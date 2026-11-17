#!/usr/bin/env python3
"""Create a demo database for interface work. Not used by the real app."""

from __future__ import annotations

import base64
import os
import shutil
import struct
import sys
import time
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.store import Store

DATA = Path(os.environ.get("COURIER_DATA_DIR", "/tmp/courier-demo"))
if DATA.exists():
    shutil.rmtree(DATA)
DATA.mkdir(parents=True)
store = Store(DATA / "courier.db")
now = int(time.time() * 1000)
MIN = 60 * 1000
HOUR = 60 * MIN
DAY = 24 * HOUR


def b64(value: str) -> str:
    return base64.b64encode(value.encode()).decode()


store.add_account(
    account_id="acct-joel",
    email="joel@gmail.com",
    name="Joel",
    color="#3E6FA8",
    access_token="demo",
    refresh_token="demo",
    token_expiry=now + DAY,
    scope="demo",
    history_id="1",
)
store.add_account(
    account_id="acct-work",
    email="joel.work@gmail.com",
    name="Joel Work",
    color="#5E7F45",
    access_token="demo",
    refresh_token="demo",
    token_expiry=now + DAY,
    scope="demo",
    history_id="1",
)

created: dict[str, dict] = {}


def add(
    account: str,
    tid: str,
    subject: str,
    frm_name: str,
    frm_email: str,
    to: list[dict[str, str]],
    body_html: str,
    body_text: str,
    *,
    date: int,
    labels: list[str],
    sender_name: str | None = None,
    sender_email: str | None = None,
    unread: bool = True,
    starred: bool = False,
    attachments: list[dict] | None = None,
    message_id: str | None = None,
    refs: str = "",
    in_reply_to: str = "",
    snippet: str = "",
    part_of: str | None = None,
) -> None:
    account_id = account
    mid = message_id or f"msg-{tid}-{len(created.get(tid, {}).get('messages', [])) + 1}"
    message = {
        "account_id": account_id,
        "id": mid,
        "thread_id": tid,
        "subject": subject,
        "from_name": frm_name,
        "from_email": frm_email,
        "to": to,
        "cc": [],
        "bcc": [],
        "date": date,
        "snippet": snippet or body_text[:120].replace("\n", " "),
        "body_html": body_html,
        "body_text": body_text,
        "message_id": f"<{mid}@mail.example>",
        "refs": refs,
        "in_reply_to": in_reply_to,
        "labels": labels,
        "attachments": attachments or [],
        "body_loaded": True,
    }
    store.upsert_message(message)
    entry = created.setdefault(tid, {"messages": [], "labels": set(), "people": []})
    entry["messages"].append(message)
    entry["labels"].update(labels)
    entry["people"].append({"name": frm_name, "email": frm_email})
    for person in to:
        if person not in entry["people"]:
            entry["people"].append(person)
    entry.update(
        {
            "account_id": account_id,
            "account_email": (store.get_account(account_id) or {})["email"] if store.get_account(account_id) else "",
            "id": tid,
            "subject": subject,
            "sender_name": sender_name or frm_name,
            "sender_email": sender_email or frm_email,
            "starred": starred or entry.get("starred", False),
        }
    )


def finish(tid: str) -> None:
    entry = created[tid]
    messages = sorted(entry["messages"], key=lambda m: m["date"])
    last = messages[-1]
    unread = any("UNREAD" in m["labels"] for m in messages)
    starred = any("STARRED" in m["labels"] for m in messages)
    labels: set[str] = set()
    for message in messages:
        labels.update(message["labels"])
    attach = any(
        not (item.get("inline") and item.get("mime", "").startswith("image/"))
        for m in messages
        for item in m.get("attachments", [])
    )
    sender_name = entry.get("sender_name") or last["from_name"]
    sender_email = entry.get("sender_email") or last["from_email"]
    if "SENT" in labels and last["from_email"] == entry.get("account_email"):
        recipients = last.get("to") or []
        if recipients:
            sender_name = recipients[0].get("name") or recipients[0].get("email", "")
            sender_email = recipients[0].get("email", "")
    store.upsert_thread(
        {
            "account_id": entry["account_id"],
            "id": tid,
            "subject": entry["subject"],
            "snippet": last["snippet"],
            "last_date": last["date"],
            "message_count": len(messages),
            "labels": sorted(labels),
            "unread": unread,
            "starred": starred,
            "has_attachment": attach,
            "participants": entry["people"][:12],
            "sender_name": sender_name,
            "sender_email": sender_email,
        }
    )


def person(name: str, email: str) -> dict[str, str]:
    return {"name": name, "email": email}


me = person("Joel", "joel@gmail.com")
me_work = person("Joel Work", "joel.work@gmail.com")

priya_sig = """
<div class="gmail_signature" style="margin-top:18px;border-top:1px solid #ddd;padding-top:12px;font-family:Arial,sans-serif;font-size:12px;color:#666">
  <table cellpadding="0" cellspacing="0" style="font-size:12px;color:#555">
    <tr><td style="padding-right:12px"><img src="cid:logo-priya" width="54" height="54" alt="Northstar" style="display:block;border-radius:4px"></td>
    <td><strong style="color:#22405e;font-size:14px">Priya Raman</strong><br>
    Senior Brand Manager, Northstar Studio<br>
    +1 (415) 555-0138 · priya@northstar.example<br>
    18 King Street, Floor 4, San Francisco, CA 94107<br>
    <a href="https://northstar.example" style="color:#336699">northstar.example</a> · <a href="https://linkedin.com/in/priya-example" style="color:#336699">LinkedIn</a></td></tr>
  </table>
  <p style="font-size:10px;color:#999;margin:12px 0 0">This message and any attachments are confidential and intended only for the named recipient. If you received this in error, please delete it and notify the sender. Northstar Studio LLC, 18 King Street, San Francisco CA 94107.</p>
</div>"""

add(
    "acct-joel",
    "t-launch",
    "Q3 launch checklist",
    "Priya Raman",
    "priya@northstar.example",
    [me],
    f"""<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
    <p>Hi Joel,</p>
    <p>Quick check on the launch list before Thursday. The visual system is locked, but the site still has the old pricing copy and the press page is missing the new screenshots.</p>
    <ul><li>Homepage and pricing copy by Tuesday noon</li><li>Two launch screenshots, 1600px wide</li><li>Final approval from Mara on the press note</li></ul>
    <p>Can you send comments on the attached checklist today? I need to lock the handoff tomorrow morning.</p>
    <p>Thanks,<br>Priya</p>
    {priya_sig}
    </div>""",
    """Hi Joel,

Quick check on the launch list before Thursday. The visual system is locked, but the site still has the old pricing copy and the press page is missing the new screenshots.

Homepage and pricing copy by Tuesday noon. Two launch screenshots, 1600px wide. Final approval from Mara on the press note.

Can you send comments on the attached checklist today? I need to lock the handoff tomorrow morning.

Thanks,
Priya
Senior Brand Manager, Northstar Studio
+1 415 555 0138
18 King Street, San Francisco""",
    date=now - 42 * MIN,
    labels=["INBOX", "UNREAD", "CATEGORY_PERSONAL"],
    attachments=[
        {
            "id": "2",
            "filename": "launch-checklist.pdf",
            "mime": "application/pdf",
            "size": 184320,
            "content_id": "",
            "inline": False,
            "attachment_id": "demo-attachment",
            "data": b64("Demo launch checklist\n\n1. Homepage copy\n2. Pricing copy\n3. Press screenshots\n"),
        },
        {
            "id": "1",
            "filename": "northstar.png",
            "mime": "image/png",
            "size": 2600,
            "content_id": "logo-priya",
            "inline": True,
            "attachment_id": "demo-inline",
            "data": "",
        },
    ],
)
finish("t-launch")

add(
    "acct-work",
    "t-invoice",
    "Invoice 2041 from Fieldwork",
    "Fieldwork Billing",
    "billing@fieldwork.example",
    [me_work],
    """<div style="font-family:Georgia,serif;font-size:15px;color:#222">
    <p>Invoice 2041 is attached for the October studio rental.</p>
    <p><strong>Amount due:</strong> $1,840.00<br><strong>Due date:</strong> 30 November</p>
    <p>Payment can be made by bank transfer using the details on the invoice.</p>
    <p>Fieldwork Billing</p>
    <p style="color:#777">--<br>Fieldwork Studio · 12 Ossington Ave, Toronto<br>billing@fieldwork.example · (416) 555-0192</p>
    </div>""",
    """Invoice 2041 is attached for the October studio rental.

Amount due: $1,840.00
Due date: 30 November

Payment can be made by bank transfer using the details on the invoice.

Fieldwork Billing

--
Fieldwork Studio · 12 Ossington Ave, Toronto
billing@fieldwork.example · (416) 555-0192""",
    date=now - 3 * HOUR,
    labels=["INBOX", "UNREAD"],
    attachments=[
        {
            "id": "1",
            "filename": "invoice-2041.pdf",
            "mime": "application/pdf",
            "size": 92160,
            "content_id": "",
            "inline": False,
            "attachment_id": "demo-attachment-2",
            "data": b64("Invoice 2041\nFieldwork Studio\nAmount due: 1840.00\n"),
        }
    ],
)
finish("t-invoice")

add(
    "acct-work",
    "t-booking",
    "Re: Studio booking for the 24th",
    "Ana Ruiz",
    "ana@fieldwork.example",
    [me_work],
    """<div style="font-family:Arial,sans-serif;font-size:14px">
    <p>Hi Joel,</p>
    <p>The 24th works. I have put you down for the north room from 9 to 6. The loading bay is free after 8:30, so you can bring the lights in early.</p>
    <p>Let me know if you need the blackout curtains.</p>
    <p>Ana</p>
    </div>""",
    """Hi Joel,

The 24th works. I have put you down for the north room from 9 to 6. The loading bay is free after 8:30, so you can bring the lights in early.

Let me know if you need the blackout curtains.

Ana""",
    date=now - DAY,
    labels=["INBOX", "UNREAD", "IMPORTANT"],
)
finish("t-booking")

add(
    "acct-work",
    "t-booking",
    "Re: Studio booking for the 24th",
    "Joel Work",
    "joel.work@gmail.com",
    [person("Ana Ruiz", "ana@fieldwork.example")],
    """<div style="font-family:Arial,sans-serif;font-size:14px">
    <p>Hi Ana,</p>
    <p>Perfect. I will take the blackout curtains too. We should be out by six.</p>
    <p>Thanks,<br>Joel</p>
    <div class="gmail_quote">
      <div>On Mon, 10 Nov 2026 at 09:14, Ana Ruiz &lt;ana@fieldwork.example&gt; wrote:</div>
      <blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">
        <div>Hi Joel,</div>
        <div>Can we move the booking to the 24th? The south room is still occupied that morning.</div>
        <div>Ana</div>
        <div>--<br>Ana Ruiz · Fieldwork Studio · (416) 555-0183</div>
      </blockquote>
    </div>
    </div>""",
    """Hi Ana,

Perfect. I will take the blackout curtains too. We should be out by six.

Thanks,
Joel

On Mon, 10 Nov 2026 at 09:14, Ana Ruiz <ana@fieldwork.example> wrote:
> Hi Joel,
> Can we move the booking to the 24th? The south room is still occupied that morning.
> Ana""",
    date=now - 20 * HOUR,
    labels=["SENT"],
    unread=False,
)
finish("t-booking")

phone_sig = """
<div class="gmail_signature" style="margin-top:14px;font-family:Arial,sans-serif;font-size:12px;color:#777">
  <p>Sent from my iPhone</p>
  <table cellpadding="0" cellspacing="0"><tr>
  <td style="padding-right:10px"><img src="cid:photo-sig" width="64" height="48" alt="" style="display:block"></td>
  <td><strong>Mara Bell</strong><br>Producer<br>+44 20 7946 0104<br>mara@halcyon.example<br><a href="https://halcyon.example">halcyon.example</a></td>
  </tr></table>
</div>"""

add(
    "acct-joel",
    "t-wedding",
    "Re: Wedding photos — final selects",
    "Mara Bell",
    "mara@halcyon.example",
    [me],
    f"""<div style="font-family:Arial,sans-serif;font-size:14px">
    <p>Joel, these are lovely. I have marked the eleven we want for the book and left notes on the two crops that need another pass.</p>
    <p>Can you send the high-res versions by Friday? The printer is holding a slot for us.</p>
    <p>Mara</p>
    {phone_sig}
    </div>""",
    """Joel, these are lovely. I have marked the eleven we want for the book and left notes on the two crops that need another pass.

Can you send the high-res versions by Friday? The printer is holding a slot for us.

Mara
Producer
+44 20 7946 0104""",
    date=now - 4 * HOUR,
    labels=["INBOX", "STARRED", "UNREAD"],
    starred=True,
    attachments=[
        {
            "id": "1",
            "filename": "final-selects.zip",
            "mime": "application/zip",
            "size": 24117248,
            "content_id": "",
            "inline": False,
            "attachment_id": "demo-attachment-3",
            "data": b64("demo archive"),
        }
    ],
)
finish("t-wedding")

newsletter = """
<div style="margin:0;padding:0;background:#f4f1e9;font-family:Georgia,serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fffdf7;border:1px solid #ddd5c3">
      <tr><td style="padding:30px 34px 12px">
        <div style="font-size:11px;color:#9a8f7c;letter-spacing:.08em">FIELD NOTES</div>
        <h1 style="font-size:28px;line-height:1.2;margin:12px 0 10px;color:#2f2a23">The quiet geometry of a room</h1>
        <p style="font-size:15px;line-height:1.6;color:#4a443a">A bench, a window, and one good lamp. This week we visited three studios that make very little furniture do a great deal of work.</p>
      </td></tr>
      <tr><td style="padding:0 34px"><img src="https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=900&q=70" width="532" alt="A quiet studio" style="display:block;width:100%;height:auto"></td></tr>
      <tr><td style="padding:18px 34px 6px">
        <p style="font-size:15px;line-height:1.65;color:#4a443a">The first room belongs to a bookbinder in Copenhagen. She keeps the guillotine by the window and the paper on the north wall. Nothing is labelled. She knows where everything is by the shape of the light.</p>
        <p style="font-size:15px;line-height:1.65;color:#4a443a">Further south, a ceramicist works under a single pendant. The shelves are deliberately low enough to sit beside. The room, she says, should not tower over the work.</p>
        <p style="margin:26px 0 8px"><a href="https://fieldnotes.example/rooms" style="display:inline-block;background:#3e5f4a;color:#fff;text-decoration:none;padding:11px 18px;font-family:Arial,sans-serif;font-size:13px">Read the full piece</a></p>
      </td></tr>
      <tr><td style="padding:20px 34px 28px;border-top:1px solid #eee6d7">
        <p style="font-family:Arial,sans-serif;font-size:11px;color:#9a8f7c;line-height:1.6;margin:0">Field Notes, 14 Larch Lane, London E2 7RG<br>
        You are receiving this because you subscribed. <a href="https://fieldnotes.example/unsubscribe" style="color:#9a8f7c">Unsubscribe</a></p>
      </td></tr>
    </table>
  </td></tr></table>
</div>"""
add(
    "acct-joel",
    "t-newsletter",
    "Field Notes 12: rooms that hold still",
    "Field Notes",
    "notes@fieldnotes.example",
    [me],
    newsletter,
    """FIELD NOTES

The quiet geometry of a room

A bench, a window, and one good lamp. This week we visited three studios that make very little furniture do a great deal of work.

The first room belongs to a bookbinder in Copenhagen. She keeps the guillotine by the window and the paper on the north wall. Nothing is labelled.

Further south, a ceramicist works under a single pendant. The shelves are deliberately low enough to sit beside. The room, she says, should not tower over the work.

Read the full piece
Unsubscribe""",
    date=now - 2 * DAY,
    labels=["INBOX"],
    unread=False,
)
finish("t-newsletter")

add(
    "acct-work",
    "t-contract",
    "Contract draft v4",
    "Sam Okafor",
    "sam@latticeworks.example",
    [me_work],
    """<div style="font-family:Arial,sans-serif;font-size:14px">
    <p>Joel,</p>
    <p>Here is v4 with the revised payment schedule. Clause 7 now has the 14-day notice period and the scope table matches the brief you sent on Monday.</p>
    <p>I have flagged two lines for you: the second payment date and the limit on revisions. Everything else should be settled.</p>
    <p>Best,</p>
    <p>Sam Okafor<br>Lattice Works<br>sam@latticeworks.example</p>
    </div>""",
    """Joel,

Here is v4 with the revised payment schedule. Clause 7 now has the 14-day notice period and the scope table matches the brief you sent on Monday.

I have flagged two lines for you: the second payment date and the limit on revisions. Everything else should be settled.

Best,
Sam Okafor
Lattice Works
sam@latticeworks.example""",
    date=now - 25 * HOUR,
    labels=["INBOX", "STARRED"],
    starred=True,
    attachments=[
        {
            "id": "1",
            "filename": "lattice-contract-v4.pdf",
            "mime": "application/pdf",
            "size": 312320,
            "content_id": "",
            "inline": False,
            "attachment_id": "demo-attachment-4",
            "data": b64("Contract draft v4"),
        }
    ],
)
finish("t-contract")

add(
    "acct-joel",
    "t-shipping",
    "Your order has shipped",
    "Post & Parcel",
    "orders@postparcel.example",
    [me],
    """<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
    <p>Your order is on its way.</p>
    <p><strong>Order:</strong> PP-884120<br><strong>Estimated delivery:</strong> Thursday, 13 November<br><strong>Tracking:</strong> <a href="https://postparcel.example/track/PP-884120">PP-884120</a></p>
    <p>No signature is required. The parcel will be left with reception if you are out.</p>
    </div>""",
    """Your order is on its way.

Order: PP-884120
Estimated delivery: Thursday, 13 November
Tracking: PP-884120

No signature is required. The parcel will be left with reception if you are out.""",
    date=now - 30 * HOUR,
    labels=["INBOX"],
    unread=False,
)
finish("t-shipping")

add(
    "acct-joel",
    "t-archive",
    "Notes from the Tuesday review",
    "Nadia Chen",
    "nadia@northstar.example",
    [me],
    """<div style="font-family:Arial,sans-serif;font-size:14px">
    <p>Notes from yesterday, before I forget:</p>
    <p>The new grid is working. The type still needs a second pass at mobile sizes. We agreed to keep the blue for links and drop the underline except on hover.</p>
    <p>Nadia</p>
    </div>""",
    """Notes from yesterday, before I forget:

The new grid is working. The type still needs a second pass at mobile sizes. We agreed to keep the blue for links and drop the underline except on hover.

Nadia""",
    date=now - 5 * DAY,
    labels=[],
    unread=False,
)
finish("t-archive")

add(
    "acct-work",
    "t-spam",
    "Final reminder: your reward is waiting",
    "Rewards Center",
    "winner@promo-rewards.example",
    [me_work],
    """<div style="font-family:Arial;color:#333">
    <p>Your unclaimed reward expires today.</p>
    <p>Click below to confirm your delivery details.</p>
    <p><a href="https://promo-rewards.example/claim">Claim now</a></p>
    </div>""",
    """Your unclaimed reward expires today. Click below to confirm your delivery details. Claim now.""",
    date=now - 6 * HOUR,
    labels=["SPAM", "UNREAD"],
)
finish("t-spam")

add(
    "acct-joel",
    "t-trash",
    "Old newsletter you unsubscribed from",
    "Daily Digest",
    "digest@example.net",
    [me],
    """<div style="font-family:Arial;font-size:14px"><p>Today's digest.</p></div>""",
    """Today's digest.""",
    date=now - 12 * DAY,
    labels=["TRASH"],
    unread=False,
)
finish("t-trash")

add(
    "acct-joel",
    "t-sent",
    "Re: Dinner on Saturday",
    "Joel",
    "joel@gmail.com",
    [person("Elena Marsh", "elena@example.org")],
    """<div style="font-family:Arial;font-size:14px">
    <p>Saturday works. I will book the corner table for seven.</p>
    <p>Joel</p>
    </div>""",
    """Saturday works. I will book the corner table for seven.

Joel""",
    date=now - 2 * DAY,
    labels=["SENT"],
    unread=False,
)
finish("t-sent")

# User labels, merged by name across accounts in the sidebar.
LABELS = [
    ("Label_work", "Work", "#3E6FA8"),
    ("Label_design", "Design", "#8B4E6A"),
    ("Label_receipts", "Receipts", "#4F7A3B"),
    ("Label_family", "Family", "#A46A22"),
    ("Label_photos", "Photos", "#6659A5"),
    ("Label_reading", "Reading", "#59636F"),
    ("Label_client", "Client", "#B15245"),
    ("Label_travel", "Travel", "#2F7D74"),
]
for account_id in ("acct-joel", "acct-work"):
    store.replace_labels(
        account_id,
        [
            {
                "id": label_id,
                "name": name,
                "type": "user",
                "color": {"backgroundColor": color},
            }
            for label_id, name, color in LABELS
        ],
    )


def attach_labels(account_id: str, thread_id: str, extra: list[str]) -> None:
    thread = store.get_thread(account_id, thread_id)
    if not thread:
        return
    labels = [label for label in thread["labels"] if not label.startswith("Label_")]
    labels.extend(extra)
    store.update_thread(account_id, thread_id, labels=sorted(set(labels)))


attach_labels("acct-joel", "t-launch", ["Label_work", "Label_design"])
attach_labels("acct-work", "t-invoice", ["Label_receipts"])
attach_labels("acct-work", "t-booking", ["Label_work", "Label_client", "Label_travel"])
attach_labels("acct-joel", "t-wedding", ["Label_family", "Label_photos"])
attach_labels("acct-joel", "t-newsletter", ["Label_reading"])
attach_labels("acct-work", "t-contract", ["Label_work", "Label_client"])
attach_labels("acct-joel", "t-archive", ["Label_design"])
attach_labels("acct-joel", "t-sent", ["Label_family"])


def image_data(label: str, color: str) -> str:
    width, height = 640, 360
    rgb = tuple(int(color[index : index + 2], 16) for index in (1, 3, 5))
    accent = tuple(min(255, value + 38) for value in rgb)
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            edge = x < 6 or x >= width - 6 or y < 6 or y >= height - 6
            stripe = 130 <= y < 230 and (x + y) % 96 < 18
            pixel = (255, 255, 255) if edge else accent if stripe else rgb
            raw.extend(pixel)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 6))
        + chunk(b"IEND", b"")
    )
    return "data:image/png;base64," + base64.b64encode(png).decode()


long_tid = "t-renovation"
long_subject = "Kitchen renovation, week six"
long_people = [
    ("Marta Ellis", "marta@ellisbuild.example"),
    ("Joel", "joel@gmail.com"),
]
images = [
    image_data("Cabinet run", "#37546e"),
    image_data("Island sketch", "#6b4a36"),
    image_data("Lighting plan", "#4f6448"),
]
long_messages = [
    (
        "Marta Ellis",
        "marta@ellisbuild.example",
        [me],
        f"""<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
        <p>Morning Joel,</p>
        <p>The cabinet run is set for Thursday. I have attached the revised island sketch and the lighting plan so you can check the outlet positions before the electrician arrives.</p>
        <p><img src="{images[0]}" width="640" height="360" alt="Cabinet run"></p>
        <p><img src="{images[1]}" width="640" height="360" alt="Island sketch"></p>
        <p><img src="{images[2]}" width="640" height="360" alt="Lighting plan"></p>
        <p>Marta</p>
        </div>""",
        """Morning Joel,

The cabinet run is set for Thursday. I have attached the revised island sketch and the lighting plan so you can check the outlet positions before the electrician arrives.

Marta""",
        ["INBOX", "UNREAD"],
        now - 6 * HOUR,
    ),
    (
        "Joel",
        "joel@gmail.com",
        [person("Marta Ellis", "marta@ellisbuild.example")],
        """<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
        <p>Marta,</p>
        <p>The island sketch works. Move the two outlets on the north wall 20cm to the right so they clear the cabinet doors. Everything else is fine.</p>
        <p>Joel</p>
        </div>""",
        """Marta,

The island sketch works. Move the two outlets on the north wall 20cm to the right so they clear the cabinet doors. Everything else is fine.

Joel""",
        ["SENT"],
        now - 5 * HOUR,
    ),
    (
        "Marta Ellis",
        "marta@ellisbuild.example",
        [me],
        """<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
        <p>Makes sense. The electrician can do that Thursday morning. The countertop template is booked for Friday at nine, so the island needs to be in place by then.</p>
        <p>Marta</p>
        </div>""",
        """Makes sense. The electrician can do that Thursday morning. The countertop template is booked for Friday at nine, so the island needs to be in place by then.

Marta""",
        ["INBOX", "UNREAD"],
        now - 4 * HOUR,
    ),
    (
        "Joel",
        "joel@gmail.com",
        [person("Marta Ellis", "marta@ellisbuild.example")],
        """<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
        <p>Friday at nine is fine. I will be home from eight. Please ask them to call when they are twenty minutes away.</p>
        <p>Joel</p>
        </div>""",
        """Friday at nine is fine. I will be home from eight. Please ask them to call when they are twenty minutes away.

Joel""",
        ["SENT"],
        now - 3 * HOUR,
    ),
    (
        "Marta Ellis",
        "marta@ellisbuild.example",
        [me],
        """<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
        <p>Will do. One more thing: the replacement handle samples arrived but the brushed brass is two weeks out. Do you want to wait or use the matte black set?</p>
        <p>Marta</p>
        </div>""",
        """Will do. One more thing: the replacement handle samples arrived but the brushed brass is two weeks out. Do you want to wait or use the matte black set?

Marta""",
        ["INBOX", "UNREAD"],
        now - 2 * HOUR,
    ),
    (
        "Priya Raman",
        "priya@northstar.example",
        [me],
        """<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
        <p>Joel, the matte black handles match the window frames much better. I would use those and skip the wait.</p>
        <p>Priya</p>
        </div>""",
        """Joel, the matte black handles match the window frames much better. I would use those and skip the wait.

Priya""",
        ["INBOX", "UNREAD"],
        now - 1 * HOUR,
    ),
]
for name, email, recipients, html, text, labels, date in long_messages:
    add(
        "acct-joel",
        long_tid,
        long_subject,
        name,
        email,
        recipients,
        html,
        text,
        date=date,
        labels=labels + ["Label_work", "Label_design"],
        unread="UNREAD" in labels,
    )
finish(long_tid)

print(f"Demo database at {DATA / 'courier.db'}")
print("Threads:", len(store.all_thread_summaries()))
print("Labels:", ", ".join(item["name"] for item in store.label_summary()))
store.close()
