from __future__ import annotations

import base64
import copy
import email
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.ai import _strip_thinking, clean_email_body
from app.notifications import NotificationMonitor
from app.server import _clean_ui_prefs, _outgoing_name
from app.gmail import (
    GmailClient,
    build_mime,
    build_thread_summary,
    parse_thread_full,
)
from app.store import Store
from app.sync import SyncManager


def b64(data: str | bytes) -> str:
    if isinstance(data, str):
        data = data.encode()
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def header(name: str, value: str) -> dict:
    return {"name": name, "value": value}


def part(mime: str, data: str, *, filename: str = "", headers=None, part_id="1", attachment_id=""):
    body = {"size": len(data)}
    if attachment_id:
        body["attachmentId"] = attachment_id
    else:
        body["data"] = b64(data)
    return {
        "partId": part_id,
        "mimeType": mime,
        "filename": filename,
        "headers": headers or [],
        "body": body,
    }


def make_thread():
    plain = "Hi Joel,\n\nCan you review the launch checklist today?\n\nThanks,\nPriya"
    html = '<div>Hi Joel,<p>Can you review the launch checklist today?</p><p>Thanks,<br>Priya</p><div class="gmail_signature">Priya Raman<br>+1 415 555 0138</div></div>'
    attachment = part(
        "application/pdf",
        "pdf bytes",
        filename="checklist.pdf",
        headers=[header("Content-Disposition", 'attachment; filename="checklist.pdf"')],
        part_id="3",
        attachment_id="att-1",
    )
    inline = part(
        "image/png",
        "png bytes",
        filename="logo.png",
        headers=[
            header("Content-ID", "<logo1>"),
            header("Content-Disposition", "inline; filename=logo.png"),
        ],
        part_id="4",
    )
    msg1 = {
        "id": "m1",
        "threadId": "t1",
        "internalDate": "1730000000000",
        "labelIds": ["INBOX", "UNREAD", "Label_work"],
        "snippet": "Hi Joel, Can you review the launch checklist today?",
        "payload": {
            "mimeType": "multipart/mixed",
            "headers": [
                header("Subject", "Q3 launch checklist"),
                header("From", "Priya Raman <priya@example.com>"),
                header("To", "Joel <joel@example.com>"),
                header("Cc", "Ana <ana@example.com>"),
                header("Message-ID", "<m1@example.com>"),
                header("References", "<root@example.com>"),
            ],
            "parts": [
                {
                    "partId": "0",
                    "mimeType": "multipart/alternative",
                    "filename": "",
                    "headers": [],
                    "body": {"size": 0},
                    "parts": [
                        part("text/plain", plain, part_id="0.0"),
                        part("text/html", html, part_id="0.1"),
                    ],
                },
                attachment,
                inline,
            ],
        },
    }
    msg2 = {
        "id": "m2",
        "threadId": "t1",
        "internalDate": "1730003600000",
        "labelIds": ["SENT", "STARRED"],
        "snippet": "Following up on the checklist.",
        "payload": {
            "mimeType": "text/html",
            "headers": [
                header("Subject", "Re: Q3 launch checklist"),
                header("From", "Joel <joel@example.com>"),
                header("To", "Priya Raman <priya@example.com>"),
            ],
            "body": {"data": b64("<p>Following up on the checklist.</p>")},
        },
    }
    return {"id": "t1", "messages": [msg1, msg2]}


class GmailParsingTests(unittest.TestCase):
    def test_thread_summary(self):
        summary = build_thread_summary("acct", "joel@example.com", make_thread())
        self.assertEqual(summary["subject"], "Re: Q3 launch checklist")
        self.assertEqual(summary["message_count"], 2)
        self.assertTrue(summary["unread"])
        self.assertTrue(summary["starred"])
        self.assertTrue(summary["has_attachment"])
        self.assertEqual(summary["sender_email"], "priya@example.com")
        self.assertEqual(summary["last_from_email"], "joel@example.com")
        self.assertIn("INBOX", summary["labels"])
        self.assertIn("SENT", summary["labels"])

    def test_draft_thread_displays_recipient(self):
        thread = make_thread()
        thread["messages"][1]["labelIds"] = ["DRAFT"]
        summary = build_thread_summary("acct", "joel@example.com", thread)
        self.assertEqual(summary["sender_email"], "priya@example.com")
        self.assertIn("DRAFT", summary["labels"])

    def test_full_thread_bodies_and_attachments(self):
        messages = parse_thread_full("acct", make_thread())
        self.assertEqual(len(messages), 2)
        first = messages[0]
        self.assertIn("Can you review", first["body_html"])
        self.assertIn("gmail_signature", first["body_html"])
        self.assertEqual(first["from_email"], "priya@example.com")
        self.assertEqual(first["to"][0]["email"], "joel@example.com")
        self.assertEqual(first["cc"][0]["email"], "ana@example.com")
        self.assertEqual(first["message_id"], "<m1@example.com>")
        self.assertEqual(len(first["attachments"]), 2)
        attachment = first["attachments"][0]
        self.assertEqual(attachment["filename"], "checklist.pdf")
        self.assertEqual(attachment["attachment_id"], "att-1")
        self.assertFalse(attachment["inline"])
        inline = first["attachments"][1]
        self.assertEqual(inline["content_id"], "logo1")
        self.assertTrue(inline["inline"])
        self.assertEqual(inline["data"], b64("png bytes"))

    def test_plain_body_fallback(self):
        payload = {
            "mimeType": "text/plain",
            "headers": [
                header("Subject", "Plain"),
                header("From", "Ana <ana@example.com>"),
                header("To", "Joel <joel@example.com>"),
            ],
            "body": {"data": b64("One line\n\nSecond paragraph")},
        }
        msg = {
            "id": "p1",
            "threadId": "pt",
            "internalDate": "1730000000000",
            "labelIds": ["INBOX"],
            "snippet": "One line",
            "payload": payload,
        }
        parsed = parse_thread_full("acct", {"id": "pt", "messages": [msg]})[0]
        self.assertIn("<p>One line</p>", parsed["body_html"])
        self.assertIn("Second paragraph", parsed["body_html"])


class MimeTests(unittest.TestCase):
    def test_build_mime_with_inline_image(self):
        raw = build_mime(
            account_email="joel@example.com",
            from_name="Joel",
            to=[{"name": "Priya", "email": "priya@example.com"}],
            cc=[],
            bcc=[],
            subject="Photo",
            text="See attached.",
            html='<p>See this <img src="cid:img1"></p>',
            attachments=[
                {
                    "filename": "photo.png",
                    "mime": "image/png",
                    "data": base64.b64encode(b"png bytes").decode(),
                    "inline": True,
                    "content_id": "img1",
                }
            ],
        )
        message = email.message_from_bytes(raw)
        self.assertEqual(message.get_content_type(), "multipart/mixed")
        images = [
            part
            for part in message.walk()
            if part.get_content_type() == "image/png"
        ]
        self.assertEqual(len(images), 1)
        self.assertEqual(images[0]["Content-ID"], "<img1>")
        self.assertIn("inline", (images[0]["Content-Disposition"] or "").lower())

    def test_build_mime_with_attachment(self):
        raw = build_mime(
            account_email="joel@example.com",
            from_name="Joel",
            to=[{"name": "Priya", "email": "priya@example.com"}],
            cc=[],
            bcc=[],
            subject="Re: Q3 launch checklist",
            text="Hello\n\nReply text.",
            html="<p>Hello</p><p>Reply text.</p>",
            attachments=[
                {
                    "filename": "notes.txt",
                    "mime": "text/plain",
                    "data": base64.b64encode(b"attachment content").decode(),
                }
            ],
            in_reply_to="<m1@example.com>",
            references="<root@example.com> <m1@example.com>",
        )
        message = email.message_from_bytes(raw)
        self.assertEqual(message["Subject"], "Re: Q3 launch checklist")
        self.assertEqual(message["In-Reply-To"], "<m1@example.com>")
        self.assertIn("<m1@example.com>", message["References"])
        self.assertEqual(message["To"], "Priya <priya@example.com>")
        self.assertTrue(message.is_multipart())
        text_parts = [
            part for part in message.walk() if part.get_content_type() == "text/plain"
        ]
        self.assertTrue(text_parts)
        attachment = [
            part
            for part in message.walk()
            if part.get_filename() == "notes.txt"
        ][0]
        self.assertEqual(attachment.get_payload(decode=True), b"attachment content")


class FakeGmail:
    def __init__(self, thread):
        self.thread = thread

    def profile(self, account_id):
        return {"historyId": "100", "emailAddress": "joel@example.com"}

    def list_thread_ids(
        self, account_id, *, label=None, query=None, max_results=100, page_token=None
    ):
        if label in (None, "INBOX"):
            return {"threads": [{"id": self.thread["id"]}]}
        return {"threads": []}

    def labels(self, account_id):
        return [
            {
                "id": "Label_work",
                "name": "Work",
                "type": "user",
                "color": {"backgroundColor": "#3E6FA8"},
            },
            {"id": "INBOX", "name": "Inbox", "type": "system"},
        ]

    def get_thread(self, account_id, thread_id, fmt="metadata"):
        return self.thread


class PagingGmail(FakeGmail):
    def __init__(self, thread):
        super().__init__(thread)
        self.pages = {
            None: {
                "threads": [{"id": "t1"}, {"id": "t2"}],
                "nextPageToken": "page-2",
            },
            "page-2": {"threads": [{"id": "t3"}]},
        }

    def list_thread_ids(
        self, account_id, *, label=None, query=None, max_results=100, page_token=None
    ):
        if label in (None, "INBOX"):
            return self.pages.get(page_token, {"threads": []})
        return {"threads": []}

    def get_thread(self, account_id, thread_id, fmt="metadata"):
        thread = copy.deepcopy(self.thread)
        thread["id"] = thread_id
        for message in thread.get("messages", []):
            message["threadId"] = thread_id
        return thread


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name) / "sync.db")
        self.store.add_account(
            account_id="a1",
            email="joel@example.com",
            name="Joel",
            color="#3E6FA8",
            access_token="x",
            refresh_token="y",
            token_expiry=0,
            scope="s",
        )

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def test_fetch_older_pages_through_gmail(self):
        manager = SyncManager(self.store, PagingGmail(make_thread()))
        first = manager.fetch_older("inbox")
        self.assertEqual(first["fetched"], 2)
        self.assertTrue(first["has_more"])
        second = manager.fetch_older("inbox")
        self.assertEqual(second["fetched"], 1)
        self.assertFalse(second["has_more"])
        third = manager.fetch_older("inbox")
        self.assertEqual(third["fetched"], 0)
        self.assertFalse(third["has_more"])
        ids = {thread["id"] for thread in self.store.list_threads(folder="inbox")}
        self.assertEqual(ids, {"t1", "t2", "t3"})

    def test_full_sync_then_lazy_thread(self):
        manager = SyncManager(self.store, FakeGmail(make_thread()))
        manager._sync_account("a1")
        threads = self.store.list_threads(folder="inbox")
        self.assertEqual(len(threads), 1)
        self.assertEqual(threads[0]["id"], "t1")
        self.assertEqual(threads[0]["message_count"], 2)
        self.assertTrue(threads[0]["unread"])
        account = self.store.get_account("a1")
        self.assertEqual(account["history_id"], "100")
        self.assertGreater(account["last_sync"], 0)
        self.assertGreater(manager.status()["revision"], 0)
        self.assertEqual(self.store.get_messages("a1", "t1"), [])
        labels = {row["name"] for row in self.store.labels()}
        self.assertEqual(labels, {"Work"})
        self.assertEqual(self.store.label_summary()[0]["total"], 1)
        entry = manager.full_thread("a1", "t1")
        self.assertEqual(len(entry["messages"]), 2)
        self.assertIn("Can you review", entry["messages"][0]["body_html"])
        self.assertIsNotNone(manager.cached_thread("a1", "t1"))


class MigrationTests(unittest.TestCase):
    def test_username_column_is_added_to_an_old_database(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "old.db"
            conn = sqlite3.connect(path)
            conn.executescript(
                """
                CREATE TABLE accounts (
                    id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE,
                    name TEXT,
                    color TEXT NOT NULL,
                    access_token TEXT,
                    refresh_token TEXT,
                    token_expiry INTEGER DEFAULT 0,
                    scope TEXT,
                    history_id TEXT,
                    last_sync INTEGER DEFAULT 0,
                    needs_reauth INTEGER DEFAULT 0,
                    created_at INTEGER NOT NULL
                );
                INSERT INTO accounts(id,email,name,color,created_at)
                VALUES('old','old@example.com','Old','#3E6FA8',1);
                """
            )
            conn.commit()
            conn.close()
            store = Store(path)
            try:
                row = store.get_account("old")
                self.assertIsNotNone(row)
                self.assertIn("username", row.keys())
                self.assertIsNone(row["username"])
                self.assertIn("default_view_id", row.keys())
                self.assertIsNone(row["default_view_id"])
                self.assertEqual(store.views(), [])
            finally:
                store.close()


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name) / "test.db")
        self.store.add_account(
            account_id="a1",
            email="joel@example.com",
            name="Joel",
            color="#3E6FA8",
            access_token="x",
            refresh_token="y",
            token_expiry=0,
            scope="s",
        )
        indexes = [
            ("inbox", ["INBOX", "UNREAD"], 1),
            ("starred", ["STARRED"], 0),
            ("archive", [], 0),
            ("sent", ["SENT"], 0),
            ("spam", ["SPAM", "UNREAD"], 1),
            ("trash", ["TRASH"], 0),
        ]
        for name, labels, unread in indexes:
            self.store.upsert_thread(
                {
                    "account_id": "a1",
                    "id": name,
                    "subject": name,
                    "snippet": "",
                    "last_date": 1000,
                    "message_count": 1,
                    "labels": labels,
                    "unread": bool(unread),
                    "starred": "STARRED" in labels,
                    "has_attachment": False,
                    "participants": [],
                    "sender_name": "Joel",
                    "sender_email": "joel@example.com",
                }
            )

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def test_folders_and_counts(self):
        self.assertEqual(
            [t["id"] for t in self.store.list_threads(folder="inbox")], ["inbox"]
        )
        archive_ids = [t["id"] for t in self.store.list_threads(folder="archive")]
        self.assertIn("archive", archive_ids)
        self.assertIn("starred", archive_ids)
        counts = self.store.counts()
        self.assertEqual(counts["total"]["inbox"]["total"], 1)
        self.assertEqual(counts["total"]["inbox"]["unread"], 1)
        self.assertEqual(counts["total"]["spam"]["unread"], 1)
        self.assertGreaterEqual(counts["total"]["archive"]["total"], 1)

    def test_archived_reply_is_in_archive(self):
        self.store.upsert_thread(
            {
                "account_id": "a1",
                "id": "sent-reply",
                "subject": "Re: archived reply",
                "snippet": "",
                "last_date": 1200,
                "message_count": 2,
                "labels": ["SENT", "CATEGORY_PERSONAL"],
                "unread": False,
                "starred": False,
                "has_attachment": False,
                "participants": [],
                "sender_name": "Ana",
                "sender_email": "ana@example.com",
            }
        )
        archive_ids = [
            thread["id"]
            for thread in self.store.list_threads(folder="archive")
        ]
        self.assertIn("sent-reply", archive_ids)
        self.assertNotIn("sent", archive_ids)

    def test_custom_views_filter_and_persist(self):
        self.store.upsert_thread(
            {
                "account_id": "a1",
                "id": "work",
                "subject": "Weekly report",
                "snippet": "Numbers",
                "last_date": 5000,
                "message_count": 1,
                "labels": ["INBOX", "Label_work"],
                "unread": True,
                "starred": False,
                "has_attachment": False,
                "participants": [
                    {"name": "Ana Ruiz", "email": "ana@example.com"}
                ],
                "sender_name": "Ana Ruiz",
                "sender_email": "ana@example.com",
            }
        )
        self.store.upsert_thread(
            {
                "account_id": "a1",
                "id": "draft-reply",
                "subject": "Weekly report draft",
                "snippet": "",
                "last_date": 4800,
                "message_count": 2,
                "labels": ["INBOX", "DRAFT"],
                "unread": False,
                "starred": False,
                "has_attachment": False,
                "participants": [
                    {"name": "Ana Ruiz", "email": "ana@example.com"}
                ],
                "sender_name": "Ana Ruiz",
                "sender_email": "ana@example.com",
            }
        )
        self.store.upsert_thread(
            {
                "account_id": "a1",
                "id": "draft-only",
                "subject": "Draft only",
                "snippet": "",
                "last_date": 4700,
                "message_count": 1,
                "labels": ["DRAFT"],
                "unread": False,
                "starred": False,
                "has_attachment": False,
                "participants": [],
                "sender_name": "Joel",
                "sender_email": "joel@example.com",
            }
        )
        self.store.upsert_thread(
            {
                "account_id": "a1",
                "id": "support",
                "subject": "Weekly support digest",
                "snippet": "",
                "last_date": 4500,
                "message_count": 1,
                "labels": ["INBOX", "Label_support"],
                "unread": True,
                "starred": False,
                "has_attachment": False,
                "participants": [
                    {
                        "name": "Support",
                        "email": "support@example.com",
                    }
                ],
                "sender_name": "Support",
                "sender_email": "support@example.com",
            }
        )
        view = self.store.save_view(
            "a1",
            "Weekly work",
            {
                "include_labels": ["INBOX"],
                "exclude_labels": [],
                "include_senders": [],
                "exclude_senders": ["support@"],
                "include_subject": "weekly",
                "exclude_subject": "",
            },
        )
        threads, total = self.store.list_threads_for_view(view)
        self.assertEqual(
            [thread["id"] for thread in threads], ["work", "draft-reply"]
        )
        self.assertEqual(total, 2)
        work_only = self.store.save_view(
            "a1",
            "Work only",
            {
                "include_labels": ["INBOX", "Label_work"],
                "exclude_labels": [],
                "include_senders": [],
                "exclude_senders": [],
                "include_subject": "",
                "exclude_subject": "",
            },
        )
        threads, _ = self.store.list_threads_for_view(work_only)
        self.assertEqual([thread["id"] for thread in threads], ["work"])
        no_work = self.store.save_view(
            "a1",
            "No work",
            {
                "include_labels": ["INBOX"],
                "exclude_labels": ["Label_work"],
                "include_senders": [],
                "exclude_senders": [],
                "include_subject": "",
                "exclude_subject": "",
            },
        )
        threads, _ = self.store.list_threads_for_view(no_work)
        ids = [thread["id"] for thread in threads]
        self.assertNotIn("work", ids)
        self.assertIn("draft-reply", ids)
        self.assertNotIn("draft-only", ids)
        self.assertEqual(len(self.store.views(account_id="a1")), 3)
        self.assertIn(
            "draft-reply",
            [thread["id"] for thread in self.store.list_threads(folder="inbox")],
        )
        self.store.update_account("a1", default_view_id=view["id"])
        self.assertEqual(
            self.store.get_account("a1")["default_view_id"], view["id"]
        )
        self.store.delete_view(view["id"])
        self.assertIsNone(
            self.store.get_account("a1")["default_view_id"]
        )
        self.assertEqual(len(self.store.views(account_id="a1")), 2)

    def test_account_outgoing_name(self):
        self.store.update_account("a1", name="Joel Smith")
        self.assertEqual(self.store.get_account("a1")["name"], "Joel Smith")
        self.store.update_account("a1", name=None)
        self.assertIsNone(self.store.get_account("a1")["name"])

    def test_drafts_folder_and_counts(self):
        self.store.upsert_thread(
            {
                "account_id": "a1",
                "id": "draft",
                "subject": "Draft subject",
                "snippet": "Draft body",
                "last_date": 4000,
                "message_count": 1,
                "labels": ["DRAFT"],
                "unread": False,
                "starred": False,
                "has_attachment": False,
                "participants": [],
                "sender_name": "Ana",
                "sender_email": "ana@example.com",
            }
        )
        self.assertEqual(
            [thread["id"] for thread in self.store.list_threads(folder="drafts")],
            ["draft"],
        )
        counts = self.store.counts()
        self.assertEqual(counts["total"]["drafts"]["total"], 1)
        self.assertEqual(
            counts["accounts"]["a1"]["folders"]["drafts"]["total"], 1
        )

    def test_contact_suggestions_rank_and_exclude_account(self):
        self.store.upsert_thread(
            {
                "account_id": "a1",
                "id": "inbox",
                "subject": "inbox",
                "snippet": "",
                "last_date": 3000,
                "message_count": 1,
                "labels": ["INBOX"],
                "participants": [
                    {"name": "Ana Ruiz", "email": "ana@example.com"},
                    {"name": "Joel", "email": "joel@example.com"},
                ],
                "sender_name": "Ana Ruiz",
                "sender_email": "ana@example.com",
            }
        )
        self.store.upsert_thread(
            {
                "account_id": "a1",
                "id": "sent",
                "subject": "sent",
                "snippet": "",
                "last_date": 2000,
                "message_count": 1,
                "labels": ["SENT"],
                "participants": [
                    {"name": "Ana Ruiz", "email": "ana@example.com"},
                    {"name": "ana", "email": "ana@example.com"},
                    {"name": "Ben Okafor", "email": "ben@example.com"},
                ],
                "sender_name": "Ana Ruiz",
                "sender_email": "ana@example.com",
            }
        )
        results = self.store.contact_suggestions("", account_id="a1")
        self.assertEqual(
            [contact["email"] for contact in results],
            ["ana@example.com", "ben@example.com"],
        )
        self.assertEqual(results[0]["name"], "Ana Ruiz")
        self.assertEqual(
            self.store.contact_suggestions("ben", account_id="a1"),
            [{"name": "Ben Okafor", "email": "ben@example.com"}],
        )
        self.assertEqual(self.store.contact_suggestions("joel", account_id="a1"), [])

    def test_update_thread_labels_changes_folders(self):
        self.store.update_thread(
            "a1", "inbox", labels=["ARCHIVE", "STARRED"], unread=0, starred=1
        )
        self.assertEqual(self.store.list_threads(folder="inbox"), [])
        archive_ids = [t["id"] for t in self.store.list_threads(folder="archive")]
        self.assertIn("inbox", archive_ids)

    def test_drafts_round_trip(self):
        self.store.save_draft(
            "a1",
            "inbox",
            "reply",
            {
                "to": "ana@example.com",
                "subject": "Re: test",
                "html": "<p>Draft</p>",
                "attachments": [],
            },
        )
        drafts = self.store.thread_drafts("a1", "inbox")
        self.assertEqual(len(drafts), 1)
        self.assertEqual(drafts[0]["kind"], "reply")
        self.assertIn("Draft", drafts[0]["payload"]["html"])
        self.store.delete_draft("a1", "inbox", "reply")
        self.assertEqual(self.store.thread_drafts("a1", "inbox"), [])

    def test_marking_thread_unread_updates_cached_messages(self):
        self.store.upsert_message(
            {
                "account_id": "a1",
                "id": "m1",
                "thread_id": "inbox",
                "labels": ["INBOX"],
                "body_loaded": True,
            }
        )
        self.store.set_messages_unread("a1", "inbox", True)
        message = self.store.get_message("a1", "m1")
        self.assertIn("UNREAD", message["labels"])
        self.store.set_messages_unread("a1", "inbox", False)
        message = self.store.get_message("a1", "m1")
        self.assertNotIn("UNREAD", message["labels"])

    def test_settings_round_trip(self):
        self.store.set_setting("ai_model", "test-model")
        self.assertEqual(self.store.get_setting("ai_model"), "test-model")
        self.store.set_setting("ai_model", None)
        self.assertIsNone(self.store.get_setting("ai_model"))

    def test_account_metadata_can_be_customised(self):
        self.store.update_account("a1", username="Studio", color="#A26232")
        account = self.store.get_account("a1")
        self.assertEqual(account["username"], "Studio")
        self.assertEqual(account["color"], "#A26232")

    def test_user_labels_merge_across_accounts(self):
        self.store.add_account(
            account_id="a2",
            email="joel.work@example.com",
            name="Joel Work",
            color="#5E7F45",
            access_token="x",
            refresh_token="y",
            token_expiry=0,
            scope="s",
        )
        for account_id in ("a1", "a2"):
            self.store.replace_labels(
                account_id,
                [
                    {
                        "id": "Label_work",
                        "name": "Work",
                        "type": "user",
                        "color": {"backgroundColor": "#3E6FA8"},
                    },
                    {
                        "id": "Label_read",
                        "name": "Reading",
                        "type": "user",
                        "color": None,
                    },
                ],
            )
        self.store.update_thread("a1", "inbox", labels=["INBOX", "UNREAD", "Label_work"])
        self.store.update_thread("a1", "spam", labels=["SPAM", "UNREAD", "Label_work"])
        self.store.upsert_thread(
            {
                "account_id": "a2",
                "id": "other",
                "subject": "Other work",
                "snippet": "",
                "last_date": 2000,
                "message_count": 1,
                "labels": ["INBOX", "Label_work"],
                "unread": False,
                "starred": False,
                "has_attachment": False,
                "participants": [],
                "sender_name": "Ana",
                "sender_email": "ana@example.com",
            }
        )
        summary = {item["name"]: item for item in self.store.label_summary()}
        self.assertEqual(summary["Work"]["total"], 2)
        self.assertEqual(summary["Work"]["unread"], 1)
        self.assertEqual(
            summary["Work"]["accounts"],
            {
                "a1": {"total": 1, "unread": 1, "color": "#3E6FA8"},
                "a2": {"total": 1, "unread": 0, "color": "#3E6FA8"},
            },
        )
        self.assertEqual(summary["Reading"]["total"], 0)
        self.assertEqual(
            summary["Reading"]["accounts"],
            {
                "a1": {"total": 0, "unread": 0, "color": None},
                "a2": {"total": 0, "unread": 0, "color": None},
            },
        )
        merged = self.store.list_threads_for_label("Work")
        self.assertEqual({thread["account_id"] for thread in merged}, {"a1", "a2"})
        self.assertEqual(
            [thread["id"] for thread in self.store.list_threads_for_label("Work", limit=1)],
            ["other"],
        )
        self.assertEqual(
            [thread["id"] for thread in self.store.list_threads_for_label("Work", limit=1, offset=1)],
            ["inbox"],
        )

    def test_threads_can_be_paged(self):
        first = self.store.list_threads(folder="archive", limit=1, offset=0)
        second = self.store.list_threads(folder="archive", limit=1, offset=1)
        self.assertEqual(len(first), 1)
        self.assertEqual(len(second), 1)
        self.assertNotEqual(first[0]["id"], second[0]["id"])

    def test_refresh_intervals(self):
        manager = SyncManager(self.store, FakeGmail(make_thread()))
        self.assertEqual(manager._refresh_interval(), 10)
        self.store.set_setting("refresh_mode", "balanced")
        self.assertEqual(manager._refresh_interval(), 60)
        self.store.set_setting("refresh_mode", "manual")
        self.assertEqual(manager._refresh_interval(), 0)


class FakeNotification:
    def __init__(self, title, body):
        self.title = title
        self.body = body
        self.actions = []
        self.closed = []
        self.shown = False

    def set_app_name(self, _name):
        pass

    def set_hint(self, _name, _value):
        pass

    def add_action(self, action, label, callback, target):
        self.actions.append((action, label, callback, target))

    def connect(self, signal, callback):
        if signal == "closed":
            self.closed.append(callback)

    def show(self):
        self.shown = True

    def emit_closed(self):
        for callback in self.closed:
            callback(self)


class FakeNotify:
    created = []

    class Notification:
        @staticmethod
        def new(title, body, _icon):
            note = FakeNotification(title, body)
            FakeNotify.created.append(note)
            return note


class FakeGLib:
    @staticmethod
    def idle_add(callback):
        return callback()


class FakeNotifyApp:
    def __init__(self):
        self.logs = []

    def log(self, message):
        self.logs.append(message)


class FakeNotifyStore:
    def accounts(self):
        return []

    def get_account(self, _account_id):
        return None

    def get_setting(self, key):
        if key == "ui_prefs":
            return '{"notifySound":"none"}'
        return None


class AIBodyCleanTests(unittest.TestCase):
    def test_html_quote_and_signature_containers_are_removed(self):
        message = {
            "body_text": "",
            "body_html": (
                "<div>Please review the budget.</div>"
                '<div class="gmail_quote">On Tuesday Jane wrote:'
                "<blockquote>Old quoted text</blockquote></div>"
                '<div class="gmail_signature">Jane Doe<br>'
                "jane@example.com</div>"
            ),
        }
        self.assertEqual(
            clean_email_body(message), "Please review the budget."
        )

    def test_text_quote_markers_are_removed(self):
        message = {
            "body_text": (
                "Please review the budget.\n\n"
                "On Tue, Jan 2, 2024, Jane <jane@example.com> wrote:\n"
                "> Old quoted text"
            )
        }
        self.assertEqual(
            clean_email_body(message), "Please review the budget."
        )

    def test_angle_quoted_text_is_removed(self):
        message = {"body_text": "See the note.\n\n> Old quoted text"}
        self.assertEqual(clean_email_body(message), "See the note.")

    def test_outlook_quote_block_is_removed(self):
        message = {
            "body_text": (
                "Here is the update.\n\nFrom: Jane Doe\nSent: Tuesday\n"
                "To: Joel\nSubject: Re: update\n\nOld text"
            )
        }
        self.assertEqual(clean_email_body(message), "Here is the update.")

    def test_signature_separator_and_closer_are_removed(self):
        message = {
            "body_text": (
                "The launch is Friday.\n\nThanks,\nJane Doe\n"
                "Acme Inc\njane@example.com\n555-0100"
            )
        }
        self.assertEqual(
            clean_email_body(message), "The launch is Friday."
        )
        self.assertEqual(
            clean_email_body({"body_text": "Body text here.\n\n--\nJane"}),
            "Body text here.",
        )

    def test_short_email_with_a_closer_is_not_gutted(self):
        self.assertEqual(
            clean_email_body({"body_text": "Thanks,\nJane"}),
            "Thanks,\nJane",
        )

    def test_thinking_blocks_and_tags_are_removed(self):
        self.assertEqual(
            _strip_thinking("<think>hidden reasoning</think>John needs a reset."),
            "John needs a reset.",
        )
        self.assertEqual(
            _strip_thinking("John needs a reset.</think>"),
            "John needs a reset.",
        )
        self.assertEqual(
            _strip_thinking("hidden reasoning</think>John needs a reset."),
            "John needs a reset.",
        )
        self.assertEqual(_strip_thinking("<thinking>still thinking"), "")


class UIPrefsTests(unittest.TestCase):
    def test_ai_and_google_setup_are_off_by_default(self):
        prefs = _clean_ui_prefs({})
        self.assertFalse(prefs["aiEnabled"])
        self.assertFalse(prefs["googleSetupSeen"])
        self.assertFalse(prefs["updateAuto"])
        self.assertEqual(prefs["updateInterval"], 5)
        self.assertTrue(_clean_ui_prefs({"updateAuto": True})["updateAuto"])
        self.assertEqual(
            _clean_ui_prefs({"updateInterval": 8})["updateInterval"], 8
        )
        self.assertEqual(
            _clean_ui_prefs({"updateInterval": 3})["updateInterval"], 5
        )

    def test_ai_and_google_setup_booleans_are_preserved(self):
        prefs = _clean_ui_prefs(
            {"aiEnabled": True, "googleSetupSeen": True}
        )
        self.assertTrue(prefs["aiEnabled"])
        self.assertTrue(prefs["googleSetupSeen"])


class OutgoingNameTests(unittest.TestCase):
    def test_profile_name_from_id_token(self):
        payload = base64.urlsafe_b64encode(
            b'{"name":"Joel Smith"}'
        ).decode("ascii").rstrip("=")
        self.assertEqual(
            GmailClient.profile_name({"id_token": f"e30.{payload}.sig"}),
            "Joel Smith",
        )

    def test_outgoing_name_does_not_use_badge_username(self):
        self.assertEqual(
            _outgoing_name(
                {
                    "email": "joel@example.com",
                    "name": "Joel Smith",
                    "username": "joelnod64",
                }
            ),
            "Joel Smith",
        )
        self.assertEqual(
            _outgoing_name(
                {
                    "email": "joel@example.com",
                    "name": "joel",
                    "username": "Joel Smith",
                }
            ),
            "joel",
        )
        self.assertEqual(
            _outgoing_name(
                {
                    "email": "joel@example.com",
                    "name": "",
                    "username": "",
                }
            ),
            "joel",
        )


class NotificationTests(unittest.TestCase):
    def setUp(self):
        FakeNotify.created = []
        self.app = FakeNotifyApp()
        self.app.store = FakeNotifyStore()
        self.opened = []
        self.monitor = NotificationMonitor(
            self.app,
            Path("/nonexistent/courier.svg"),
            on_open=lambda account_id, thread_id: self.opened.append(
                (account_id, thread_id)
            ),
        )
        self.monitor.notify = FakeNotify
        self.monitor.GLib = FakeGLib
        self.prefs = {"notifySound": "system"}

    def test_default_action_opens_the_thread(self):
        self.monitor._send_notification(
            "Ana", "Budget", self.prefs, ("acc-1", "thread-1")
        )
        note = FakeNotify.created[-1]
        self.assertTrue(note.shown)
        self.assertEqual(note.actions[0][0], "default")
        self.assertEqual(note.actions[0][3], ("acc-1", "thread-1"))

        action, _label, callback, target = note.actions[0]
        callback(note, action, target)
        self.assertEqual(self.opened, [("acc-1", "thread-1")])
        self.assertIn(note, self.monitor.active)

        note.emit_closed()
        self.assertNotIn(note, self.monitor.active)

    def test_update_notification_opens_updates(self):
        self.updated = []
        self.monitor.on_update = lambda version: self.updated.append(version)
        sent = self.monitor._send_notification(
            "Courier 1.2.0 is available",
            "Open Settings to download it.",
            self.prefs,
            ("__update__", "1.2.0"),
        )
        self.assertTrue(sent)
        note = FakeNotify.created[-1]
        action, _label, callback, target = note.actions[0]
        callback(note, action, target)
        self.assertEqual(self.updated, ["1.2.0"])

    def test_notify_update_includes_version(self):
        self.updated = []
        self.monitor.on_update = lambda version: self.updated.append(version)
        self.assertTrue(self.monitor.notify_update("1.2.0"))
        note = FakeNotify.created[-1]
        self.assertIn("1.2.0", note.title)
        self.assertIn("1.2.0", note.body)
        action, _label, callback, target = note.actions[0]
        callback(note, action, target)
        self.assertEqual(self.updated, ["1.2.0"])

    def test_test_notification_has_no_action(self):
        self.monitor._send_test(self.prefs)
        note = FakeNotify.created[-1]
        self.assertTrue(note.shown)
        self.assertEqual(note.actions, [])

    def test_missing_thread_id_never_gets_an_action(self):
        self.monitor._send_notification("Ana", "Budget", self.prefs, None)
        note = FakeNotify.created[-1]
        self.assertEqual(note.actions, [])

    def test_archived_threads_are_quiet_by_default(self):
        self.app.store.get_account = lambda _id: {
            "email": "joel@example.com",
            "username": "Joel",
        }
        notified = []
        self.monitor._notify = lambda thread, _prefs, _summary: notified.append(
            thread["id"]
        )
        thread = {
            "account_id": "acc-1",
            "id": "thread-1",
            "labels": ["Label_work"],
            "unread": True,
            "last_from_email": "ana@example.com",
        }
        self.monitor._dispatch(thread, self.prefs)
        self.assertEqual(notified, [])
        self.monitor._dispatch(thread, self.prefs | {"notifyArchived": True})
        self.assertEqual(notified, ["thread-1"])

    def test_ai_notifications_require_the_main_ai_toggle(self):
        self.app.store.get_account = lambda _id: {
            "email": "joel@example.com",
            "username": "Joel",
        }
        notified = []
        self.monitor._notify = lambda thread, _prefs, _summary: notified.append(
            thread["id"]
        )
        thread = {
            "account_id": "acc-1",
            "id": "thread-1",
            "labels": ["INBOX"],
            "unread": True,
            "last_from_email": "ana@example.com",
        }
        self.monitor._dispatch(
            thread,
            self.prefs | {"notifyUseAI": True, "aiEnabled": False},
        )
        self.assertEqual(notified, ["thread-1"])

    def test_own_message_in_an_inbox_thread_is_ignored(self):
        self.app.store.get_account = lambda _id: {
            "email": "joel@example.com",
            "username": "Joel",
        }
        notified = []
        self.monitor._notify = lambda thread, _prefs, _summary: notified.append(
            thread["id"]
        )
        base = {
            "account_id": "acc-1",
            "id": "thread-1",
            "labels": ["INBOX", "SENT"],
            "unread": True,
        }
        self.monitor._dispatch(
            base | {"last_from_email": "joel@example.com"}, self.prefs
        )
        self.assertEqual(notified, [])
        self.monitor._dispatch(
            base | {"last_from_email": "ana@example.com"}, self.prefs
        )
        self.assertEqual(notified, ["thread-1"])


if __name__ == "__main__":
    unittest.main()
