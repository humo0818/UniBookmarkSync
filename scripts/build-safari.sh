#!/bin/bash
# Convert Chrome-compatible extension to Safari
# Requires: Xcode and Safari (macOS only)
# Usage: bash scripts/build-safari.sh

set -e

DIST="dist/safari"
XCODE_OUT="dist/safari-xcode"

echo "Building Safari extension..."

if [ ! -d "$DIST" ]; then
  echo "Error: $DIST not found. Run 'npm run build:safari' first."
  exit 1
fi

if command -v xcrun &> /dev/null; then
  xcrun safari-web-extension-converter \
    --bundle-identifier com.bookmarksync.extension \
    --force \
    "$DIST"

  echo "Safari Xcode project created at $XCODE_OUT"
  echo "Open the project in Xcode to build and archive."
else
  echo "Warning: xcrun not found (not on macOS?). Skipping Safari conversion."
  echo "The extension at $DIST is ready but needs to be converted on a Mac."
fi
