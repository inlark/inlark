#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./apps/desktop/package.json').version")
directory=apps/desktop/release/linux-unpacked
test -x "$directory/inlark"
test -f "$directory/resources/app.asar"
install -m644 LICENSE "$directory/resources/LICENSE.inlark"
tar -czf "apps/desktop/release/Inlark-$version-x64.tar.gz" -C apps/desktop/release linux-unpacked
node scripts/prepare-flatpak.mjs "$version" "apps/desktop/release/Inlark-$version-x64.tar.gz"
