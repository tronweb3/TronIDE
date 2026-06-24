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

# Security response headers for static hosting (Cloudflare Pages / Netlify read
# this `_headers` file). Delivering the Content-Security-Policy as a *response
# header* is more robust than the <meta> CSP in index.html and is the only way
# to honour header-only directives such as `frame-ancestors`.
#
# Keep this policy in sync with:
#   - the <meta http-equiv="Content-Security-Policy"> in apps/remix-ide/src/index.html
#   - the `add_header Content-Security-Policy` in apps/remix-ide/nginx.conf
#   - CONTENT_SECURITY_POLICY in apps/remix-ide/webpack.config.js (dev-server)
#
# NOTE: GitHub Pages (the current Deploy workflow target) ignores `_headers`.
# When served from GitHub Pages only the <meta> CSP applies; to get the
# response-header CSP in prod, deploy behind Cloudflare Pages / Netlify / the
# nginx image, or set the header at the CDN/gateway.
cat > ./build/apps/remix-ide/_headers <<'EOF'
/*
  Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://kit.fontawesome.com https://www.googletagmanager.com https://www.google-analytics.com https://tronprotocol.github.io https://binaries.soliditylang.org; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://use.fontawesome.com https://*.fontawesome.com; font-src 'self' data: https://use.fontawesome.com https://*.fontawesome.com https://cdnjs.cloudflare.com; img-src 'self' data: blob: https:; connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https: wss:; frame-src 'self' http://localhost:* https:; worker-src 'self' blob:; form-action 'self'; frame-ancestors 'self'
  X-Frame-Options: SAMEORIGIN
  X-Content-Type-Options: nosniff
EOF
