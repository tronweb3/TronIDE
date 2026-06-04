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

test('GitHub PAT is kept in sessionStorage only and legacy localStorage copies are scrubbed', function (t) {
  const source = readIdeSource('app/ui/landing-page/landing-page.js')

  t.notOk(/localStorage\.setItem\('tronide\.github\.token'/.test(source), 'GitHub token is never written to localStorage')
  t.notOk(/localStorage\.setItem\('tronide\.github\.user'/.test(source), 'GitHub user metadata is never written to localStorage')
  t.ok(/sessionStorage\.setItem\('tronide\.github\.token'/.test(source), 'GitHub token is still saved in sessionStorage for the current tab')
  t.ok(/localStorage\.removeItem\('tronide\.github\.token'\)/.test(source), 'startup and disconnect scrub the legacy localStorage token entry')
  t.ok(/localStorage\.removeItem\('tronide\.github\.user'\)/.test(source), 'startup and disconnect scrub the legacy localStorage user entry')
  t.notOk(/id="githubTokenRemember"/.test(source), 'the "Remember in this browser" checkbox has been removed from the Connect Token modal')
  t.ok(/Tokens stay in this browser tab only/.test(source), 'Connect Token modal advertises tab-only storage')
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
  t.equal(packageJson.pnpm.overrides.tmp, '0.2.6', 'tmp override is added to clear CVE-2026-44705 (HIGH) and CVE-2025-54798 (LOW)')
  t.equal(packageJson.pnpm.overrides['js-cookie'], '3.0.7', 'js-cookie override is added to enforce the patched version across transitives')
  t.notOk(packageJson.dependencies.request, 'deprecated request is not a runtime dependency')
  t.notOk(packageJson.devDependencies.request, 'deprecated request is not a dev dependency either')
  t.ok(/js-cookie@3\.0\.7:/.test(lockfile), 'lockfile resolves js-cookie@3.0.7')
  t.ok(/qs@6\.15\.2:/.test(lockfile), 'lockfile resolves qs@6.15.2')
  t.ok(/tmp@0\.2\.6:/.test(lockfile), 'lockfile resolves tmp@0.2.6')
  t.notOk(/require\(['"]request['"]\)/.test(handlerSource), 'gist-handler.js no longer imports the deprecated request module')
  t.ok(/window\.fetch/.test(handlerSource), 'gist-handler.js fetches gists via window.fetch')
  t.ok(/redirect:\s*'error'/.test(handlerSource), 'gist-handler.js disables cross-host redirects so CVE-2023-28155-style SSRF is not reachable through this path')
  t.end()
})
