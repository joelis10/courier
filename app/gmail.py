"""Gmail REST client, OAuth flow, and MIME parsing.

Only the Python standard library is used. Errors are turned into GmailError with a
message suitable for showing in the UI.
"""

from __future__ import annotations

import base64
import email
import email.message
import email.policy
import email.utils
import json
import mimetypes
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any

from . import APP_VERSION
from .store import Store

AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke"
API_ROOT = "https://gmail.googleapis.com/gmail/v1/users/me"
UPLOAD_ROOT = "https://gmail.googleapis.com/upload/gmail/v1/users/me"
SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
]
USER_AGENT = f"Courier/{APP_VERSION} (local Gmail client)"
MAX_SEND_BYTES = 34 * 1024 * 1024
LARGE_MESSAGE_BYTES = 2 * 1024 * 1024


class GmailError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.message = message
        self.status = status


class AuthError(GmailError):
    pass


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _header_map(headers: list[dict[str, str]] | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for header in headers or []:
        name = (header.get("name") or "").lower()
        if name and name not in out:
            out[name] = header.get("value") or ""
    return out


def _addresses(value: str) -> list[dict[str, str]]:
    out = []
    for name, addr in email.utils.getaddresses([value or ""]):
        addr = (addr or "").strip()
        if not addr:
            continue
        out.append({"name": (name or "").strip() or addr.split("@")[0], "email": addr})
    return out


def _one_address(value: str) -> dict[str, str]:
    found = _addresses(value)
    if found:
        return found[0]
    return {"name": "", "email": ""}


def _decode_part(part: dict[str, Any]) -> str:
    data = (part.get("body") or {}).get("data")
    if not data:
        return ""
    raw = _b64url_decode(data)
    headers = _header_map(part.get("headers"))
    charset = "utf-8"
    ctype = headers.get("content-type", "")
    if ctype:
        try:
            msg = email.message_from_string(f"Content-Type: {ctype}\n\n", policy=email.policy.default)
            charset = msg.get_content_charset() or "utf-8"
        except Exception:
            pass
    for candidate in (charset, "utf-8", "latin-1"):
        try:
            return raw.decode(candidate)
        except (LookupError, UnicodeDecodeError):
            continue
    return raw.decode("utf-8", "replace")


def _guess_mime(filename: str, fallback: str = "application/octet-stream") -> str:
    if fallback and "/" in fallback:
        return fallback
    guess, _ = mimetypes.guess_type(filename or "")
    return guess or fallback or "application/octet-stream"


def _plain_to_html(text: str) -> str:
    import html as html_module

    escaped = html_module.escape(text or "")
    paras = re.split(r"\n{2,}", escaped)
    return "".join(f"<p>{p.replace(chr(10), '<br>')}</p>" for p in paras)


def _walk_parts(part: dict[str, Any]):
    yield part
    for child in part.get("parts") or []:
        yield from _walk_parts(child)


def _has_attachment(payload: dict[str, Any]) -> bool:
    for part in _walk_parts(payload):
        filename = part.get("filename") or ""
        if not filename:
            continue
        headers = _header_map(part.get("headers"))
        disp = (headers.get("content-disposition") or "").lower()
        mime = part.get("mimeType") or ""
        if "inline" in disp and mime.startswith("image/"):
            continue
        return True
    return False


class GmailClient:
    def __init__(self, store: Store):
        self.store = store
        self._refresh_lock = threading.Lock()

    # ------------------------------------------------------------------ oauth

    @staticmethod
    def make_state() -> tuple[str, str, str]:
        """Return state, PKCE verifier, and S256 challenge."""
        import hashlib
        import secrets

        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        challenge = _b64url_encode(hashlib.sha256(verifier.encode("ascii")).digest())
        return state, verifier, challenge

    def auth_url(self, *, client_id: str, redirect_uri: str, state: str, challenge: str) -> str:
        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(SCOPES),
            "access_type": "offline",
            "prompt": "consent select_account",
            "include_granted_scopes": "true",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        return AUTH_ENDPOINT + "?" + urllib.parse.urlencode(params)

    def exchange_code(
        self,
        *,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        code: str,
        verifier: str,
    ) -> dict[str, Any]:
        body = urllib.parse.urlencode(
            {
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
                "code_verifier": verifier,
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            TOKEN_ENDPOINT,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": USER_AGENT,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            try:
                detail = json.loads(exc.read().decode("utf-8"))
            except Exception:
                detail = {}
            message = detail.get("error_description") or detail.get("error") or "Token exchange failed"
            raise AuthError(str(message), status=400) from exc
        except Exception as exc:
            raise AuthError(f"Could not reach Google: {exc}", status=502) from exc

    @staticmethod
    def profile_name(tokens: dict[str, Any]) -> str:
        id_token = str(tokens.get("id_token") or "")
        if id_token:
            try:
                parts = id_token.split(".")
                if len(parts) >= 2:
                    raw = parts[1] + "=" * (-len(parts[1]) % 4)
                    claims = json.loads(
                        base64.urlsafe_b64decode(raw).decode("utf-8")
                    )
                    name = str(claims.get("name") or "").strip()
                    if name:
                        return name
            except Exception:
                pass
        access = str(tokens.get("access_token") or "")
        if access:
            try:
                request = urllib.request.Request(
                    "https://openidconnect.googleapis.com/v1/userinfo",
                    headers={
                        "Authorization": f"Bearer {access}",
                        "User-Agent": USER_AGENT,
                    },
                )
                with urllib.request.urlopen(request, timeout=20) as response:
                    data = json.loads(response.read().decode("utf-8"))
                return str(data.get("name") or "").strip()
            except Exception:
                pass
        return ""

    def connect_account(self, tokens: dict[str, Any]) -> dict[str, Any]:
        refresh = tokens.get("refresh_token") or ""
        access = tokens.get("access_token") or ""
        if not refresh or not access:
            raise AuthError(
                "Google did not return a refresh token. Remove Courier from your Google "
                "account permissions and try again.",
                status=400,
            )
        temp = {
            "access_token": access,
            "refresh_token": refresh,
            "token_expiry": int(time.time() * 1000) + int(tokens.get("expires_in", 3600)) * 1000,
            "email": "",
            "id": "",
        }
        profile = self._api_with_token(temp, "GET", "profile")
        email_address = profile.get("emailAddress") or ""
        if not email_address:
            raise AuthError("Google did not return an email address.", status=400)
        display_name = self.profile_name(tokens)
        existing = self.store.get_account_by_email(email_address)
        account_id = existing["id"] if existing else uuid.uuid4().hex
        scope = tokens.get("scope") or " ".join(SCOPES)
        if existing:
            updates: dict[str, Any] = {
                "access_token": access,
                "refresh_token": refresh,
                "token_expiry": temp["token_expiry"],
                "scope": scope,
                "needs_reauth": 0,
            }
            current_name = str(existing["name"] or "").strip()
            local = email_address.split("@")[0]
            username = str(existing["username"] or "").strip()
            if display_name and (
                not current_name
                or current_name.lower()
                in {
                    local.lower(),
                    email_address.lower(),
                    username.lower(),
                }
            ):
                updates["name"] = display_name
            self.store.update_account(account_id, **updates)
        else:
            used = {row["color"] for row in self.store.accounts()}
            from .theme import ACCOUNT_COLORS

            color = next((c for c in ACCOUNT_COLORS if c not in used), ACCOUNT_COLORS[len(used) % len(ACCOUNT_COLORS)])
            self.store.add_account(
                account_id=account_id,
                email=email_address,
                name=display_name or email_address.split("@")[0],
                color=color,
                access_token=access,
                refresh_token=refresh,
                token_expiry=temp["token_expiry"],
                scope=scope,
                history_id=profile.get("historyId"),
            )
        return {
            "id": account_id,
            "email": email_address,
            "reauth": bool(existing),
            "history_id": profile.get("historyId"),
        }

    def _refresh(self, account_id: str, force: bool = False) -> dict[str, Any]:
        client_id = self.store.get_setting("oauth_client_id")
        client_secret = self.store.get_setting("oauth_client_secret")
        if not client_id or not client_secret:
            raise AuthError("Google OAuth credentials are missing.")
        with self._refresh_lock:
            account = self.store.get_account(account_id)
            if not account:
                raise AuthError("Account not found.", status=404)
            now = int(time.time() * 1000)
            if (
                not force
                and account["access_token"]
                and int(account["token_expiry"] or 0) > now + 60_000
            ):
                return dict(account)
            body = urllib.parse.urlencode(
                {
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "refresh_token": account["refresh_token"],
                    "grant_type": "refresh_token",
                }
            ).encode("utf-8")
            request = urllib.request.Request(
                TOKEN_ENDPOINT,
                data=body,
                method="POST",
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": USER_AGENT,
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    tokens = json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                detail = {}
                try:
                    detail = json.loads(exc.read().decode("utf-8"))
                except Exception:
                    pass
                self.store.update_account(account_id, needs_reauth=1)
                message = detail.get("error_description") or detail.get("error") or "Google sign-in expired"
                raise AuthError(f"{account['email']}: {message}", status=401) from exc
            except Exception as exc:
                raise GmailError(f"Could not refresh Google sign-in: {exc}", status=502) from exc
            expiry = int(time.time() * 1000) + int(tokens.get("expires_in", 3600)) * 1000
            self.store.update_account(
                account_id,
                access_token=tokens.get("access_token"),
                token_expiry=expiry,
                needs_reauth=0,
                scope=tokens.get("scope") or account["scope"],
            )
            updated = dict(self.store.get_account(account_id))
            return updated

    def access_token(self, account_id: str, force: bool = False) -> str:
        account = self._refresh(account_id, force=force)
        token = account.get("access_token")
        if not token:
            raise AuthError("Google sign-in is missing.", status=401)
        return token

    def revoke(self, account_id: str) -> None:
        account = self.store.get_account(account_id)
        if not account:
            return
        token = account["refresh_token"] or account["access_token"]
        if not token:
            return
        try:
            data = urllib.parse.urlencode({"token": token}).encode("utf-8")
            request = urllib.request.Request(
                REVOKE_ENDPOINT,
                data=data,
                method="POST",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            urllib.request.urlopen(request, timeout=10).close()
        except Exception:
            pass

    # ------------------------------------------------------------------ requests

    def _request_url(self, path: str, params: dict[str, Any] | None = None) -> str:
        url = f"{API_ROOT}/{path.lstrip('/')}"
        if params:
            clean = {k: v for k, v in params.items() if v is not None}
            if clean:
                url += "?" + urllib.parse.urlencode(clean, doseq=True)
        return url

    def _api_with_token(
        self,
        token_record: dict[str, Any],
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
        timeout: int = 45,
    ) -> dict[str, Any]:
        url = self._request_url(path, params)
        data = None
        headers = {
            "Authorization": f"Bearer {token_record['access_token']}",
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
        }
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read()
                return json.loads(body.decode("utf-8")) if body else {}
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            detail = {}
            try:
                detail = json.loads(raw.decode("utf-8"))
            except Exception:
                pass
            message = (
                (detail.get("error") or {}).get("message")
                if isinstance(detail.get("error"), dict)
                else detail.get("error")
            )
            message = message or f"Gmail request failed ({exc.code})"
            raise GmailError(str(message), status=exc.code) from exc
        except urllib.error.URLError as exc:
            raise GmailError(f"Could not reach Gmail: {exc.reason}", status=502) from exc
        except TimeoutError as exc:
            raise GmailError("Gmail took too long to respond.", status=504) from exc
        except OSError as exc:
            raise GmailError(f"Could not reach Gmail: {exc}", status=502) from exc

    def _upload_with_token(
        self,
        token_record: dict[str, Any],
        method: str,
        path: str,
        metadata: dict[str, Any],
        raw: bytes,
        timeout: int = 120,
    ) -> dict[str, Any]:
        boundary = f"courier-{uuid.uuid4().hex}"
        body = b"".join(
            [
                f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode(
                    "utf-8"
                ),
                json.dumps(metadata or {}).encode("utf-8"),
                b"\r\n",
                f"--{boundary}\r\nContent-Type: message/rfc822\r\n\r\n".encode(
                    "utf-8"
                ),
                raw,
                b"\r\n",
                f"--{boundary}--\r\n".encode("utf-8"),
            ]
        )
        url = f"{UPLOAD_ROOT}/{path.lstrip('/')}?uploadType=multipart"
        headers = {
            "Authorization": f"Bearer {token_record['access_token']}",
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "Content-Type": f"multipart/related; boundary={boundary}",
        }
        request = urllib.request.Request(
            url, data=body, method=method, headers=headers
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = response.read()
                return json.loads(payload.decode("utf-8")) if payload else {}
        except urllib.error.HTTPError as exc:
            raw_error = exc.read()
            detail = {}
            try:
                detail = json.loads(raw_error.decode("utf-8"))
            except Exception:
                pass
            message = (
                (detail.get("error") or {}).get("message")
                if isinstance(detail.get("error"), dict)
                else detail.get("error")
            )
            message = message or f"Gmail request failed ({exc.code})"
            raise GmailError(str(message), status=exc.code) from exc
        except urllib.error.URLError as exc:
            raise GmailError(
                f"Could not reach Gmail: {exc.reason}", status=502
            ) from exc
        except TimeoutError as exc:
            raise GmailError("Gmail took too long to respond.", status=504) from exc
        except OSError as exc:
            raise GmailError(f"Could not reach Gmail: {exc}", status=502) from exc

    def upload(
        self,
        account_id: str,
        method: str,
        path: str,
        metadata: dict[str, Any],
        raw: bytes,
        timeout: int = 120,
        _retry: bool = True,
    ) -> dict[str, Any]:
        token = self.access_token(account_id)
        try:
            return self._upload_with_token(
                {"access_token": token},
                method,
                path,
                metadata,
                raw,
                timeout=timeout,
            )
        except GmailError as exc:
            if exc.status == 401 and _retry:
                self.access_token(account_id, force=True)
                return self.upload(
                    account_id,
                    method,
                    path,
                    metadata,
                    raw,
                    timeout=timeout,
                    _retry=False,
                )
            if exc.status == 429 and _retry:
                time.sleep(2)
                return self.upload(
                    account_id,
                    method,
                    path,
                    metadata,
                    raw,
                    timeout=timeout,
                    _retry=False,
                )
            if exc.status in (401, 403) and self.store.get_account(account_id):
                if exc.status == 401:
                    self.store.update_account(account_id, needs_reauth=1)
            raise

    def api(
        self,
        account_id: str,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
        timeout: int = 45,
        _retry: bool = True,
    ) -> dict[str, Any]:
        token = self.access_token(account_id)
        account = self.store.get_account(account_id)
        try:
            return self._api_with_token(
                {"access_token": token}, method, path, params=params, payload=payload, timeout=timeout
            )
        except GmailError as exc:
            if exc.status == 401 and _retry:
                self.access_token(account_id, force=True)
                return self.api(
                    account_id,
                    method,
                    path,
                    params=params,
                    payload=payload,
                    timeout=timeout,
                    _retry=False,
                )
            if exc.status == 429 and _retry:
                time.sleep(2)
                return self.api(
                    account_id,
                    method,
                    path,
                    params=params,
                    payload=payload,
                    timeout=timeout,
                    _retry=False,
                )
            if exc.status in (401, 403) and self.store.get_account(account_id):
                if exc.status == 401:
                    self.store.update_account(account_id, needs_reauth=1)
            raise

    def profile(self, account_id: str) -> dict[str, Any]:
        return self.api(account_id, "GET", "profile")

    def labels(self, account_id: str) -> list[dict[str, Any]]:
        response = self.api(account_id, "GET", "labels")
        return response.get("labels") or []

    def list_thread_ids(
        self,
        account_id: str,
        *,
        label: str | None = None,
        query: str | None = None,
        max_results: int = 100,
        page_token: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"maxResults": max_results}
        if label:
            params["labelIds"] = [label]
        if query:
            params["q"] = query
        if page_token:
            params["pageToken"] = page_token
        return self.api(account_id, "GET", "threads", params=params)

    def get_thread(self, account_id: str, thread_id: str, fmt: str = "metadata") -> dict[str, Any]:
        return self.api(
            account_id,
            "GET",
            f"threads/{urllib.parse.quote(thread_id, safe='')}",
            params={"format": fmt},
        )

    def modify_thread(
        self,
        account_id: str,
        thread_id: str,
        *,
        add: list[str] | None = None,
        remove: list[str] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        if add:
            payload["addLabelIds"] = add
        if remove:
            payload["removeLabelIds"] = remove
        return self.api(
            account_id,
            "POST",
            f"threads/{urllib.parse.quote(thread_id, safe='')}/modify",
            payload=payload,
        )

    def trash_thread(self, account_id: str, thread_id: str) -> dict[str, Any]:
        return self.api(
            account_id,
            "POST",
            f"threads/{urllib.parse.quote(thread_id, safe='')}/trash",
            payload={},
        )

    def untrash_thread(self, account_id: str, thread_id: str) -> dict[str, Any]:
        return self.api(
            account_id,
            "POST",
            f"threads/{urllib.parse.quote(thread_id, safe='')}/untrash",
            payload={},
        )

    def history(self, account_id: str, start_history_id: str) -> dict[str, Any]:
        return self.api(
            account_id,
            "GET",
            "history",
            params={"startHistoryId": start_history_id, "maxResults": 500},
        )

    def send_raw(self, account_id: str, raw: bytes, thread_id: str | None = None) -> dict[str, Any]:
        if len(raw) > LARGE_MESSAGE_BYTES:
            metadata = {"threadId": thread_id} if thread_id else {}
            return self.upload(
                account_id,
                "POST",
                "messages/send",
                metadata,
                raw,
                timeout=240,
            )
        encoded = base64.urlsafe_b64encode(raw).decode("ascii")
        payload = {"raw": encoded}
        if thread_id:
            payload["threadId"] = thread_id
        return self.api(account_id, "POST", "messages/send", payload=payload, timeout=90)

    def list_drafts(self, account_id: str, max_results: int = 100) -> dict[str, Any]:
        return self.api(
            account_id,
            "GET",
            "drafts",
            params={"maxResults": max_results},
        )

    def get_draft(self, account_id: str, draft_id: str) -> dict[str, Any]:
        return self.api(
            account_id,
            "GET",
            f"drafts/{urllib.parse.quote(draft_id, safe='')}",
            params={"format": "full"},
        )

    def create_draft(
        self,
        account_id: str,
        raw: bytes,
        thread_id: str | None = None,
    ) -> dict[str, Any]:
        if len(raw) > LARGE_MESSAGE_BYTES:
            metadata = (
                {"message": {"threadId": thread_id}}
                if thread_id
                else {"message": {}}
            )
            return self.upload(
                account_id, "POST", "drafts", metadata, raw, timeout=240
            )
        return self.api(
            account_id,
            "POST",
            "drafts",
            payload={"message": self._draft_message(raw, thread_id)},
            timeout=90,
        )

    def update_draft(
        self,
        account_id: str,
        draft_id: str,
        raw: bytes,
        thread_id: str | None = None,
    ) -> dict[str, Any]:
        if len(raw) > LARGE_MESSAGE_BYTES:
            metadata = (
                {"message": {"threadId": thread_id}}
                if thread_id
                else {"message": {}}
            )
            return self.upload(
                account_id,
                "PUT",
                f"drafts/{urllib.parse.quote(draft_id, safe='')}",
                metadata,
                raw,
                timeout=240,
            )
        return self.api(
            account_id,
            "PUT",
            f"drafts/{urllib.parse.quote(draft_id, safe='')}",
            payload={"message": self._draft_message(raw, thread_id)},
            timeout=90,
        )

    def delete_draft(self, account_id: str, draft_id: str) -> dict[str, Any]:
        return self.api(
            account_id,
            "DELETE",
            f"drafts/{urllib.parse.quote(draft_id, safe='')}",
        )

    @staticmethod
    def _draft_message(raw: bytes, thread_id: str | None) -> dict[str, Any]:
        payload = {"raw": base64.urlsafe_b64encode(raw).decode("ascii")}
        if thread_id:
            payload["threadId"] = thread_id
        return payload

    def attachment(self, account_id: str, message_id: str, attachment_id: str) -> bytes:
        response = self.api(
            account_id,
            "GET",
            f"messages/{urllib.parse.quote(message_id, safe='')}/attachments/"
            f"{urllib.parse.quote(attachment_id, safe='')}",
            timeout=90,
        )
        return _b64url_decode(response.get("data") or "")


# ---------------------------------------------------------------------- parsing


def build_thread_summary(account_id: str, account_email: str, thread: dict[str, Any]) -> dict[str, Any]:
    messages = thread.get("messages") or []
    if not messages:
        raise GmailError("Thread has no messages.")
    headers_by_message: list[tuple[dict[str, Any], dict[str, str]]] = []
    for msg in messages:
        payload = msg.get("payload") or {}
        headers_by_message.append((msg, _header_map(payload.get("headers"))))

    def sort_key(item):
        return int(item[0].get("internalDate") or 0)

    headers_by_message.sort(key=sort_key)
    last_msg, last_headers = headers_by_message[-1]

    labels: set[str] = set()
    unread = False
    starred = False
    participants: list[dict[str, str]] = []
    seen: set[str] = set()
    for msg, headers in headers_by_message:
        for label in msg.get("labelIds") or []:
            labels.add(label)
        if "UNREAD" in (msg.get("labelIds") or []):
            unread = True
        if "STARRED" in (msg.get("labelIds") or []):
            starred = True
        for field in ("from", "to", "cc"):
            for person in _addresses(headers.get(field, "")):
                key = person["email"].lower()
                if key and key not in seen:
                    seen.add(key)
                    participants.append(person)

    from_person = _one_address(last_headers.get("from", ""))
    displayed_from = from_person
    if (
        ("SENT" in labels or "DRAFT" in labels)
        and from_person["email"].lower() == account_email.lower()
    ):
        recipients = _addresses(last_headers.get("to", ""))
        if recipients:
            displayed_from = recipients[0]

    subject = last_headers.get("subject") or ""
    if not subject:
        for _, headers in headers_by_message:
            if headers.get("subject"):
                subject = headers["subject"]
                break

    has_attachment = any(
        _has_attachment(message.get("payload") or {}) for message, _ in headers_by_message
    )
    summary = {
        "account_id": account_id,
        "id": thread.get("id", ""),
        "subject": subject,
        "snippet": last_msg.get("snippet") or thread.get("snippet") or "",
        "last_date": int(last_msg.get("internalDate") or 0),
        "message_count": len(messages),
        "labels": sorted(labels),
        "unread": unread,
        "starred": starred,
        "has_attachment": has_attachment,
        "participants": participants[:12],
        "sender_name": displayed_from["name"],
        "sender_email": displayed_from["email"],
        "last_from_email": from_person["email"],
    }
    return summary


def parse_thread_full(account_id: str, thread: dict[str, Any]) -> list[dict[str, Any]]:
    messages = thread.get("messages") or []
    out: list[dict[str, Any]] = []
    for msg in messages:
        out.append(parse_message(account_id, msg))
    out.sort(key=lambda m: m.get("date") or 0)
    return out


def parse_message(account_id: str, msg: dict[str, Any]) -> dict[str, Any]:
    payload = msg.get("payload") or {}
    headers = _header_map(payload.get("headers"))
    html_chunks: list[str] = []
    text_chunks: list[str] = []
    attachments: list[dict[str, Any]] = []

    for part in _walk_parts(payload):
        mime = part.get("mimeType") or ""
        body = part.get("body") or {}
        filename = part.get("filename") or ""
        part_headers = _header_map(part.get("headers"))
        content_id = (part_headers.get("content-id") or "").strip().strip("<>")
        disposition = (part_headers.get("content-disposition") or "").lower()
        attachment_id = body.get("attachmentId")
        has_attachment_marker = bool(filename or attachment_id) and mime not in (
            "multipart/alternative",
            "multipart/mixed",
            "multipart/related",
        )
        if has_attachment_marker:
            is_inline = "inline" in disposition or (
                bool(content_id) and "attachment" not in disposition
            )
            data = body.get("data")
            attachments.append(
                {
                    "id": part.get("partId") or "",
                    "filename": filename or ("image" if mime.startswith("image/") else "attachment"),
                    "mime": _guess_mime(filename, mime),
                    "size": int(body.get("size") or 0),
                    "content_id": content_id,
                    "inline": is_inline,
                    "attachment_id": attachment_id or "",
                    "data": data or "",
                }
            )
            # A part can still be an inline body variant; don't use it as the main body.
            continue
        if mime == "text/html":
            html_chunks.append(_decode_part(part))
        elif mime == "text/plain":
            text_chunks.append(_decode_part(part))
        elif mime == "message/rfc822" and filename:
            attachments.append(
                {
                    "id": part.get("partId") or "",
                    "filename": filename,
                    "mime": "message/rfc822",
                    "size": int(body.get("size") or 0),
                    "content_id": content_id,
                    "inline": False,
                    "attachment_id": attachment_id or "",
                    "data": body.get("data") or "",
                }
            )

    body_html = "\n".join(chunk for chunk in html_chunks if chunk.strip())
    body_text = "\n".join(chunk for chunk in text_chunks if chunk.strip())
    if not body_html.strip() and body_text.strip():
        body_html = _plain_to_html(body_text)

    from_person = _one_address(headers.get("from", ""))
    to = _addresses(headers.get("to", ""))
    cc = _addresses(headers.get("cc", ""))
    bcc = _addresses(headers.get("bcc", ""))
    try:
        date = int(msg.get("internalDate") or 0)
    except (TypeError, ValueError):
        date = 0
    if not date and headers.get("date"):
        try:
            date = int(email.utils.parsedate_to_datetime(headers["date"]).timestamp() * 1000)
        except Exception:
            date = 0

    return {
        "account_id": account_id,
        "id": msg.get("id", ""),
        "thread_id": msg.get("threadId", ""),
        "subject": headers.get("subject") or "",
        "from_name": from_person["name"],
        "from_email": from_person["email"],
        "to": to,
        "cc": cc,
        "bcc": bcc,
        "date": date,
        "snippet": msg.get("snippet") or "",
        "body_html": body_html,
        "body_text": body_text,
        "message_id": headers.get("message-id") or "",
        "refs": headers.get("references") or "",
        "in_reply_to": headers.get("in-reply-to") or "",
        "labels": msg.get("labelIds") or [],
        "attachments": attachments,
        "body_loaded": True,
    }


# ---------------------------------------------------------------------- sending


def build_mime(
    *,
    account_email: str,
    from_name: str,
    to: list[dict[str, str]],
    cc: list[dict[str, str]],
    bcc: list[dict[str, str]],
    subject: str,
    text: str,
    html: str,
    attachments: list[dict[str, Any]],
    in_reply_to: str = "",
    references: str = "",
) -> bytes:
    message = email.message.EmailMessage()

    def clean_header(value: str) -> str:
        return re.sub(r"[\r\n]+", " ", str(value or "")).strip()

    def clean_addr(people: list[dict[str, str]]) -> str:
        clean = []
        for person in people:
            addr = clean_header(person.get("email") or "")
            name = clean_header(person.get("name") or "")
            if addr:
                clean.append(email.utils.formataddr((name, addr)))
        return ", ".join(clean)

    def addr_list(people: list[dict[str, str]]) -> str:
        return clean_addr(people)

    message["From"] = email.utils.formataddr(
        (clean_header(from_name) or account_email.split("@")[0], account_email)
    )
    if to:
        message["To"] = addr_list(to)
    if cc:
        message["Cc"] = addr_list(cc)
    if bcc:
        message["Bcc"] = addr_list(bcc)
    message["Subject"] = clean_header(subject)
    message["Date"] = email.utils.formatdate(localtime=True)
    message["MIME-Version"] = "1.0"
    if in_reply_to:
        message["In-Reply-To"] = clean_header(in_reply_to)
    if references:
        message["References"] = clean_header(references)
    total = 0
    decoded = []
    for item in attachments:
        try:
            data = base64.b64decode(item.get("data") or "")
        except Exception:
            continue
        total += len(data)
        if total > MAX_SEND_BYTES:
            raise GmailError("Attachments are larger than 34 MB.", status=400)
        filename = (
            re.sub(r"[\r\n]+", " ", str(item.get("filename") or "attachment")).strip()
            or "attachment"
        )
        mime = str(
            item.get("mime")
            or mimetypes.guess_type(filename)[0]
            or "application/octet-stream"
        )
        if "/" in mime:
            maintype, subtype = mime.split("/", 1)
        else:
            maintype, subtype = "application", "octet-stream"
        maintype = re.sub(r"[^A-Za-z0-9.+-]", "", maintype) or "application"
        subtype = re.sub(r"[^A-Za-z0-9.+-]", "", subtype) or "octet-stream"
        decoded.append((item, data, maintype, subtype, filename))

    inline_parts = [
        part
        for part in decoded
        if part[0].get("inline") and part[0].get("content_id")
    ]
    file_parts = [
        part
        for part in decoded
        if not (part[0].get("inline") and part[0].get("content_id"))
    ]

    if inline_parts:
        message.set_type("multipart/mixed")
        related = email.message.EmailMessage()
        related.set_type("multipart/related")
        body = email.message.EmailMessage()
        if html:
            body.set_content(text or "This message is in HTML format.")
            body.add_alternative(html, subtype="html")
        else:
            body.set_content(text or "")
        related.attach(body)
        for item, data, maintype, subtype, filename in inline_parts:
            cid = re.sub(r"[\r\n<>]", "", str(item.get("content_id") or ""))
            image = email.message.EmailMessage()
            image.set_content(
                data,
                maintype=maintype,
                subtype=subtype,
                filename=filename,
                disposition="inline",
            )
            if cid:
                image["Content-ID"] = f"<{cid}>"
            related.attach(image)
        message.attach(related)
        for item, data, maintype, subtype, filename in file_parts:
            message.add_attachment(
                data, maintype=maintype, subtype=subtype, filename=filename
            )
    else:
        if html:
            message.set_content(text or "This message is in HTML format.")
            message.add_alternative(html, subtype="html")
        else:
            message.set_content(text or "")
        for item, data, maintype, subtype, filename in file_parts:
            message.add_attachment(
                data, maintype=maintype, subtype=subtype, filename=filename
            )
    raw = bytes(message)
    if len(raw) > MAX_SEND_BYTES:
        raise GmailError(
            "This message is larger than 34 MB. Remove some attachments or inline images.",
            status=400,
        )
    return raw
