#!/usr/bin/env bash
# Post-build script: replace symlink with Finder alias + set custom icon
set -e

DMG_PATH="$1"
if [[ -z "$DMG_PATH" ]]; then
  echo "Usage: $0 <path-to-dmg>"
  exit 1
fi

ICON_PATH="/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/ApplicationsFolderIcon.icns"
SET_ICON="/tmp/set_icon"

echo "Fixing Applications icon in DMG: $DMG_PATH"

# Convert compressed DMG to read-write
RW_DMG="/tmp/rw_team9_$$.dmg"
hdiutil convert "$DMG_PATH" -format UDRW -o "$RW_DMG" -quiet

# Mount the read-write DMG
MOUNT_OUTPUT=$(hdiutil attach "$RW_DMG" -readwrite -noverify -noautoopen -nobrowse)
DEV_NAME=$(echo "$MOUNT_OUTPUT" | grep -E '^/dev/' | head -1 | awk '{print $1}')
MOUNT_DIR=$(echo "$MOUNT_OUTPUT" | grep -o '/Volumes/.*' | head -1)

echo "Mounted at: $MOUNT_DIR"

# Remove old symlink and .DS_Store
rm -f "$MOUNT_DIR/Applications"
rm -f "$MOUNT_DIR/.DS_Store"

# Create Finder alias
osascript -e "
  tell application \"Finder\"
    make new alias file at POSIX file \"$MOUNT_DIR\" to POSIX file \"/Applications\"
  end tell
" > /dev/null

# Find the alias (may have localized name) and rename to Applications
ALIAS_FILE=$(ls "$MOUNT_DIR" | grep -v "Team9.app" | grep -v "^\." | grep -v "^Applications$" | head -1)
if [[ -n "$ALIAS_FILE" ]]; then
  echo "Renaming '$ALIAS_FILE' -> 'Applications'"
  mv "$MOUNT_DIR/$ALIAS_FILE" "$MOUNT_DIR/Applications"
fi

# Set custom icon using compiled Swift tool
echo "Setting custom icon..."
"$SET_ICON" "$ICON_PATH" "$MOUNT_DIR/Applications" || echo "Swift setIcon returned non-zero"

# Also try: copy the icon as resource fork
cp "$ICON_PATH" /tmp/_app_icon.icns
sips -i /tmp/_app_icon.icns 2>/dev/null || true
DeRez -only icns /tmp/_app_icon.icns > /tmp/_app_icon.rsrc 2>/dev/null || true
if [[ -s /tmp/_app_icon.rsrc ]]; then
  Rez -append /tmp/_app_icon.rsrc -o "$MOUNT_DIR/Applications" 2>/dev/null || true
  SetFile -a C "$MOUNT_DIR/Applications" 2>/dev/null || true
  echo "Resource fork icon applied"
fi

# Re-apply Finder view settings
osascript <<EOF
  tell application "Finder"
    tell disk "$(basename "$MOUNT_DIR")"
      open
      set current view of container window to icon view
      set toolbar visible of container window to false
      set statusbar visible of container window to false
      set bounds of container window to {100, 100, 760, 508}
      set opts to the icon view options of container window
      set icon size of opts to 128
      set text size of opts to 16
      set arrangement of opts to not arranged
      set background picture of opts to file ".background:dmg-background.png"
      set position of item "Team9.app" to {180, 175}
      set position of item "Applications" to {480, 175}
      close
      open
    end tell
  end tell
EOF

sleep 2

# Unmount
hdiutil detach "$DEV_NAME" -quiet

# Convert back to compressed read-only
rm -f "$DMG_PATH"
hdiutil convert "$RW_DMG" -format UDZO -imagekey zlib-level=9 -o "$DMG_PATH" -quiet
rm -f "$RW_DMG"

echo "Done!"
