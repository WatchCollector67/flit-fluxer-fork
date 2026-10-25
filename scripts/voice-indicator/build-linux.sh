#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail

repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
command -v pnpm >/dev/null || { echo 'Install the pnpm version pinned in package.json first.' >&2; exit 1; }
command -v cargo >/dev/null || { echo 'Install Rust/Cargo with the wasm32-unknown-unknown target first.' >&2; exit 1; }
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-6}"
export CARGO_PROFILE_DEV_DEBUG="${CARGO_PROFILE_DEV_DEBUG:-0}"
cd -- "$repo"
exec pnpm dev:desktop:build "$@"
