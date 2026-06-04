/*
 * Static regression tests for plugin teardown of timers/listeners.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')

function readSource (relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', 'src', relativePath), 'utf8')
}

test('SettingsUI persists and clears polling timers and blockchain listeners', function (t) {
  const source = readSource('app/tabs/runTab/settings.js')

  t.ok(/this\._intervals\s*=\s*\[\]/.test(source), 'SettingsUI tracks interval IDs')
  t.ok(/this\._accountBalanceInterval\s*=\s*setInterval/.test(source), 'account balance interval is stored')
  t.ok(/this\._accountListInterval\s*=\s*setInterval/.test(source), 'account list interval is stored')
  t.ok(/destroy\s*\(\)\s*{[\s\S]*this\._intervals\.forEach\(\(intervalId\)\s*=>\s*clearInterval\(intervalId\)\)/.test(source), 'destroy clears every SettingsUI interval')
  t.ok(/destroy\s*\(\)\s*{[\s\S]*this\._timeouts\.forEach\(\(timeoutId\)\s*=>\s*clearTimeout\(timeoutId\)\)/.test(source), 'destroy clears recursive SettingsUI timeouts')
  t.ok(/this\._blockchainEventHandlers\s*=\s*\[\]/.test(source), 'SettingsUI tracks blockchain event handlers')
  t.ok(/_registerBlockchainEvent\('transactionExecuted', this\._onTransactionExecuted\)/.test(source), 'transactionExecuted handler is registered by reference')
  t.ok(/_registerBlockchainEvent\('contextChanged', this\._onContextChanged\)/.test(source), 'contextChanged handler is registered by reference')
  t.ok(/_registerBlockchainEvent\('networkStatus', this\._onNetworkStatus\)/.test(source), 'networkStatus handler is registered by reference')
  t.ok(/_registerBlockchainEvent\('addProvider', this\._onProviderAdded\)/.test(source), 'addProvider handler is registered by reference')
  t.ok(/_registerBlockchainEvent\('removeProvider', this\._onProviderRemoved\)/.test(source), 'removeProvider handler is registered by reference')
  t.ok(/this\._blockchainEventHandlers\.forEach\(\(\{ eventName, handler \}\)\s*=>\s*{[\s\S]*this\.blockchain\.event\.unregister\(eventName, handler\)/.test(source), 'destroy unregisters all tracked blockchain handlers')
  t.ok(/removeEventListener\('change', this\._selectExEnvChangeHandler\)/.test(source), 'destroy removes select change handler')
  t.ok(/this\._destroyed/.test(source), 'destroyed flag guards stale callbacks')
  t.end()
})

test('RunTab tears down SettingsUI when the plugin deactivates', function (t) {
  const source = readSource('app/udapp/run-tab.js')

  t.ok(/onDeactivation\s*\(\)\s*{[\s\S]*this\.settingsUI\.destroy\(\)/.test(source), 'RunTab onDeactivation calls SettingsUI.destroy')
  t.ok(/this\._externalEventSubscriptions\s*=\s*\[\]/.test(source), 'RunTab tracks external event subscriptions')
  t.ok(/this\._managerEventSubscriptionsRegistered\s*=\s*false/.test(source), 'RunTab tracks manager listener registration state')
  t.ok(/_registerExternalListener\(this\.blockchain\.events, 'newTransaction', this\._onNewTransaction\)/.test(source), 'RunTab registers newTransaction by reference')
  t.ok(/_registerExternalListener\(fileManager\.events, 'currentFileChanged', this\._onCurrentFileChanged, 'render'\)/.test(source), 'RunTab registers currentFileChanged by reference')
  t.ok(/this\._externalEventSubscriptions\.forEach\(\(subscription\)\s*=>\s*{[\s\S]*(emitter\.removeListener|emitter\.off)\(eventName, handler\)/.test(source), 'RunTab removes tracked external listeners')
  t.ok(/_clearRenderSubscriptions\s*\(\)\s*{[\s\S]*this\._removeExternalListeners\(\(subscription\)\s*=>\s*subscription\.scope === 'render'\)/.test(source), 'RunTab can remove render-scoped listeners before re-render')
  t.ok(/_clearManagerEventSubscriptions\s*\(\)\s*{[\s\S]*if \(!this\._managerEventSubscriptionsRegistered\) return/.test(source), 'RunTab does not call engine off before manager listeners are registered')
  t.ok(/onDeactivation\s*\(\)\s*{[\s\S]*this\._removeExternalListeners\(\)/.test(source), 'RunTab onDeactivation removes external listeners')
  t.ok(/@remixproject\/engine stores one callback per listener\/emitter\/event/.test(source), 'RunTab documents engine-scoped manager off semantics')
  t.ok(/_clearManagerEventSubscriptions\s*\(\)\s*{[\s\S]*this\.off\('manager', 'pluginActivated'\)/.test(source), 'RunTab removes manager activation listener')
  t.ok(/_clearManagerEventSubscriptions\s*\(\)\s*{[\s\S]*this\.off\('manager', 'pluginDeactivated'\)/.test(source), 'RunTab removes manager deactivation listener')
  t.end()
})

test('ContextualListener clears activation interval and listeners on deactivation', function (t) {
  const source = readSource('app/editor/contextualListener.js')

  t.ok(/onActivation\s*\(\)\s*{[\s\S]*this\.onDeactivation\(\)/.test(source), 'activation first clears previous interval/listener registrations')
  t.ok(/this\._highlightInterval\s*=\s*setInterval/.test(source), 'highlight interval is stored')
  t.ok(/onDeactivation\s*\(\)\s*{[\s\S]*clearInterval\(this\._highlightInterval\)/.test(source), 'deactivation clears highlight interval')
  t.ok(/onDeactivation\s*\(\)\s*{[\s\S]*this\.off\('solidity', 'compilationFinished'\)/.test(source), 'deactivation unregisters compilationFinished listener')
  t.ok(/this\._onEditorContentChanged\s*=/.test(source), 'editor contentChanged handler is named')
  t.ok(/this\.editor\.event\.unregister\('contentChanged', this\._onEditorContentChanged\)/.test(source), 'deactivation unregisters contentChanged handler')
  t.end()
})

test('LandingPage removes global and registry listeners on deactivation', function (t) {
  const source = readSource('app/ui/landing-page/landing-page.js')

  t.ok(/render\s*\(\)\s*{\s*this\._landingActive\s*=\s*true/.test(source), 'render reactivates same LandingPage instance after deactivation')
  t.ok(/refreshWorkspaceStatus\s*=\s*async \(\)\s*=>\s*{[\s\S]*if \(!this\._landingActive\) return/.test(source), 'workspace status refresh is guarded before async work')
  t.ok(/const counts = await countWorkspaceFiles\('\/'\)[\s\S]*if \(!this\._landingActive\) return/.test(source), 'workspace status refresh is guarded after async work')
  t.ok(/scheduleWorkspaceStatusRefresh\s*=\s*\(\)\s*=>\s*{[\s\S]*if \(!this\._landingActive\) return/.test(source), 'scheduled workspace refresh ignores events after deactivation')
  t.ok(/this\._onWindowResize\s*=\s*\(\)\s*=>\s*this\.adjustMediaPanel\(\)/.test(source), 'resize listener is named')
  t.ok(/this\._onWindowClick\s*=\s*\(e\)\s*=>\s*this\.hideMediaPanel\(e\)/.test(source), 'click listener is named')
  t.ok(/window\.removeEventListener\('resize', this\._onWindowResize\)/.test(source), 'deactivation removes resize listener')
  t.ok(/window\.removeEventListener\('click', this\._onWindowClick\)/.test(source), 'deactivation removes click listener')
  t.ok(/this\._themeHandlers\.forEach\(\(handler\)\s*=>\s*this\._themeEvents\.removeListener\('themeChanged', handler\)\)/.test(source), 'deactivation removes theme handlers')
  t.ok(/this\._fileEventSubscriptions\.forEach/.test(source), 'deactivation iterates file/workspace event subscriptions')
  t.ok(/this\._workspaceStatusTimers\.forEach\(\(timerId\)\s*=>\s*clearTimeout\(timerId\)\)/.test(source), 'deactivation clears scheduled workspace refresh timers')
  t.end()
})

test('Terminal pending transaction polling does not depend on udapp activation', function (t) {
  const terminalSource = readSource('app/panels/terminal.js')
  const blockchainSource = readSource('blockchain/blockchain.js')

  t.ok(/this\.blockchain\.pendingTransactionsCount\(\)/.test(terminalSource), 'terminal reads pending transaction count from blockchain directly')
  t.notOk(/this\.call\('udapp', 'pendingTransactionsCount'\)/.test(terminalSource), 'terminal does not call udapp for pending transaction polling')
  t.ok(/pendingTransactionsCount\s*\(\)\s*{[\s\S]*if \(!this\.txRunner \|\| !this\.txRunner\.pendingTxs\) return 0/.test(blockchainSource), 'blockchain returns zero when txRunner pending map is unavailable')
  t.end()
})
