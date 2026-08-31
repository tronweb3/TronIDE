/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')
var root = path.resolve(__dirname, '../../..')

function testWithFile (name, relativePath, callback) {
  test(name, function (t) {
    if (!fs.existsSync(path.join(root, relativePath))) {
      t.comment('skipped because this public mirror excludes: ' + relativePath)
      t.end()
      return
    }
    callback(t)
  })
}

function jobBlock (workflow, name, nextName) {
  var start = workflow.indexOf(`  ${name}:`)
  var end = nextName ? workflow.indexOf(`  ${nextName}:`, start + 1) : workflow.length
  return start >= 0 && end > start ? workflow.slice(start, end) : ''
}

test('GitHub CI separates the required Playwright gate from the full regression', function (t) {
  var workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')
  var packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  var gate = jobBlock(workflow, 'e2e-gate', 'e2e-remixd-gate')
  var remixdGate = jobBlock(workflow, 'e2e-remixd-gate', 'e2e-smoke')
  var full = jobBlock(workflow, 'e2e-smoke')

  t.ok(gate.includes('name: Required Playwright release gate'), 'the focused release gate is a distinct required job')
  t.ok(gate.includes('timeout-minutes: 45'), 'the gate has enough runner time for the serial browser suite')
  t.ok(gate.includes('run: pnpm test:pw:gate'), 'the required job runs only the deterministic @gate subset')
  t.ok(gate.includes('TRONIDE_GITHUB_BFF_ORIGIN: https://tronide-github-bff.test'), 'the gate compiles GitHub flows against a routeable synthetic BFF origin')
  t.notOk(gate.includes('continue-on-error: true'), 'the focused release gate cannot fail silently')
  t.ok(remixdGate.includes('name: Required real remixd integration gate'), 'real remixd has a separate required CI job')
  t.ok(remixdGate.includes('run: pnpm e2e:remixd'), 'the required remixd job runs the daemon-backed suite')
  t.notOk(remixdGate.includes('continue-on-error: true'), 'remixd integration failures cannot be ignored')
  t.ok(full.includes('name: Playwright full regression'), 'the complete suite is labelled honestly instead of smoke')
  t.ok(full.includes('timeout-minutes: 60'), 'the complete suite is no longer killed at the old 30-minute limit')
  t.ok(full.includes('continue-on-error: true'), 'the long complete regression remains informational')
  t.match(packageJson.scripts['test:pw:gate'], /--grep @gate --workers=1 --retries=0$/, 'the gate script is serial and retry-free')
  t.end()
})

testWithFile('GitLab required P0/P1 gates have a combined ten-minute budget', '.gitlab-ci.yml', function (t) {
  var workflow = fs.readFileSync(path.join(root, '.gitlab-ci.yml'), 'utf8')
  var coreRunner = fs.readFileSync(path.join(root, 'scripts/run-core-tests-ci.sh'), 'utf8')
  var goldenSmoke = fs.readFileSync(path.join(root, 'scripts/run-core-golden-deploy-smoke.sh'), 'utf8')
  var storageWriteBarrier = fs.readFileSync(path.join(root, 'apps/remix-ide/test/workspace-storage-write-barrier-test.js'), 'utf8')
  var requiredStart = workflow.indexOf('\ntest:')
  var requiredEnd = workflow.indexOf('\nproduction_validation:', requiredStart)
  var required = requiredStart >= 0 && requiredEnd > requiredStart ? workflow.slice(requiredStart, requiredEnd) : ''
  var start = workflow.indexOf('golden_e2e:')
  var end = workflow.indexOf('\ndeploy_main:', start)
  var golden = start >= 0 && end > start ? workflow.slice(start, end) : ''
  var requiredMinutes = Number((required.match(/timeout:\s*(\d+)m/) || [])[1])
  var goldenMinutes = Number((golden.match(/timeout:\s*(\d+)m/) || [])[1])

  t.ok(required.includes('needs: []'), 'the required test job runs in parallel with the production build')
  t.equal(requiredMinutes, 20, 'the P0/P1 Node gate allows cold dependency setup and the focused suite')
  t.ok(required.includes('bash scripts/run-core-tests-ci.sh'), 'the required test job runs the focused P0/P1 entry point')
  t.notOk(required.includes('pnpm i --frozen-lockfile') || required.includes('pnpm install --frozen-lockfile'), 'the required gate does not install the 29 GB workspace')
  t.notOk(required.includes('pnpm nx lint') || required.includes('pnpm nx test') || required.includes('pnpm build:e2e'), 'legacy lint, build, and library suites stay out of the fast gate')
  t.ok(coreRunner.includes('npm run test:core-p0-p1'), 'the focused test runner executes the named core suite')
  t.ok(coreRunner.includes('TRONBOX_HANDOFF_SKIP_COMPILE=1'), 'the fast gate validates the handoff structure without downloading the external compiler')
  t.ok(coreRunner.includes('crypto-js@4.2.0'), 'the focused test runner installs the AI approval integrity dependency')
  t.ok(coreRunner.includes('@babel/core@7.29.6'), 'the focused test runner installs the Babel runtime core')
  t.ok(coreRunner.includes('@babel/register@7.28.3'), 'the focused test runner installs the Recorder UI test transpiler')
  t.ok(coreRunner.includes('@babel/plugin-transform-modules-commonjs@7.27.1'), 'the focused test runner installs the focused ESM transform')
  t.ok(storageWriteBarrier.includes('babelrc: false') && storageWriteBarrier.includes('configFile: false'), 'the workspace write-barrier test stays inside the reduced Babel sandbox')
  t.ok(coreRunner.includes('async@3.2.6'), 'the focused test runner installs the Recorder model dependency')
  t.ok(coreRunner.includes('ethereumjs-util@7.1.0'), 'the focused test runner installs the Recorder address utility')
  t.ok(coreRunner.includes('highlight.js@11.11.1'), 'the focused test runner installs the reduced syntax highlighter')
  t.ok(coreRunner.includes('highlightjs-solidity@2.0.6'), 'the focused test runner installs Solidity highlighting support')

  t.ok(golden.includes('stage: verify'), 'the browser smoke runs after the test deployment is published')
  t.ok(golden.includes('- publish_main'), 'the browser smoke verifies the current deployed commit')
  t.equal(goldenMinutes, 45, 'the deployed browser suite allows compiler download and serial Nightwatch execution')
  t.ok(requiredMinutes + goldenMinutes >= 60, 'required test and golden E2E have a realistic cold-run budget')
  t.ok(golden.includes('bash scripts/run-core-golden-deploy-smoke.sh'), 'golden E2E runs only the deployed core artifact smoke')
  t.ok(golden.includes('- tronother3testmachine'), 'the deployed smoke runs inside the same reachable network boundary as publish')
  t.ok(golden.includes('$CI_COMMIT_BRANCH =~ /^release\\/.*$/'), 'ordinary release pushes run the core browser gate automatically')
  t.ok(golden.includes('allow_failure: false'), 'the deployed artifact regression is blocking')
  t.notOk(golden.includes('docker pull') || golden.includes('run-golden-e2e-ci.sh'), 'cold browser images and legacy Nightwatch stay out of the golden budget')
  t.notOk(goldenSmoke.includes('--retry-all-errors'), 'the deployed smoke stays compatible with the test runner curl version')
  t.ok(goldenSmoke.includes('CI_COMMIT_SHA') && goldenSmoke.includes('ver.txt'), 'the smoke proves that the test site serves the current commit across runner abbreviation settings')
  t.ok(goldenSmoke.includes('main.js') && goldenSmoke.includes('bundle_size'), 'the smoke inspects the real published production bundle')
  t.ok(goldenSmoke.includes('release-notes.html') && goldenSmoke.includes('release-notes-root'), 'the smoke verifies the independently published Release Notes document')
  ;['landingPrimaryActionsPanel', 'landingAiTaskNileDeploy', 'chat-wrapper-id', 'releaseNotesGalleryV'].forEach(function (selector) {
    t.ok(goldenSmoke.includes(selector), `the deployed smoke covers ${selector}`)
  })
  t.end()
})

testWithFile('GitLab full legacy E2E remains available without blocking releases', '.gitlab-ci.yml', function (t) {
  var workflow = fs.readFileSync(path.join(root, '.gitlab-ci.yml'), 'utf8')
  var runner = fs.readFileSync(path.join(root, 'scripts/run-golden-e2e-ci.sh'), 'utf8')
  var seleniumHelper = fs.readFileSync(path.join(root, 'scripts/start-matching-selenium.cjs'), 'utf8')
  var seleniumWaitGate = fs.readFileSync(path.join(root, 'scripts/wait-for-golden-e2e.sh'), 'utf8')
  var nightwatchConfig = fs.readFileSync(path.join(root, 'apps/remix-ide-e2e/nightwatch.ts'), 'utf8')
  var start = workflow.indexOf('\nfull_e2e:')
  var full = start >= 0 ? workflow.slice(start) : ''

  t.ok(full.includes('stage: full'), 'the complete suite is isolated after the release path')
  t.ok(full.includes('needs: []'), 'starting a manual full review cannot hold publish stage dependencies')
  t.ok(full.includes('timeout: 1h'), 'the complete legacy suite retains enough review time')
  t.ok(full.includes('pnpm test:tronbox-handoff'), 'full review keeps the real fixed-version TronBox compile')
  t.ok(full.includes('bash scripts/run-golden-e2e-ci.sh'), 'full review keeps the checked-in legacy entry point')
  t.ok(full.includes('$CI_PIPELINE_SOURCE == "schedule"'), 'scheduled self-test can run the complete regression')
  t.ok(full.includes('$CI_PIPELINE_SOURCE == "merge_request_event"') && full.includes('when: manual'), 'merge requests expose full regression only on review demand')
  t.ok(full.includes('$CI_COMMIT_BRANCH == "master"') && full.includes('when: manual'), 'master exposes full regression only on self-test demand')
  t.ok(full.includes('$CI_COMMIT_BRANCH =~ /^release\\/.*$/') && full.includes('when: manual'), 'release branches expose full regression only on self-test demand')
  t.ok(full.includes('allow_failure: true'), 'the long suite remains informational')
  t.ok(runner.includes("require('@playwright/test').chromium.executablePath()"), 'the bundled browser path is exported to legacy E2E')
  t.ok(runner.includes('"$CHROME_BIN" --version'), 'the bundled browser is executable before the suite starts')
  t.ok(seleniumHelper.includes('process.env.CHROME_BIN'), 'ChromeDriver version detection honors the explicit browser binary')
  t.ok(seleniumHelper.includes('DIRECT_CHROMEDRIVER'), 'the CI helper can launch the downloaded ChromeDriver directly')
  t.ok(seleniumWaitGate.includes('DIRECT_CHROMEDRIVER') && seleniumWaitGate.includes('4444/status'), 'the CI readiness gate probes direct ChromeDriver at /status')
  t.ok(nightwatchConfig.includes("default_path_prefix: ''"), 'direct ChromeDriver sessions do not use Selenium\'s /wd/hub path')
  t.ok(nightwatchConfig.includes('...chromeBinary'), 'Nightwatch launches the same explicit browser binary')
  t.ok(nightwatchConfig.includes("process.env.CI\n  ? ['headless=new'"), 'the CI browser runs headlessly on the shell runner')
  t.end()
})
