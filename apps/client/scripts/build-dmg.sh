#!/bin/bash
# Custom DMG builder with smaller icons (80px vs Tauri's default 128px).
#
# Usage: cd apps/client && ./scripts/build-dmg.sh [--debug]
set -euo pipefail

MODE="release"
PROFILE_FLAG=""
if [[ "${1:-}" == "--debug" ]]; then
  MODE="debug"
  PROFILE_FLAG="--debug"
fi

TAURI_DIR="src-tauri"
TARGET_DIR="$TAURI_DIR/target/$MODE"
BUNDLE_DIR="$TARGET_DIR/bundle"
DMG_DIR="$BUNDLE_DIR/dmg"
DMG_SCRIPT="$DMG_DIR/bundle_dmg.sh"
APP_NAME="Team9"
APP_PATH="$BUNDLE_DIR/macos/$APP_NAME.app"
BACKGROUND="$TAURI_DIR/icons/dmg-background.png"
VOLICON="$DMG_DIR/icon.icns"
VERSION=$(grep '"version"' "$TAURI_DIR/tauri.conf.json" | head -1 | sed 's/.*: *"\(.*\)".*/\1/')
DMG_OUTPUT="$DMG_DIR/${APP_NAME}_${VERSION}_$(uname -m).dmg"

# Step 1: Build .app and generate bundle_dmg.sh via Tauri's DMG bundler
echo "==> Building $APP_NAME.app + DMG toolchain ($MODE)..."
pnpm tauri build $PROFILE_FLAG --bundles dmg 2>&1 | tail -5 || true

if [[ ! -d "$APP_PATH" ]]; then
  echo "ERROR: $APP_PATH not found"
  exit 1
fi
if [[ ! -f "$DMG_SCRIPT" ]]; then
  echo "ERROR: $DMG_SCRIPT not found"
  exit 1
fi

# Step 2: Rebuild DMG with custom icon size
echo "==> Rebuilding DMG with 80px icons..."
SRC_DIR=$(mktemp -d)
trap "rm -rf $SRC_DIR" EXIT
cp -R "$APP_PATH" "$SRC_DIR/"
rm -f "$DMG_OUTPUT"

"$DMG_SCRIPT" \
  --volname "$APP_NAME" \
  --volicon "$VOLICON" \
  --background "$BACKGROUND" \
  --window-size 540 380 \
  --icon-size 80 \
  --icon "$APP_NAME.app" 135 175 \
  --app-drop-link 405 175 \
  --hide-extension "$APP_NAME.app" \
  "$DMG_OUTPUT" \
  "$SRC_DIR"

echo "==> Done: $DMG_OUTPUT"
