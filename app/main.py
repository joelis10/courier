#!/usr/bin/env python3
"""Courier entry point: local server plus a native WebKitGTK window."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import shutil
import signal
import socket
import sys
import threading
import urllib.parse
import urllib.request
import warnings
import webbrowser
from pathlib import Path
from typing import Any

from .notifications import NotificationMonitor
from .server import App, _load_ui_prefs


def instance_socket_path(data_dir: Path) -> Path:
    runtime = os.environ.get("XDG_RUNTIME_DIR")
    base = Path(runtime) if runtime else Path.home() / ".cache"
    digest = hashlib.sha1(str(data_dir.resolve()).encode("utf-8")).hexdigest()[:12]
    return base / f"courier-{os.getuid()}-{digest}.sock"


def notify_existing(data_dir: Path) -> bool:
    path = instance_socket_path(data_dir)
    if not path.exists():
        return False
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(1.5)
            client.connect(str(path))
            client.sendall(b"show\n")
            return True
    except OSError:
        try:
            path.unlink()
        except OSError:
            pass
        return False


class SingleInstance:
    def __init__(self, path: Path, callback):
        self.path = path
        self.callback = callback
        self.server = None
        self.thread = None
        self.stop_event = threading.Event()

    def start(self) -> bool:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            try:
                self.path.unlink()
            except FileNotFoundError:
                pass
            self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self.server.bind(str(self.path))
            self.path.chmod(0o600)
            self.server.listen(4)
            self.server.settimeout(0.5)
        except OSError:
            self.close()
            return False
        self.thread = threading.Thread(
            target=self._serve, daemon=True, name="courier-instance"
        )
        self.thread.start()
        return True

    def _serve(self) -> None:
        while not self.stop_event.is_set():
            try:
                connection, _address = self.server.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            try:
                with connection:
                    data = connection.recv(64)
                if data.strip().startswith(b"show"):
                    self.callback()
            except OSError:
                continue

    def close(self) -> None:
        self.stop_event.set()
        if self.server:
            try:
                self.server.close()
            except OSError:
                pass
            self.server = None
        try:
            self.path.unlink()
        except OSError:
            pass


def default_data_dir() -> Path:
    override = os.environ.get("COURIER_DATA_DIR")
    if override:
        return Path(override).expanduser()
    base = os.environ.get("XDG_DATA_HOME")
    if base:
        return Path(base) / "courier"
    return Path.home() / ".local" / "share" / "courier"


def run_headless(app: App) -> int:
    port = app.start()
    url = f"http://127.0.0.1:{port}/?t={app.page_token}"
    print(url, flush=True)
    try:
        signal.pause()
    except KeyboardInterrupt:
        pass
    finally:
        app.stop()
    return 0


def autostart_path() -> Path:
    config = os.environ.get("XDG_CONFIG_HOME")
    base = Path(config) if config else Path.home() / ".config"
    return base / "autostart" / "courier.desktop"


def sync_autostart(mode: str) -> None:
    if os.environ.get("COURIER_DEMO") == "1" or os.environ.get("COURIER_DATA_DIR"):
        return
    path = autostart_path()
    if mode not in ("minimized", "foreground"):
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            pass
        return
    root = Path(__file__).resolve().parent.parent
    executable = sys.executable
    flag = " --minimized" if mode == "minimized" else ""
    content = f"""[Desktop Entry]
Type=Application
Version=1.0
Name=Courier
Comment=Local Gmail client
Exec="{executable}" -m app.main{flag}
Path={root}
Icon={root / 'app' / 'web' / 'icon.svg'}
Terminal=false
Categories=Network;Email;
StartupWMClass=Courier
X-GNOME-Autostart-enabled=true
"""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists() or path.read_text(encoding="utf-8") != content:
            path.write_text(content, encoding="utf-8")
            path.chmod(0o644)
    except OSError:
        pass


def run_gui(app: App, minimized: bool = False) -> int:
    warnings.filterwarnings(
        "ignore", category=DeprecationWarning, message=".*Gtk\\.StatusIcon.*"
    )
    try:
        import gi

        gi.require_version("Gtk", "3.0")
        gi.require_version("Gdk", "3.0")
        gi.require_version("WebKit2", "4.1")
        from gi.repository import Gtk, Gdk, GLib, WebKit2, Gio
    except Exception as exc:  # pragma: no cover - environment failure
        print(
            "Courier needs GTK 3 and WebKitGTK 4.1 introspection files.\n"
            "On Debian or LMDE: sudo apt install python3-gi gir1.2-webkit2-4.1 libwebkit2gtk-4.1-0\n"
            f"Details: {exc}",
            file=sys.stderr,
        )
        return 1

    port = app.start()
    url = f"http://127.0.0.1:{port}/?t={app.page_token}"
    dev = os.environ.get("COURIER_DEV") == "1"

    GLib.set_prgname("courier")
    GLib.set_application_name("Courier")
    try:
        Gdk.set_program_class("Courier")
    except Exception:
        pass

    window = Gtk.Window()
    window.set_title("Courier")
    window.set_default_size(1380, 880)
    window.set_size_request(920, 600)
    window.set_role("courier")
    icon = Path(__file__).resolve().parent / "web" / "icon.svg"
    if icon.exists():
        try:
            window.set_icon_from_file(str(icon))
        except Exception:
            pass

    webview = WebKit2.WebView()
    try:
        settings = webview.get_settings()
        settings.set_enable_developer_extras(dev)
        settings.set_javascript_can_open_windows_automatically(True)
        settings.set_enable_html5_local_storage(True)
        settings.set_enable_media_stream(False)
        settings.set_enable_mediasource(False)
        try:
            settings.set_javascript_can_access_clipboard(True)
        except Exception:
            pass
        try:
            settings.set_enable_webgl(False)
            settings.set_enable_webaudio(False)
            settings.set_enable_page_cache(False)
            settings.set_cache_model(WebKit2.CacheModel.DOCUMENT_VIEWER)
            if os.environ.get("COURIER_GPU") != "1":
                settings.set_hardware_acceleration_policy(
                    WebKit2.HardwareAccelerationPolicy.NEVER
                )
        except Exception:
            pass
        if dev:
            settings.set_enable_write_console_messages_to_stdout(True)
    except Exception:
        pass

    try:
        webview.set_background_color(Gdk.RGBA(0.91, 0.92, 0.93, 1.0))
    except Exception:
        pass

    def open_external(uri: str) -> None:
        if not uri:
            return
        if uri.startswith(app.base_url):
            return
        if uri.startswith(("http://", "https://", "mailto:")):
            try:
                Gtk.show_uri_on_window(window, uri, Gdk.CURRENT_TIME)
                return
            except Exception:
                pass
            webbrowser.open(uri)

    def show_shell_error(message: str) -> None:
        dialog = Gtk.MessageDialog(
            transient_for=window,
            flags=Gtk.DialogFlags.MODAL,
            message_type=Gtk.MessageType.ERROR,
            buttons=Gtk.ButtonsType.CLOSE,
            text=message,
        )
        dialog.run()
        dialog.destroy()

    def launch_attachment(path: Path, filename: str) -> None:
        try:
            uri = Gio.File.new_for_path(str(path)).get_uri()
            if Gio.AppInfo.launch_default_for_uri(uri, None):
                return
        except Exception:
            pass
        try:
            dialog = Gtk.AppChooserDialog.new(
                window,
                Gtk.DialogFlags.MODAL,
                Gio.File.new_for_path(str(path)),
            )
            dialog.set_title(f"Open {filename}")
            response = dialog.run()
            if response in (Gtk.ResponseType.OK, Gtk.ResponseType.ACCEPT):
                app_info = dialog.get_app_info()
                if app_info:
                    try:
                        app_info.launch(
                            [Gio.File.new_for_path(str(path))], None
                        )
                    except Exception as exc:
                        show_shell_error(
                            f"Could not open the attachment.\n{exc}"
                        )
            dialog.destroy()
        except Exception as exc:
            show_shell_error(f"Could not open the attachment.\n{exc}")

    def resolve_attachment(
        url: str, filename: str = ""
    ) -> tuple[str | None, str | None]:
        try:
            parsed = urllib.parse.urlparse(url)
            base = urllib.parse.urlparse(app.base_url)
            if not parsed.scheme and not parsed.netloc:
                url = f"{app.base_url.rstrip('/')}/{url.lstrip('/')}"
                parsed = urllib.parse.urlparse(url)
            if (
                parsed.scheme != "http"
                or parsed.netloc != base.netloc
                or parsed.path != "/api/attachment"
            ):
                return None, None
            token = (urllib.parse.parse_qs(parsed.query).get("t") or [""])[0]
            if not secrets.compare_digest(token, app.page_token):
                return None, None
            safe = Path(filename or "attachment").name
            safe = re.sub(r"[\x00-\x1f\x7f/\\]+", "_", safe)
            safe = safe.strip()[:180]
            if not safe or safe in (".", ".."):
                safe = "attachment"
            return url, safe
        except Exception:
            return None, None

    def open_attachment(url: str, filename: str = "") -> bool:
        url, safe = resolve_attachment(url, filename)
        if not url or not safe:
            return False

        def worker() -> None:
            target = None
            try:
                folder = app.data_dir / "attachments"
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
                with urllib.request.urlopen(url, timeout=90) as response:
                    with open(target, "wb") as handle:
                        shutil.copyfileobj(response, handle)
                try:
                    target.chmod(0o600)
                except OSError:
                    pass
            except Exception as exc:
                app.log(f"attachment open failed: {exc!r}")

                def report() -> bool:
                    show_shell_error("Could not download the attachment.")
                    return False

                GLib.idle_add(report)
                return

            def launch() -> bool:
                launch_attachment(target, safe)
                return False

            GLib.idle_add(launch)

        threading.Thread(
            target=worker, daemon=True, name="courier-attachment"
        ).start()
        return True

    def download_attachment(url: str, filename: str = "") -> bool:
        url, safe = resolve_attachment(url, filename)
        if not url or not safe:
            return False

        def worker() -> None:
            try:
                with urllib.request.urlopen(url, timeout=90) as response:
                    data = response.read()
            except Exception as exc:
                app.log(f"attachment download failed: {exc!r}")

                def report() -> bool:
                    show_shell_error("Could not download the attachment.")
                    return False

                GLib.idle_add(report)
                return

            def save() -> bool:
                dialog = None
                try:
                    dialog = Gtk.FileChooserDialog(
                        title="Save attachment",
                        transient_for=window,
                        action=Gtk.FileChooserAction.SAVE,
                    )
                    dialog.add_buttons(
                        "Cancel",
                        Gtk.ResponseType.CANCEL,
                        "Save",
                        Gtk.ResponseType.ACCEPT,
                    )
                    dialog.set_current_name(safe)
                    dialog.set_do_overwrite_confirmation(True)
                    downloads = GLib.get_user_special_dir(
                        GLib.UserDirectory.DIRECTORY_DOWNLOAD
                    )
                    if downloads and Path(downloads).is_dir():
                        dialog.set_current_folder(downloads)
                    response = dialog.run()
                    if response == Gtk.ResponseType.ACCEPT:
                        path = dialog.get_filename()
                        if path:
                            Path(path).write_bytes(data)
                except Exception as exc:
                    show_shell_error(
                        f"Could not save the attachment.\n{exc}"
                    )
                finally:
                    if dialog is not None:
                        dialog.destroy()
                return False

            GLib.idle_add(save)

        threading.Thread(
            target=worker, daemon=True, name="courier-download"
        ).start()
        return True

    def choose_attachments() -> list[str]:
        result: dict[str, Any] = {}
        done = threading.Event()

        def show() -> bool:
            dialog = None
            try:
                dialog = Gtk.FileChooserDialog(
                    title="Attach files",
                    transient_for=window,
                    action=Gtk.FileChooserAction.OPEN,
                )
                dialog.add_buttons(
                    "Cancel",
                    Gtk.ResponseType.CANCEL,
                    "Attach",
                    Gtk.ResponseType.ACCEPT,
                )
                dialog.set_select_multiple(True)
                downloads = GLib.get_user_special_dir(
                    GLib.UserDirectory.DIRECTORY_DOWNLOAD
                )
                if downloads and Path(downloads).is_dir():
                    dialog.set_current_folder(downloads)
                response = dialog.run()
                result["files"] = (
                    dialog.get_filenames()
                    if response == Gtk.ResponseType.ACCEPT
                    else []
                )
            except Exception as exc:
                app.log(f"attach chooser failed: {exc!r}")
                result["files"] = []
            finally:
                if dialog is not None:
                    dialog.destroy()
                done.set()
            return False

        GLib.idle_add(show)
        done.wait(timeout=300)
        return result.get("files", [])

    def choose_oauth_json() -> str:
        result: dict[str, str] = {}
        done = threading.Event()

        def show() -> bool:
            dialog = None
            try:
                dialog = Gtk.FileChooserDialog(
                    title="Import Google OAuth client",
                    transient_for=window,
                    action=Gtk.FileChooserAction.OPEN,
                )
                dialog.add_buttons(
                    "Cancel",
                    Gtk.ResponseType.CANCEL,
                    "Import",
                    Gtk.ResponseType.ACCEPT,
                )
                json_filter = Gtk.FileFilter()
                json_filter.set_name("OAuth client JSON")
                json_filter.add_pattern("*.json")
                dialog.add_filter(json_filter)
                downloads = GLib.get_user_special_dir(
                    GLib.UserDirectory.DIRECTORY_DOWNLOAD
                )
                if downloads and Path(downloads).is_dir():
                    dialog.set_current_folder(downloads)
                response = dialog.run()
                result["path"] = ""
                if response == Gtk.ResponseType.ACCEPT:
                    result["path"] = dialog.get_filename() or ""
            except Exception as exc:
                app.log(f"OAuth JSON chooser failed: {exc!r}")
                result["path"] = ""
            finally:
                if dialog is not None:
                    dialog.destroy()
                done.set()
            return False

        GLib.idle_add(show)
        done.wait(timeout=300)
        return result.get("path", "")

    def open_attachment_file(path: Path, filename: str) -> bool:
        GLib.idle_add(lambda: launch_attachment(path, filename) or False)
        return True

    app.open_attachment = open_attachment
    app.open_attachment_file = open_attachment_file
    app.download_attachment = download_attachment
    app.choose_attachments = choose_attachments
    app.choose_oauth_json = choose_oauth_json

    def on_file_chooser(_webview, request):
        dialog = None
        try:
            dialog = Gtk.FileChooserDialog(
                title="Choose file",
                transient_for=window,
                action=Gtk.FileChooserAction.OPEN,
            )
            dialog.add_buttons(
                "Cancel",
                Gtk.ResponseType.CANCEL,
                "Open",
                Gtk.ResponseType.ACCEPT,
            )
            try:
                dialog.set_select_multiple(bool(request.get_select_multiple()))
            except Exception:
                pass
            try:
                mime_types = [
                    value
                    for value in (request.get_mime_types() or [])
                    if value and value != "*/*"
                ]
                if mime_types:
                    file_filter = request.get_mime_types_filter()
                    if file_filter:
                        dialog.set_filter(file_filter)
            except Exception:
                pass
            downloads = GLib.get_user_special_dir(
                GLib.UserDirectory.DIRECTORY_DOWNLOAD
            )
            if downloads and Path(downloads).is_dir():
                dialog.set_current_folder(downloads)
            response = dialog.run()
            if response == Gtk.ResponseType.ACCEPT:
                files = [
                    Gio.File.new_for_path(filename)
                    for filename in dialog.get_filenames()
                ]
                request.select_files(files)
            else:
                request.cancel()
        except Exception:
            try:
                request.cancel()
            except Exception:
                pass
        finally:
            if dialog is not None:
                dialog.destroy()
        return True

    def on_create(_webview, action):
        try:
            request = action.get_request()
            uri = request.get_uri() if request else ""
        except Exception:
            uri = ""
        open_external(uri)
        return None

    def on_decide_policy(_webview, decision, decision_type):
        try:
            if decision_type in (
                WebKit2.PolicyDecisionType.NAVIGATION_ACTION,
                WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION,
            ):
                uri = decision.get_navigation_action().get_request().get_uri()
                if uri and not uri.startswith(app.base_url) and not uri.startswith("about:"):
                    open_external(uri)
                    decision.ignore()
                    return True
        except Exception:
            pass
        return False

    def on_download_started(_webview, download):
        suggested = download.get_suggested_filename() or "attachment"
        dialog = Gtk.FileChooserDialog(
            title="Save attachment",
            transient_for=window,
            action=Gtk.FileChooserAction.SAVE,
        )
        dialog.add_buttons("Cancel", Gtk.ResponseType.CANCEL, "Save", Gtk.ResponseType.ACCEPT)
        dialog.set_current_name(suggested)
        dialog.set_do_overwrite_confirmation(True)
        try:
            downloads = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD)
            if downloads:
                dialog.set_current_folder(downloads)
        except Exception:
            pass
        response = dialog.run()
        path = dialog.get_filename()
        dialog.destroy()
        if response != Gtk.ResponseType.ACCEPT or not path:
            download.cancel()
            return
        download.set_destination(path)

    def on_load_failed(_webview, _event, uri, error):
        print(f"Courier failed to load {uri}: {error.message}", file=sys.stderr)
        if "DMABUF" in (error.message or "") or "EGL" in (error.message or ""):
            print(
                "Try launching with WEBKIT_DISABLE_DMABUF_RENDERER=1 ./run.sh",
                file=sys.stderr,
            )
        return False

    webview.connect("run-file-chooser", on_file_chooser)
    webview.connect("create", on_create)
    webview.connect("decide-policy", on_decide_policy)
    try:
        webview.get_context().connect("download-started", on_download_started)
    except Exception as exc:
        print(f"Could not attach download handler: {exc}", file=sys.stderr)
    webview.connect("load-failed", on_load_failed)
    window.add(webview)
    webview.load_uri(url)

    quitting = False
    tray_icon = None
    tray_menu = None
    tray_available = False
    instance = None
    monitor = NotificationMonitor(
        app,
        icon,
        on_open=lambda account_id, thread_id: GLib.idle_add(
            open_notification_thread, account_id, thread_id
        ),
    )
    monitor.start()
    unread_baseline = 0
    if app.store.accounts() and os.environ.get("COURIER_DEMO") != "1":
        try:
            app.sync.trigger()
        except Exception:
            pass

    def unread_total() -> int:
        try:
            return sum(
                int(account.get("inbox_unread") or 0)
                for account in app.state().get("accounts", [])
            )
        except Exception:
            return 0

    unread_baseline = unread_total()

    def mark_opened() -> None:
        nonlocal unread_baseline
        unread_baseline = unread_total()

    def run_js(script: str) -> None:
        try:
            webview.run_javascript(script, None, None, None)
        except Exception:
            pass

    def send_window_active(active: bool) -> None:
        run_js(
            "window.courierSetWindowActive && window.courierSetWindowActive("
            + ("true" if active else "false")
            + ")"
        )

    def window_active() -> bool:
        try:
            gdk_window = window.get_window()
            if gdk_window is None:
                return False
            window_state = gdk_window.get_state()
            if window_state & (
                Gdk.WindowState.WITHDRAWN | Gdk.WindowState.ICONIFIED
            ):
                return False
        except Exception:
            pass
        try:
            return bool(window.get_visible() and window.is_active())
        except Exception:
            return False

    def on_window_focus(_window, _event) -> bool:
        send_window_active(True)
        return False

    def on_window_blur(_window, _event) -> bool:
        send_window_active(False)
        return False

    def on_window_state(_window, event) -> bool:
        minimized = bool(
            event.new_window_state
            & (Gdk.WindowState.WITHDRAWN | Gdk.WindowState.ICONIFIED)
        )
        send_window_active(not minimized and window.is_active())
        return False

    def on_window_hide(_window) -> None:
        send_window_active(False)

    def on_window_show(_window) -> None:
        send_window_active(window_active())

    def on_load_changed(_webview, event) -> None:
        if event == WebKit2.LoadEvent.FINISHED:
            send_window_active(window_active())

    window.connect("focus-in-event", on_window_focus)
    window.connect("focus-out-event", on_window_blur)
    window.connect("window-state-event", on_window_state)
    window.connect("hide", on_window_hide)
    window.connect("show", on_window_show)
    webview.connect("load-changed", on_load_changed)

    def show_window(account_id: str | None = None) -> None:
        try:
            window.deiconify()
            window.show_all()
            window.present()
        except Exception:
            return
        mark_opened()
        if os.environ.get("COURIER_DEMO") != "1":
            try:
                app.sync.trigger()
            except Exception:
                pass
        run_js("window.courierRefresh && window.courierRefresh()")
        if account_id:
            def apply_account() -> bool:
                run_js(
                    "window.courierOpenAccount && window.courierOpenAccount("
                    + json.dumps(account_id)
                    + ")"
                )
                return False
            GLib.timeout_add(180, apply_account)

    def open_notification_thread(account_id: str, thread_id: str) -> None:
        show_window()
        if not account_id or not thread_id:
            return

        def apply_thread() -> bool:
            run_js(
                "window.courierOpenThread && window.courierOpenThread("
                + json.dumps(account_id)
                + ", "
                + json.dumps(thread_id)
                + ")"
            )
            return False

        # show_window refreshes state first; let the render settle so the list
        # and account context exist before the thread fetch starts.
        GLib.timeout_add(320, apply_thread)

    try:
        instance = SingleInstance(
            instance_socket_path(app.data_dir),
            lambda: GLib.idle_add(show_window),
        )
        if not instance.start():
            app.log("single-instance socket unavailable")
            instance = None
    except Exception as exc:
        app.log(f"single-instance socket failed: {exc!r}")
        instance = None

    def account_menu_label(account: dict) -> str:
        name = account.get("username") or account.get("email") or "Account"
        unread = int(account.get("inbox_unread") or 0)
        return f"{name} ({unread})" if unread else name

    def build_tray_menu():
        menu = Gtk.Menu()
        accounts: list[dict] = []
        try:
            accounts = app.state().get("accounts", [])
        except Exception:
            pass
        new_count = max(0, unread_total() - unread_baseline)
        new_item = Gtk.MenuItem(
            label=(
                f"{new_count} new email{'s' if new_count != 1 else ''} since last opened"
            )
        )
        new_item.set_sensitive(False)
        menu.append(new_item)
        menu.append(Gtk.SeparatorMenuItem())
        if not accounts:
            empty = Gtk.MenuItem(label="No accounts connected")
            empty.set_sensitive(False)
            menu.append(empty)
        for account in accounts:
            item = Gtk.MenuItem(label=account_menu_label(account))
            item.connect(
                "activate",
                lambda _item, account_id=account.get("id"): show_window(account_id),
            )
            menu.append(item)
        menu.append(Gtk.SeparatorMenuItem())
        quit_item = Gtk.MenuItem(label="Quit Courier")
        quit_item.connect("activate", lambda _item: quit_app())
        menu.append(quit_item)
        menu.show_all()
        return menu

    def popup_tray(_icon, button, activate_time) -> None:
        nonlocal tray_menu
        tray_menu = build_tray_menu()
        tray_menu.popup(None, None, None, None, button, activate_time)

    def quit_app() -> None:
        nonlocal quitting
        if quitting:
            return
        quitting = True
        try:
            sync_autostart(_load_ui_prefs(app.store).get("loginStartup", "off"))
        except Exception:
            pass
        if tray_icon:
            try:
                tray_icon.set_visible(False)
            except Exception:
                pass
        if instance:
            try:
                instance.close()
            except Exception:
                pass
        monitor.stop()
        try:
            app.stop()
        finally:
            Gtk.main_quit()

    try:
        tray_icon = Gtk.StatusIcon()
        loaded = False
        if icon.exists():
            try:
                loaded = tray_icon.set_from_file(str(icon))
            except Exception:
                loaded = False
        if not loaded:
            tray_icon.set_from_icon_name("courier")
        tray_icon.set_tooltip_text("Courier")
        tray_icon.connect("activate", lambda _icon: show_window())
        tray_icon.connect("popup-menu", popup_tray)
        tray_icon.set_visible(True)
        tray_available = True
        app.log("tray icon ready")

        def report_tray() -> bool:
            try:
                app.log(f"tray embedded={tray_icon.is_embedded()}")
            except Exception:
                pass
            return False

        GLib.timeout_add(1800, report_tray)
    except Exception as exc:
        app.log(f"tray unavailable: {exc!r}")
        tray_icon = None
        tray_available = False

    last_autostart = _load_ui_prefs(app.store).get("loginStartup", "off")
    sync_autostart(last_autostart)

    def check_autostart() -> bool:
        nonlocal last_autostart
        mode = _load_ui_prefs(app.store).get("loginStartup", "off")
        if mode != last_autostart:
            last_autostart = mode
            sync_autostart(mode)
        return True

    GLib.timeout_add(2000, check_autostart)

    def on_delete(_widget, _event):
        try:
            behavior = _load_ui_prefs(app.store).get("closeBehavior", "tray")
        except Exception:
            behavior = "tray"
        if behavior == "tray" and tray_available:
            window.hide()
            return True
        quit_app()
        return True

    def on_window_state(_widget, event):
        try:
            minimized_state = bool(event.new_window_state & Gdk.WindowState.ICONIFIED)
        except Exception:
            return False
        if minimized_state:
            try:
                behavior = _load_ui_prefs(app.store).get(
                    "minimizeBehavior", "default"
                )
            except Exception:
                behavior = "default"
            if behavior == "tray" and tray_available:
                GLib.idle_add(window.hide)
                return True
        return False

    window.connect("delete-event", on_delete)
    window.connect("window-state-event", on_window_state)
    window.connect("focus-in-event", lambda *_args: mark_opened())

    if dev:
        def on_key(_widget, event):
            try:
                if (
                    event.state & Gdk.ModifierType.CONTROL_MASK
                    and event.state & Gdk.ModifierType.SHIFT_MASK
                    and event.keyval in (Gdk.KEY_I, Gdk.KEY_i)
                ):
                    inspector = webview.get_inspector()
                    inspector.show()
                    return True
            except Exception:
                pass
            return False

        window.connect("key-press-event", on_key)

    def on_destroy(_widget):
        quit_app()

    window.connect("destroy", on_destroy)
    if minimized and tray_available:
        window.hide()
    else:
        window.show_all()
        mark_opened()

    def place_on_right():
        try:
            screen = window.get_screen()
            display = screen.get_display() if screen else None
            if display and display.get_n_monitors() > 0:
                monitors = [
                    display.get_monitor(index).get_geometry()
                    for index in range(display.get_n_monitors())
                ]
                target = max(monitors, key=lambda geometry: geometry.x)
                width = window.get_size()[0] or 1380
                x = max(target.x, target.x + target.width - width - 24)
                window.move(x, target.y + 60)
        except Exception:
            pass
        return False

    GLib.timeout_add(80, place_on_right)
    Gtk.main()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Courier, a local Gmail client")
    parser.add_argument("--serve", action="store_true", help="run the local server only")
    parser.add_argument(
        "--data-dir",
        default=None,
        help="override the runtime data directory",
    )
    parser.add_argument(
        "--minimized",
        action="store_true",
        help="start with only the tray icon visible",
    )
    args = parser.parse_args()
    data_dir = Path(args.data_dir).expanduser() if args.data_dir else default_data_dir()
    if not args.serve and notify_existing(data_dir):
        return 0
    app = App(data_dir, log=lambda line: print(line, file=sys.stderr))
    try:
        if args.serve:
            return run_headless(app)
        return run_gui(app, minimized=args.minimized)
    except Exception as exc:
        app.log(f"fatal: {exc!r}")
        print(f"Courier could not start: {exc}", file=sys.stderr)
        try:
            app.stop()
        except Exception:
            pass
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
