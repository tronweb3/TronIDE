/*
 * Build and release-script regression tests.
 *
 * These tests deliberately avoid AWS, GPG, nginx, and a production build. They
 * pin the fail-closed contracts that can be checked safely in every checkout.
 */

'use strict'

var crypto = require('crypto')
var fs = require('fs')
var os = require('os')
var path = require('path')
var spawnSync = require('child_process').spawnSync
var test = require('tape')

var root = path.resolve(__dirname, '../../..')

function readRoot (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function testWithFiles (name, relativePaths, callback) {
  test(name, function (t) {
    var missing = relativePaths.filter(function (relativePath) {
      return !fs.existsSync(path.join(root, relativePath))
    })
    if (missing.length > 0) {
      t.comment('skipped because this public mirror excludes: ' + missing.join(', '))
      t.end()
      return
    }
    callback(t)
  })
}

testWithFiles('release archives use the intended development suffix', ['.gitlab-ci-base.yml', 'scripts/publish.sh'], function (t) {
  var ci = readRoot('.gitlab-ci-base.yml')
  var publish = readRoot('scripts/publish.sh')

  t.ok(ci.indexOf('"${BUILD_CMD}:${short_sha}_dev.zip"') !== -1, 'GitLab build creates a development archive with the short SHA')
  t.ok(ci.indexOf('"${BUILD_CMD}:${short_sha}.zip"') !== -1, 'GitLab build creates the release archive with the short SHA')
  t.notOk(/\$short_sha_dev|\$version_dev/.test(ci + publish), 'ambiguous shell variable names are not used')
  t.ok(/source_archive="\$\{ORIGIN_NAME\}:\$\{version\}_dev\.zip"/.test(publish), 'publish downloads the development archive')
  t.ok(publish.indexOf('archive_version') !== -1 && publish.indexOf('Downloaded archive SHA mismatch') !== -1, 'publish rejects an archive whose embedded SHA does not match the requested version')
  t.end()
})

testWithFiles('all release jobs use one fixed short SHA', ['.gitlab-ci-base.yml'], function (t) {
  var ci = readRoot('.gitlab-ci-base.yml')
  var fixedSha = 'short_sha="${CI_COMMIT_SHORT_SHA:-$(git rev-parse --short=8 HEAD)}"'

  t.equal((ci.match(new RegExp(fixedSha.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 3, 'build, deploy, and publish use the GitLab fixed short SHA')
  t.notOk(ci.indexOf('git rev-parse --short "$CI_COMMIT_SHA"') !== -1, 'release jobs do not depend on runner-specific Git abbreviation settings')
  t.end()
})

testWithFiles('deployment scripts use strict Bash entrypoints', ['scripts/deploy.sh', 'scripts/publish.sh', 'scripts/fetch.sh'], function (t) {
  ;['scripts/deploy.sh', 'scripts/publish.sh', 'scripts/fetch.sh'].forEach(function (relativePath) {
    var source = readRoot(relativePath)
    t.ok(source.indexOf('#!/usr/bin/env bash') === 0, relativePath + ' has a portable Bash shebang')
    t.ok(source.indexOf('set -euo pipefail') !== -1, relativePath + ' enables fail-closed shell behavior')
  })
  t.end()
})

testWithFiles('publish only requires commands used by the test runner', ['scripts/publish.sh'], function (t) {
  var publish = readRoot('scripts/publish.sh')

  t.notOk(/for command_name in [^\n]*python3/.test(publish), 'publish does not require the unavailable python3 command')
  t.ok(publish.indexOf('python3') === -1, 'publish has no hidden python3 dependency')
  t.end()
})

testWithFiles('test deployment has an explicit unsigned-signing fallback', ['.gitlab-ci.yml', 'scripts/deploy.sh'], function (t) {
  var ci = readRoot('.gitlab-ci.yml')
  var deploy = readRoot('scripts/deploy.sh')

  t.ok(/deploy_main:[\s\S]*?ALLOW_UNSIGNED_TEST_DEPLOY:\s*['"]1['"]/.test(ci), 'test deploy explicitly opts into the unsigned fallback')
  t.ok(deploy.indexOf('GPG_PRIVATE_KEY_FILE') !== -1 && deploy.indexOf('GPG_PRIVATE_KEY') !== -1, 'deploy can import a provisioned private key without storing it in the repository')
  t.ok(deploy.indexOf('GPG_SIGNING_KEY') !== -1, 'deploy allows the signing fingerprint to be configured')
  t.ok(/if \[\[ -n "\$tag" \|\| "\$allow_unsigned_test" != "1" \]\]/.test(deploy), 'deploy refuses unsigned tagged or non-opted-in releases')
  t.ok(deploy.indexOf('continuing explicitly unsigned test deployment') !== -1, 'unsigned test deployment is clearly marked in the job log')
  t.ok(/zip_inputs=\("\$renamed_archive"\)/.test(deploy), 'unsigned packages contain the build archive')
  t.ok(deploy.indexOf('if [[ "$renamed_archive" != "$source_archive" ]]') !== -1, 'untagged deployments do not move an archive onto itself')
  t.ok(deploy.indexOf('if [[ "$renamed_signature" != "$signed_archive" ]]') !== -1, 'untagged signed deployments do not move a signature onto itself')
  t.end()
})

testWithFiles('MD5 manifest verification fails on tampering', ['scripts/md5_verify.py'], function (t) {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tronide-md5-'))
  var payload = path.join(directory, 'payload.txt')
  var manifest = path.join(directory, 'md5sums.txt')
  fs.writeFileSync(payload, 'original\n')
  fs.writeFileSync(manifest, crypto.createHash('md5').update('original\n').digest('hex') + '  ' + payload + '\n')

  try {
    var valid = spawnSync('python3', [path.join(root, 'scripts/md5_verify.py'), manifest], { encoding: 'utf8' })
    t.equal(valid.status, 0, 'a matching manifest passes')
    fs.writeFileSync(payload, 'tampered\n')
    var invalid = spawnSync('python3', [path.join(root, 'scripts/md5_verify.py'), manifest], { encoding: 'utf8' })
    t.notEqual(invalid.status, 0, 'a changed file fails the verifier')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
  t.end()
})

test('compiler download and build metadata are pinned', function (t) {
  var downloader = readRoot('scripts/download-solc-assets.cjs')
  var webpackConfig = readRoot('apps/remix-ide/webpack.config.js')

  t.ok(/SOLC_SHA256\s*=\s*'[0-9a-f]{64}'/.test(downloader), 'compiler download pins a SHA-256 digest')
  t.ok(/AbortController|REQUEST_TIMEOUT_MS/.test(downloader), 'compiler download has a timeout')
  t.notOk(/timestamp:\s*Date\.now\(\)/.test(webpackConfig), 'version metadata does not use a wall-clock timestamp')
  t.ok(/const buildId = process\.env\.TRONIDE_BUILD_ID/.test(webpackConfig), 'version metadata uses a stable build id')
  t.end()
})

test('GitHub OAuth BFF is release-gated and its origin reaches production builds', function (t) {
  var githubCi = readRoot('.github/workflows/ci.yml')

  t.ok(/github-oauth-bff:[\s\S]*?deno task check[\s\S]*?deno task test/.test(githubCi), 'GitHub CI checks and tests the Deno BFF')
  if (fs.existsSync(path.join(root, '.gitlab-ci.yml')) && fs.existsSync(path.join(root, '.gitlab-ci-base.yml'))) {
    var gitlab = readRoot('.gitlab-ci.yml')
    var gitlabBase = readRoot('.gitlab-ci-base.yml')
    t.ok(/github_oauth_bff_test:[\s\S]*?task check[\s\S]*?task test/.test(gitlab), 'GitLab checks and tests the Deno BFF')
    t.ok(gitlab.indexOf('denoland/deno:2.4.2@sha256:') !== -1, 'GitLab pins the Deno test image by digest')
    t.ok(gitlabBase.indexOf('-e TRONIDE_GITHUB_BFF_ORIGIN=') !== -1, 'GitLab forwards the selected BFF base URL into the frontend build container')
    t.ok(gitlabBase.indexOf('TRONIDE_GITHUB_BFF_ORIGIN must be configured') !== -1, 'GitLab refuses to build deployable artifacts without the organization BFF base URL')
    t.notOk(/TRONIDE_GITHUB_BFF_ORIGIN:-https?:/.test(gitlabBase), 'GitLab has no hard-coded BFF deployment fallback')
    t.notOk(/redchar1992/i.test(gitlabBase), 'GitLab has no personal BFF deployment reference')
  } else {
    t.comment('GitLab BFF assertions skipped in the public mirror')
  }
  t.end()
})

testWithFiles('production validation pins the complete NVM installer digest', ['.gitlab-ci.yml'], function (t) {
  var gitlab = readRoot('.gitlab-ci.yml')
  var digest = gitlab.match(/NVM_INSTALLER_SHA256='([0-9a-f]+)'/)

  t.ok(digest, 'GitLab declares the NVM installer SHA-256')
  t.equal(digest && digest[1].length, 64, 'the pinned SHA-256 has all 64 hexadecimal characters')
  t.equal(digest && digest[1], 'fabc489b39a5e9c999c7cab4d281cdbbcbad10ec2f8b9a7f7144ad701b6bfdc7', 'the pin matches nvm v0.39.1 install.sh')
  t.ok(/echo "\$NVM_INSTALLER_SHA256  \$NVM_INSTALLER_PATH" \| sha256sum --check --status/.test(gitlab), 'GitLab verifies the installer before executing it')
  t.end()
})

test('dependency security pins and workspace bootstrap are explicit', function (t) {
  var packageJson = JSON.parse(readRoot('package.json'))
  var workflow = readRoot('.github/workflows/ci.yml')
  var yoYo = packageJson.devDependencies['yo-yo']

  t.equal(packageJson.scripts.postinstall, undefined, 'dependency installation has no implicit workspace build/download lifecycle')
  t.equal(packageJson.scripts['setup-workspace'], 'npm run build:libs && npm run downloadsolc_assets', 'workspace bootstrap is an explicit command')
  t.equal(packageJson.pnpm.overrides['brace-expansion'], '5.0.9', 'brace-expansion is pinned to the patched release')
  t.equal(packageJson.pnpm.overrides['fast-uri'], '3.1.5', 'fast-uri is pinned to the patched release')
  t.equal(packageJson.pnpm.overrides.postcss, '8.5.23', 'postcss is pinned to the patched release')
  t.equal(packageJson.pnpm.overrides['ip-address'], '10.3.1', 'ip-address is pinned to the patched release')
  t.ok(/#405f53eff653a2f66b5752e1890788403fc5fe20$/.test(yoYo), 'yo-yo is pinned to an immutable commit')
  t.notOk(/#(?:master|main|HEAD)$/.test(yoYo), 'yo-yo does not use a floating branch')
  t.ok(/- name: Audit dependencies\s+run: pnpm audit/.test(workflow), 'CI runs a blocking full dependency audit')
  t.notOk(/continue-on-error:\s*true\s+run: pnpm audit/.test(workflow), 'dependency audit failures are not ignored')
  if (fs.existsSync(path.join(root, '.gitlab-ci.yml'))) {
    var gitlab = readRoot('.gitlab-ci.yml')
    t.ok(/dependency_check:\s*\n\s+stage:\s+dependency_check/.test(gitlab), 'GitLab has a dedicated dependency-check stage')
    t.ok(/dependency_check:[\s\S]*?pnpm install --frozen-lockfile --ignore-scripts/.test(gitlab), 'GitLab dependency check installs without lifecycle scripts')
    t.ok(/dependency_check:[\s\S]*?pnpm audit --audit-level=low/.test(gitlab), 'GitLab dependency check runs the full blocking audit')
    t.ok(/dependency_check:[\s\S]*?allow_failure:\s*false/.test(gitlab), 'GitLab dependency check failures are not ignored')
    t.ok(/dependency_check:[\s\S]*?CI_COMMIT_BRANCH =~ \/\^release\\\/\.\*\$\//.test(gitlab), 'GitLab dependency check runs on release branches')
  } else {
    t.comment('GitLab dependency assertions skipped in the public mirror')
  }
  t.end()
})

test('GitHub Actions references are immutable commit pins', function (t) {
  ;['.github/workflows/ci.yml', '.github/workflows/deploy.yml'].forEach(function (relativePath) {
    var workflow = readRoot(relativePath)
    var references = workflow.match(/uses:\s+[^\s]+@[0-9a-f]{40}/g) || []
    var floating = workflow.match(/uses:\s+[^\s]+@v\d+/g) || []
    t.ok(references.length > 0, relativePath + ' contains pinned actions')
    t.equal(floating.length, 0, relativePath + ' has no floating action tags')
  })
  t.end()
})

test('GitHub unit tests build remix-solidity before loading compiled app tests', function (t) {
  var workflow = readRoot('.github/workflows/ci.yml')
  var unitJob = (workflow.match(/\n  unit:[\s\S]*?\n  tronbox-handoff:/) || [])[0] || ''
  var buildIndex = unitJob.indexOf('- name: Build remix-solidity')
  var ideTestIndex = unitJob.indexOf('- name: Test Remix IDE')

  t.ok(unitJob, 'the required unit job is present')
  t.ok(buildIndex !== -1, 'the unit job builds remix-solidity')
  t.ok(ideTestIndex !== -1, 'the unit job runs the Remix IDE tests')
  t.ok(buildIndex < ideTestIndex, 'compiled remix-solidity output exists before the Remix IDE tests load it')
  t.equal((unitJob.match(/- name: Build remix-solidity/g) || []).length, 1, 'the library is built exactly once in the unit job')
  t.end()
})
