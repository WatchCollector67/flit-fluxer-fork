#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail

repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
desktop="$repo/fluxer_desktop"

node - "$desktop/dist/build-info.json" <<'JS'
const fs = require('node:fs');
const info = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (info.buildChannel !== 'development' || !info.offlineBuild || info.modulesEnabled) {
	throw new Error('Expected a development-channel desktop build with a locally bundled renderer.');
}
JS

export FLUXER_OFFLINE=1
export CHROME_DESKTOP=app.fluxer.FluxerDesktopDevelopment.desktop
unset ELECTRON_RUN_AS_NODE
cd -- "$desktop"
exec "$desktop/node_modules/.bin/electron" . "$@"
