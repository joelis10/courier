"""Download and install Courier release packages from GitHub.

The browser never supplies a download URL. Courier asks the GitHub release API for
the latest release, accepts a single checksummed ``.deb`` asset, streams it into the
data directory, and verifies its SHA-256 digest before the system installer runs.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

from . import APP_VERSION

REPOSITORY = "joelis10/courier"
RELEASE_API = f"https://api.github.com/repos/{REPOSITORY}/releases/latest"
RELEASE_DOWNLOAD_PREFIX = f"/{REPOSITORY}/releases/download/"
PACKAGE_ROOT = Path("/usr/lib/courier")
MAX_PACKAGE_BYTES = 64 * 1024 * 1024
PACKAGE_NAME = re.compile(r"^courier_[0-9][A-Za-z0-9.+~_-]*_all\.deb$")
DIGEST_PATTERN = re.compile(r"^sha256:([0-9a-fA-F]{64})$")
VERSION_PATTERN = re.compile(r"^[0-9][0-9A-Za-z.+~-]*$")
TOOL_PATHS = {
    "apt-get": ("/usr/bin/apt-get", "/bin/apt-get"),
    "env": ("/usr/bin/env", "/bin/env"),
    "pkexec": ("/usr/bin/pkexec", "/bin/pkexec"),
    "xdg-open": ("/usr/bin/xdg-open", "/bin/xdg-open"),
}


def _find_tool(
    name: str, which: Callable[[str], str | None] | None = None
) -> str | None:
    """Resolve installer tools without trusting PATH for privileged commands."""
    if which is not None:
        return which(name)
    for candidate in TOOL_PATHS.get(name, ()):
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


class UpdateError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def version_key(value: str) -> tuple[int, ...]:
    parts = re.findall(r"\d+", str(value or ""))
    return tuple(int(part) for part in parts[:4]) or (0,)


def release_version(release: dict[str, Any]) -> str:
    tag = str(release.get("tag_name") or "").strip()
    latest = tag.lstrip("vV")
    if not latest or not VERSION_PATTERN.fullmatch(latest):
        raise UpdateError("GitHub returned an invalid release.", 502)
    return latest


def fetch_latest_release(timeout: int = 20) -> dict[str, Any]:
    request = urllib.request.Request(
        RELEASE_API,
        headers={
            "User-Agent": f"Courier/{APP_VERSION}",
            "Accept": "application/vnd.github+json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise UpdateError("No published Courier release was found.", 404)
        if exc.code in (403, 429):
            raise UpdateError(
                "GitHub update checks are rate limited. Try again later.", 429
            )
        raise UpdateError(
            f"GitHub returned {exc.code} while checking for updates.", 502
        ) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise UpdateError("Could not reach GitHub to check for updates.", 502) from exc
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise UpdateError("GitHub returned an invalid release.", 502) from exc
    if not isinstance(data, dict):
        raise UpdateError("GitHub returned an invalid release.", 502)
    return data


def _check_download_url(url: str) -> None:
    parsed = urllib.parse.urlparse(str(url or ""))
    if (
        parsed.scheme != "https"
        or parsed.netloc != "github.com"
        or not parsed.path.startswith(RELEASE_DOWNLOAD_PREFIX)
    ):
        raise UpdateError("GitHub returned an unexpected download URL.", 502)


def asset_matches_version(name: str, version: str) -> bool:
    prefix = f"courier_{version}"
    if not name.startswith(prefix):
        return False
    rest = name[len(prefix) :]
    return bool(
        re.fullmatch(r"(?:[-+~][A-Za-z0-9.+~:-]+)?_all\.deb", rest)
    )


def release_asset(
    release: dict[str, Any], version: str | None = None
) -> dict[str, Any]:
    """Return the installable Debian asset, requiring a SHA-256 digest."""
    latest = version or release_version(release)
    assets = release.get("assets")
    if not isinstance(assets, list):
        raise UpdateError("GitHub returned an invalid release.", 502)
    candidates: list[dict[str, Any]] = []
    for item in assets:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "")
        if not PACKAGE_NAME.fullmatch(name):
            continue
        digest_match = DIGEST_PATTERN.fullmatch(str(item.get("digest") or ""))
        if not digest_match:
            continue
        url = str(item.get("browser_download_url") or "")
        try:
            _check_download_url(url)
        except UpdateError:
            continue
        try:
            size = int(item.get("size") or 0)
        except (TypeError, ValueError):
            size = 0
        if size <= 0 or size > MAX_PACKAGE_BYTES:
            continue
        candidates.append(
            {
                "name": name,
                "size": size,
                "sha256": digest_match.group(1).lower(),
                "url": url,
            }
        )
    if not candidates:
        raise UpdateError(
            "The release has no installable Debian package with a SHA-256 checksum.",
            502,
        )
    matching = [
        item for item in candidates if asset_matches_version(item["name"], latest)
    ]
    if not matching:
        raise UpdateError(
            f"The release does not include a Courier {latest} package.", 502
        )
    return matching[0]


def download_package(
    asset: dict[str, Any],
    destination: Path,
    progress: Callable[[int, int], None] | None = None,
    timeout: int = 60,
) -> dict[str, Any]:
    """Stream one release asset to disk and verify its published digest."""
    _check_download_url(str(asset.get("url") or ""))
    expected = str(asset.get("sha256") or "").lower()
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise UpdateError("The release package has no valid checksum.", 502)
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        destination.parent.chmod(0o700)
    except OSError:
        pass
    partial = destination.with_name(destination.name + ".part")
    try:
        partial.unlink()
    except FileNotFoundError:
        pass
    except OSError:
        pass

    request = urllib.request.Request(
        str(asset["url"]),
        headers={
            "User-Agent": f"Courier/{APP_VERSION}",
            "Accept": "application/octet-stream",
        },
    )
    digest = hashlib.sha256()
    received = 0
    total = int(asset.get("size") or 0)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            length = response.headers.get("Content-Length")
            if length:
                try:
                    announced = int(length)
                except ValueError:
                    announced = 0
                if announced > MAX_PACKAGE_BYTES:
                    raise UpdateError("The update package is too large.", 502)
                if announced > 0:
                    total = announced
            with open(partial, "wb") as handle:
                while True:
                    chunk = response.read(64 * 1024)
                    if not chunk:
                        break
                    received += len(chunk)
                    if received > MAX_PACKAGE_BYTES:
                        raise UpdateError("The update package is too large.", 502)
                    handle.write(chunk)
                    digest.update(chunk)
                    if progress:
                        progress(received, total)
    except UpdateError:
        try:
            partial.unlink()
        except OSError:
            pass
        raise
    except urllib.error.HTTPError as exc:
        try:
            partial.unlink()
        except OSError:
            pass
        if exc.code == 404:
            raise UpdateError("The release package is no longer available.", 404)
        if exc.code in (403, 429):
            raise UpdateError(
                "GitHub download was rate limited. Try again later.", 429
            )
        raise UpdateError(
            f"GitHub returned {exc.code} while downloading the update.", 502
        ) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        try:
            partial.unlink()
        except OSError:
            pass
        raise UpdateError("Could not download the update from GitHub.", 502) from exc

    actual = digest.hexdigest()
    if actual != expected:
        try:
            partial.unlink()
        except OSError:
            pass
        raise UpdateError(
            "The downloaded package did not match the release checksum. "
            "Nothing was installed.",
            502,
        )
    try:
        os.replace(partial, destination)
        destination.chmod(0o600)
    except OSError as exc:
        try:
            partial.unlink()
        except OSError:
            pass
        raise UpdateError("Could not save the downloaded package.", 500) from exc
    if progress:
        progress(received, total or received)
    return {
        "name": asset.get("name"),
        "size": received,
        "sha256": actual,
        "path": str(destination),
    }


def install_method(
    which: Callable[[str], str | None] | None = None,
    euid: int | None = None,
) -> dict[str, Any]:
    """Describe how this copy of Courier can apply a downloaded package."""
    user_id = os.geteuid() if euid is None else euid
    app_dir = Path(__file__).resolve().parent
    packaged = app_dir == (PACKAGE_ROOT / "app").resolve()
    if not packaged:
        return {
            "packaged": False,
            "can_install": False,
            "method": "",
            "reason": (
                "Courier is running from a source checkout. "
                "Install the release package to use in-client updates."
            ),
        }
    apt_get = _find_tool("apt-get", which)
    if apt_get and user_id == 0:
        return {
            "packaged": True,
            "can_install": True,
            "method": "root",
            "reason": "",
        }
    pkexec = _find_tool("pkexec", which)
    if apt_get and pkexec:
        return {
            "packaged": True,
            "can_install": True,
            "method": "pkexec",
            "reason": "",
        }
    xdg_open = _find_tool("xdg-open", which)
    if xdg_open:
        return {
            "packaged": True,
            "can_install": True,
            "method": "installer",
            "reason": (
                "The downloaded package opens in the system installer. "
                "Restart Courier after it finishes."
            ),
        }
    return {
        "packaged": True,
        "can_install": False,
        "method": "",
        "reason": (
            "No system package installer was found. "
            "Download the update from the release page."
        ),
    }


def installer_command(
    package_path: Path,
    which: Callable[[str], str | None] | None = None,
    euid: int | None = None,
) -> tuple[list[str], str]:
    """Build the installer command without using a shell."""
    user_id = os.geteuid() if euid is None else euid
    apt_get = _find_tool("apt-get", which)
    if not apt_get:
        xdg_open = _find_tool("xdg-open", which)
        if xdg_open:
            return [xdg_open, str(package_path)], "installer"
        raise UpdateError(
            "No system package installer was found. "
            "Download the update from the release page.",
            409,
        )
    command = [
        apt_get,
        "install",
        "-y",
        "--no-install-recommends",
        "-o",
        "Dpkg::Options::=--force-confdef",
        "-o",
        "Dpkg::Options::=--force-confold",
        str(package_path),
    ]
    if user_id == 0:
        return command, "root"
    pkexec = _find_tool("pkexec", which)
    if pkexec:
        env = _find_tool("env", which) or "/usr/bin/env"
        return [
            pkexec,
            env,
            "DEBIAN_FRONTEND=noninteractive",
            "APT_LISTCHANGES_FRONTEND=none",
            *command,
        ], "pkexec"
    xdg_open = _find_tool("xdg-open", which)
    if xdg_open:
        return [xdg_open, str(package_path)], "installer"
    raise UpdateError(
        "No system package installer was found. "
        "Download the update from the release page.",
        409,
    )


class UpdateManager:
    """Tracks the current download/install operation for one Courier process."""

    def __init__(self, app):
        self.app = app
        self.data_dir = Path(app.data_dir).expanduser().resolve()
        self._lock = threading.Lock()
        self._operation: dict[str, Any] = {
            "status": "idle",
            "version": "",
            "received": 0,
            "total": 0,
            "message": "",
            "output": "",
        }
        self._thread: threading.Thread | None = None

    def mode(self) -> dict[str, Any]:
        mode = install_method()
        mode["can_restart"] = callable(
            getattr(self.app, "restart_courier", None)
        )
        return mode

    def operation(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._operation)

    def installed_version(self) -> str:
        stored = str(
            self.app.store.get_setting("update_installed_version") or ""
        ).strip()
        if stored and version_key(APP_VERSION) >= version_key(stored):
            self.app.store.set_setting("update_installed_version", "")
            return ""
        return stored

    def status(self) -> dict[str, Any]:
        return {
            "current": APP_VERSION,
            "mode": self.mode(),
            "operation": self.operation(),
            "installed_version": self.installed_version(),
        }

    def _update_operation(self, **fields: Any) -> dict[str, Any]:
        with self._lock:
            self._operation.update(fields)
            return dict(self._operation)

    def apply(self) -> dict[str, Any]:
        mode = self.mode()
        if not mode["packaged"] or not mode["can_install"]:
            raise UpdateError(
                mode["reason"] or "Updates cannot be installed from this copy.",
                409,
            )
        with self._lock:
            if self._operation.get("status") in ("downloading", "installing"):
                return dict(self._operation)
            self._operation = {
                "status": "downloading",
                "version": "",
                "received": 0,
                "total": 0,
                "message": "",
                "output": "",
            }
        thread = threading.Thread(
            target=self._run, daemon=True, name="courier-update"
        )
        self._thread = thread
        thread.start()
        return self.operation()

    def _run(self) -> None:
        try:
            release = fetch_latest_release()
            latest = release_version(release)
            if version_key(latest) <= version_key(APP_VERSION):
                raise UpdateError("Courier is already up to date.", 409)
            asset = release_asset(release, latest)
            destination = self.data_dir / "updates" / asset["name"]
            self._update_operation(
                status="downloading",
                version=latest,
                received=0,
                total=int(asset["size"]),
                message="",
                output="",
            )

            def on_progress(received: int, total: int) -> None:
                self._update_operation(received=received, total=total)

            downloaded = download_package(asset, destination, on_progress)
            self._update_operation(
                status="installing",
                version=latest,
                received=int(downloaded["size"]),
                total=int(downloaded["size"]),
                message="",
                output="",
            )
            command, method = installer_command(destination)
            output: list[str] = []
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            if process.stdout is not None:
                for raw in process.stdout:
                    line = raw.replace("\r", "").strip()
                    if not line:
                        continue
                    output.append(line)
                    del output[:-12]
                    self._update_operation(output="\n".join(output))
            code = process.wait()
            tail = " ".join(output[-3:]).strip()
            if method == "installer":
                if code != 0:
                    message = "The system installer could not open the package."
                    if tail:
                        message = f"{message} {tail}"
                    raise UpdateError(message, 500)
                self._update_operation(
                    status="opened",
                    message=(
                        "The package installer is open. "
                        "Restart Courier after it finishes."
                    ),
                    output="\n".join(output[-12:]),
                )
                return
            if code != 0:
                if code in (126, 127):
                    message = (
                        "Installation was cancelled or permission was denied."
                    )
                else:
                    message = "Installation failed."
                if tail:
                    message = f"{message} {tail}"
                raise UpdateError(message, 500)
            self.app.store.set_setting("update_installed_version", latest)
            self._update_operation(
                status="installed",
                message=f"Courier {latest} is installed. Restart Courier to finish.",
                output="\n".join(output[-12:]),
            )
            try:
                destination.unlink()
            except OSError:
                pass
        except UpdateError as exc:
            self.app.log(f"update failed: {exc.message}")
            self._update_operation(status="failed", message=exc.message)
        except Exception as exc:  # pragma: no cover - defensive
            self.app.log(f"update failed: {exc!r}")
            self._update_operation(
                status="failed",
                message="The update could not be installed. See courier.log.",
            )
