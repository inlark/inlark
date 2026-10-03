#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $(uname -m) != x86_64 ]]; then
  echo 'Flatpak packaging currently supports x86_64 Linux.' >&2
  exit 1
fi
command -v flatpak >/dev/null
command -v flatpak-builder >/dev/null
pnpm build
pnpm --filter @inlark/desktop exec electron-builder --linux dir --x64 --publish never
bash scripts/flatpak-archive.sh
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak-builder --user --force-clean --disable-rofiles-fuse --install-deps-from=flathub --repo=apps/desktop/release/flatpak/repo \
  --default-branch=stable apps/desktop/release/flatpak/build \
  apps/desktop/release/flatpak/local/com.inlark.Inlark.json
version=$(node -p "require('./apps/desktop/package.json').version")
flatpak build-bundle --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo \
  apps/desktop/release/flatpak/repo "apps/desktop/release/Inlark-$version-x64.flatpak" \
  com.inlark.Inlark stable
