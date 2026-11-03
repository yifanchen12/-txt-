#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != "Darwin" ]]; then echo "Requires macOS and Xcode" >&2; exit 1; fi
for cmd in xcodebuild xcrun node npm; do command -v "$cmd" >/dev/null || { echo "Missing $cmd" >&2; exit 1; }; done
if [[ -z "${APPLE_TEAM_ID:-}" ]]; then echo "Set APPLE_TEAM_ID to your 10-character Apple Development Team ID" >&2; exit 1; fi
if [[ ! "$APPLE_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]]; then echo "Invalid APPLE_TEAM_ID format" >&2; exit 1; fi
BUNDLE_ID="${IOS_BUNDLE_ID:-io.github.yifanchen12.novelarchive}"
if [[ ! "$BUNDLE_ID" =~ ^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$ ]]; then echo "Invalid IOS_BUNDLE_ID" >&2; exit 1; fi
MODE="${1:-build}"
if [[ "$MODE" != "build" && "$MODE" != "install" ]]; then echo "Usage: npm run ios:device -- [build|install]" >&2; exit 1; fi
if [[ "$MODE" == "install" && -z "${IOS_DEVICE_ID:-}" ]]; then
  echo "Set IOS_DEVICE_ID to the connected iPhone UDID (xcrun devicectl list devices)" >&2; exit 1
fi
xcodebuild -version
npm run build
if [[ ! -d ios/App ]]; then npx cap add ios; fi
npx cap sync ios
node scripts/prepare-native.mjs
WORKSPACE="ios/App/App.xcworkspace"
[[ -d "$WORKSPACE" ]] || { echo "Missing $WORKSPACE" >&2; exit 1; }
DERIVED_DATA="${IOS_DERIVED_DATA:-$PWD/.ios-derived-data}"
DESTINATION="generic/platform=iOS"
if [[ "$MODE" == "install" ]]; then DESTINATION="platform=iOS,id=$IOS_DEVICE_ID"; fi
xcodebuild -workspace "$WORKSPACE" -scheme App -configuration Debug \
  -destination "$DESTINATION" -derivedDataPath "$DERIVED_DATA" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CODE_SIGN_STYLE=Automatic \
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" build
APP="$DERIVED_DATA/Build/Products/Debug-iphoneos/App.app"
[[ -d "$APP" ]] || { echo "Built app missing: $APP" >&2; exit 1; }
echo "Signed build: $APP"
if [[ "$MODE" == "install" ]]; then
  xcrun devicectl device install app --device "$IOS_DEVICE_ID" "$APP"
  echo "Installed $BUNDLE_ID; open it on the iPhone to test."
fi
