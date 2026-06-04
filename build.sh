#!/bin/bash
set -euo pipefail

rm -rf dist

npm run downloadsolc_assets

npx nx build remix-ide --configuration=production --with-deps

# Newer webpack configs emit index.html directly; only copy from the legacy
# webpack.index.html when it exists so the build does not fail on the missing file.
if [ -f ./build/apps/remix-ide/webpack.index.html ]; then
  cp ./build/apps/remix-ide/webpack.index.html ./build/apps/remix-ide/index.html
fi

# Cloudflare Pages SPA fallback for deep links and browser refreshes.
echo '/* /index.html 200' > ./build/apps/remix-ide/_redirects
