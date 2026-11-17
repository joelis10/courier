"""Local HTTP server and JSON API.

The server binds to loopback only, and every data route requires the random page token
created at startup. Static assets are public within the local origin.
"""

from __future__ import annotations

import base64
import html
import json
import mimetypes
import os
import re
import secrets
import threading
import time
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .ai import AIClient, AIError, message_messages, thread_messages
from .gmail import AuthError, GmailClient, GmailError, parse_message
from .store import FOLDERS, Store
from .sync import SyncManager

WEB_ROOT = Path(__file__).resolve().parent / "web"
TOKEN_HEADER = "X-Courier-Token"


def _outgoing_name(account) -> str:
    email = str(account["email"] or "")
    local = email.split("@")[0]
    name = str(account["name"] or "").strip()
    return name or local

UI_THEMES = {"fog", "linen", "sepia", "graphite", "midnight"}
UI_EMAIL_THEMES = {"fog", "linen", "sepia", "graphite", "midnight"}
UI_PREF_DEFAULTS = {
    "theme": "fog",
    "accent": "#3E6FA8",
    "hideSignatures": True,
    "hideQuotes": True,
    "blockImages": True,
    "layout": "split",
    "composerMode": "tray",
    "sidebarCollapsed": False,
    "trayHeight": None,
    "contentWidth": "wide",
    "badgePosition": "before-subject",
    "labelPosition": "after-subject",
    "sidebarWidth": None,
    "listWidth": None,
    "emailTheme": "fog",
    "closeBehavior": "tray",
    "minimizeBehavior": "default",
    "loginStartup": "off",
    "notifyEnabled": True,
    "notifyArchived": False,
    "notifySound": "soft-knock",
    "notifyVolume": 60,
    "notifySoundPath": None,
    "notifyShowAccount": True,
    "notifyBadgePosition": "before-subject",
    "notifyUseAI": False,
    "notifyAIMinChars": 400,
}
UI_BOOLEAN_PREFS = {
    "hideSignatures",
    "hideQuotes",
    "blockImages",
    "sidebarCollapsed",
    "notifyEnabled",
    "notifyArchived",
    "notifyShowAccount",
    "notifyUseAI",
}


def _mix_hex(hex_value: str, other: str, amount: float) -> str:
    def rgb(value: str) -> tuple[int, int, int]:
        value = value.lstrip("#")
        return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))

    a = rgb(hex_value)
    b = rgb(other)
    values = [round(x + (y - x) * amount) for x, y in zip(a, b)]
    return "#" + "".join(f"{value:02x}" for value in values)


def _clean_ui_prefs(value: Any) -> dict[str, Any]:
    prefs = dict(UI_PREF_DEFAULTS)
    if not isinstance(value, dict):
        return prefs
    theme = value.get("theme")
    if theme in UI_THEMES:
        prefs["theme"] = theme
    accent = str(value.get("accent") or "")
    if re.fullmatch(r"#[0-9a-fA-F]{6}", accent):
        prefs["accent"] = accent.upper()
    for key in UI_BOOLEAN_PREFS:
        if isinstance(value.get(key), bool):
            prefs[key] = value[key]
    if value.get("layout") in ("split", "reading"):
        prefs["layout"] = value["layout"]
    if value.get("composerMode") in ("tray", "panel"):
        prefs["composerMode"] = value["composerMode"]
    if value.get("contentWidth") in ("standard", "wide", "full"):
        prefs["contentWidth"] = value["contentWidth"]
    if value.get("badgePosition") in (
        "before-sender",
        "after-sender",
        "before-subject",
        "after-subject",
    ):
        prefs["badgePosition"] = value["badgePosition"]
    if value.get("labelPosition") in (
        "before-sender",
        "after-sender",
        "before-subject",
        "after-subject",
    ):
        prefs["labelPosition"] = value["labelPosition"]
    tray_height = value.get("trayHeight")
    if isinstance(tray_height, (int, float)) and 120 <= tray_height <= 1000:
        prefs["trayHeight"] = int(tray_height)
    for key, low, high in (
        ("sidebarWidth", 180, 420),
        ("listWidth", 280, 760),
    ):
        width = value.get(key)
        if isinstance(width, (int, float)) and low <= width <= high:
            prefs[key] = int(width)
    email_theme = value.get("emailTheme")
    email_theme = {
        "paper": "fog",
        "white": "fog",
        "dark": "midnight",
    }.get(email_theme, email_theme)
    if email_theme in UI_EMAIL_THEMES:
        prefs["emailTheme"] = email_theme
    if value.get("closeBehavior") in ("tray", "quit"):
        prefs["closeBehavior"] = value["closeBehavior"]
    if value.get("minimizeBehavior") in ("default", "tray"):
        prefs["minimizeBehavior"] = value["minimizeBehavior"]
    if value.get("loginStartup") in ("off", "minimized", "foreground"):
        prefs["loginStartup"] = value["loginStartup"]
    if value.get("notifySound") in (
        "soft-knock",
        "bell",
        "message",
        "complete",
        "attention",
        "system",
        "none",
        "custom",
    ):
        prefs["notifySound"] = value["notifySound"]
    try:
        notify_volume = int(value.get("notifyVolume"))
    except (TypeError, ValueError):
        notify_volume = 60
    prefs["notifyVolume"] = min(100, max(0, notify_volume))
    sound_path = value.get("notifySoundPath")
    if isinstance(sound_path, str) and 0 < len(sound_path) <= 1024:
        prefs["notifySoundPath"] = sound_path
    if value.get("notifyBadgePosition") in (
        "before-sender",
        "after-sender",
        "before-subject",
        "after-subject",
    ):
        prefs["notifyBadgePosition"] = value["notifyBadgePosition"]
    try:
        min_chars = int(value.get("notifyAIMinChars"))
    except (TypeError, ValueError):
        min_chars = 400
    prefs["notifyAIMinChars"] = min(5000, max(80, min_chars))
    return prefs


def _load_ui_prefs(store: Store) -> dict[str, Any]:
    try:
        parsed = json.loads(store.get_setting("ui_prefs") or "{}")
    except (TypeError, ValueError):
        parsed = {}
    return _clean_ui_prefs(parsed)


def _accent_style(theme: str, accent: str) -> str:
    rgb_value = accent.lstrip("#")
    r = int(rgb_value[0:2], 16)
    g = int(rgb_value[2:4], 16)
    b = int(rgb_value[4:6], 16)
    luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    contrast = "#1f1b15" if luminance > 0.62 else "#ffffff"
    ink = (
        _mix_hex(accent, "#ffffff", 0.4)
        if theme in ("graphite", "midnight")
        else _mix_hex(accent, "#000000", 0.22)
    )
    return (
        f"--accent:{accent};--accent-rgb:{r}, {g}, {b};"
        f"--accent-contrast:{contrast};--accent-ink:{ink}"
    )


def _now_ms() -> int:
    return int(time.time() * 1000)


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


class App:
    def __init__(self, data_dir: str | Path, log: callable | None = None):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.log_path = self.data_dir / "courier.log"
        self._log_lock = threading.Lock()
        self._external_log = log
        self.store = Store(self.data_dir / "courier.db")
        self.gmail = GmailClient(self.store)
        self.sync = SyncManager(self.store, self.gmail, log=self.log)
        self.ai = AIClient(self.store)
        self.page_token = secrets.token_urlsafe(32)
        self.port = 0
        self.base_url = ""
        self.oauth_pending: dict[str, dict[str, Any]] = {}
        self.oauth_lock = threading.Lock()
        self.httpd: ThreadingHTTPServer | None = None
        self.open_attachment = None
        self.open_attachment_file = None
        self.download_attachment = None
        self.choose_attachments = None

    # ------------------------------------------------------------------ util

    def log(self, message: str) -> None:
        line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}"
        with self._log_lock:
            try:
                with open(self.log_path, "a", encoding="utf-8") as handle:
                    handle.write(line + "\n")
            except OSError:
                pass
        if self._external_log:
            self._external_log(line)

    def public_settings(self) -> dict[str, Any]:
        return {
            "oauth_client_id": self.store.get_setting("oauth_client_id") or "",
            "oauth_client_secret_set": bool(self.store.get_setting("oauth_client_secret")),
            "ai_base_url": self.store.get_setting("ai_base_url") or "",
            "ai_model": self.store.get_setting("ai_model") or "",
            "ai_api_key_set": bool(self.store.get_setting("ai_api_key")),
            "ai_configured": self.ai.configured(),
            "refresh_mode": self.store.get_setting("refresh_mode") or "fast",
        }

    def account_public(self, row) -> dict[str, Any]:
        counts = self.store.counts()["accounts"].get(row["id"], {})
        stored_username = row["username"] if "username" in row.keys() else None
        return {
            "id": row["id"],
            "email": row["email"],
            "username": (stored_username or "").strip() or row["email"].split("@")[0],
            "name": _outgoing_name(row),
            "color": row["color"],
            "needs_reauth": bool(row["needs_reauth"]),
            "default_view_id": row["default_view_id"]
            if "default_view_id" in row.keys()
            else None,
            "last_sync": row["last_sync"] or 0,
            "unread": counts.get("unread", 0),
            "inbox_unread": counts.get("inbox_unread", 0),
            "folders": counts.get("folders", {}),
        }

    def state(self) -> dict[str, Any]:
        counts = self.store.counts()
        return {
            "accounts": [self.account_public(row) for row in self.store.accounts()],
            "counts": counts["total"],
            "labels": self.store.label_summary(),
            "views": self.store.views(),
            "sync": self.sync.status(),
            "settings": self.public_settings(),
            "prefs": _load_ui_prefs(self.store),
            "oauth_pending": any(
                p.get("status") == "pending" for p in self.oauth_pending.values()
            ),
        }

    # ------------------------------------------------------------------ lifecycle

    def start(self) -> int:
        app = self

        class Handler(ApiHandler):
            pass

        self.httpd = CourierServer(("127.0.0.1", 0), Handler, app)
        self.port = self.httpd.server_address[1]
        self.base_url = f"http://127.0.0.1:{self.port}"
        thread = threading.Thread(
            target=self.httpd.serve_forever,
            daemon=True,
            name="courier-http",
        )
        thread.start()
        if os.environ.get("COURIER_DEMO") != "1":
            self.sync.start_background()
        self.log(f"Courier server on {self.base_url}")
        return self.port

    def stop(self) -> None:
        self.sync.stop()
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
        self.store.close()


class CourierServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, handler, app: App):
        self.app = app
        super().__init__(address, handler)


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "Courier"
    protocol_version = "HTTP/1.1"

    @property
    def app(self) -> App:
        return self.server.app  # type: ignore[attr-defined]

    # ------------------------------------------------------------------ plumbing

    def log_message(self, fmt: str, *args) -> None:
        return

    def _url(self):
        return urllib.parse.urlparse(self.path)

    def _query(self) -> dict[str, list[str]]:
        return urllib.parse.parse_qs(self._url().query, keep_blank_values=True)

    def _token(self) -> str:
        header = self.headers.get(TOKEN_HEADER) or ""
        if header:
            return header
        values = self._query().get("t")
        return values[0] if values else ""

    def _check_token(self) -> None:
        supplied = self._token()
        if not supplied or not secrets.compare_digest(supplied, self.app.page_token):
            raise ApiError("Unauthorized", status=403)

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        if length > 30 * 1024 * 1024:
            raise ApiError("Request body is too large.", status=413)
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ApiError("Malformed JSON.") from exc

    def _send_bytes(
        self,
        body: bytes,
        *,
        status: int = 200,
        content_type: str = "application/octet-stream",
        headers: dict[str, str] | None = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if headers:
            for key, value in headers.items():
                self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _send_json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send_bytes(
            body,
            status=status,
            content_type="application/json; charset=utf-8",
            headers={"Cache-Control": "no-store"},
        )

    def _error(self, message: str, status: int = 400) -> None:
        self._send_json({"error": message}, status=status)

    # ------------------------------------------------------------------ verbs

    def do_GET(self) -> None:
        url = self._url()
        try:
            if url.path == "/oauth/callback":
                self._oauth_callback()
                return
            if url.path in ("/", "/index.html"):
                query = self._query()
                if "state" in query and ("code" in query or "error" in query):
                    self._oauth_callback()
                    return
                self._serve_index()
                return
            if url.path.startswith("/api/"):
                self._check_token()
                self._handle_get(url.path, self._query())
                return
            self._serve_static(url.path)
        except ApiError as exc:
            self._error(exc.message, exc.status)
        except GmailError as exc:
            self._error(exc.message, exc.status if exc.status in (400, 401, 403, 404) else 502)
        except AIError as exc:
            self._error(exc.message, exc.status)
        except Exception as exc:  # pragma: no cover - defensive
            self.app.log(f"GET {url.path}: {exc!r}")
            self._error("Internal error. See courier.log.", 500)

    def do_POST(self) -> None:
        url = self._url()
        try:
            if url.path.startswith("/api/"):
                self._check_token()
                payload = self._read_json()
                if url.path == "/api/sync":
                    started = self.app.sync.trigger(manual=True)
                    self._send_json({"started": started, "sync": self.app.sync.status()})
                    return
                if url.path == "/api/thread/action":
                    self._thread_action(payload)
                    return
                if url.path == "/api/send":
                    self._send_mail(payload)
                    return
                if url.path == "/api/search":
                    self._search(payload)
                    return
                if url.path == "/api/settings":
                    self._save_settings(payload)
                    return
                if url.path == "/api/accounts/remove":
                    self._remove_account(payload)
                    return
                if url.path == "/api/accounts/update":
                    self._update_account(payload)
                    return
                if url.path == "/api/views/save":
                    self._save_view(payload)
                    return
                if url.path == "/api/views/delete":
                    self._delete_view(payload)
                    return
                if url.path == "/api/open-attachment":
                    self._open_attachment(payload)
                    return
                if url.path == "/api/download-attachment":
                    self._download_attachment(payload)
                    return
                if url.path == "/api/choose-attachments":
                    self._choose_attachments(payload)
                    return
                if url.path == "/api/open-composer-attachment":
                    self._open_composer_attachment(payload)
                    return
                if url.path == "/api/draft":
                    self._save_draft(payload)
                    return
                if url.path == "/api/draft/delete":
                    self._delete_draft(payload)
                    return
                if url.path == "/api/notification-sound":
                    self._save_notification_sound(payload)
                    return
                if url.path == "/api/notify/test":
                    self._request_test_notification()
                    return
                if url.path == "/api/threads/older":
                    result = self.app.sync.fetch_older(
                        folder=str(payload.get("folder") or "inbox"),
                        account_id=str(payload.get("account") or "") or None,
                        label_name=str(payload.get("label_name") or ""),
                    )
                    self._send_json(result)
                    return
                if url.path == "/api/prefs":
                    incoming = payload.get("prefs")
                    merged = _load_ui_prefs(self.app.store)
                    if isinstance(incoming, dict):
                        merged.update(incoming)
                    prefs = _clean_ui_prefs(merged)
                    self.app.store.set_setting(
                        "ui_prefs", json.dumps(prefs, separators=(",", ":"))
                    )
                    self._send_json({"prefs": prefs})
                    return
                if url.path == "/api/oauth/start":
                    self._oauth_start(payload)
                    return
                if url.path == "/api/ai/test":
                    self._ai_test()
                    return
                if url.path == "/api/ai/summarize":
                    self._ai_summarize(payload)
                    return
                raise ApiError("Unknown endpoint.", status=404)
            raise ApiError("Unknown endpoint.", status=404)
        except ApiError as exc:
            self._error(exc.message, exc.status)
        except AuthError as exc:
            self._error(exc.message, 401)
        except GmailError as exc:
            self._error(exc.message, exc.status if exc.status in (400, 401, 403, 404) else 502)
        except AIError as exc:
            self._error(exc.message, exc.status)
        except Exception as exc:  # pragma: no cover - defensive
            self.app.log(f"POST {url.path}: {exc!r}")
            self._error("Internal error. See courier.log.", 500)

    # ------------------------------------------------------------------ GET routes

    def _handle_get(self, path: str, query: dict[str, list[str]]) -> None:
        def arg(name: str, default: str = "") -> str:
            values = query.get(name)
            return values[0] if values else default

        if path == "/api/state":
            self._send_json(self.app.state())
            return
        if path == "/api/settings":
            self._send_json(self.app.public_settings())
            return
        if path == "/api/contacts":
            contacts = self.app.store.contact_suggestions(
                arg("q"),
                account_id=arg("account") or "",
                limit=min(max(int(arg("limit", "8") or 8), 1), 20),
            )
            self._send_json({"contacts": contacts})
            return
        if path == "/api/threads":
            folder = arg("folder", "inbox")
            if folder not in FOLDERS and folder != "all":
                raise ApiError("Unknown folder.")
            label_name = arg("label_name").strip()
            account_id = arg("account") or None
            query_text = arg("q")
            unread_only = arg("unread") == "1"
            offset = max(int(arg("offset", "0") or 0), 0)
            limit = min(max(int(arg("limit", "100") or 100), 1), 1000)
            view_id = arg("view")
            if view_id:
                try:
                    parsed_view = int(view_id)
                except ValueError as exc:
                    raise ApiError("Invalid view.") from exc
                view = self.app.store.get_view(parsed_view)
                if not view:
                    raise ApiError("View not found.", 404)
                threads, total = self.app.store.list_threads_for_view(
                    view,
                    unread_only=unread_only,
                    limit=limit,
                    offset=offset,
                )
                self._send_json(
                    {
                        "threads": threads,
                        "has_more": offset + len(threads) < total,
                        "view_total": total,
                    }
                )
                return
            if label_name:
                threads = self.app.store.list_threads_for_label(
                    label_name,
                    account_id=account_id,
                    unread_only=unread_only,
                    limit=limit + 1,
                    offset=offset,
                )
            else:
                threads = self.app.store.list_threads(
                    account_id=account_id,
                    folder=folder,
                    query=query_text,
                    unread_only=unread_only,
                    limit=limit + 1,
                    offset=offset,
                )
            has_more = len(threads) > limit
            self._send_json({"threads": threads[:limit], "has_more": has_more})
            return
        if path == "/api/thread":
            self._get_thread(
                arg("account"),
                arg("id"),
                refresh=arg("refresh") == "1",
                mark_read=arg("read") != "0",
            )
            return
        if path == "/api/oauth/status":
            self._oauth_status()
            return
        if path in ("/api/attachment", "/api/inline"):
            self._attachment(arg, inline=path == "/api/inline")
            return
        raise ApiError("Unknown endpoint.", status=404)

    def _format_people(self, people: list[dict[str, Any]] | None) -> str:
        from email.utils import formataddr

        values = []
        for person in people or []:
            email = (person.get("email") or "").strip()
            if email:
                values.append(formataddr((person.get("name") or "", email)))
        return ", ".join(values)

    def _thread_draft(
        self,
        account_id: str,
        thread_id: str,
        messages: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any] | None:
        parsed = None
        for message in messages or []:
            if "DRAFT" in (message.get("labels") or []):
                if parsed is None or (message.get("date") or 0) >= (
                    parsed.get("date") or 0
                ):
                    parsed = message
        try:
            listing = self.app.gmail.list_drafts(account_id, max_results=100)
        except GmailError as exc:
            self.app.log(f"draft list failed: {exc.message}")
            return None
        draft_id = ""
        for item in listing.get("drafts") or []:
            message = item.get("message") or {}
            if message.get("threadId") == thread_id:
                draft_id = item.get("id") or ""
                break
        if not draft_id:
            return None
        if parsed is None:
            try:
                draft = self.app.gmail.get_draft(account_id, draft_id)
            except GmailError as exc:
                self.app.log(f"draft load failed: {exc.message}")
                return None
            message = draft.get("message") or {}
            if not message:
                return None
            parsed = parse_message(account_id, message)
        attachments: list[dict[str, Any]] = []
        downloaded = 0
        for item in parsed.get("attachments") or []:
            raw = item.get("data") or ""
            data = b""
            if item.get("attachment_id"):
                try:
                    data = self.app.gmail.attachment(
                        account_id,
                        parsed.get("id") or "",
                        item["attachment_id"],
                    )
                except Exception as exc:
                    self.app.log(f"draft attachment failed: {exc!r}")
                    continue
            elif raw:
                try:
                    data = base64.urlsafe_b64decode(
                        raw + "=" * (-len(raw) % 4)
                    )
                except Exception:
                    continue
            if not data:
                continue
            if downloaded + len(data) > 22 * 1024 * 1024:
                continue
            downloaded += len(data)
            attachments.append(
                {
                    "filename": item.get("filename") or "attachment",
                    "mime": item.get("mime") or "application/octet-stream",
                    "size": len(data),
                    "data": base64.b64encode(data).decode("ascii"),
                    "inline": bool(item.get("inline")),
                    "content_id": item.get("content_id") or "",
                }
            )
        body_html = parsed.get("body_html") or ""
        for item in attachments:
            if item["inline"] and item["content_id"]:
                data_url = (
                    f"data:{item['mime']};base64,{item['data']}"
                )
                body_html = re.sub(
                    rf"cid:{re.escape(item['content_id'])}",
                    data_url,
                    body_html,
                    flags=re.IGNORECASE,
                )
        payload = {
            "to": self._format_people(parsed.get("to")),
            "cc": self._format_people(parsed.get("cc")),
            "bcc": self._format_people(parsed.get("bcc")),
            "subject": parsed.get("subject") or "",
            "html": body_html,
            "text": parsed.get("body_text") or "",
            "attachments": [
                item for item in attachments if not item["inline"]
            ],
            "in_reply_to": parsed.get("in_reply_to") or "",
            "references": parsed.get("refs") or "",
            "updatedAt": parsed.get("date") or 0,
        }
        return {
            "id": draft_id,
            "thread_id": thread_id,
            "message_id": parsed.get("id") or "",
            "payload": payload,
        }

    def _get_thread(
        self,
        account_id: str,
        thread_id: str,
        refresh: bool = False,
        mark_read: bool = True,
    ) -> None:
        if not account_id or not thread_id:
            raise ApiError("Missing thread.")
        account = self.app.store.get_account(account_id)
        if not account:
            raise ApiError("Account not found.", 404)
        entry = None if refresh else self.app.sync.cached_thread(account_id, thread_id)
        if entry is None:
            entry = self.app.sync.full_thread(account_id, thread_id)
        thread = entry["thread"]
        if thread and thread.get("unread") and mark_read:
            try:
                self.app.gmail.modify_thread(account_id, thread_id, remove=["UNREAD"])
                labels = [
                    label
                    for label in self.app.store.thread_labels(account_id, thread_id)
                    if label != "UNREAD"
                ]
                self.app.store.update_thread(
                    account_id, thread_id, labels=labels, unread=0
                )
                thread = self.app.store.get_thread(account_id, thread_id)
            except Exception as exc:
                self.app.log(f"mark-read {thread_id} failed: {exc}")
        draft = None
        if thread and "DRAFT" in (thread.get("labels") or []):
            draft = self._thread_draft(
                account_id, thread_id, entry.get("messages")
            )
        self._send_json(
            entry
            | {
                "thread": thread,
                "draft": draft,
                "drafts": self.app.store.thread_drafts(account_id, thread_id),
            }
        )

    # ------------------------------------------------------------------ threads

    def _refresh_thread_metadata(self, account_id: str, thread_id: str) -> None:
        account = self.app.store.get_account(account_id)
        if not account or not thread_id:
            return
        try:
            self.app.sync._fetch_metadata(
                account_id, account["email"], thread_id
            )
            self.app.sync._bump_revision()
        except GmailError as exc:
            if exc.status == 404:
                self.app.store.delete_thread(account_id, thread_id)
                self.app.sync._bump_revision()
            else:
                self.app.log(f"draft thread refresh failed: {exc.message}")
        except Exception as exc:
            self.app.log(f"draft thread refresh failed: {exc!r}")

    def _save_draft(self, payload: dict[str, Any]) -> None:
        account_id = str(payload.get("account") or "")
        account = self.app.store.get_account(account_id)
        if not account:
            raise ApiError("Account not found.", 404)
        draft = payload.get("payload")
        if not isinstance(draft, dict):
            raise ApiError("Invalid draft payload.")
        draft_id = str(payload.get("draft_id") or "")
        existing = bool(draft_id)
        thread_id = str(payload.get("thread_id") or "") or None
        raw = self._mail_raw(account, draft)
        result = None
        if draft_id:
            try:
                result = self.app.gmail.update_draft(
                    account_id, draft_id, raw, thread_id=thread_id
                )
            except GmailError as exc:
                if exc.status != 404:
                    raise
                existing = False
                draft_id = ""
        if result is None:
            try:
                result = self.app.gmail.create_draft(
                    account_id, raw, thread_id=thread_id
                )
            except GmailError as exc:
                if exc.status == 404 and thread_id:
                    result = self.app.gmail.create_draft(account_id, raw)
                else:
                    raise
        message = result.get("message") or {}
        actual_thread = (
            result.get("threadId")
            or message.get("threadId")
            or thread_id
            or ""
        )
        if actual_thread and not existing:
            self._refresh_thread_metadata(account_id, actual_thread)
        self._send_json(
            {
                "draft_id": result.get("id") or draft_id,
                "thread_id": actual_thread,
                "message_id": message.get("id") or "",
            }
        )

    def _delete_draft(self, payload: dict[str, Any]) -> None:
        account_id = str(payload.get("account") or "")
        draft_id = str(payload.get("draft_id") or "")
        thread_id = str(payload.get("thread") or payload.get("thread_id") or "")
        kind = str(payload.get("kind") or "")
        if account_id and thread_id and kind:
            self.app.store.delete_draft(account_id, thread_id, kind)
        if draft_id:
            account = self.app.store.get_account(account_id)
            if not account:
                raise ApiError("Account not found.", 404)
            try:
                self.app.gmail.delete_draft(account_id, draft_id)
            except GmailError as exc:
                if exc.status != 404:
                    raise
            if thread_id:
                try:
                    listing = self.app.gmail.list_drafts(
                        account_id, max_results=100
                    )
                    for item in listing.get("drafts") or []:
                        other_id = item.get("id") or ""
                        message = item.get("message") or {}
                        if (
                            other_id
                            and other_id != draft_id
                            and message.get("threadId") == thread_id
                        ):
                            try:
                                self.app.gmail.delete_draft(
                                    account_id, other_id
                                )
                            except GmailError as exc:
                                if exc.status != 404:
                                    self.app.log(
                                        "extra draft cleanup failed: "
                                        f"{exc.message}"
                                    )
                except GmailError as exc:
                    self.app.log(f"draft cleanup failed: {exc.message}")
                self._refresh_thread_metadata(account_id, thread_id)
            self._send_json({"deleted": True, "thread_id": thread_id})
            return
        self._send_json({"deleted": True})

    def _save_notification_sound(self, payload: dict[str, Any]) -> None:
        raw = payload.get("data")
        name = str(payload.get("name") or "sound")
        if not isinstance(raw, str) or not raw:
            raise ApiError("No sound data.")
        if raw.startswith("data:"):
            try:
                raw = raw.split(",", 1)[1]
            except IndexError as exc:
                raise ApiError("Invalid sound data.") from exc
        try:
            data = base64.b64decode(raw, validate=True)
        except Exception as exc:
            raise ApiError("Invalid sound data.") from exc
        if len(data) > 4 * 1024 * 1024:
            raise ApiError("Sound file is larger than 4 MB.")
        suffix = Path(name).suffix.lower()
        if suffix not in (".wav", ".ogg", ".oga", ".mp3", ".flac", ".m4a"):
            raise ApiError("Use a WAV, OGG, MP3, FLAC, or M4A sound.")
        folder = self.app.data_dir / "sounds"
        folder.mkdir(parents=True, exist_ok=True)
        try:
            folder.chmod(0o700)
        except OSError:
            pass
        target = folder / f"notification-{secrets.token_hex(6)}{suffix}"
        try:
            target.write_bytes(data)
            target.chmod(0o600)
        except OSError as exc:
            raise ApiError("Could not save the sound.") from exc
        self._send_json({"path": str(target), "name": name})

    def _request_test_notification(self) -> None:
        try:
            sequence = int(
                self.app.store.get_setting("notification_test_seq") or "0"
            )
        except ValueError:
            sequence = 0
        self.app.store.set_setting("notification_test_seq", str(sequence + 1))
        self._send_json({"queued": True})

    def _thread_action(self, payload: dict[str, Any]) -> None:
        account_id = str(payload.get("account") or "")
        thread_id = str(payload.get("id") or "")
        action = str(payload.get("action") or "")
        if not account_id or not thread_id:
            raise ApiError("Missing thread.")
        if not self.app.store.get_thread(account_id, thread_id):
            raise ApiError("Thread not found.", 404)
        labels = set(self.app.store.thread_labels(account_id, thread_id))
        gmail = self.app.gmail
        store = self.app.store

        if action == "read":
            gmail.modify_thread(account_id, thread_id, remove=["UNREAD"])
            labels.discard("UNREAD")
            store.update_thread(account_id, thread_id, labels=sorted(labels), unread=0)
            store.set_messages_unread(account_id, thread_id, False)
        elif action == "unread":
            gmail.modify_thread(account_id, thread_id, add=["UNREAD"])
            labels.add("UNREAD")
            store.update_thread(account_id, thread_id, labels=sorted(labels), unread=1)
            store.set_messages_unread(account_id, thread_id, True)
        elif action == "star":
            gmail.modify_thread(account_id, thread_id, add=["STARRED"])
            labels.add("STARRED")
            store.update_thread(account_id, thread_id, labels=sorted(labels), starred=1)
        elif action == "unstar":
            gmail.modify_thread(account_id, thread_id, remove=["STARRED"])
            labels.discard("STARRED")
            store.update_thread(account_id, thread_id, labels=sorted(labels), starred=0)
        elif action == "archive":
            gmail.modify_thread(account_id, thread_id, remove=["INBOX"])
            labels.discard("INBOX")
            store.update_thread(account_id, thread_id, labels=sorted(labels))
        elif action == "spam":
            gmail.modify_thread(account_id, thread_id, add=["SPAM"], remove=["INBOX"])
            labels.discard("INBOX")
            labels.add("SPAM")
            store.update_thread(account_id, thread_id, labels=sorted(labels))
        elif action == "inbox":
            if "TRASH" in labels:
                gmail.untrash_thread(account_id, thread_id)
                labels.discard("TRASH")
            gmail.modify_thread(account_id, thread_id, add=["INBOX"], remove=["SPAM"])
            labels.discard("SPAM")
            labels.add("INBOX")
            store.update_thread(account_id, thread_id, labels=sorted(labels))
        elif action == "trash":
            gmail.trash_thread(account_id, thread_id)
            labels.discard("INBOX")
            labels.discard("SPAM")
            labels.add("TRASH")
            store.update_thread(account_id, thread_id, labels=sorted(labels))
        else:
            raise ApiError("Unknown action.")
        self._send_json({"thread": store.get_thread(account_id, thread_id), "state": self.app.state()})

    # ------------------------------------------------------------------ sending

    def _mail_people(self, value: Any) -> list[dict[str, str]]:
        from email.utils import getaddresses

        if isinstance(value, str):
            cleaned = re.sub(r"[,;]+\s*$", "", value.strip())
            pairs = getaddresses([cleaned])
        else:
            pairs = []
            for item in value or []:
                if isinstance(item, str):
                    pairs.extend(getaddresses([item]))
                elif isinstance(item, dict) and item.get("email"):
                    pairs.append((item.get("name") or "", item["email"]))
        out = []
        for name, addr in pairs:
            addr = addr.strip()
            if "@" in addr:
                out.append({"name": name.strip(), "email": addr})
        return out

    def _mail_raw(self, account: Any, payload: dict[str, Any]) -> bytes:
        attachments = payload.get("attachments") or []
        if not isinstance(attachments, list):
            attachments = []
        if len(attachments) > 20:
            raise ApiError("Too many attachments.")
        from .gmail import build_mime

        return build_mime(
            account_email=account["email"],
            from_name=_outgoing_name(account),
            to=self._mail_people(payload.get("to")),
            cc=self._mail_people(payload.get("cc")),
            bcc=self._mail_people(payload.get("bcc")),
            subject=str(payload.get("subject") or ""),
            text=str(payload.get("text") or ""),
            html=str(payload.get("html") or ""),
            attachments=attachments,
            in_reply_to=str(payload.get("in_reply_to") or ""),
            references=str(payload.get("references") or ""),
        )

    def _send_mail(self, payload: dict[str, Any]) -> None:
        account_id = str(payload.get("account") or "")
        account = self.app.store.get_account(account_id)
        if not account:
            raise ApiError("Account not found.", 404)
        if not (
            self._mail_people(payload.get("to"))
            or self._mail_people(payload.get("cc"))
            or self._mail_people(payload.get("bcc"))
        ):
            raise ApiError("Add a recipient.")
        raw = self._mail_raw(account, payload)
        thread_id = str(payload.get("thread_id") or "") or None
        draft_id = str(payload.get("draft_id") or "")
        result = self.app.gmail.send_raw(account_id, raw, thread_id=thread_id)
        if draft_id:
            try:
                self.app.gmail.delete_draft(account_id, draft_id)
            except Exception as exc:
                self.app.log(f"draft cleanup failed: {exc!r}")
            draft_thread = str(payload.get("draft_thread_id") or "")
            if draft_thread:
                self._refresh_thread_metadata(account_id, draft_thread)
        self._send_json({"id": result.get("id"), "thread_id": result.get("threadId")})

    # ------------------------------------------------------------------ search

    def _search(self, payload: dict[str, Any]) -> None:
        query = str(payload.get("q") or "").strip()
        account_filter = str(payload.get("account") or "")
        if len(query) < 2:
            self._send_json({"threads": []})
            return
        local = self.app.store.list_threads(
            account_id=account_filter or None,
            folder="all",
            query=query,
            limit=80,
        )
        by_key = {thread["key"]: thread for thread in local}
        errors = []
        accounts = [
            account
            for account in self.app.store.accounts()
            if not account_filter or account["id"] == account_filter
        ]
        for account in accounts:
            try:
                response = self.app.gmail.list_thread_ids(account["id"], query=query, max_results=20)
            except GmailError as exc:
                errors.append(f"{account['email']}: {exc.message}")
                continue
            new_ids = []
            for item in response.get("threads") or []:
                thread_id = item.get("id")
                if not thread_id:
                    continue
                existing = self.app.store.get_thread(account["id"], thread_id)
                if not existing:
                    new_ids.append(thread_id)
                elif f"{account['id']}:{thread_id}" not in by_key:
                    by_key[f"{account['id']}:{thread_id}"] = existing
            if new_ids:
                try:
                    self.app.sync._fetch_metadata_many(
                        account["id"], account["email"], new_ids, force=False
                    )
                except Exception as exc:
                    self.app.log(f"search metadata failed: {exc}")
                for thread_id in new_ids:
                    item = self.app.store.get_thread(account["id"], thread_id)
                    if item:
                        by_key[item["key"]] = item
        threads = sorted(by_key.values(), key=lambda item: item["last_date"], reverse=True)[:120]
        self._send_json({"threads": threads, "errors": errors})

    # ------------------------------------------------------------------ settings

    def _save_settings(self, payload: dict[str, Any]) -> None:
        store = self.app.store
        if "oauth_client_id" in payload:
            store.set_setting("oauth_client_id", str(payload.get("oauth_client_id") or "").strip())
        secret = str(payload.get("oauth_client_secret") or "").strip()
        if secret:
            store.set_setting("oauth_client_secret", secret)
        if "ai_base_url" in payload:
            store.set_setting("ai_base_url", str(payload.get("ai_base_url") or "").strip())
        if "ai_model" in payload:
            store.set_setting("ai_model", str(payload.get("ai_model") or "").strip())
        ai_key = str(payload.get("ai_api_key") or "").strip()
        if ai_key:
            store.set_setting("ai_api_key", ai_key)
        if payload.get("clear_ai_api_key"):
            store.set_setting("ai_api_key", None)
        refresh_mode = str(payload.get("refresh_mode") or "").strip()
        if refresh_mode in ("fast", "balanced", "manual"):
            store.set_setting("refresh_mode", refresh_mode)
        self._send_json(self.app.public_settings())

    def _update_account(self, payload: dict[str, Any]) -> None:
        account_id = str(payload.get("id") or "")
        account = self.app.store.get_account(account_id)
        if not account:
            raise ApiError("Account not found.", 404)
        updates: dict[str, Any] = {}
        if "name" in payload:
            name = re.sub(
                r"[\x00-\x1f\x7f]", "", str(payload.get("name") or "")
            )
            name = re.sub(r"\s+", " ", name).strip()[:80]
            updates["name"] = name or None
        if "username" in payload:
            username = re.sub(r"[\x00-\x1f\x7f]", "", str(payload.get("username") or ""))
            username = re.sub(r"\s+", " ", username).strip()[:40]
            updates["username"] = username or None
        if "color" in payload:
            color = str(payload.get("color") or "").strip()
            if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
                raise ApiError("Colour must be a hex value such as #3E6FA8.")
            updates["color"] = color.upper()
        if "default_view_id" in payload:
            raw_view = payload.get("default_view_id")
            try:
                view_id = int(raw_view) if raw_view not in (None, "", 0) else 0
            except (TypeError, ValueError) as exc:
                raise ApiError("Invalid default view.") from exc
            if view_id:
                view = self.app.store.get_view(view_id)
                if not view or view["account_id"] != account_id:
                    raise ApiError("Invalid default view.")
                updates["default_view_id"] = view_id
            else:
                updates["default_view_id"] = None
        if updates:
            self.app.store.update_account(account_id, **updates)
        self._send_json({
            "account": self.app.account_public(self.app.store.get_account(account_id)),
            "state": self.app.state(),
        })

    def _save_view(self, payload: dict[str, Any]) -> None:
        account_id = str(payload.get("account") or "")
        if not self.app.store.get_account(account_id):
            raise ApiError("Account not found.", 404)
        name = re.sub(r"[\x00-\x1f\x7f]", "", str(payload.get("name") or ""))
        name = re.sub(r"\s+", " ", name).strip()[:60]
        if not name:
            raise ApiError("Name the view.")
        raw_view = payload.get("id")
        view_id = None
        if raw_view not in (None, "", 0):
            try:
                view_id = int(raw_view)
            except (TypeError, ValueError) as exc:
                raise ApiError("Invalid view.") from exc
            existing = self.app.store.get_view(view_id)
            if not existing or existing["account_id"] != account_id:
                raise ApiError("View not found.", 404)
        incoming = payload.get("filters")
        if not isinstance(incoming, dict):
            incoming = {}

        def string_list(key: str, maximum: int) -> list[str]:
            values = incoming.get(key)
            if not isinstance(values, list):
                return []
            out = []
            for value in values:
                text = str(value or "").strip()
                if text and text not in out and len(text) <= 200:
                    out.append(text)
                if len(out) >= maximum:
                    break
            return out

        def regex_value(key: str) -> str:
            text = str(incoming.get(key) or "").strip()
            if len(text) > 200:
                raise ApiError("Regex is too long.")
            if text:
                try:
                    re.compile(text)
                except re.error as exc:
                    raise ApiError(f"Invalid regex: {exc}") from exc
            return text

        filters = {
            "include_labels": string_list("include_labels", 50),
            "exclude_labels": string_list("exclude_labels", 50),
            "include_senders": string_list("include_senders", 20),
            "exclude_senders": string_list("exclude_senders", 20),
            "include_subject": regex_value("include_subject"),
            "exclude_subject": regex_value("exclude_subject"),
        }
        view = self.app.store.save_view(
            account_id, name, filters, view_id=view_id
        )
        self._send_json({"view": view, "state": self.app.state()})

    def _delete_view(self, payload: dict[str, Any]) -> None:
        try:
            view_id = int(payload.get("id") or 0)
        except (TypeError, ValueError) as exc:
            raise ApiError("Invalid view.") from exc
        if not view_id or not self.app.store.get_view(view_id):
            raise ApiError("View not found.", 404)
        self.app.store.delete_view(view_id)
        self._send_json({"deleted": True, "state": self.app.state()})

    def _open_attachment(self, payload: dict[str, Any]) -> None:
        opener = getattr(self.app, "open_attachment", None)
        if not callable(opener):
            raise ApiError(
                "Attachment opening is only available in the desktop window.",
                503,
            )
        if not opener(
            str(payload.get("url") or ""),
            str(payload.get("filename") or ""),
        ):
            raise ApiError("Attachment not available.", 400)
        self._send_json({"opening": True})

    def _download_attachment(self, payload: dict[str, Any]) -> None:
        downloader = getattr(self.app, "download_attachment", None)
        if not callable(downloader):
            raise ApiError(
                "Attachment downloads are only available in the desktop window.",
                503,
            )
        if not downloader(
            str(payload.get("url") or ""),
            str(payload.get("filename") or ""),
        ):
            raise ApiError("Attachment not available.", 400)
        self._send_json({"saving": True})

    def _open_composer_attachment(self, payload: dict[str, Any]) -> None:
        opener = getattr(self.app, "open_attachment_file", None)
        if not callable(opener):
            raise ApiError(
                "Attachment viewing is only available in the desktop window.",
                503,
            )
        raw = payload.get("data")
        if not isinstance(raw, str) or not raw:
            raise ApiError("Attachment has no data.")
        try:
            data = base64.b64decode(raw, validate=True)
        except Exception as exc:
            raise ApiError("Invalid attachment data.") from exc
        if len(data) > 20 * 1024 * 1024:
            raise ApiError("Attachment is larger than 20 MB.", 400)
        filename = str(payload.get("filename") or "attachment")
        safe = Path(filename).name
        safe = re.sub(r"[\x00-\x1f\x7f/\\]+", "_", safe).strip()[:180]
        if not safe or safe in (".", ".."):
            safe = "attachment"
        folder = self.app.data_dir / "attachments"
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        try:
            folder.chmod(0o700)
        except OSError:
            pass
        target = folder / safe
        if target.exists():
            target = folder / (
                f"{Path(safe).stem}-{secrets.token_hex(3)}"
                f"{Path(safe).suffix}"
            )
        try:
            target.write_bytes(data)
            target.chmod(0o600)
        except OSError as exc:
            raise ApiError("Could not store the attachment.") from exc
        if not opener(target, safe):
            raise ApiError("Attachment could not be opened.", 400)
        self._send_json({"opening": True})

    def _choose_attachments(self, payload: dict[str, Any]) -> None:
        chooser = getattr(self.app, "choose_attachments", None)
        if not callable(chooser):
            raise ApiError(
                "File attachments are only available in the desktop window.",
                503,
            )
        paths = chooser()
        files = []
        total = 0
        for path in paths or []:
            file_path = Path(path)
            try:
                data = file_path.read_bytes()
            except OSError:
                continue
            total += len(data)
            if total > 20 * 1024 * 1024:
                raise ApiError(
                    "Attachments are larger than 20 MB in total.", 400
                )
            mime = (
                mimetypes.guess_type(file_path.name)[0]
                or "application/octet-stream"
            )
            files.append(
                {
                    "filename": file_path.name,
                    "mime": mime,
                    "size": len(data),
                    "data": base64.b64encode(data).decode("ascii"),
                }
            )
        self._send_json({"files": files})

    def _remove_account(self, payload: dict[str, Any]) -> None:
        account_id = str(payload.get("id") or "")
        account = self.app.store.get_account(account_id)
        if not account:
            raise ApiError("Account not found.", 404)
        self.app.gmail.revoke(account_id)
        self.app.store.remove_account(account_id)
        self._send_json(self.app.state())

    # ------------------------------------------------------------------ oauth

    def _oauth_start(self, payload: dict[str, Any]) -> None:
        store = self.app.store
        client_id = str(payload.get("client_id") or store.get_setting("oauth_client_id") or "").strip()
        client_secret = str(payload.get("client_secret") or store.get_setting("oauth_client_secret") or "").strip()
        if not client_id or not client_secret:
            raise ApiError("Paste a Google OAuth client ID and client secret first.")
        if not client_id.endswith(".apps.googleusercontent.com"):
            raise ApiError("That does not look like a Google OAuth client ID.")
        store.set_setting("oauth_client_id", client_id)
        store.set_setting("oauth_client_secret", client_secret)
        state, verifier, challenge = self.app.gmail.make_state()
        redirect_uri = self.app.base_url
        auth_url = self.app.gmail.auth_url(
            client_id=client_id,
            redirect_uri=redirect_uri,
            state=state,
            challenge=challenge,
        )
        with self.app.oauth_lock:
            now = time.time()
            for key in list(self.app.oauth_pending):
                if now - self.app.oauth_pending[key].get("created", 0) > 900:
                    del self.app.oauth_pending[key]
            self.app.oauth_pending[state] = {
                "status": "pending",
                "created": now,
                "verifier": verifier,
                "redirect_uri": redirect_uri,
                "account": None,
                "error": "",
            }
        self._send_json({"url": auth_url, "redirect_uri": redirect_uri})

    def _oauth_status(self) -> None:
        with self.app.oauth_lock:
            items = sorted(
                self.app.oauth_pending.values(), key=lambda item: item.get("created", 0), reverse=True
            )
            item = items[0] if items else None
            if not item:
                self._send_json({"status": "none"})
                return
            self._send_json(
                {
                    "status": item["status"],
                    "error": item.get("error") or "",
                    "account": item.get("account"),
                }
            )

    def _oauth_callback(self) -> None:
        query = self._query()

        def one(name: str) -> str:
            values = query.get(name)
            return values[0] if values else ""

        state = one("state")
        error = one("error")
        with self.app.oauth_lock:
            pending = self.app.oauth_pending.get(state)
        if not pending:
            self._oauth_page(
                "Sign-in could not be verified",
                "This sign-in attempt has expired. Start again from Courier.",
                success=False,
            )
            return
        if pending.get("status") == "connected" and pending.get("account"):
            account = pending["account"]
            self._oauth_page(
                "Google account connected",
                f"{html.escape(account.get('email', ''))} is ready in Courier. Close this tab.",
                success=True,
            )
            return
        if error:
            with self.app.oauth_lock:
                pending["status"] = "error"
                pending["error"] = one("error_description") or error
            self._oauth_page("Google sign-in was cancelled", html.escape(one("error_description") or error), False)
            return
        code = one("code")
        if not code:
            with self.app.oauth_lock:
                pending["status"] = "error"
                pending["error"] = "Google returned no authorization code."
            self._oauth_page("Google sign-in failed", "No authorization code was returned.", False)
            return
        client_id = self.app.store.get_setting("oauth_client_id") or ""
        client_secret = self.app.store.get_setting("oauth_client_secret") or ""
        try:
            tokens = self.app.gmail.exchange_code(
                client_id=client_id,
                client_secret=client_secret,
                redirect_uri=pending["redirect_uri"],
                code=code,
                verifier=pending["verifier"],
            )
            account = self.app.gmail.connect_account(tokens)
            with self.app.oauth_lock:
                pending["status"] = "connected"
                pending["account"] = account
            self.app.sync.trigger(account["id"], manual=True)
            self._oauth_page(
                "Google account connected",
                f"{html.escape(account['email'])} is ready in Courier. Close this tab.",
                success=True,
            )
        except Exception as exc:
            message = getattr(exc, "message", str(exc))
            self.app.log(f"oauth callback failed: {message}")
            with self.app.oauth_lock:
                pending["status"] = "error"
                pending["error"] = message
            self._oauth_page("Google sign-in failed", html.escape(message), False)

    def _oauth_page(self, title: str, message: str, success: bool) -> None:
        accent = "#3E6FA8" if success else "#9A4640"
        document = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title>
<style>
  html,body{{height:100%;margin:0}}
  body{{display:grid;place-items:center;background:#e9ecef;
    font:15px/1.5 "Nimbus Sans","Liberation Sans",sans-serif;color:#24272a}}
  main{{width:min(460px,calc(100vw - 48px));background:#fbfbf9;border:1px solid #b8bdc2;
    border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.12);padding:28px 30px}}
  h1{{font-size:19px;margin:0 0 10px;color:{accent}}}
  p{{margin:0;color:#4d5358}}
</style></head>
<body><main><h1>{title}</h1><p>{message}</p></main></body></html>"""
        self._send_bytes(document.encode("utf-8"), content_type="text/html; charset=utf-8")

    # ------------------------------------------------------------------ AI

    def _ai_test(self) -> None:
        try:
            result = self.app.ai.test()
        except AIError as exc:
            self._send_json({"error": exc.message}, status=exc.status)
            return
        self._send_json({"result": result})

    def _ai_summarize(self, payload: dict[str, Any]) -> None:
        if not self.app.ai.configured():
            raise ApiError("AI summaries are not configured.", 400)
        account_id = str(payload.get("account") or "")
        thread_id = str(payload.get("id") or "")
        scope = str(payload.get("scope") or "thread")
        message_id = str(payload.get("message_id") or "")
        if not account_id or not thread_id:
            raise ApiError("Missing thread.")
        account = self.app.store.get_account(account_id)
        if not account:
            raise ApiError("Account not found.", 404)
        entry = self.app.sync.cached_thread(account_id, thread_id)
        if entry is None:
            entry = self.app.sync.full_thread(account_id, thread_id)
        thread = entry["thread"]
        messages = entry["messages"]
        if scope == "message":
            selected = next((m for m in messages if m.get("id") == message_id), None)
            if not selected:
                raise ApiError("Message not found.", 404)
            prompt = message_messages(
                selected, thread.get("subject") or "", account["email"]
            )
        elif scope == "unread":
            unread = [
                message
                for message in messages
                if "UNREAD" in (message.get("labels") or [])
            ]
            if not unread:
                raise ApiError("There are no unread messages in this thread.", 400)
            prompt = thread_messages(thread, unread, account["email"])
        else:
            prompt = thread_messages(thread, messages, account["email"])

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

        def emit(event: dict[str, Any]) -> None:
            chunk = f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode("utf-8")
            self.wfile.write(chunk)
            self.wfile.flush()

        try:
            for delta in self.app.ai.stream(prompt):
                emit({"delta": delta})
            emit({"done": True})
        except (AIError, GmailError, Exception) as exc:
            message = getattr(exc, "message", str(exc))
            self.app.log(f"summary failed: {message}")
            try:
                emit({"error": message})
            except (BrokenPipeError, ConnectionResetError):
                pass

    # ------------------------------------------------------------------ attachments

    def _attachment(self, arg, inline: bool = False) -> None:
        account_id = arg("account")
        message_id = arg("message")
        try:
            index = int(arg("index", "0"))
        except ValueError:
            index = 0
        account = self.app.store.get_account(account_id)
        if not account:
            raise ApiError("Account not found.", 404)
        message = self.app.store.get_message(account_id, message_id)
        if not message:
            raise ApiError("Message not found.", 404)
        attachments = message.get("attachments") or []
        if index < 0 or index >= len(attachments):
            raise ApiError("Attachment not found.", 404)
        item = attachments[index]
        data: bytes
        if item.get("data"):
            data = base64.b64decode(item["data"])
        elif item.get("attachment_id"):
            data = self.app.gmail.attachment(account_id, message_id, item["attachment_id"])
        else:
            raise ApiError("Attachment has no data.", 404)
        filename = item.get("filename") or "attachment"
        mime = item.get("mime") or "application/octet-stream"
        disposition = "inline" if (inline or item.get("inline")) else "attachment"
        safe = re.sub(r'[\r\n\x00-\x1f\x7f]+', " ", filename).replace('"', "'")[:180]
        mime = re.sub(r'[\r\n\x00-\x1f\x7f]+', "", str(mime)).strip() or "application/octet-stream"
        if not re.match(r"^[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+$", mime.split(";")[0].strip()):
            mime = "application/octet-stream"
        else:
            mime = mime.split(";")[0].strip()
        encoded_name = urllib.parse.quote(safe)
        headers = {
            "Content-Disposition": f"{disposition}; filename=\"{safe}\"; filename*=UTF-8''{encoded_name}",
            "Cache-Control": "private, max-age=3600",
        }
        self._send_bytes(data, content_type=mime, headers=headers)

    # ------------------------------------------------------------------ static

    def _serve_index(self) -> None:
        query = self._query()
        token_values = query.get("t")
        if not token_values or not secrets.compare_digest(token_values[0], self.app.page_token):
            self._send_bytes(
                b"<h1>Courier</h1><p>Open Courier from its launcher.</p>",
                status=403,
                content_type="text/html; charset=utf-8",
            )
            return
        file = WEB_ROOT / "index.html"
        csp = (
            "default-src 'self'; img-src 'self' data: blob: https: http:; "
            "style-src 'self' 'unsafe-inline'; script-src 'self'; "
            "connect-src 'self' blob:; frame-src 'self' data:; font-src 'self' data:; "
            "object-src 'none'; base-uri 'none'; form-action 'none'"
        )
        prefs = _load_ui_prefs(self.app.store)
        theme = prefs["theme"]
        content_width = prefs["contentWidth"]
        accent_style = _accent_style(theme, prefs["accent"])
        width_style = []
        if prefs["sidebarWidth"]:
            width_style.append(f"--sidebar-width:{prefs['sidebarWidth']}px")
        if prefs["listWidth"]:
            width_style.append(f"--list-width:{prefs['listWidth']}px")
        if width_style:
            accent_style += ";" + ";".join(width_style)
        document = file.read_text(encoding="utf-8")
        document = re.sub(
            r"<html\b[^>]*>",
            f'<html lang="en" data-theme="{theme}" '
            f'data-content-width="{content_width}" style="{accent_style}">',
            document,
            count=1,
        )
        body = document.encode("utf-8")
        self._send_bytes(
            body,
            content_type="text/html; charset=utf-8",
            headers={
                "Cache-Control": "no-store",
                "Content-Security-Policy": csp,
                "Referrer-Policy": "no-referrer",
            },
        )

    def _serve_static(self, path: str) -> None:
        rel = urllib.parse.unquote(path).lstrip("/")
        if not rel:
            raise ApiError("Not found.", 404)
        candidate = (WEB_ROOT / rel).resolve()
        try:
            candidate.relative_to(WEB_ROOT)
        except ValueError:
            raise ApiError("Not found.", 404)
        if not candidate.is_file():
            raise ApiError("Not found.", 404)
        mime = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if mime.startswith("text/") or mime in ("application/javascript", "application/json"):
            mime += "; charset=utf-8"
        cache = "no-store" if rel.startswith("js/") or rel.endswith(".css") else "public, max-age=3600"
        body = candidate.read_bytes()
        self._send_bytes(
            body,
            content_type=mime,
            headers={"Cache-Control": cache},
        )
