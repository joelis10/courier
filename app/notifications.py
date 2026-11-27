"""Desktop notifications for new mail.

The GUI owns this monitor. It uses libnotify for the notification and plays a short
sound through the system's audio player. AI notification summaries are optional and
always fall back to a normal preview notification on failure or timeout.
"""

from __future__ import annotations

import html as html_module
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from .ai import clean_email_body, notification_messages

NOTIFICATION_TIMEOUT = 8
SOUND_ROOT = Path("/usr/share/sounds/freedesktop/stereo")
SOFT_KNOCK = Path(__file__).resolve().parent / "sounds" / "soft-knock.wav"

SOUND_FILES = {
    "soft-knock": SOFT_KNOCK,
    "bell": SOUND_ROOT / "bell.oga",
    "message": SOUND_ROOT / "message.oga",
    "complete": SOUND_ROOT / "complete.oga",
    "attention": SOUND_ROOT / "window-attention.oga",
}


class NotificationMonitor:
    def __init__(self, app, icon_path: Path, on_open=None, on_update=None):
        self.app = app
        self.icon_path = Path(icon_path)
        self.on_open = on_open
        self.on_update = on_update
        self.GLib = None
        self.seen: dict[str, int] = {}
        self.startup = False
        self.startup_started = 0.0
        self.startup_pending: dict[str, dict[str, Any]] = {}
        self.test_seq = 0
        self.stopped = False
        self.notify = None
        self.active = []
        self.sound_error = ""

    # ------------------------------------------------------------------ lifecycle

    def start(self) -> None:
        try:
            from gi.repository import GLib

            self.GLib = GLib
        except Exception as exc:
            self.app.log(f"notifications unavailable: {exc!r}")
            return
        self._baseline()
        self.startup = True
        self.startup_started = time.monotonic()
        self.startup_pending = {}
        self.test_seq = self._test_seq()
        self.GLib.timeout_add(2000, self._tick)

    def stop(self) -> None:
        self.stopped = True

    # ------------------------------------------------------------------ polling

    @staticmethod
    def _key(thread: dict[str, Any]) -> str:
        return f"{thread.get('account_id') or ''}:{thread.get('id') or ''}"

    def _baseline(self) -> None:
        self.seen = {}
        try:
            threads = self.app.store.list_threads(folder="all", limit=200)
        except Exception:
            return
        for thread in threads:
            self.seen[self._key(thread)] = int(thread.get("last_date") or 0)

    def _test_seq(self) -> int:
        try:
            return int(self.app.store.get_setting("notification_test_seq") or "0")
        except ValueError:
            return 0

    def _tick(self) -> bool:
        if self.stopped or self.GLib is None:
            return False
        try:
            from .server import _load_ui_prefs

            prefs = _load_ui_prefs(self.app.store)
        except Exception:
            return True

        sequence = self._test_seq()
        if sequence != self.test_seq:
            self.test_seq = sequence
            self._send_test(prefs)

        try:
            threads = self.app.store.list_threads(folder="all", limit=40)
        except Exception:
            return True
        if not prefs.get("notifyEnabled", True):
            for thread in threads:
                self.seen[self._key(thread)] = int(
                    thread.get("last_date") or 0
                )
            if self.startup:
                self.startup = False
                self.startup_pending = {}
            return True

        fresh = []
        for thread in threads:
            key = self._key(thread)
            stamp = int(thread.get("last_date") or 0)
            if stamp > self.seen.get(key, -1):
                fresh.append(thread)
        if fresh:
            for thread in fresh:
                self.seen[self._key(thread)] = int(
                    thread.get("last_date") or 0
                )
        if self.startup:
            for thread in fresh:
                self.startup_pending[self._key(thread)] = thread
            if self._startup_finished():
                self._flush_startup(prefs)
            return True
        if not fresh:
            return True
        for thread in sorted(
            fresh, key=lambda item: int(item.get("last_date") or 0)
        ):
            self._dispatch(thread, prefs)
        return True

    def _startup_finished(self) -> bool:
        elapsed = time.monotonic() - self.startup_started
        if elapsed >= 90:
            return True
        try:
            status = self.app.sync.status()
        except Exception:
            return elapsed >= 6
        if status.get("syncing"):
            return False
        if status.get("last_finished"):
            return elapsed >= 3
        return elapsed >= 6

    def _flush_startup(self, prefs: dict[str, Any]) -> None:
        self.startup = False
        pending = list(self.startup_pending.values())
        self.startup_pending = {}
        eligible = [
            thread for thread in pending if self._eligible(thread, prefs)
        ]
        if not eligible:
            return
        if len(eligible) == 1:
            self._dispatch(eligible[0], prefs)
            return
        self._send_notification(
            f"{len(eligible)}+ new notifications",
            "New mail since Courier was last opened.",
            prefs,
            None,
        )

    # ------------------------------------------------------------------ delivery

    def _eligible(
        self, thread: dict[str, Any], prefs: dict[str, Any]
    ) -> dict[str, Any] | None:
        labels = set(thread.get("labels") or [])
        if "INBOX" not in labels and not prefs.get("notifyArchived"):
            return None
        if "DRAFT" in labels and "INBOX" not in labels:
            return None
        if "SPAM" in labels or "TRASH" in labels:
            return None
        if "SENT" in labels and "INBOX" not in labels:
            return None
        if not thread.get("unread"):
            return None
        account = self.app.store.get_account(thread.get("account_id") or "")
        if not account:
            return None
        sender = (
            thread.get("last_from_email")
            or thread.get("sender_email")
            or ""
        ).lower()
        if sender and sender == (account["email"] or "").lower():
            return None
        return account

    def _dispatch(self, thread: dict[str, Any], prefs: dict[str, Any]) -> None:
        if not self._eligible(thread, prefs):
            return
        if prefs.get("aiEnabled") and prefs.get("notifyUseAI") and self.app.ai.configured():
            worker = threading.Thread(
                target=self._ai_worker,
                args=(thread, prefs),
                daemon=True,
                name="courier-notify-ai",
            )
            worker.start()
            return
        self._notify(thread, prefs, None)

    def _ai_worker(self, thread: dict[str, Any], prefs: dict[str, Any]) -> None:
        summary = ""
        try:
            entry = self.app.sync.cached_thread(
                thread.get("account_id") or "", thread.get("id") or ""
            )
            if entry is None:
                entry = self.app.sync.full_thread(
                    thread.get("account_id") or "", thread.get("id") or ""
                )
            messages = entry.get("messages") or []
            body = "\n\n".join(
                clean_email_body(message).strip()
                for message in messages[-2:]
            ).strip()
            if len(body) < int(prefs.get("notifyAIMinChars") or 400):
                raise ValueError("Message is below the AI notification threshold.")
            sender = thread.get("sender_name") or thread.get("sender_email") or "Unknown sender"
            subject = thread.get("subject") or "(No subject)"
            summary = self.app.ai.notification_summary(
                notification_messages(sender, subject, body),
                timeout=NOTIFICATION_TIMEOUT,
            )
        except Exception:
            summary = ""
        self._on_main(lambda: self._finish_ai(thread, prefs, summary))

    def _finish_ai(
        self, thread: dict[str, Any], prefs: dict[str, Any], summary: str
    ) -> bool:
        if not self.stopped:
            self._notify(thread, prefs, summary or None)
        return False

    def _on_main(self, callback) -> None:
        if self.GLib is not None:
            self.GLib.idle_add(callback)

    def _render(
        self,
        thread: dict[str, Any],
        prefs: dict[str, Any],
        ai_summary: str | None,
    ) -> tuple[str, str]:
        account = self.app.store.get_account(thread.get("account_id") or "")
        badge = ""
        if account and prefs.get("notifyShowAccount", True):
            name = account["username"] or (account["email"] or "").split("@")[0]
            badge = f"[{name}]"
        sender = thread.get("sender_name") or thread.get("sender_email") or "New mail"
        subject = thread.get("subject") or "(No subject)"
        preview = (
            ai_summary
            if ai_summary
            else html_module.unescape(thread.get("snippet") or "").strip()
        )
        position = prefs.get("notifyBadgePosition") or "before-subject"
        title = sender
        body = subject
        if badge and position == "before-sender":
            title = f"{badge} {sender}"
        elif badge and position == "after-sender":
            title = f"{sender} {badge}"
        elif badge and position == "before-subject":
            body = f"{badge} {subject}"
        elif badge and position == "after-subject":
            body = f"{subject} {badge}"
        if preview:
            body = f"{body}\n{preview[:240]}"
        return title, body

    def _notify(
        self,
        thread: dict[str, Any],
        prefs: dict[str, Any],
        ai_summary: str | None,
    ) -> None:
        title, body = self._render(thread, prefs, ai_summary)
        account_id = thread.get("account_id") or ""
        thread_id = thread.get("id") or ""
        target = (account_id, thread_id) if account_id and thread_id else None
        self._send_notification(title, body, prefs, target)

    def notify_update(self, version: str) -> bool:
        if not version or self.GLib is None:
            return False
        try:
            from .server import _load_ui_prefs

            prefs = _load_ui_prefs(self.app.store)
        except Exception:
            prefs = {}
        title = f"Courier {version} is available"
        body = f"Open Settings → Updates to download and install Courier {version}."

        def send() -> bool:
            self._send_notification(title, body, prefs, ("__update__", version))
            return False

        self.GLib.idle_add(send)
        return True

    def _send_notification(
        self,
        title: str,
        body: str,
        prefs: dict[str, Any],
        target: tuple[str, str] | None = None,
    ) -> bool:
        sent = False
        try:
            if self.notify is None:
                import gi

                gi.require_version("Notify", "0.7")
                from gi.repository import Notify

                Notify.init("Courier")
                self.notify = Notify
            icon = str(self.icon_path) if self.icon_path.exists() else "mail-unread"
            notification = self.notify.Notification.new(title, body, icon)
            notification.set_app_name("Courier")
            if (prefs.get("notifySound") or "soft-knock") != "system":
                try:
                    from gi.repository import GLib

                    notification.set_hint(
                        "suppress-sound", GLib.Variant("b", True)
                    )
                except Exception:
                    pass
            if target and (self.on_open or self.on_update):
                notification.add_action(
                    "default",
                    "Open",
                    self._on_default_action,
                    target,
                )
                # libnotify delivers ActionInvoked through the notification
                # object's own D-Bus proxy. Keep it alive until it closes, or a
                # click has nothing to call back into.
                self.active.append(notification)
                notification.connect("closed", self._drop_notification)
            notification.show()
            sent = True
        except Exception as exc:
            self.app.log(f"notification failed: {exc!r}")
        self._play_sound(prefs)
        return sent

    def _drop_notification(self, notification) -> None:
        self.active = [
            entry for entry in self.active if entry is not notification
        ]

    def _on_default_action(self, _notification, _action, target) -> None:
        try:
            target_name, target_value = target
        except (TypeError, ValueError):
            return
        if target_name == "__update__":
            if not self.on_update:
                return

            def invoke_update() -> bool:
                try:
                    self.on_update(target_value)
                except Exception as exc:
                    self.app.log(f"update notification open failed: {exc!r}")
                return False

            self._on_main(invoke_update)
            return
        if not self.on_open:
            return

        def invoke() -> bool:
            try:
                self.on_open(target_name, target_value)
            except Exception as exc:
                self.app.log(f"notification open failed: {exc!r}")
            return False

        self._on_main(invoke)

    # ------------------------------------------------------------------ sound

    def _play_sound(self, prefs: dict[str, Any]) -> None:
        sound = prefs.get("notifySound") or "soft-knock"
        if sound == "none":
            return
        if sound == "system":
            # The notification daemon plays its own sound; suppress-sound is
            # deliberately not set for this option.
            return
        if sound == "custom":
            configured = str(prefs.get("notifySoundPath") or "").strip()
            if not configured:
                self._sound_failure("The custom notification sound has no file.")
                return
            path = Path(configured)
        else:
            path = SOUND_FILES.get(sound, SOFT_KNOCK)
        if not path.exists():
            self._sound_failure(f"Notification sound is missing: {path}")
            return
        try:
            volume = min(100, max(0, int(prefs.get("notifyVolume", 60))))
        except (TypeError, ValueError):
            volume = 60
        if volume <= 0:
            return
        commands = []
        # PulseAudio/PipeWire stream restore can override paplay/pw-play
        # initial volumes back to 100%. ffplay applies the gain in software.
        if shutil.which("ffplay"):
            commands.append(
                [
                    "ffplay",
                    "-nodisp",
                    "-autoexit",
                    "-loglevel",
                    "error",
                    "-volume",
                    str(volume),
                    str(path),
                ]
            )
        if shutil.which("paplay"):
            commands.append(
                [
                    "paplay",
                    "--client-name=Courier",
                    "--stream-name=Courier notification",
                    f"--volume={round(volume / 100 * 65536)}",
                    str(path),
                ]
            )
        if shutil.which("pw-play"):
            commands.append(
                ["pw-play", "--volume", f"{volume / 100:.2f}", str(path)]
            )
        if path.suffix.lower() == ".wav" and shutil.which("aplay"):
            commands.append(["aplay", "-q", str(path)])
        if not commands:
            self._sound_failure(
                "No audio player was found for the notification sound."
            )
            return
        threading.Thread(
            target=self._play_sound_worker,
            args=(path, commands),
            daemon=True,
            name="courier-sound",
        ).start()

    def _sound_failure(self, message: str) -> None:
        if self.sound_error == message:
            return
        self.sound_error = message
        self.app.log(message)

    def _play_sound_worker(self, path: Path, commands: list[list[str]]) -> None:
        for command in commands:
            try:
                result = subprocess.run(
                    command,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=30,
                    check=False,
                )
            except Exception as exc:
                self._sound_failure(
                    f"Notification sound {command[0]} failed: {exc!r}"
                )
                continue
            if result.returncode == 0:
                if self.sound_error:
                    self.app.log(
                        f"Notification sound recovered using {command[0]}."
                    )
                self.sound_error = ""
                return
            detail = " ".join((result.stderr or "").splitlines()[-2:]).strip()
            self._sound_failure(
                f"Notification sound {command[0]} exited "
                f"{result.returncode}{f': {detail}' if detail else ''}."
            )
        self._sound_failure(f"Could not play notification sound {path}.")

    # ------------------------------------------------------------------ test

    def _send_test(self, prefs: dict[str, Any]) -> None:
        try:
            accounts = self.app.store.accounts()
        except Exception:
            accounts = []
        account_id = accounts[0]["id"] if accounts else ""
        thread = {
            "account_id": account_id,
            "sender_name": "James Okafor",
            "sender_email": "james@example.com",
            "subject": "Missing URLs for the launch page",
            "snippet": (
                "James lists the missing URLs for tomorrow's launch page and needs "
                "them updated immediately. The new pricing page and the two press "
                "screenshots are still pointing at the old domain."
            ),
        }
        if prefs.get("aiEnabled") and prefs.get("notifyUseAI") and self.app.ai.configured():
            worker = threading.Thread(
                target=self._ai_test_worker,
                args=(thread, prefs),
                daemon=True,
                name="courier-notify-test-ai",
            )
            worker.start()
            return
        self._notify(thread, prefs, None)

    def _ai_test_worker(self, thread: dict[str, Any], prefs: dict[str, Any]) -> None:
        summary = ""
        try:
            summary = self.app.ai.notification_summary(
                notification_messages(
                    thread["sender_name"],
                    thread["subject"],
                    thread["snippet"],
                ),
                timeout=NOTIFICATION_TIMEOUT,
            )
        except Exception:
            summary = ""
        self._on_main(lambda: self._finish_ai(thread, prefs, summary))
