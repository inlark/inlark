#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
runtime="${CONTAINER_RUNTIME:-podman}"
image="localhost/inlark-deb-smoke:bookworm"
"$runtime" build -t "$image" -f scripts/Containerfile.smoke scripts
"$runtime" run --rm --network=none -v "$PWD/apps/desktop/release:/release:ro" "$image"
