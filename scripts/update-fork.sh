#!/usr/bin/env bash
# Update the personal "T3 Code (Fork)" app to a newer upstream release.
# Usage: scripts/update-fork.sh [vX.Y.Z]   (default: latest upstream stable release)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
BRANCH="handoff-mutagen"
APP_ID="com.t3tools.t3code.fork"
APP_NAME="T3 Code (Fork)"
FORK_HOME="$HOME/.t3-fork"
CONFIG="$FORK_HOME/fork-update.json"
DIST="$REPO/t3code-dist-fork"

TAG="${1:-$(gh api repos/pingdotgg/t3code/releases/latest --jq .tag_name)}"
echo "==> Updating fork to $TAG"

[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "Uncommitted changes in $REPO; commit or stash first."; exit 1; }
git fetch upstream --tags
git checkout "$BRANCH"
BACKUP="$BRANCH-before-$TAG"
git branch -f "$BACKUP" "$BRANCH"
echo "==> Rebasing $BRANCH onto $TAG (backup branch: $BACKUP)"
if ! git rebase "$TAG"; then
  echo
  echo "Rebase hit conflicts. Fix them (or ask Claude), then run: git rebase --continue && scripts/update-fork.sh $TAG"
  echo "To give up: git rebase --abort"
  exit 1
fi

echo "==> Installing dependencies and building"
pnpm install --frozen-lockfile || pnpm install
rm -rf "$DIST"
T3CODE_DESKTOP_APP_ID="$APP_ID" T3CODE_DESKTOP_PRODUCT_NAME="$APP_NAME" T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR=true \
  node_modules/.bin/vp run dist:desktop:dmg:arm64 --output-dir "$DIST"

echo "==> Installing"
STAGE="$(mktemp -d)"
ditto -x -k "$DIST"/T3-Code-*-arm64.zip "$STAGE"
APP="$STAGE/$APP_NAME.app"
PB=/usr/libexec/PlistBuddy
$PB -c "Delete :LSEnvironment:T3CODE_HOME" "$APP/Contents/Info.plist" 2>/dev/null || true
$PB -c "Add :LSEnvironment dict" "$APP/Contents/Info.plist" 2>/dev/null || true
$PB -c "Add :LSEnvironment:T3CODE_HOME string $FORK_HOME" \
    -c "Add :LSEnvironment:T3CODE_USER_DATA_NAME string t3code-fork" \
    -c "Add :LSEnvironment:T3CODE_FORK_UPDATE_CONFIG string $CONFIG" "$APP/Contents/Info.plist"
codesign --force --deep --sign - "$APP"

osascript -e "tell application id \"$APP_ID\" to quit" 2>/dev/null || true
for _ in $(seq 1 30); do pgrep -f "$APP_NAME.app/Contents/MacOS" >/dev/null || break; sleep 1; done
rm -rf "/Applications/$APP_NAME.app"
ditto "$APP" "/Applications/$APP_NAME.app"
xattr -cr "/Applications/$APP_NAME.app"
rm -rf "$STAGE"

printf '{"repo":"%s","installedTag":"%s","upstream":"pingdotgg/t3code"}\n' "$REPO" "$TAG" > "$CONFIG"
echo "==> Done. Opening $APP_NAME"
open -n "/Applications/$APP_NAME.app"
