/* Static regression coverage for the AI Solidity test timeout boundary. */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')

var source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'tabs', 'test-tab.js'), 'utf8')
var remixTestsSource = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'libs', 'remix-tests', 'src', 'runTestSources.ts'), 'utf8')
var remixTestsTypesSource = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'libs', 'remix-tests', 'src', 'types.ts'), 'utf8')
var compilerSource = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'libs', 'remix-tests', 'src', 'compiler.ts'), 'utf8')
var solidityCompilerSource = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'libs', 'remix-solidity', 'src', 'compiler', 'compiler.ts'), 'utf8')
var simulatorSource = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'libs', 'remix-simulator', 'src', 'provider.ts'), 'utf8')

test('AI run_tests fails before the tool queue expires', function (t) {
  t.ok(/AI_TEST_RUN_TIMEOUT_MS\s*=\s*90000/.test(source), 'AI runs have a bounded overall timeout')
  t.ok(/AI_TEST_FILE_TIMEOUT_MS\s*=\s*60000/.test(source), 'each test file has a bounded timeout')
  t.ok(/error\.code\s*=\s*'AI_TEST_TIMEOUT'/.test(source), 'timeout errors carry a machine-readable code')
  t.ok(/if \(!timedOut &&[\s\S]*usingWorker: false/.test(source), 'worker fallback is not retried after a timeout')
  t.ok(/if \(settled\) return[\s\S]*clearTimeout/.test(source), 'late compiler callbacks cannot settle a timed-out run')
  t.ok(/new AbortController\(\)/.test(source), 'each AI run owns a cancellation controller')
  t.ok(/controller\.abort\(\)/.test(source), 'timeout aborts the underlying test pipeline')
  t.ok(/if \(timedOut\) break/.test(source), 'a timed-out file stops the remaining AI test queue')
  t.ok(/signal \}/.test(source), 'the cancellation signal is passed into remix-tests')
  t.end()
})

test('interactive Solidity tests use the builtin worker and stop active work', function (t) {
  t.ok(/INTERACTIVE_TEST_FILE_TIMEOUT_MS\s*=\s*90000/.test(source), 'interactive test files have a bounded timeout')
  t.ok(/workerCompilerVersion\s*=\s*\(currentVersion\)\s*=>\s*currentVersion\s*===\s*'builtin'\s*\?\s*BUILTIN_SOLC_VERSION/.test(source), 'the builtin compiler is normalized before the worker capability check')
  t.ok((source.match(/canUseWorker\(workerCompilerVersion\(currentVersion\)\)/g) || []).length >= 2, 'AI and interactive tests both use the normalized compiler version')
  t.ok(/abortActiveTestRun \(\)[\s\S]*activeTestController\.abort\(\)/.test(source), 'the panel can abort its active compiler and simulator pipeline')
  t.ok(/stopTests \(\)[\s\S]*this\.abortActiveTestRun\(\)/.test(source), 'Stop aborts the active test instead of waiting for the compiler watchdog')
  t.ok(/stopTests \(\)[\s\S]*if \(!this\.areTestsRunning\) return/.test(source), 'a stale Stop click cannot strand the controls after a fast run')
  t.ok(/stopTests \(\)[\s\S]*stopBtnLabel\.innerText = 'Stopping'[\s\S]*this\.abortActiveTestRun\(\)/.test(source), 'the synchronous abort callback gets the final control-state update')
  t.ok(/runTestSources\([\s\S]*\{ signal \}/.test(source), 'interactive tests pass their cancellation signal into remix-tests')
  t.ok(/onDeactivation \(\)[\s\S]*this\.abortActiveTestRun\(\)/.test(source), 'deactivating the panel releases active test resources')
  t.end()
})

test('remix-tests releases compiler and simulator resources after cancellation', function (t) {
  t.ok(/signal\?: AbortSignal/.test(remixTestsTypesSource), 'remix-tests accepts an abort signal')
  t.ok(/ownedProvider[\s\S]*\.disconnect\(\)/.test(remixTestsSource), 'runTestSources disconnects its owned provider')
  t.ok(/compileContractSources\(contractSources,[\s\S]*signal/.test(remixTestsSource), 'compile receives the cancellation signal')
  t.ok(/compiler\.dispose\(\)/.test(compilerSource), 'compileContractSources disposes its compiler')
  t.ok(/dispose \(\): void[\s\S]*terminate\(\)/.test(solidityCompilerSource), 'compiler disposal terminates workers')
  t.ok(/isConnected \(\)[\s\S]*return this\.connected/.test(simulatorSource), 'simulator reports disconnected state after cleanup')
  t.ok(/disconnect \(\)[\s\S]*this\.connected = false/.test(simulatorSource), 'simulator disconnect is no longer a no-op')
  t.end()
})
