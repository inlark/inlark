#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
id=com.inlark.Inlark
if [[ $# -gt 0 ]]; then
  bundle=$1
else
  version=$(node -p "require('./apps/desktop/package.json').version")
  bundle="apps/desktop/release/Inlark-$version-x64.flatpak"
fi
flatpak install --user --noninteractive --assumeyes --reinstall "$(realpath "$bundle")"
# Use a disposable directory inside the sandbox: never read real account data.
# Zypak provides Chromium's sandbox; the test keeps it enabled.
env -u WAYLAND_DISPLAY -u ELECTRON_RUN_AS_NODE xvfb-run -a timeout 90 dbus-run-session -- flatpak run --user --branch=stable \
  --unset-env=FONTCONFIG_FILE --unset-env=FONTCONFIG_PATH \
  --env=INLARK_DATA_DIR=/tmp/inlark-flatpak-smoke \
  "$id" --smoke-test --ozone-platform=x11 --disable-gpu
