#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if [ ! -f node_modules/ethers/package.json ]; then npm ci --omit=dev --ignore-scripts --no-audit --no-fund; fi
exec node server.mjs
