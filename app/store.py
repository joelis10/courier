"""SQLite store for Courier.

One connection guarded by a re-entrant lock. All data stays local. The database file is
created with mode 0600.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = 7

FOLDERS = ("inbox", "starred", "sent", "drafts", "spam", "trash", "archive")
FOLDER_LABELS = {
    "inbox": ("INBOX",),
    "starred": ("STARRED",),
    "sent": ("SENT",),
    "drafts": ("DRAFT",),
    "spam": ("SPAM",),
    "trash": ("TRASH",),
}
NON_ARCHIVE_LABELS = ("INBOX", "SPAM", "TRASH", "SENT", "DRAFT")


def _json(value: Any, default: Any) -> Any:
    if value is None or value == "":
        return default
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


class Store:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self.path.parent, 0o700)
        except OSError:
            pass
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(str(self.path), check_same_thread=False, timeout=20)
        self.conn.row_factory = sqlite3.Row
        with self.lock:
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.execute("PRAGMA synchronous=NORMAL")
            self.conn.execute("PRAGMA foreign_keys=ON")
            self._migrate()
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    def close(self) -> None:
        with self.lock:
            self.conn.close()

    # ------------------------------------------------------------------ schema

    def _migrate(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                username TEXT,
                name TEXT,
                color TEXT NOT NULL,
                access_token TEXT,
                refresh_token TEXT,
                token_expiry INTEGER DEFAULT 0,
                scope TEXT,
                history_id TEXT,
                last_sync INTEGER DEFAULT 0,
                needs_reauth INTEGER DEFAULT 0,
                default_view_id INTEGER,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS threads (
                account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                id TEXT NOT NULL,
                subject TEXT,
                snippet TEXT,
                last_date INTEGER DEFAULT 0,
                message_count INTEGER DEFAULT 0,
                labels TEXT NOT NULL DEFAULT '[]',
                unread INTEGER DEFAULT 0,
                starred INTEGER DEFAULT 0,
                has_attachment INTEGER DEFAULT 0,
                participants TEXT NOT NULL DEFAULT '[]',
                sender_name TEXT,
                sender_email TEXT,
                last_from_email TEXT,
                updated_at INTEGER DEFAULT 0,
                PRIMARY KEY (account_id, id)
            );
            CREATE INDEX IF NOT EXISTS threads_date ON threads(last_date DESC);
            CREATE INDEX IF NOT EXISTS threads_account_date ON threads(account_id, last_date DESC);
            CREATE TABLE IF NOT EXISTS messages (
                account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                id TEXT NOT NULL,
                thread_id TEXT NOT NULL,
                subject TEXT,
                from_name TEXT,
                from_email TEXT,
                to_json TEXT NOT NULL DEFAULT '[]',
                cc_json TEXT NOT NULL DEFAULT '[]',
                bcc_json TEXT NOT NULL DEFAULT '[]',
                date INTEGER DEFAULT 0,
                snippet TEXT,
                body_html TEXT,
                body_text TEXT,
                message_id TEXT,
                refs TEXT,
                in_reply_to TEXT,
                labels TEXT NOT NULL DEFAULT '[]',
                attachments_json TEXT NOT NULL DEFAULT '[]',
                body_loaded INTEGER DEFAULT 0,
                PRIMARY KEY (account_id, id)
            );
            CREATE INDEX IF NOT EXISTS messages_thread ON messages(account_id, thread_id, date);
            CREATE TABLE IF NOT EXISTS labels (
                account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                id TEXT NOT NULL,
                name TEXT NOT NULL,
                color TEXT,
                PRIMARY KEY (account_id, id)
            );
            CREATE INDEX IF NOT EXISTS labels_name ON labels(lower(name));
            CREATE TABLE IF NOT EXISTS drafts (
                account_id TEXT NOT NULL,
                thread_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                payload TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (account_id, thread_id, kind)
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            CREATE TABLE IF NOT EXISTS views (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                filters TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS views_account ON views(account_id, id);
            """
        )
        columns = {
            row["name"] for row in self.conn.execute("PRAGMA table_info(accounts)")
        }
        if "username" not in columns:
            self.conn.execute("ALTER TABLE accounts ADD COLUMN username TEXT")
        if "default_view_id" not in columns:
            self.conn.execute("ALTER TABLE accounts ADD COLUMN default_view_id INTEGER")
        thread_columns = {
            row["name"] for row in self.conn.execute("PRAGMA table_info(threads)")
        }
        if "last_from_email" not in thread_columns:
            self.conn.execute("ALTER TABLE threads ADD COLUMN last_from_email TEXT")
        self.conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
        self.conn.commit()

    # ------------------------------------------------------------------ generic

    def _rows(self, sql: str, args: Iterable[Any] = ()) -> list[sqlite3.Row]:
        with self.lock:
            return self.conn.execute(sql, tuple(args)).fetchall()

    def _row(self, sql: str, args: Iterable[Any] = ()) -> sqlite3.Row | None:
        with self.lock:
            return self.conn.execute(sql, tuple(args)).fetchone()

    def _write(self, sql: str, args: Iterable[Any] = ()) -> None:
        with self.lock:
            self.conn.execute(sql, tuple(args))
            self.conn.commit()

    # ------------------------------------------------------------------ settings

    def get_setting(self, key: str, default: str | None = None) -> str | None:
        row = self._row("SELECT value FROM settings WHERE key=?", (key,))
        return row["value"] if row else default

    def set_setting(self, key: str, value: str | None) -> None:
        if value is None:
            self._write("DELETE FROM settings WHERE key=?", (key,))
        else:
            self._write(
                "INSERT INTO settings(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )

    # ------------------------------------------------------------------ accounts

    def accounts(self) -> list[sqlite3.Row]:
        return self._rows("SELECT * FROM accounts ORDER BY created_at ASC")

    def get_account(self, account_id: str) -> sqlite3.Row | None:
        return self._row("SELECT * FROM accounts WHERE id=?", (account_id,))

    def get_account_by_email(self, email: str) -> sqlite3.Row | None:
        return self._row("SELECT * FROM accounts WHERE lower(email)=lower(?)", (email,))

    @staticmethod
    def _contact_name(name: str, email: str) -> str:
        cleaned = (name or "").strip().strip('"').strip()
        if not cleaned:
            return ""
        local = (email.split("@")[0] or "").strip()
        compact = re.sub(r"[^a-z0-9]", "", cleaned.lower())
        local_compact = re.sub(r"[^a-z0-9]", "", local.lower())
        if not compact:
            return ""
        if len(cleaned.split()) > 1:
            return cleaned
        if compact in {
            email.strip().lower().replace("@", ""),
            local.lower(),
            local_compact,
        }:
            return ""
        return cleaned

    def contact_suggestions(
        self, query: str = "", account_id: str = "", limit: int = 8
    ) -> list[dict[str, Any]]:
        excluded = {
            (account["email"] or "").strip().lower()
            for account in self.accounts()
            if account["email"]
        }
        contacts: dict[str, dict[str, Any]] = {}

        def add(email: str, name: str, when: int, uses: int = 1) -> None:
            email = (email or "").strip()
            if "@" not in email:
                return
            key = email.lower()
            if key in excluded:
                return
            entry = contacts.setdefault(
                key,
                {
                    "email": email,
                    "names": [],
                    "uses": 0,
                    "last_date": 0,
                },
            )
            entry["uses"] += uses
            stamp = int(when or 0)
            entry["last_date"] = max(entry["last_date"], stamp)
            resolved = self._contact_name(name, email)
            if resolved:
                entry["names"].append((stamp, resolved))

        for row in self._rows(
            "SELECT participants,last_date,sender_name,sender_email "
            "FROM threads ORDER BY last_date DESC"
        ):
            stamp = int(row["last_date"] or 0)
            for person in _json(row["participants"], []):
                if isinstance(person, dict):
                    add(person.get("email") or "", person.get("name") or "", stamp)
            add(
                row["sender_email"] or "",
                row["sender_name"] or "",
                stamp,
            )

        for row in self._rows(
            "SELECT from_name,from_email,date FROM messages ORDER BY date DESC"
        ):
            add(
                row["from_email"] or "",
                row["from_name"] or "",
                int(row["date"] or 0),
            )

        for contact in contacts.values():
            names = contact.pop("names", [])
            if names:
                contact["name"] = max(
                    names,
                    key=lambda item: (
                        1 if len(item[1].split()) > 1 else 0,
                        len(item[1]),
                        item[0],
                    ),
                )[1]
            else:
                contact["name"] = ""

        needle = query.strip().lower()

        def rank(contact: dict[str, Any]) -> tuple[int, int, int, str] | None:
            email = contact["email"].lower()
            name = contact["name"].lower()
            if not needle:
                order = 0
            elif email.startswith(needle):
                order = 0
            elif name.startswith(needle):
                order = 1
            elif any(part.startswith(needle) for part in name.split()):
                order = 2
            elif needle in email or needle in name:
                order = 3
            else:
                return None
            return (order, -contact["uses"], -contact["last_date"], email)

        ranked = []
        for contact in contacts.values():
            position = rank(contact)
            if position is not None:
                ranked.append((position, contact))
        ranked.sort(key=lambda item: item[0])
        return [
            {"name": contact["name"], "email": contact["email"]}
            for _, contact in ranked[: max(1, min(int(limit), 20))]
        ]

    def add_account(
        self,
        *,
        account_id: str,
        email: str,
        name: str | None,
        color: str,
        access_token: str,
        refresh_token: str,
        token_expiry: int,
        scope: str,
        history_id: str | None = None,
    ) -> None:
        self._write(
            "INSERT INTO accounts(id,email,name,color,access_token,refresh_token,"
            "token_expiry,scope,history_id,last_sync,needs_reauth,created_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,0,0,?)",
            (
                account_id,
                email,
                name,
                color,
                access_token,
                refresh_token,
                int(token_expiry),
                scope,
                history_id,
                int(time.time() * 1000),
            ),
        )

    def update_account(self, account_id: str, **fields: Any) -> None:
        allowed = {
            "name",
            "username",
            "color",
            "access_token",
            "refresh_token",
            "token_expiry",
            "scope",
            "history_id",
            "last_sync",
            "needs_reauth",
            "default_view_id",
        }
        keys = [k for k in fields if k in allowed]
        if not keys:
            return
        assignments = ", ".join(f"{k}=?" for k in keys)
        values = [fields[k] for k in keys]
        values.append(account_id)
        self._write(f"UPDATE accounts SET {assignments} WHERE id=?", values)

    def remove_account(self, account_id: str) -> None:
        with self.lock:
            self.conn.execute("DELETE FROM messages WHERE account_id=?", (account_id,))
            self.conn.execute("DELETE FROM threads WHERE account_id=?", (account_id,))
            self.conn.execute("DELETE FROM views WHERE account_id=?", (account_id,))
            self.conn.execute("DELETE FROM accounts WHERE id=?", (account_id,))
            self.conn.commit()

    # ------------------------------------------------------------------ views

    @staticmethod
    def _view_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": int(row["id"]),
            "account_id": row["account_id"],
            "name": row["name"],
            "filters": _json(row["filters"], {}),
            "created_at": int(row["created_at"] or 0),
            "updated_at": int(row["updated_at"] or 0),
        }

    def views(self, account_id: str | None = None) -> list[dict[str, Any]]:
        if account_id:
            rows = self._rows(
                "SELECT * FROM views WHERE account_id=? ORDER BY lower(name), id",
                (account_id,),
            )
        else:
            rows = self._rows(
                "SELECT * FROM views ORDER BY lower(name), id"
            )
        return [self._view_dict(row) for row in rows]

    def get_view(self, view_id: int) -> dict[str, Any] | None:
        row = self._row("SELECT * FROM views WHERE id=?", (int(view_id),))
        return self._view_dict(row) if row else None

    def save_view(
        self,
        account_id: str,
        name: str,
        filters: dict[str, Any],
        view_id: int | None = None,
    ) -> dict[str, Any]:
        now = int(time.time() * 1000)
        encoded = json.dumps(filters, separators=(",", ":"))
        with self.lock:
            if view_id:
                self.conn.execute(
                    "UPDATE views SET name=?, filters=?, updated_at=? "
                    "WHERE id=? AND account_id=?",
                    (
                        name,
                        encoded,
                        now,
                        int(view_id),
                        account_id,
                    ),
                )
                saved_id = int(view_id)
            else:
                cursor = self.conn.execute(
                    "INSERT INTO views(account_id,name,filters,created_at,updated_at) "
                    "VALUES(?,?,?,?,?)",
                    (account_id, name, encoded, now, now),
                )
                saved_id = int(cursor.lastrowid)
            self.conn.commit()
        return self.get_view(saved_id) or {
            "id": saved_id,
            "account_id": account_id,
            "name": name,
            "filters": filters,
            "created_at": now,
            "updated_at": now,
        }

    def delete_view(self, view_id: int) -> None:
        view_id = int(view_id)
        with self.lock:
            self.conn.execute(
                "UPDATE accounts SET default_view_id=NULL WHERE default_view_id=?",
                (view_id,),
            )
            self.conn.execute("DELETE FROM views WHERE id=?", (view_id,))
            self.conn.commit()

    # ------------------------------------------------------------------ threads

    def upsert_thread(self, thread: dict[str, Any]) -> None:
        labels = json.dumps(thread.get("labels", []), separators=(",", ":"))
        participants = json.dumps(thread.get("participants", []), separators=(",", ":"))
        self._write(
            """
            INSERT INTO threads(account_id,id,subject,snippet,last_date,message_count,
                labels,unread,starred,has_attachment,participants,sender_name,
                sender_email,last_from_email,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(account_id,id) DO UPDATE SET
                subject=excluded.subject,
                snippet=excluded.snippet,
                last_date=excluded.last_date,
                message_count=excluded.message_count,
                labels=excluded.labels,
                unread=excluded.unread,
                starred=excluded.starred,
                has_attachment=excluded.has_attachment,
                participants=excluded.participants,
                sender_name=excluded.sender_name,
                sender_email=excluded.sender_email,
                last_from_email=excluded.last_from_email,
                updated_at=excluded.updated_at
            """,
            (
                thread["account_id"],
                thread["id"],
                thread.get("subject") or "",
                thread.get("snippet") or "",
                int(thread.get("last_date") or 0),
                int(thread.get("message_count") or 0),
                labels,
                1 if thread.get("unread") else 0,
                1 if thread.get("starred") else 0,
                1 if thread.get("has_attachment") else 0,
                participants,
                thread.get("sender_name") or "",
                thread.get("sender_email") or "",
                thread.get("last_from_email") or "",
                int(time.time() * 1000),
            ),
        )

    def delete_thread(self, account_id: str, thread_id: str) -> None:
        with self.lock:
            self.conn.execute(
                "DELETE FROM messages WHERE account_id=? AND thread_id=?",
                (account_id, thread_id),
            )
            self.conn.execute(
                "DELETE FROM threads WHERE account_id=? AND id=?",
                (account_id, thread_id),
            )
            self.conn.commit()

    def get_thread(self, account_id: str, thread_id: str) -> dict[str, Any] | None:
        row = self._row(
            "SELECT * FROM threads WHERE account_id=? AND id=?",
            (account_id, thread_id),
        )
        return self._thread_dict(row) if row else None

    def update_thread(
        self,
        account_id: str,
        thread_id: str,
        *,
        labels: list[str] | None = None,
        unread: int | None = None,
        starred: int | None = None,
    ) -> None:
        sets: list[str] = []
        values: list[Any] = []
        if labels is not None:
            sets.append("labels=?")
            values.append(json.dumps(labels, separators=(",", ":")))
        if unread is not None:
            sets.append("unread=?")
            values.append(1 if unread else 0)
        if starred is not None:
            sets.append("starred=?")
            values.append(1 if starred else 0)
        if not sets:
            return
        values.extend([account_id, thread_id])
        self._write(
            f"UPDATE threads SET {', '.join(sets)} WHERE account_id=? AND id=?", values
        )

    def thread_labels(self, account_id: str, thread_id: str) -> list[str]:
        row = self._row(
            "SELECT labels FROM threads WHERE account_id=? AND id=?",
            (account_id, thread_id),
        )
        return _json(row["labels"], []) if row else []

    def _thread_dict(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "account_id": row["account_id"],
            "id": row["id"],
            "key": f"{row['account_id']}:{row['id']}",
            "subject": row["subject"] or "",
            "snippet": row["snippet"] or "",
            "last_date": row["last_date"] or 0,
            "message_count": row["message_count"] or 0,
            "labels": _json(row["labels"], []),
            "unread": bool(row["unread"]),
            "starred": bool(row["starred"]),
            "has_attachment": bool(row["has_attachment"]),
            "participants": _json(row["participants"], []),
            "sender_name": row["sender_name"] or "",
            "sender_email": row["sender_email"] or "",
            "last_from_email": row["last_from_email"] or "",
        }

    def _folder_sql(self, folder: str) -> tuple[str, list[Any]]:
        if folder == "archive":
            placeholders = ",".join("?" for _ in NON_ARCHIVE_LABELS)
            return (
                "NOT EXISTS (SELECT 1 FROM json_each(t.labels) "
                f"WHERE json_each.value IN ({placeholders}))",
                list(NON_ARCHIVE_LABELS),
            )
        if folder in FOLDER_LABELS:
            return (
                "EXISTS (SELECT 1 FROM json_each(t.labels) WHERE json_each.value = ?)",
                [FOLDER_LABELS[folder][0]],
            )
        return ("1=1", [])

    def list_threads(
        self,
        *,
        account_id: str | None = None,
        folder: str = "inbox",
        query: str = "",
        unread_only: bool = False,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        where: list[str] = []
        args: list[Any] = []
        folder_sql, folder_args = self._folder_sql(folder)
        where.append(folder_sql)
        args.extend(folder_args)
        if account_id:
            where.append("t.account_id=?")
            args.append(account_id)
        if unread_only:
            where.append("t.unread=1")
        query = (query or "").strip()
        if query:
            needle = f"%{query.lower()}%"
            where.append(
                "(lower(t.subject) LIKE ? OR lower(t.snippet) LIKE ? "
                "OR lower(t.sender_name) LIKE ? OR lower(t.sender_email) LIKE ? "
                "OR lower(t.participants) LIKE ?)"
            )
            args.extend([needle] * 5)
        sql = (
            "SELECT t.* FROM threads t WHERE "
            + " AND ".join(where)
            + " ORDER BY t.last_date DESC LIMIT ? OFFSET ?"
        )
        args.extend([int(limit), int(offset)])
        return [self._thread_dict(row) for row in self._rows(sql, args)]

    def list_threads_for_view(
        self,
        view: dict[str, Any],
        *,
        unread_only: bool = False,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        filters = view.get("filters") or {}
        if not isinstance(filters, dict):
            filters = {}
        include_labels = {
            str(value)
            for value in filters.get("include_labels") or []
            if str(value)
        }
        exclude_labels = {
            str(value)
            for value in filters.get("exclude_labels") or []
            if str(value)
        }
        include_senders = [
            str(value).strip().lower()
            for value in filters.get("include_senders") or []
            if str(value).strip()
        ]
        exclude_senders = [
            str(value).strip().lower()
            for value in filters.get("exclude_senders") or []
            if str(value).strip()
        ]

        def compile_pattern(value: Any):
            text = str(value or "").strip()
            if not text:
                return None
            try:
                return re.compile(text, re.IGNORECASE)
            except re.error:
                return None

        include_subject = compile_pattern(filters.get("include_subject"))
        exclude_subject = compile_pattern(filters.get("exclude_subject"))
        rows = self._rows(
            "SELECT t.* FROM threads t WHERE t.account_id=? "
            "ORDER BY t.last_date DESC",
            (view.get("account_id") or "",),
        )
        matches: list[dict[str, Any]] = []
        for row in rows:
            thread = self._thread_dict(row)
            labels = set(thread.get("labels") or [])
            if "SPAM" in labels and "SPAM" not in include_labels:
                continue
            if "TRASH" in labels and "TRASH" not in include_labels:
                continue
            # A reply draft still carries INBOX/SENT and must stay in normal
            # views. Only draft-only threads are hidden unless requested.
            if (
                "DRAFT" in labels
                and "DRAFT" not in include_labels
                and not (labels & {"INBOX", "SENT", "STARRED"})
            ):
                continue
            if include_labels and not include_labels.issubset(labels):
                continue
            if exclude_labels and labels & exclude_labels:
                continue
            people = [thread.get("sender_name"), thread.get("sender_email")]
            for person in thread.get("participants") or []:
                if isinstance(person, dict):
                    people.append(person.get("name"))
                    people.append(person.get("email"))
            haystack = " ".join(
                str(value).lower() for value in people if value
            )
            if include_senders and not all(
                value in haystack for value in include_senders
            ):
                continue
            if exclude_senders and any(
                value in haystack for value in exclude_senders
            ):
                continue
            subject = thread.get("subject") or ""
            if include_subject and not include_subject.search(subject):
                continue
            if exclude_subject and exclude_subject.search(subject):
                continue
            if unread_only and not thread.get("unread"):
                continue
            matches.append(thread)
        total = len(matches)
        return matches[offset : offset + limit], total

    def all_thread_summaries(self) -> list[dict[str, Any]]:
        rows = self._rows("SELECT account_id, labels, unread FROM threads")
        return [
            {
                "account_id": row["account_id"],
                "labels": _json(row["labels"], []),
                "unread": bool(row["unread"]),
            }
            for row in rows
        ]

    # ------------------------------------------------------------------ messages

    def upsert_message(self, message: dict[str, Any]) -> None:
        self._write(
            """
            INSERT INTO messages(account_id,id,thread_id,subject,from_name,from_email,
                to_json,cc_json,bcc_json,date,snippet,body_html,body_text,message_id,
                refs,in_reply_to,labels,attachments_json,body_loaded)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(account_id,id) DO UPDATE SET
                thread_id=excluded.thread_id,
                subject=excluded.subject,
                from_name=excluded.from_name,
                from_email=excluded.from_email,
                to_json=excluded.to_json,
                cc_json=excluded.cc_json,
                bcc_json=excluded.bcc_json,
                date=excluded.date,
                snippet=excluded.snippet,
                body_html=excluded.body_html,
                body_text=excluded.body_text,
                message_id=excluded.message_id,
                refs=excluded.refs,
                in_reply_to=excluded.in_reply_to,
                labels=excluded.labels,
                attachments_json=excluded.attachments_json,
                body_loaded=excluded.body_loaded
            """,
            (
                message["account_id"],
                message["id"],
                message["thread_id"],
                message.get("subject") or "",
                message.get("from_name") or "",
                message.get("from_email") or "",
                json.dumps(message.get("to", []), separators=(",", ":")),
                json.dumps(message.get("cc", []), separators=(",", ":")),
                json.dumps(message.get("bcc", []), separators=(",", ":")),
                int(message.get("date") or 0),
                message.get("snippet") or "",
                message.get("body_html") or "",
                message.get("body_text") or "",
                message.get("message_id") or "",
                message.get("refs") or "",
                message.get("in_reply_to") or "",
                json.dumps(message.get("labels", []), separators=(",", ":")),
                json.dumps(message.get("attachments", []), separators=(",", ":")),
                1 if message.get("body_loaded") else 0,
            ),
        )

    def get_message(self, account_id: str, message_id: str) -> dict[str, Any] | None:
        row = self._row(
            "SELECT * FROM messages WHERE account_id=? AND id=?",
            (account_id, message_id),
        )
        if not row:
            return None
        return {
            "account_id": row["account_id"],
            "id": row["id"],
            "thread_id": row["thread_id"],
            "subject": row["subject"] or "",
            "from_name": row["from_name"] or "",
            "from_email": row["from_email"] or "",
            "to": _json(row["to_json"], []),
            "cc": _json(row["cc_json"], []),
            "bcc": _json(row["bcc_json"], []),
            "date": row["date"] or 0,
            "snippet": row["snippet"] or "",
            "body_html": row["body_html"] or "",
            "body_text": row["body_text"] or "",
            "message_id": row["message_id"] or "",
            "refs": row["refs"] or "",
            "in_reply_to": row["in_reply_to"] or "",
            "labels": _json(row["labels"], []),
            "attachments": _json(row["attachments_json"], []),
            "body_loaded": bool(row["body_loaded"]),
        }

    def get_messages(self, account_id: str, thread_id: str) -> list[dict[str, Any]]:
        rows = self._rows(
            "SELECT * FROM messages WHERE account_id=? AND thread_id=? ORDER BY date ASC",
            (account_id, thread_id),
        )
        out = []
        for row in rows:
            out.append(
                {
                    "account_id": row["account_id"],
                    "id": row["id"],
                    "thread_id": row["thread_id"],
                    "subject": row["subject"] or "",
                    "from_name": row["from_name"] or "",
                    "from_email": row["from_email"] or "",
                    "to": _json(row["to_json"], []),
                    "cc": _json(row["cc_json"], []),
                    "bcc": _json(row["bcc_json"], []),
                    "date": row["date"] or 0,
                    "snippet": row["snippet"] or "",
                    "body_html": row["body_html"] or "",
                    "body_text": row["body_text"] or "",
                    "message_id": row["message_id"] or "",
                    "refs": row["refs"] or "",
                    "in_reply_to": row["in_reply_to"] or "",
                    "labels": _json(row["labels"], []),
                    "attachments": _json(row["attachments_json"], []),
                    "body_loaded": bool(row["body_loaded"]),
                }
            )
        return out

    def cached_message_count(self, account_id: str, thread_id: str) -> int:
        row = self._row(
            "SELECT COUNT(*) AS n, SUM(body_loaded) AS loaded FROM messages "
            "WHERE account_id=? AND thread_id=?",
            (account_id, thread_id),
        )
        return int(row["n"] or 0) if row else 0

    def all_bodies_loaded(self, account_id: str, thread_id: str) -> bool:
        row = self._row(
            "SELECT COUNT(*) AS n, SUM(body_loaded) AS loaded FROM messages "
            "WHERE account_id=? AND thread_id=?",
            (account_id, thread_id),
        )
        if not row or not row["n"]:
            return False
        return int(row["loaded"] or 0) == int(row["n"])

    def save_draft(
        self,
        account_id: str,
        thread_id: str,
        kind: str,
        payload: dict[str, Any],
    ) -> None:
        self._write(
            "INSERT INTO drafts(account_id,thread_id,kind,payload,updated_at) "
            "VALUES(?,?,?,?,?) ON CONFLICT(account_id,thread_id,kind) DO UPDATE SET "
            "payload=excluded.payload,updated_at=excluded.updated_at",
            (
                account_id,
                thread_id,
                kind,
                json.dumps(payload, separators=(",", ":")),
                int(time.time() * 1000),
            ),
        )

    def thread_drafts(self, account_id: str, thread_id: str) -> list[dict[str, Any]]:
        rows = self._rows(
            "SELECT kind,payload,updated_at FROM drafts "
            "WHERE account_id=? AND thread_id=? ORDER BY updated_at DESC",
            (account_id, thread_id),
        )
        out = []
        for row in rows:
            payload = _json(row["payload"], None)
            if isinstance(payload, dict):
                out.append(
                    {
                        "kind": row["kind"],
                        "payload": payload,
                        "updated_at": row["updated_at"] or 0,
                    }
                )
        return out

    def delete_draft(self, account_id: str, thread_id: str, kind: str) -> None:
        self._write(
            "DELETE FROM drafts WHERE account_id=? AND thread_id=? AND kind=?",
            (account_id, thread_id, kind),
        )

    def clear_messages(self, account_id: str, thread_id: str) -> None:
        self._write(
            "DELETE FROM messages WHERE account_id=? AND thread_id=?",
            (account_id, thread_id),
        )

    def set_messages_unread(
        self, account_id: str, thread_id: str, unread: bool
    ) -> None:
        rows = self._rows(
            "SELECT id,labels FROM messages WHERE account_id=? AND thread_id=?",
            (account_id, thread_id),
        )
        with self.lock:
            for row in rows:
                labels = [
                    label
                    for label in _json(row["labels"], [])
                    if label != "UNREAD"
                ]
                if unread:
                    labels.append("UNREAD")
                self.conn.execute(
                    "UPDATE messages SET labels=? WHERE account_id=? AND id=?",
                    (
                        json.dumps(sorted(set(labels)), separators=(",", ":")),
                        account_id,
                        row["id"],
                    ),
                )
            self.conn.commit()

    # ------------------------------------------------------------------ labels

    def replace_labels(self, account_id: str, labels: list[dict[str, Any]]) -> None:
        with self.lock:
            self.conn.execute("DELETE FROM labels WHERE account_id=?", (account_id,))
            for label in labels:
                label_id = str(label.get("id") or "")
                name = str(label.get("name") or "").strip()
                if not label_id or not name:
                    continue
                color = (label.get("color") or {}).get("backgroundColor") if isinstance(label.get("color"), dict) else None
                if color and not isinstance(color, str):
                    color = None
                self.conn.execute(
                    "INSERT INTO labels(account_id,id,name,color) VALUES(?,?,?,?) "
                    "ON CONFLICT(account_id,id) DO UPDATE SET "
                    "name=excluded.name,color=excluded.color",
                    (account_id, label_id, name, color),
                )
            self.conn.commit()

    def labels(self) -> list[sqlite3.Row]:
        return self._rows(
            "SELECT account_id,id,name,color FROM labels ORDER BY lower(name), name"
        )

    def label_summary(self) -> list[dict[str, Any]]:
        label_rows = self.labels()
        by_account: dict[str, dict[str, dict[str, Any]]] = {}
        merged: dict[str, dict[str, Any]] = {}
        for row in label_rows:
            by_account.setdefault(row["account_id"], {})[row["id"]] = {
                "name": row["name"],
                "color": row["color"],
            }
            key = row["name"].lower()
            item = merged.setdefault(
                key,
                {
                    "name": row["name"],
                    "color": row["color"],
                    "total": 0,
                    "unread": 0,
                    "accounts": {},
                    "ids": {},
                },
            )
            item["ids"].setdefault(row["account_id"], row["id"])
            bucket = item["accounts"].setdefault(
                row["account_id"],
                {"total": 0, "unread": 0, "color": row["color"]},
            )
            if not bucket["color"] and row["color"]:
                bucket["color"] = row["color"]
            if not item["color"] and row["color"]:
                item["color"] = row["color"]

        for thread in self.all_thread_summaries():
            labels = set(thread["labels"])
            if "SPAM" in labels or "TRASH" in labels:
                continue
            account_map = by_account.get(thread["account_id"], {})
            seen: set[str] = set()
            for label_id in labels:
                label = account_map.get(label_id)
                if not label:
                    continue
                key = label["name"].lower()
                if key in seen:
                    continue
                seen.add(key)
                item = merged.get(key)
                if not item:
                    continue
                item["total"] += 1
                if thread["unread"]:
                    item["unread"] += 1
                bucket = item["accounts"].setdefault(
                    thread["account_id"],
                    {"total": 0, "unread": 0, "color": label["color"]},
                )
                bucket["total"] += 1
                if thread["unread"]:
                    bucket["unread"] += 1
        return sorted(merged.values(), key=lambda item: item["name"].lower())

    def label_thread_ids(self, name: str, account_id: str | None = None) -> dict[str, list[str]]:
        rows = self._rows(
            "SELECT account_id,id FROM labels WHERE lower(name)=lower(?)"
            + (" AND account_id=?" if account_id else ""),
            (name, account_id) if account_id else (name,),
        )
        out: dict[str, list[str]] = {}
        for row in rows:
            out.setdefault(row["account_id"], []).append(row["id"])
        return out

    def list_threads_for_label(
        self,
        name: str,
        *,
        account_id: str | None = None,
        unread_only: bool = False,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        grouped = self.label_thread_ids(name, account_id)
        if not grouped:
            return []
        conditions: list[str] = []
        args: list[Any] = []
        for account, ids in grouped.items():
            placeholders = ",".join("?" for _ in ids)
            conditions.append(
                "(t.account_id=? AND EXISTS (SELECT 1 FROM json_each(t.labels) "
                f"WHERE json_each.value IN ({placeholders})))"
            )
            args.append(account)
            args.extend(ids)
        where = ["(" + " OR ".join(conditions) + ")"]
        where.append(
            "NOT EXISTS (SELECT 1 FROM json_each(t.labels) WHERE json_each.value IN ('SPAM','TRASH'))"
        )
        if unread_only:
            where.append("t.unread=1")
        sql = (
            "SELECT t.* FROM threads t WHERE "
            + " AND ".join(where)
            + " ORDER BY t.last_date DESC LIMIT ? OFFSET ?"
        )
        args.extend([int(limit), int(offset)])
        return [self._thread_dict(row) for row in self._rows(sql, args)]

    # ------------------------------------------------------------------ counts

    def counts(self) -> dict[str, Any]:
        rows = self.all_thread_summaries()
        total = {folder: {"total": 0, "unread": 0} for folder in FOLDERS}
        per_account: dict[str, dict[str, Any]] = {}

        def touch(account_id: str) -> dict[str, Any]:
            if account_id not in per_account:
                per_account[account_id] = {
                    "unread": 0,
                    "inbox_unread": 0,
                    "folders": {f: {"total": 0, "unread": 0} for f in FOLDERS},
                }
            return per_account[account_id]

        for row in rows:
            labels = set(row["labels"])
            folder_hits = []
            if "INBOX" in labels:
                folder_hits.append("inbox")
            if "STARRED" in labels:
                folder_hits.append("starred")
            if "SENT" in labels:
                folder_hits.append("sent")
            if "DRAFT" in labels:
                folder_hits.append("drafts")
            if "SPAM" in labels:
                folder_hits.append("spam")
            if "TRASH" in labels:
                folder_hits.append("trash")
            if not any(label in labels for label in NON_ARCHIVE_LABELS):
                folder_hits.append("archive")
            acct = touch(row["account_id"])
            unread = bool(row["unread"])
            for folder in folder_hits:
                total[folder]["total"] += 1
                acct["folders"][folder]["total"] += 1
                if unread:
                    total[folder]["unread"] += 1
                    acct["folders"][folder]["unread"] += 1
            if unread:
                acct["unread"] += 1
                if "INBOX" in labels:
                    acct["inbox_unread"] += 1
        return {"total": total, "accounts": per_account}
