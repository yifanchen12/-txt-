#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

usage() {
  echo "Usage: npm run ios:device -- [setup|build|install]"
}
MODE="${1:-install}"
if [[ $# -gt 1 ]] || [[ "$MODE" != "setup" && "$MODE" != "build" && "$MODE" != "install" ]]; then usage >&2; exit 2; fi
if [[ "$(uname -s)" != "Darwin" ]]; then echo "Requires macOS with full Xcode" >&2; exit 1; fi
for cmd in xcodebuild xcrun node npm; do command -v "$cmd" >/dev/null || { echo "Missing $cmd" >&2; exit 1; }; done

valid_team() { [[ "$1" =~ ^[A-Z0-9]{10}$ ]]; }
valid_bundle() { [[ "$1" =~ ^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$ ]]; }
valid_device() { [[ "$1" =~ ^[A-Za-z0-9-]{8,128}$ ]]; }

if [[ "$MODE" == "setup" ]]; then
  echo "Find your Team ID in Xcode > Settings > Accounts."
  read -r -p "Apple Team ID (10 characters): " team
  valid_team "$team" || { echo "Invalid Apple Team ID" >&2; exit 1; }
  echo "Available devices:"
  xcrun devicectl list devices
  read -r -p "iPhone ID (from list above): " device
  valid_device "$device" || { echo "Invalid device ID" >&2; exit 1; }
  read -r -p "Bundle Identifier [io.github.yifanchen12.novelarchive]: " bundle
  bundle="${bundle:-io.github.yifanchen12.novelarchive}"
  valid_bundle "$bundle" || { echo "Invalid Bundle Identifier" >&2; exit 1; }
  umask 077
  printf 'APPLE_TEAM_ID=%s\nIOS_DEVICE_ID=%s\nIOS_BUNDLE_ID=%s\n' \
    "$team" "$device" "$bundle" > .ios-device.env
  echo "Saved .ios-device.env (ignored by Git)."
  exit 0
fi

# Only consume known key=value entries, not arbitrary shell commands.
if [[ -f .ios-device.env ]]; then
  while IFS='=' read -r key value || [[ -n "$key" ]]; do
    case "$key" in
      APPLE_TEAM_ID) APPLE_TEAM_ID="${APPLE_TEAM_ID:-$value}" ;;
      IOS_DEVICE_ID) IOS_DEVICE_ID="${IOS_DEVICE_ID:-$value}" ;;
      IOS_BUNDLE_ID) IOS_BUNDLE_ID="${IOS_BUNDLE_ID:-$value}" ;;
    esac
  done < .ios-device.env
fi
if ! valid_team "${APPLE_TEAM_ID:-}"; then echo "Missing/invalid APPLE_TEAM_ID; run npm run ios:device -- setup" >&2; exit 1; fi
BUNDLE_ID="${IOS_BUNDLE_ID:-io.github.yifanchen12.novelarchive}"
valid_bundle "$BUNDLE_ID" || { echo "Invalid IOS_BUNDLE_ID" >&2; exit 1; }
if [[ "$MODE" == "install" ]]; then
  valid_device "${IOS_DEVICE_ID:-}" || { echo "Missing/invalid IOS_DEVICE_ID; run npm run ios:device -- setup" >&2; exit 1; }
fi

xcodebuild -version
npm run build
if [[ ! -d ios/App ]]; then npx cap add ios; fi
npx cap sync ios
node scripts/prepare-native.mjs

# Capacitor 8 often generates an SPM project, while CocoaPods uses a workspace.
if [[ -d ios/App/App.xcworkspace ]]; then
  PROJECT_ARGS=(-workspace ios/App/App.xcworkspace)
elif [[ -d ios/App/App.xcodeproj ]]; then
  PROJECT_ARGS=(-project ios/App/App.xcodeproj)
else
  echo "No generated iOS Xcode project found" >&2
  exit 1
fi
DERIVED_DATA="${IOS_DERIVED_DATA:-$PWD/.ios-derived-data}"
DESTINATION="generic/platform=iOS"
if [[ "$MODE" == "install" ]]; then DESTINATION="platform=iOS,id=$IOS_DEVICE_ID"; fi
xcodebuild "${PROJECT_ARGS[@]}" -scheme App -configuration Debug \
  -destination "$DESTINATION" -derivedDataPath "$DERIVED_DATA" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CODE_SIGN_STYLE=Automatic \
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" build
APP="$DERIVED_DATA/Build/Products/Debug-iphoneos/App.app"
[[ -d "$APP" ]] || { echo "Expected signed application not found: $APP" >&2; exit 1; }
codesign --verify "$APP"
echo "Verified signed development build: $APP"
if [[ "$MODE" == "install" ]]; then
  xcrun devicectl device install app --device "$IOS_DEVICE_ID" "$APP"
  echo "Installation succeeded for $BUNDLE_ID; now test on the iPhone."
fi
