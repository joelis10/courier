#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor/scalable/apps"
DESKTOP="$APPS/courier.desktop"
ICON="$ICONS/courier.svg"

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$DESKTOP" "$ICON"
  rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/courier.desktop"
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$APPS" >/dev/null 2>&1 || true
  fi
  printf 'Removed the Courier launcher. Mail data was left in %s.\n' "$HOME/.local/share/courier"
  exit 0
fi

chmod +x "$ROOT/run.sh"
mkdir -p "$APPS" "$ICONS"
cp "$ROOT/app/web/icon.svg" "$ICON"

cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Courier
Comment=Local Gmail client
Exec="$ROOT/run.sh"
Path=$ROOT
Icon=courier
Terminal=false
Categories=Network;Email;
StartupWMClass=Courier
EOF

chmod 644 "$DESKTOP" "$ICON"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPS" >/dev/null 2>&1 || true
fi

printf 'Installed Courier in the applications menu.\n'
printf 'Run it from there, or with %s/run.sh\n' "$ROOT"
