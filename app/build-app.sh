#!/bin/bash
# Builds MuseMachine.app from the web app + native Swift shell.
# Usage: bash build-app.sh   (re-run after any web-file edit)
set -euo pipefail
cd "$(dirname "$0")"
ROOT=".."
APP="$ROOT/MuseMachine.app"

echo "→ assembling bundle"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"
cp "$ROOT"/index.html "$ROOT"/style.css "$ROOT"/app.js "$ROOT"/decks.js \
   "$ROOT"/sky.js "$ROOT"/dreambox.js "$ROOT"/portal.js "$ROOT"/tracks.js \
   "$ROOT"/manifest.json \
   "$APP/Contents/Resources/web/"
cp -R "$ROOT"/icons "$APP/Contents/Resources/web/icons"
cp Info.plist "$APP/Contents/"

echo "→ compiling shell"
swiftc -O main.swift -o "$APP/Contents/MacOS/MuseMachine"

if [ ! -f AppIcon.icns ]; then
  echo "→ rendering icon"
  swift makeicon.swift
  rm -rf AppIcon.iconset && mkdir AppIcon.iconset
  for s in 16 32 64 128 256 512; do
    sips -z $s $s icon-1024.png --out "AppIcon.iconset/icon_${s}x${s}.png" >/dev/null
    d=$((s * 2))
    sips -z $d $d icon-1024.png --out "AppIcon.iconset/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns AppIcon.iconset -o AppIcon.icns
  rm -rf AppIcon.iconset icon-1024.png
fi
cp AppIcon.icns "$APP/Contents/Resources/"

echo "→ signing (ad-hoc)"
codesign --force -s - "$APP"

echo "✓ built $APP"
