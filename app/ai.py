"""OpenAI-compatible chat completions used for on-demand summaries.

The API key is read on the server and never sent to the browser. Requests stream back to
the UI as server-sent events.
"""

from __future__ import annotations

import html as html_module
import json
import re
import urllib.error
import urllib.request
from html.parser import HTMLParser
from typing import Any, Iterable

from . import APP_VERSION
from .store import Store

SYSTEM_PROMPT = (
    "You summarize email for the owner of this mailbox, who needs the useful content quickly. "
    "The reader is the mailbox owner. Messages they sent are labelled You. Refer to them as "
    "'you' or 'your', never by their own name. Use other people's names when they are relevant. "
    "Use short bullet points rather than paragraphs, one per event or point, and keep the "
    "events in the order they happened. Do not reorder events or infer a sequence that is "
    "not in the messages. "
    "Do not add a title, greeting, closing, or headings. Do not repeat the subject line. "
    "Do not mention that this is an email or that you are summarizing. "
    "Use only facts present in the message. "
    "If there is a request, decision, or deadline, state it plainly. "
    "Do not end with a sentence saying that no action is needed, that nothing is required "
    "from the reader, or that they do not need to do anything. If nothing is required, "
    "simply stop after the factual summary. "
    "If the email is mostly marketing or automated noise, say what it is in one sentence."
)

NOTIFICATION_PROMPT = (
    "Write one short notification sentence for the mailbox owner. Start with the sender's "
    "name and state the action or main point in as few words as possible. Use at most 140 "
    "characters. No greeting, no quotation marks, no markdown, no mention of email. "
    "Examples: \"John needs his password reset.\" "
    "\"James lists missing URLs; needs these updated immediately.\" "
    "If nothing is needed, state the main fact."
)

MAX_BODY_CHARS = 14000
MAX_TOTAL_CHARS = 26000


class AIError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


class AIClient:
    def __init__(self, store: Store):
        self.store = store

    def config(self) -> dict[str, str]:
        return {
            "base_url": (self.store.get_setting("ai_base_url") or "").strip(),
            "api_key": self.store.get_setting("ai_api_key") or "",
            "model": (self.store.get_setting("ai_model") or "").strip(),
        }

    def configured(self) -> bool:
        config = self.config()
        return bool(config["base_url"] and config["model"])

    def _endpoint(self) -> str:
        base = self.config()["base_url"].rstrip("/")
        if not base:
            raise AIError("Set an API base URL first.")
        if not (base.startswith("http://") or base.startswith("https://")):
            raise AIError("API base URL must start with http:// or https://.")
        if base.endswith("/chat/completions"):
            return base
        return base + "/chat/completions"

    def _headers(self) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "text/event-stream, application/json",
            "User-Agent": f"Courier/{APP_VERSION}",
        }
        key = self.config()["api_key"]
        if key:
            headers["Authorization"] = f"Bearer {key}"
        return headers

    def _open(self, payload: dict[str, Any], timeout: int = 120):
        request = urllib.request.Request(
            self._endpoint(),
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers=self._headers(),
        )
        try:
            return urllib.request.urlopen(request, timeout=timeout)
        except urllib.error.HTTPError as exc:
            message = f"Provider returned {exc.code}."
            try:
                detail = json.loads(exc.read().decode("utf-8"))
                error = detail.get("error")
                if isinstance(error, dict):
                    message = error.get("message") or message
                elif isinstance(error, str):
                    message = error
                elif detail.get("message"):
                    message = str(detail["message"])
            except Exception:
                pass
            raise AIError(message, status=502) from exc
        except urllib.error.URLError as exc:
            raise AIError(f"Could not reach provider: {exc.reason}", status=502) from exc
        except Exception as exc:
            raise AIError(f"Could not reach provider: {exc}", status=502) from exc

    def stream(self, messages: list[dict[str, str]]) -> Iterable[str]:
        if not self.configured():
            raise AIError("AI summaries are not configured.")
        payload = {
            "model": self.config()["model"],
            "messages": messages,
            "stream": True,
            "temperature": 0.2,
        }
        response = self._open(payload)
        content_type = (response.headers.get("Content-Type") or "").lower()
        try:
            if "application/json" in content_type:
                data = json.loads(response.read().decode("utf-8"))
                text = _strip_thinking(_extract_message(data))
                if text:
                    yield text
                return
            for raw_line in response:
                line = raw_line.decode("utf-8", "replace").strip()
                if not line or line.startswith(":"):
                    continue
                if line.startswith("data:"):
                    data_text = line[5:].strip()
                else:
                    data_text = line
                if data_text == "[DONE]":
                    break
                try:
                    data = json.loads(data_text)
                except ValueError:
                    continue
                delta = _extract_delta(data)
                if delta:
                    yield delta
        finally:
            response.close()

    def notification_summary(
        self, messages: list[dict[str, str]], timeout: int = 8
    ) -> str:
        if not self.configured():
            raise AIError("AI summaries are not configured.")
        payload = {
            "model": self.config()["model"],
            "messages": messages,
            "stream": False,
            "temperature": 0.2,
            "max_tokens": 90,
        }
        response = self._open(payload, timeout=timeout)
        try:
            data = json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            raise AIError("Provider returned an unreadable response.", status=502) from exc
        finally:
            response.close()
        text = _strip_thinking(_extract_message(data)).strip()
        text = text.strip("\"' \n\r\t")
        text = text.splitlines()[0].strip() if text else ""
        if not text:
            raise AIError("Provider returned an empty notification.", status=502)
        return text[:180]

    def test(self) -> str:
        if not self.configured():
            raise AIError("Set a base URL and model first.")
        payload = {
            "model": self.config()["model"],
            "messages": [{"role": "user", "content": "Reply with OK."}],
            "stream": False,
            "temperature": 0,
            "max_tokens": 8,
        }
        response = self._open(payload, timeout=45)
        try:
            data = json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            raise AIError("Provider returned an unreadable response.", status=502) from exc
        finally:
            response.close()
        text = _extract_message(data).strip()
        if not text:
            raise AIError("Provider returned an empty response.", status=502)
        return text[:40]


def _extract_delta(data: dict[str, Any]) -> str:
    choices = data.get("choices") or []
    if not choices:
        return ""
    choice = choices[0] or {}
    delta = choice.get("delta") or {}
    text = delta.get("content")
    if isinstance(text, str):
        return text
    # Some local servers stream full messages instead of deltas.
    message = choice.get("message") or {}
    if isinstance(message.get("content"), str):
        return message["content"]
    return ""


def _extract_message(data: dict[str, Any]) -> str:
    choices = data.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, list):
        return "".join(
            item.get("text", "") for item in content if isinstance(item, dict)
        )
    return content if isinstance(content, str) else ""


_THINKING_NAME = r"(?:think|thinking|reasoning|thought|analysis)"


def _strip_thinking(text: str) -> str:
    value = str(text or "")
    paired = re.compile(
        rf"<{_THINKING_NAME}\b[^>]*>.*?</{_THINKING_NAME}\s*>",
        re.I | re.S,
    )
    while True:
        cleaned = paired.sub("", value)
        if cleaned == value:
            break
        value = cleaned
    closing = re.compile(rf"</{_THINKING_NAME}\s*>", re.I)
    while True:
        match = closing.search(value)
        if not match:
            break
        tail = value[match.end() :]
        if tail.strip():
            value = tail
        else:
            value = value[: match.start()]
    unclosed = re.compile(
        rf"<{_THINKING_NAME}\b[^>]*>.*$", re.I | re.S
    )
    value = unclosed.sub("", value)
    value = re.sub(
        rf"</?{_THINKING_NAME}\b[^>]*>", "", value, flags=re.I
    )
    return value.strip()


def _has_text(value: str) -> bool:
    return bool(value and value.strip())


def _has_meaningful_text(value: str) -> bool:
    return len(re.sub(r"\s+", "", value or "")) >= 10


CLOSER_PATTERNS = (
    r"^(best|kind|warm|warmest|many|with)\s+(regards|wishes)[,.!]?$",
    r"^(regards|thanks|thank you|sincerely|cheers|best|take care|all the best|respectfully|yours|yours truly)[,.!]?$",
    r"^(many thanks|thanks so much|thanks a lot|thanks again|much appreciated|appreciate it)[,.!]?$",
    r"^sent from my (iphone|ipad|android|phone|mobile)[.!]?$",
    r"^get outlook for (ios|android)[.!]?$",
)


def _strip_quoted(text: str) -> str:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    cut = len(lines)
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        lowered = stripped.lower()
        marker = False
        if lowered.startswith("-----original message"):
            marker = True
        elif stripped.startswith("_" * 20):
            marker = True
        elif re.match(r"^-{2,}\s*original message\s*-{2,}$", stripped, re.I):
            marker = True
        elif re.match(r"^on\s.+\bwrote:\s*$", stripped, re.I):
            marker = True
        elif re.match(r"^from:\s+\S", stripped, re.I):
            nearby = [item.strip().lower() for item in lines[index + 1 : index + 7]]
            marker = any(
                item.startswith(("sent:", "date:")) for item in nearby
            ) and any(
                item.startswith(("to:", "subject:")) for item in nearby
            )
        elif stripped.startswith(">"):
            marker = True
        if marker:
            prefix = "\n".join(lines[:index])
            if _has_text(prefix):
                cut = index
                break
    return "\n".join(lines[:cut])


def _strip_signature(text: str) -> str:
    lines = text.split("\n")
    cut = len(lines)
    for index, line in enumerate(lines):
        if re.match(r"^--\s*$", line.strip()):
            if _has_text("\n".join(lines[:index])):
                cut = index
                break
    if cut == len(lines):
        for index, line in enumerate(lines):
            if re.match(
                r"^(sent from my (iphone|ipad|android|phone|mobile)|"
                r"get outlook for (ios|android))[.!]?$",
                line.strip(),
                re.I,
            ):
                if _has_text("\n".join(lines[:index])):
                    cut = index
                    break
    if cut == len(lines):
        nonempty = [
            (index, line)
            for index, line in enumerate(lines)
            if line.strip()
        ]
        for position, (index, line) in enumerate(nonempty):
            if not any(
                re.match(pattern, line.strip(), re.I)
                for pattern in CLOSER_PATTERNS
            ):
                continue
            prefix = "\n".join(lines[:index])
            tail = "\n".join(lines[index:])
            if (
                _has_meaningful_text(prefix)
                and len(nonempty) - position <= 8
                and len(tail) <= 800
            ):
                cut = index
                break
    lines = lines[:cut]

    prefix_text = "\n".join(lines)
    if _has_meaningful_text(prefix_text) and len(prefix_text) >= 200:
        start = None
        for index in range(
            len(lines) - 1, max(len(lines) - 11, -1), -1
        ):
            if not lines[index].strip():
                start = index + 1
                break
        if start is not None and 0 < len(lines) - start <= 8:
            tail = "\n".join(lines[start:])
            prefix = "\n".join(lines[:start])
            if len(prefix) >= 200:
                score = 0
                if re.search(
                    r"\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b", tail, re.I
                ):
                    score += 2
                if re.search(r"https?://", tail, re.I):
                    score += 1
                if re.search(r"\+?\d[\d\s().-]{6,}\d", tail):
                    score += 1
                if re.search(
                    r"\b(inc|llc|ltd|gmbh|corp|co\.)\b", tail, re.I
                ):
                    score += 1
                if re.search(
                    r"\b(street|st\.?|avenue|ave\.?|road|rd\.?|suite|"
                    r"floor|building|postal|zip|city|country)\b",
                    tail,
                    re.I,
                ):
                    score += 1
                if score >= 3:
                    lines = lines[:start]
    return "\n".join(lines).strip()


def _clean_body(text: str) -> str:
    text = _strip_quoted(text or "")
    text = _strip_signature(text)
    text = "\n".join(line.rstrip() for line in text.splitlines())
    text = "\n".join(line for line in text.splitlines() if line.strip())
    return text[:MAX_BODY_CHARS]


def _message_content(message: dict[str, Any]) -> str:
    body_html = str(message.get("body_html") or "").strip()
    if body_html:
        text = _html_to_text(body_html)
        if text:
            return text
        raw = _html_to_text_raw(body_html)
        if raw:
            return raw
    return str(message.get("body_text") or "").strip()


def clean_email_body(message: dict[str, Any]) -> str:
    content = _message_content(message)
    cleaned = _clean_body(content)
    if not cleaned.strip() and content.strip():
        # Forwarded or quote-only mail has no separate main block. Keep the
        # original rather than sending an empty summary body.
        return content[:MAX_BODY_CHARS]
    return cleaned


def _sender_label(
    name: str | None, email: str | None, owner_email: str | None
) -> str:
    address = (email or "").strip()
    display = (name or address or "Unknown sender").strip()
    if owner_email and address.lower() == owner_email.lower():
        return "You"
    return f"{display} <{address}>" if address else display


def message_messages(
    message: dict[str, Any],
    thread_subject: str = "",
    owner_email: str | None = None,
) -> list[dict[str, str]]:
    sender = _sender_label(
        message.get("from_name"), message.get("from_email"), owner_email
    )
    body = clean_email_body(message)
    subject = message.get("subject") or thread_subject or "(No subject)"
    content = f"Subject: {subject}\nFrom: {sender}\n\n{body}"[:MAX_TOTAL_CHARS]
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": "Summarize this email in short bullet points.\n\n" + content,
        },
    ]


def notification_messages(
    sender: str,
    subject: str,
    body: str,
) -> list[dict[str, str]]:
    content = (
        f"From: {sender or 'Unknown sender'}\n"
        f"Subject: {subject or '(No subject)'}\n\n"
        f"{body}"
    )[:MAX_TOTAL_CHARS]
    return [
        {"role": "system", "content": NOTIFICATION_PROMPT},
        {"role": "user", "content": content},
    ]


def thread_messages(
    thread: dict[str, Any],
    messages: list[dict[str, Any]],
    owner_email: str | None = None,
) -> list[dict[str, str]]:
    subject = thread.get("subject") or "(No subject)"
    pieces: list[str] = [f"Subject: {subject}"]
    if owner_email:
        pieces.append(f"Reader: You <{owner_email}>")
    remaining = MAX_TOTAL_CHARS
    for message in messages[-8:]:
        sender = _sender_label(
            message.get("from_name"), message.get("from_email"), owner_email
        )
        body = clean_email_body(message)
        header = f"\n---\nFrom: {sender}\n"
        chunk = header + body
        if len(chunk) > remaining:
            chunk = chunk[:remaining]
        pieces.append(chunk)
        remaining -= len(chunk)
        if remaining <= 500:
            break
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": "Summarize this email thread in short bullet points. Keep the "
            "events in the order they happened. If the reader needs to do something, "
            "state it; otherwise omit any action note.\n"
            + "".join(pieces),
        },
    ]


BLOCK_TAGS = {
    "p",
    "div",
    "br",
    "li",
    "tr",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "section",
    "article",
    "table",
    "td",
    "th",
    "ul",
    "ol",
}
VOID_TAGS = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
}
DROP_HINTS = re.compile(
    r"(gmail_quote|gmail_extra|gmail_signature|moz-cite-prefix|moz-signature|"
    r"protonmail_quote|protonmail_signature|yahoo_quoted|yahoo_signature|"
    r"zmail_quote|outlookmessageheader|divrplyfwdmsg|appendonsend|"
    r"mail-editor-reference-message-container)",
    re.I,
)


class _EmailTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs) -> None:
        tag = tag.lower()
        if self.skip:
            if tag not in VOID_TAGS:
                self.skip += 1
            return
        if tag in ("script", "style"):
            self.skip = 1
            return
        attributes = {
            str(key).lower(): str(value or "") for key, value in attrs
        }
        identifier = (
            f"{attributes.get('class', '')} {attributes.get('id', '')}"
        ).lower()
        if DROP_HINTS.search(identifier):
            self.skip = 1
            return
        if tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_startendtag(self, tag, attrs) -> None:
        if not self.skip and tag.lower() == "br":
            self.parts.append("\n")

    def handle_endtag(self, tag) -> None:
        tag = tag.lower()
        if self.skip:
            if tag not in VOID_TAGS:
                self.skip -= 1
            return
        if tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data) -> None:
        if not self.skip:
            self.parts.append(data)

    def text(self) -> str:
        value = "".join(self.parts)
        value = re.sub(r"[ \t]+", " ", value)
        value = re.sub(r"\n[ \t]+", "\n", value)
        value = re.sub(r"\n{3,}", "\n\n", value)
        return value.strip()


def _html_to_text_raw(html: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", html)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</(p|div|li|tr|h[1-6])>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html_module.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _html_to_text(html: str) -> str:
    if not html:
        return ""
    parser = _EmailTextParser()
    try:
        parser.feed(html)
        parser.close()
        return parser.text()
    except Exception:
        return _html_to_text_raw(html)
