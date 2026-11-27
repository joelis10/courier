"""Background Gmail synchronisation and lazy thread loading."""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable

from .gmail import GmailClient, GmailError, build_thread_summary, parse_thread_full
from .store import Store

REFRESH_INTERVALS = {"fast": 10, "balanced": 60, "manual": 0}
INITIAL_MAIL = 100
INITIAL_SPAM = 20
INITIAL_TRASH = 15
INITIAL_DRAFTS = 50
RECENT_SAFETY = 50


class SyncManager:
    def __init__(self, store: Store, gmail: GmailClient, log: Callable[[str], None] | None = None):
        self.store = store
        self.gmail = gmail
        self.log = log or (lambda _msg: None)
        self._status_lock = threading.Lock()
        self._trigger_lock = threading.Lock()
        self._stop = threading.Event()
        self._worker: threading.Thread | None = None
        self._looper: threading.Thread | None = None
        self._pending_accounts: set[str] = set()
        self._labels_refreshed: dict[str, float] = {}
        self._page_tokens: dict[tuple[str, str], str] = {}
        self._page_done: set[tuple[str, str]] = set()
        self._older_lock = threading.Lock()
        self._status: dict[str, Any] = {
            "syncing": False,
            "active": "",
            "progress": "",
            "errors": {},
            "last_finished": 0,
            "manual": False,
            "revision": 0,
        }

    # ------------------------------------------------------------------ status

    def status(self) -> dict[str, Any]:
        with self._status_lock:
            return {
                "syncing": self._status["syncing"],
                "active": self._status["active"],
                "progress": self._status["progress"],
                "errors": dict(self._status["errors"]),
                "last_finished": self._status["last_finished"],
                "manual": self._status["manual"],
                "revision": self._status["revision"],
            }

    def _set(self, **values: Any) -> None:
        with self._status_lock:
            self._status.update(values)

    def _set_error(self, account_id: str, message: str) -> None:
        with self._status_lock:
            self._status["errors"][account_id] = message

    def _clear_error(self, account_id: str) -> None:
        with self._status_lock:
            self._status["errors"].pop(account_id, None)

    def _bump_revision(self) -> None:
        with self._status_lock:
            self._status["revision"] += 1

    # ------------------------------------------------------------------ control

    def trigger(self, account_id: str | None = None, manual: bool = False) -> bool:
        with self._trigger_lock:
            if self._status["syncing"]:
                self._pending_accounts.add(account_id or "__all__")
                if manual:
                    self._set(manual=True)
                return False
            self._set(syncing=True, active="", progress="", errors={}, manual=manual)
        self._worker = threading.Thread(
            target=self._run_all, args=(account_id,), daemon=True, name="courier-sync"
        )
        self._worker.start()
        return True

    def start_background(self) -> None:
        self._looper = threading.Thread(target=self._loop, daemon=True, name="courier-sync-loop")
        self._looper.start()

    def stop(self) -> None:
        self._stop.set()

    def _refresh_interval(self) -> int:
        mode = self.store.get_setting("refresh_mode") or "fast"
        return REFRESH_INTERVALS.get(mode, REFRESH_INTERVALS["fast"])

    def _loop(self) -> None:
        self._stop.wait(1.2)
        last_run = 0.0
        started = False
        while not self._stop.is_set():
            try:
                interval = self._refresh_interval()
                if (
                    self.store.accounts()
                    and not self.status()["syncing"]
                    and (
                        not started
                        or (interval > 0 and time.time() - last_run >= interval)
                    )
                ):
                    last_run = time.time()
                    started = True
                    self.trigger()
            except Exception as exc:  # pragma: no cover - defensive
                self.log(f"sync loop error: {exc}")
            self._stop.wait(4)

    def _run_all(self, account_id: str | None) -> None:
        try:
            accounts = self.store.accounts()
            if account_id:
                accounts = [a for a in accounts if a["id"] == account_id]
            accounts = [a for a in accounts if not a["needs_reauth"]]
            for index, account in enumerate(accounts):
                if self._stop.is_set():
                    break
                self._set(
                    active=account["email"],
                    progress=f"{index + 1} of {len(accounts)} accounts",
                )
                try:
                    self._sync_account(account["id"])
                    self._clear_error(account["id"])
                except Exception as exc:
                    message = getattr(exc, "message", str(exc))
                    self.log(f"sync {account['email']} failed: {message}")
                    self._set_error(account["id"], message)
                finally:
                    self._set(active="", progress="")
        finally:
            self._set(syncing=False, manual=False, last_finished=int(time.time() * 1000))
            with self._trigger_lock:
                pending = set(self._pending_accounts)
                self._pending_accounts.clear()
            if pending and not self._stop.is_set():
                account = None if "__all__" in pending else next(iter(pending))
                self.trigger(account)

    # ------------------------------------------------------------------ account sync

    def _sync_account(self, account_id: str) -> None:
        account = self.store.get_account(account_id)
        if not account:
            return
        if account["needs_reauth"]:
            raise GmailError("Google sign-in has expired. Reconnect this account.")
        profile = self.gmail.profile(account_id)
        latest_history = profile.get("historyId")
        account_email = account["email"]

        now = time.time()
        if now - self._labels_refreshed.get(account_id, 0) > 300:
            try:
                all_labels = self.gmail.labels(account_id)
                user_labels = [
                    label for label in all_labels if label.get("type") == "user"
                ]
                self.store.replace_labels(account_id, user_labels)
                self._labels_refreshed[account_id] = now
            except GmailError as exc:
                self.log(f"labels {account_email} failed: {exc.message}")

        if not account["history_id"]:
            self._full_sync(account_id, account_email)
        else:
            try:
                self._incremental_sync(account_id, account_email, account["history_id"])
            except GmailError as exc:
                if exc.status == 404:
                    self.log(f"history expired for {account_email}; doing a full sync")
                    self._full_sync(account_id, account_email)
                else:
                    raise
        if latest_history:
            self.store.update_account(account_id, history_id=latest_history)
        self.store.update_account(account_id, last_sync=int(time.time()))

    def _full_sync(self, account_id: str, account_email: str) -> None:
        ids: list[str] = []
        seen: set[str] = set()
        for params in (
            {"max_results": INITIAL_MAIL},
            {"label": "SPAM", "max_results": INITIAL_SPAM},
            {"label": "TRASH", "max_results": INITIAL_TRASH},
            {"label": "DRAFT", "max_results": INITIAL_DRAFTS},
        ):
            try:
                response = self.gmail.list_thread_ids(
                    account_id,
                    label=params.get("label"),
                    max_results=params["max_results"],
                )
            except GmailError as exc:
                if exc.status in (403, 404):
                    continue
                raise
            for item in response.get("threads") or []:
                thread_id = item.get("id")
                if thread_id and thread_id not in seen:
                    seen.add(thread_id)
                    ids.append(thread_id)
        self._fetch_metadata_many(account_id, account_email, ids, force=True)

    def _incremental_sync(self, account_id: str, account_email: str, history_id: str) -> None:
        changed: set[str] = set()
        page_token = None
        pages = 0
        while pages < 8:
            if page_token:
                response = self.gmail.api(
                    account_id,
                    "GET",
                    "history",
                    params={
                        "startHistoryId": history_id,
                        "maxResults": 500,
                        "pageToken": page_token,
                    },
                )
            else:
                response = self.gmail.history(account_id, history_id)
            for entry in response.get("history") or []:
                for key in (
                    "messages",
                    "messagesAdded",
                    "messagesDeleted",
                    "labelsAdded",
                    "labelsRemoved",
                ):
                    for item in entry.get(key) or []:
                        message = item.get("message") or item
                        thread_id = message.get("threadId")
                        if thread_id:
                            # Even a deleted message means the thread metadata may
                            # have changed. Refetching it handles full deletions via 404.
                            changed.add(thread_id)
                for key in ("threads", "threadsAdded"):
                    for item in entry.get(key) or []:
                        thread_id = item.get("id")
                        if thread_id:
                            changed.add(thread_id)
            page_token = response.get("nextPageToken")
            pages += 1
            if not page_token:
                break

        # Recent-list calls catch new mail and drafts even when history is
        # unavailable between polls. Existing threads are left to history so read
        # state changes win.
        for label in (None, "DRAFT"):
            try:
                recent = self.gmail.list_thread_ids(
                    account_id,
                    label=label,
                    max_results=RECENT_SAFETY if label is None else INITIAL_DRAFTS,
                )
                for item in recent.get("threads") or []:
                    thread_id = item.get("id")
                    if not thread_id:
                        continue
                    if not self.store.get_thread(account_id, thread_id):
                        changed.add(thread_id)
            except GmailError:
                pass

        if changed:
            self._fetch_metadata_many(
                account_id, account_email, sorted(changed), force=False
            )

    def _fetch_metadata_many(
        self,
        account_id: str,
        account_email: str,
        thread_ids: list[str],
        *,
        force: bool,
    ) -> None:
        if not thread_ids:
            return
        total = len(thread_ids)
        done = 0
        self._set(progress=f"0 of {total}")
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {
                pool.submit(self._fetch_metadata, account_id, account_email, thread_id): thread_id
                for thread_id in thread_ids
            }
            for future in as_completed(futures):
                thread_id = futures[future]
                done += 1
                self._set(progress=f"{done} of {total}")
                try:
                    future.result()
                except GmailError as exc:
                    if exc.status == 404:
                        self.store.delete_thread(account_id, thread_id)
                        self._bump_revision()
                    else:
                        self.log(f"thread {thread_id} failed: {exc.message}")
                except Exception as exc:
                    self.log(f"thread {thread_id} failed: {exc}")

    def _fetch_metadata(
        self, account_id: str, account_email: str, thread_id: str
    ) -> None:
        thread = self.gmail.get_thread(account_id, thread_id, fmt="metadata")
        summary = build_thread_summary(account_id, account_email, thread)
        self.store.upsert_thread(summary)
        self._bump_revision()

    # ------------------------------------------------------------------ older pages

    def _folder_source(self, folder: str, label_name: str, account_id: str) -> tuple[str, str | None, str | None] | None:
        if label_name:
            rows = self.store.label_thread_ids(label_name, account_id)
            ids = rows.get(account_id) or []
            if not ids:
                return None
            label_id = ids[0]
            return f"label:{label_id}", label_id, None
        mapping = {
            "inbox": ("inbox", "INBOX", None),
            "starred": ("starred", "STARRED", None),
            "sent": ("sent", "SENT", None),
            "drafts": ("drafts", "DRAFT", None),
            "spam": ("spam", "SPAM", None),
            "trash": ("trash", "TRASH", None),
            "archive": (
                "archive",
                None,
                "-in:inbox -in:spam -in:trash -in:drafts",
            ),
        }
        return mapping.get(folder, mapping["inbox"])

    def fetch_older(
        self,
        folder: str = "inbox",
        account_id: str | None = None,
        label_name: str = "",
    ) -> dict[str, Any]:
        if not self._older_lock.acquire(blocking=False):
            return {"fetched": 0, "has_more": True, "busy": True}
        try:
            accounts = self.store.accounts()
            if account_id:
                accounts = [row for row in accounts if row["id"] == account_id]
            fetched = 0
            has_more = False
            for account in accounts:
                source = self._folder_source(folder, label_name, account["id"])
                if not source:
                    continue
                key = (account["id"], source[0])
                if key in self._page_done:
                    continue
                label_id, query = source[1], source[2]
                page_token = self._page_tokens.get(key)
                new_ids: list[str] = []
                for _attempt in range(4):
                    try:
                        response = self.gmail.list_thread_ids(
                            account["id"],
                            label=label_id,
                            query=query,
                            max_results=60,
                            page_token=page_token,
                        )
                    except GmailError as exc:
                        self.log(f"older {account['email']} failed: {exc.message}")
                        self._page_done.add(key)
                        break
                    ids = [
                        item.get("id")
                        for item in response.get("threads") or []
                        if item.get("id")
                    ]
                    new_ids = [
                        thread_id
                        for thread_id in ids
                        if not self.store.get_thread(account["id"], thread_id)
                    ]
                    page_token = response.get("nextPageToken")
                    if new_ids or not page_token:
                        break
                if page_token:
                    self._page_tokens[key] = page_token
                    has_more = True
                else:
                    self._page_done.add(key)
                    self._page_tokens.pop(key, None)
                if new_ids:
                    self._fetch_metadata_many(
                        account["id"], account["email"], new_ids, force=False
                    )
                    fetched += len(new_ids)
            return {"fetched": fetched, "has_more": has_more}
        finally:
            self._older_lock.release()

    # ------------------------------------------------------------------ thread loading

    def full_thread(self, account_id: str, thread_id: str) -> dict[str, Any]:
        account = self.store.get_account(account_id)
        if not account:
            raise GmailError("Account not found.", status=404)
        thread = self.gmail.get_thread(account_id, thread_id, fmt="full")
        messages = parse_thread_full(account_id, thread)
        summary = build_thread_summary(account_id, account["email"], thread)
        self.store.clear_messages(account_id, thread_id)
        for message in messages:
            self.store.upsert_message(message)
        self.store.upsert_thread(summary)
        row = self.store.get_thread(account_id, thread_id)
        return {"thread": row, "messages": self.store.get_messages(account_id, thread_id)}

    def cached_thread(self, account_id: str, thread_id: str) -> dict[str, Any] | None:
        thread = self.store.get_thread(account_id, thread_id)
        if not thread:
            return None
        messages = self.store.get_messages(account_id, thread_id)
        if not messages:
            return None
        if not all(m["body_loaded"] for m in messages):
            return None
        if len(messages) < int(thread.get("message_count") or 0):
            return None
        return {"thread": thread, "messages": messages}
