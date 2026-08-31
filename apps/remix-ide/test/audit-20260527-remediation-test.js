/*
 * Static regression tests for 2026-05-27 audit remediation.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')

function readRoot (relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', relativePath), 'utf8')
}

function readIdeSource (relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', 'src', relativePath), 'utf8')
}

function pathExists (relativePath) {
  return fs.existsSync(path.join(__dirname, '..', '..', '..', relativePath))
}

// The browser keeps only a TronIDE BFF session handle. GitHub's access token
// stays encrypted server-side and must never enter frontend storage or state.
test('GitHub access uses only an opaque tab-scoped BFF session', function (t) {
  const source = readIdeSource('app/ui/landing-page/landing-page.js')
  const authSource = readIdeSource('lib/github-auth.js')
  const bffSource = readIdeSource('lib/github-bff.js')
  const oauthSource = readIdeSource('lib/github-oauth.js')

  t.notOk(/localStorage\.setItem\('tronide\.github\.token'/.test(source + authSource), 'GitHub token is never written to localStorage')
  t.notOk(/const TOKEN_KEY|function getToken|function setToken/.test(authSource), 'frontend token store API is removed')
  t.ok(/const SESSION_KEY = 'tronide\.github\.session'/.test(authSource), 'only a TronIDE BFF session key is persisted')
  t.ok(/githubAuth\.isConnected\(\)/.test(source), 'Home renders from BFF session state')
  t.ok(/githubRepositoryRequest\(path, options\)/.test(source), 'Home routes GitHub REST calls through the BFF')
  t.notOk(/https:\/\/api\.github\.com/.test(source), 'Home never calls GitHub REST directly')
  t.ok(/X-TronIDE-Session/.test(bffSource), 'BFF requests use the opaque TronIDE session header')
  t.notOk(/Authorization|Bearer/.test(bffSource), 'BFF client never creates a GitHub Authorization header')
  t.notOk(/clientId|authorizeUrl|scope:/.test(oauthSource), 'OAuth client id, scopes, and authorize URL are server-owned')
  t.notOk(/d\.token|\{ token/.test(oauthSource), 'OAuth popup never consumes or resolves a GitHub token')
  t.ok(/localStorage\.removeItem\('tronide\.github\.token'\)/.test(source), 'startup and disconnect scrub the legacy localStorage token entry')
  t.notOk(/Connect token \(PAT\)|promptPassphrase\('Connect with a GitHub token'/.test(source), 'browser PAT entry is removed')
  t.ok(/sanitizeGithubError/.test(source), 'GitHub error messages flow through a sanitizer before reaching the UI')
  t.ok(/\[redacted\]/.test(source), 'sanitizer redacts token-shaped substrings')
  t.end()
})

test('GitHub URL parsing rejects path traversal and import/commit assert workspace scope', function (t) {
  const source = readIdeSource('app/ui/landing-page/landing-page.js')

  t.ok(/assertSafeGithubRepoPath/.test(source), 'assertSafeGithubRepoPath helper is defined')
  t.ok(/Invalid GitHub file path/.test(source), 'assertSafeGithubRepoPath rejects unsafe paths with a documented error')
  t.ok(/segment === '\.\.'|segment === "\.\."/.test(source), 'assertSafeGithubRepoPath rejects \'..\' segments explicitly')
  t.ok(/segment === '\.'|segment === "\."/.test(source), 'assertSafeGithubRepoPath rejects single-dot segments explicitly')
  t.ok(/!localPath\.startsWith\(`github\/\$\{safeOwner\}\/\$\{safeRepo\}\/`\)/.test(source), 'importGithubFileWithToken double-checks the constructed localPath stays under github/<owner>/<repo>/')
  t.ok(/Refusing to write outside the github\/<owner>\/<repo>\/ folder/.test(source), 'localPath guard explains why the write was refused')
  t.end()
})

test('Empty catch blocks now emit diagnostics in contract-verification plugin and home workflow', function (t) {
  const verificationSource = readIdeSource('app/tabs/contract-verification-tab.js')
  const landingSource = readIdeSource('app/ui/landing-page/landing-page.js')

  t.notOk(/catch \(error\) \{\}/.test(verificationSource), 'contract verification plugin no longer swallows errors silently')
  t.ok(/console\.debug\('\[contractVerification\]/.test(verificationSource), 'contract verification plugin emits namespaced debug diagnostics')
  t.notOk(/catch \(error\) \{\}/.test(landingSource), 'home landing page no longer swallows errors silently')
  t.ok(/console\.debug\('\[home\]/.test(landingSource), 'home landing page emits namespaced debug diagnostics')
  t.ok(/error\.status && error\.status !== 404/.test(landingSource), 'GitHub commit distinguishes 404 (new file) from real auth/permission errors')
  t.end()
})

test('TRC10 simulator path normalizes inputs through BN-aware validator without Number()', function (t) {
  const source = readRoot('libs/remix-lib/src/execution/runtimeFacade.ts')

  t.notOk(/Number\(input\.tokenId/.test(source), 'runtimeFacade no longer converts tokenId through Number()')
  t.notOk(/Number\(input\.tokenValue/.test(source), 'runtimeFacade no longer converts tokenValue through Number()')
  t.notOk(/as any/.test(source), 'runtimeFacade no longer needs an any-cast for TRC10 inputs')
  t.ok(/validateTrc10Inputs\(input\.tokenId \|\| 0, input\.tokenValue \|\| 0\)/.test(source), 'runtimeFacade passes inputs straight to the BN-aware validator')
  t.end()
})

test('legacy unguarded compiler worker has been removed and ES worker remains hardened', function (t) {
  t.notOk(pathExists('libs/remix-solidity/src/compiler/compiler-worker.ts'), 'legacy libs/remix-solidity/src/compiler/compiler-worker.ts is gone')
  const esWorker = readRoot('libs/remix-solidity/src/lib/es-web-worker/compiler-worker.ts')
  t.ok(/assertAllowedCompilerURL/.test(esWorker), 'ES worker still validates compiler URL via assertAllowedCompilerURL')
  t.end()
})

test('patched vulnerable dependencies are pinned in package.json and gist handler does not use deprecated request', function (t) {
  const packageJson = JSON.parse(readRoot('package.json'))
  const lockfile = readRoot('pnpm-lock.yaml')
  const handlerSource = readRoot('apps/remix-ide/src/lib/gist-handler.js')

  t.equal(packageJson.dependencies['js-cookie'], '3.0.7', 'js-cookie is bumped past CVE-2026-46625 (HIGH)')
  t.equal(packageJson.dependencies.qs, '6.15.2', 'qs is bumped past CVE-2026-8723 (MODERATE)')
  t.equal(packageJson.pnpm.overrides.qs, '6.15.2', 'qs override is bumped past CVE-2026-8723')
  t.equal(packageJson.pnpm.overrides.tmp, '0.2.7', 'tmp override is pinned to 0.2.7, clearing CVE-2026-44705 (HIGH) and CVE-2025-54798 (LOW)')
  t.equal(packageJson.pnpm.overrides['js-cookie'], '3.0.7', 'js-cookie override is added to enforce the patched version across transitives')
  t.notOk(packageJson.dependencies.request, 'deprecated request is not a runtime dependency')
  t.notOk(packageJson.devDependencies.request, 'deprecated request is not a dev dependency either')
  t.ok(/js-cookie@3\.0\.7:/.test(lockfile), 'lockfile resolves js-cookie@3.0.7')
  t.ok(/qs@6\.15\.2:/.test(lockfile), 'lockfile resolves qs@6.15.2')
  t.ok(/tmp@0\.2\.7:/.test(lockfile), 'lockfile resolves tmp@0.2.7')
  t.notOk(/require\(['"]request['"]\)/.test(handlerSource), 'gist-handler.js no longer imports the deprecated request module')
  t.ok(/githubBff\.githubRequest/.test(handlerSource), 'authenticated gist requests use the BFF')
  t.ok(/window\.fetch/.test(handlerSource), 'anonymous and raw gist content still use window.fetch')
  t.ok(/redirect:\s*'error'/.test(handlerSource), 'gist-handler.js disables cross-host redirects so CVE-2023-28155-style SSRF is not reachable through this path')
  t.end()
})
