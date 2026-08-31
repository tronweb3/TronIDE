/*
 * Modifications Copyright © 2026 TronIDE
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

'use strict'

const tape = require('tape')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '../../..')

tape('Playwright smoke config uses a dedicated port and never reuses arbitrary local services', function (t) {
  const source = fs.readFileSync(path.join(root, 'apps/remix-ide-pw/playwright.config.ts'), 'utf8')

  t.ok(/http:\/\/localhost:18080/.test(source), 'default Playwright base URL uses the dedicated 18080 port')
  t.ok(/--port=\$\{serverPort\}/.test(source), 'dev-server command follows the configured base URL port')
  t.ok(/reuseExistingServer:\s*false/.test(source), 'webServer does not silently reuse an existing listener')
  t.ok(/TRONIDE_PW_REUSE_SERVER\s*===\s*'1'/.test(source), 'external server reuse requires explicit opt-in')
  t.notOk(/http:\/\/localhost:8080/.test(source), 'config does not default to the commonly occupied 8080 port')
  t.end()
})

tape('Nightwatch golden E2E uses its dedicated server and propagates the base URL', function (t) {
  const scripts = require(path.join(root, 'package.json')).scripts
  const waitGate = fs.readFileSync(path.join(root, 'scripts/wait-for-golden-e2e.sh'), 'utf8')

  t.ok(/serve:e2e/.test(scripts['e2e:golden']), 'golden E2E does not start the general-purpose 8080 server')
  t.equal(scripts['serve:e2e'], 'nx serve remix-ide --configuration=development --port=18080', 'golden E2E server listens on the isolated 18080 port')
  t.equal(scripts['remixd:e2e'], 'nx serve remixd --folder="${REMIXD_E2E_FOLDER:-./apps/remix-ide/contracts}" --remixide=http://127.0.0.1:18080', 'remixd gate shares the isolated IDE origin and accepts an isolated fixture')
  t.ok(/run-remixd-e2e\.sh/.test(scripts['e2e:remixd']), 'real remixd E2E uses the cleanup-aware service runner')
  t.ok(/E2E_BASE_URL=http:\/\/127\.0\.0\.1:18080/.test(scripts['e2e:golden:wait-and-run']), 'wait-and-run exports the same base URL to Nightwatch')
  t.notOk(/127\.0\.0\.1:8080/.test(scripts['e2e:golden:wait-and-run']), 'golden wait gate does not probe the commonly occupied 8080 port')
  t.ok(/wait-for-golden-e2e\.sh/.test(scripts['e2e:golden:wait-and-run']), 'golden E2E uses the shared readiness gate')
  t.ok(/127\.0\.0\.1:4444\/wd\/hub\/status/.test(waitGate), 'Selenium standalone keeps its /wd/hub readiness endpoint')
  t.ok(/DIRECT_CHROMEDRIVER/.test(waitGate) && /127\.0\.0\.1:4444\/status/.test(waitGate), 'direct ChromeDriver readiness uses its root /status endpoint')
  t.ok(/SELENIUM_STATUS_URL:-\$default_selenium_status_url/.test(waitGate), 'an explicit Selenium status URL still overrides both defaults')
  t.ok(/E2E_READY_TIMEOUT_SECONDS/.test(waitGate) && /Timed out waiting for/.test(waitGate), 'readiness gate fails closed after a bounded timeout')
  t.ok(/exec pnpm e2e:golden:run/.test(waitGate), 'Nightwatch starts only after both dependencies are ready')
  const remixdWaitGate = fs.readFileSync(path.join(root, 'scripts/wait-for-remixd-e2e.sh'), 'utf8')
  t.ok(/DIRECT_CHROMEDRIVER/.test(remixdWaitGate) && /127\.0\.0\.1:4444\/status/.test(remixdWaitGate), 'remixd E2E uses the same direct ChromeDriver readiness endpoint')
  t.ok(/65520\/remixd-token/.test(remixdWaitGate), 'remixd gate waits on the real token endpoint')
  t.ok(/Origin: \$\{ide_url%\//.test(remixdWaitGate), 'remixd readiness uses the browser origin guard')
  t.ok(/--test build\/apps\/remix-ide-e2e\/src\/tests\/remixd\.test\.js/.test(remixdWaitGate), 'remixd gate selects the real Nightwatch filesystem suite through the supported CLI option')
  t.ok(/--testcase Remixd/.test(remixdWaitGate), 'remixd gate runs only the deterministic daemon testcase')
  const remixdRunner = fs.readFileSync(path.join(root, 'scripts/run-remixd-e2e.sh'), 'utf8')
  t.ok(/mktemp -d/.test(remixdRunner) && /REMIXD_E2E_FOLDER/.test(remixdRunner), 'remixd mutations run in an isolated temporary fixture')
  t.ok(/trap cleanup EXIT/.test(remixdRunner) && /terminate_tree/.test(remixdRunner), 'remixd services are stopped on both pass and failure')
  const remixdSuite = fs.readFileSync(path.join(root, 'apps/remix-ide-e2e/src/tests/remixd.test.ts'), 'utf8')
  const runTestsStart = remixdSuite.indexOf('function runTests')
  const runTests = runTestsStart >= 0 ? remixdSuite.slice(runTestsStart) : ''
  t.ok(/testEditorValue\(remixdCompanyContract\)/.test(runTests) && /testEditorValue\(gmbhTestContract\)/.test(runTests), 'required daemon testcase verifies imported nested file contents without compiler coupling')
  t.notOk(/executeTerminalScript\('git/.test(runTests), 'required daemon testcase does not claim coverage for the disabled native Git bridge')
  t.ok(/contract1\.sol/.test(remixdRunner) && /renamed_contract_chrome\.sol/.test(remixdRunner), 'runner verifies that browser writes, renames, and removals reached the temporary filesystem')
  t.end()
})
