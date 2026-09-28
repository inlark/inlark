#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm build
if [[ -f /etc/os-release ]] && (source /etc/os-release && [[ "${ID:-}" == nixos ]]); then
  nix shell github:NixOS/nixpkgs/6774f7bc253789b113a4f39285dc0fa100abeacc#fpm \
    github:NixOS/nixpkgs/6774f7bc253789b113a4f39285dc0fa100abeacc#rpm \
    --command env USE_SYSTEM_FPM=true pnpm --filter @inlark/desktop package:linux
else
  pnpm --filter @inlark/desktop package:linux
fi
