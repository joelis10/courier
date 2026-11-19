#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VERSION=${1:-0.0.0}
OUT_DIR=${2:-"$ROOT/dist"}

case "$VERSION" in
  [0-9]*) ;;
  *)
    printf 'Debian versions must start with a digit: %s\n' "$VERSION" >&2
    exit 1
    ;;
esac

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT INT TERM

PKG="$STAGE/courier"
mkdir -p \
  "$PKG/DEBIAN" \
  "$PKG/usr/bin" \
  "$PKG/usr/lib/courier" \
  "$PKG/usr/share/applications" \
  "$PKG/usr/share/icons/hicolor/scalable/apps" \
  "$PKG/usr/share/man/man1" \
  "$PKG/usr/share/doc/courier"

cp -a "$ROOT/app" "$PKG/usr/lib/courier/app"
find "$PKG/usr/lib/courier/app" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$PKG/usr/lib/courier/app" -type f -name '*.pyc' -delete

install -m 755 "$ROOT/packaging/courier" "$PKG/usr/bin/courier"
install -m 644 "$ROOT/packaging/courier.desktop" \
  "$PKG/usr/share/applications/courier.desktop"
install -m 644 "$ROOT/app/web/icon.svg" \
  "$PKG/usr/share/icons/hicolor/scalable/apps/courier.svg"
gzip -9n -c "$ROOT/packaging/courier.1" > "$PKG/usr/share/man/man1/courier.1.gz"
install -m 644 "$ROOT/README.md" "$PKG/usr/share/doc/courier/README.md"
install -m 644 "$ROOT/LICENSE" "$PKG/usr/share/doc/courier/LICENSE"
install -m 644 "$ROOT/packaging/copyright" "$PKG/usr/share/doc/courier/copyright"

{
  printf 'courier (%s) unstable; urgency=medium\n\n' "$VERSION"
  printf '  * Built from Courier %s.\n\n' "$VERSION"
  printf ' -- Joel Nod <joelis10@users.noreply.github.com>  %s\n' "$(date -R)"
} > "$PKG/usr/share/doc/courier/changelog.Debian"
gzip -9n "$PKG/usr/share/doc/courier/changelog.Debian"

SIZE=$(du -sk "$PKG" | cut -f1)

cat > "$PKG/DEBIAN/control" <<EOF
Package: courier
Version: $VERSION
Section: mail
Priority: optional
Architecture: all
Installed-Size: $SIZE
Maintainer: Joel Nod <joelis10@users.noreply.github.com>
Depends: python3 (>= 3.11), python3-gi, gir1.2-gtk-3.0, gir1.2-webkit2-4.1, gir1.2-notify-0.7
Recommends: ffmpeg, pkexec | policykit-1, xdg-utils
Homepage: https://github.com/joelis10/courier
Description: local Gmail client for Linux
 Courier is a desktop Gmail client built with Python, GTK 3, and
 WebKitGTK 4.1. It merges multiple Gmail accounts into one inbox,
 renders HTML mail in a sandboxed web view, blocks remote images
 until you allow them, and supports labels, search, drafts, and
 sending with attachments.
EOF

mkdir -p "$OUT_DIR"
OUT_FILE="$OUT_DIR/courier_${VERSION}_all.deb"
dpkg-deb --build --root-owner-group "$PKG" "$OUT_FILE"
printf '%s\n' "$OUT_FILE"
