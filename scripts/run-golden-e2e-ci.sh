#!/usr/bin/env bash

set -euo pipefail

pnpm install --frozen-lockfile
pnpm downloadsolc_assets

export CHROME_BIN="$(node -p "require('@playwright/test').chromium.executablePath()")"
"$CHROME_BIN" --version

pnpm lint:compiler-source
ALLOW_REMIX_IDE_ENTRY_MISMATCH=1 pnpm lint:remix-ide-entry
pnpm e2e:golden
