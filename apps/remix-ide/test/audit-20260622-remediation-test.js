/*
 * Static regression tests for the 2026-06-22 security-header remediation.
 *
 * Context: the production target is GitHub Pages, which cannot emit response
 * headers, so the <meta> CSP in index.html is the only CSP a GitHub-Pages
 * visitor receives. The CSP / clickjacking headers are therefore declared in
 * five places that must not drift:
 *   - apps/remix-ide/nginx.conf           (Docker image, response header)
 *   - build.sh `_headers`                 (Cloudflare Pages / Netlify, response header)
 *   - apps/remix-ide/webpack.config.js    (dev-server, response header)
 *   - apps/remix-ide/src/index.html       (<meta> fallback)
 *   - apps/remix-ide/src/webpack.index.html (<meta> fallback)
 *
 * The four "response header" sources carry the full policy; the two <meta>
 * sources carry the same policy minus `frame-ancestors`, which browsers ignore
 * in a <meta> tag. These tests pin that contract so a future edit to one source
 * fails CI unless every source is updated together.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')

var root = path.join(__dirname, '..', '..', '..')

function readRoot (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function readIdeSource (relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', 'src', relativePath), 'utf8')
}

// The single source of truth this test enforces. Keep ordered exactly as the
// directives appear in webpack.config.js's CONTENT_SECURITY_POLICY array.
var CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://kit.fontawesome.com https://www.googletagmanager.com https://www.google-analytics.com https://tronprotocol.github.io https://binaries.soliditylang.org",
  "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://use.fontawesome.com https://*.fontawesome.com",
  "font-src 'self' data: https://use.fontawesome.com https://*.fontawesome.com https://cdnjs.cloudflare.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https: wss:",
  "frame-src 'self' http://localhost:* https:",
  "worker-src 'self' blob:",
  "form-action 'self'"
]
var FRAME_ANCESTORS = "frame-ancestors 'self'"

var FULL_POLICY = CSP_DIRECTIVES.concat([FRAME_ANCESTORS]).join('; ')
var META_POLICY = CSP_DIRECTIVES.join('; ')

function metaCspContent (html) {
  var match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)
  return match ? match[1] : null
}

test('every CSP directive is present and identical across all five sources', function (t) {
  var indexHtml = metaCspContent(readIdeSource('index.html'))
  var webpackIndexHtml = metaCspContent(readIdeSource('webpack.index.html'))
  var nginxConfig = readRoot('apps/remix-ide/nginx.conf')
  var buildSh = readRoot('build.sh')
  var webpackConfig = readRoot('apps/remix-ide/webpack.config.js')

  // <meta> sources must equal the full policy minus the header-only directive.
  t.equal(indexHtml, META_POLICY, 'index.html <meta> CSP matches the canonical policy (no frame-ancestors)')
  t.equal(webpackIndexHtml, META_POLICY, 'webpack.index.html <meta> CSP matches the canonical policy (no frame-ancestors)')

  // Response-header sources must carry the full policy, including frame-ancestors.
  t.ok(nginxConfig.indexOf(FULL_POLICY) !== -1, 'nginx.conf carries the full canonical policy incl. frame-ancestors')
  t.ok(buildSh.indexOf(FULL_POLICY) !== -1, 'build.sh _headers carries the full canonical policy incl. frame-ancestors')

  // webpack builds the policy from the array, so assert each directive is a literal entry.
  CSP_DIRECTIVES.concat([FRAME_ANCESTORS]).forEach(function (directive) {
    t.ok(webpackConfig.indexOf('"' + directive + '"') !== -1, 'webpack.config.js declares directive: ' + directive)
  })

  // Guard the regression that motivated this remediation: the analytics /
  // fontawesome-kit script hosts must be in the <meta> CSP, not just the header.
  ;['https://kit.fontawesome.com', 'https://www.googletagmanager.com', 'https://www.google-analytics.com'].forEach(function (host) {
    t.ok(indexHtml.indexOf(host) !== -1, 'index.html <meta> script-src allows ' + host)
  })

  t.end()
})

test('frame-ancestors is a response-header-only directive (absent from <meta> fallbacks)', function (t) {
  t.equal(metaCspContent(readIdeSource('index.html')).indexOf(FRAME_ANCESTORS), -1, 'index.html <meta> omits frame-ancestors (browsers ignore it there)')
  t.equal(metaCspContent(readIdeSource('webpack.index.html')).indexOf(FRAME_ANCESTORS), -1, 'webpack.index.html <meta> omits frame-ancestors')
  t.end()
})

test('clickjacking / sniffing headers are sent by every response-header source', function (t) {
  var nginxConfig = readRoot('apps/remix-ide/nginx.conf')
  var buildSh = readRoot('build.sh')
  var webpackConfig = readRoot('apps/remix-ide/webpack.config.js')

  t.ok(/add_header X-Frame-Options "SAMEORIGIN" always/.test(nginxConfig), 'nginx sends X-Frame-Options: SAMEORIGIN')
  t.ok(/add_header X-Content-Type-Options "nosniff" always/.test(nginxConfig), 'nginx sends X-Content-Type-Options: nosniff')

  t.ok(/X-Frame-Options:\s*SAMEORIGIN/.test(buildSh), 'build.sh _headers sends X-Frame-Options: SAMEORIGIN')
  t.ok(/X-Content-Type-Options:\s*nosniff/.test(buildSh), 'build.sh _headers sends X-Content-Type-Options: nosniff')

  t.ok(/'X-Frame-Options':\s*'SAMEORIGIN'/.test(webpackConfig), 'dev-server sends X-Frame-Options: SAMEORIGIN')
  t.ok(/'X-Content-Type-Options':\s*'nosniff'/.test(webpackConfig), 'dev-server sends X-Content-Type-Options: nosniff')

  t.end()
})

test('both Dockerfiles install the hardened nginx.conf', function (t) {
  // Production image (built from the apps/remix-ide context, see build.yaml).
  var appDockerfile = readRoot('apps/remix-ide/Dockerfile')
  t.ok(/COPY\s+\.\/nginx\.conf\s+\/etc\/nginx\/nginx\.conf/.test(appDockerfile), 'apps/remix-ide/Dockerfile copies ./nginx.conf into the image')

  // Root mirror (built from the repo-root context).
  var rootDockerfile = readRoot('Dockerfile')
  t.ok(/COPY\s+\.\/apps\/remix-ide\/nginx\.conf\s+\/etc\/nginx\/nginx\.conf/.test(rootDockerfile), 'root Dockerfile copies ./apps/remix-ide/nginx.conf into the image')

  t.end()
})
