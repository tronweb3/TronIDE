/*
 * Dynamic regression coverage for sensitive engine event subscriptions.
 */

'use strict'

var test = require('tape')

function loadRemixEngine () {
  var babelRegister = require('@babel/register')
  babelRegister({
    extensions: ['.js'],
    cache: false,
    babelrc: false,
    configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]]
  })
  var modulePath = require.resolve('../src/remixEngine')
  delete require.cache[modulePath]
  try {
    return require(modulePath).RemixEngine
  } finally {
    babelRegister.revert()
  }
}

function createEngine (askPermission, active) {
  var RemixEngine = loadRemixEngine()
  var engine = new RemixEngine()
  var profiles = {
    manager: { name: 'manager', displayName: 'Plugin manager', permission: true, events: ['profileUpdated'] },
    solidity: { name: 'solidity', displayName: 'Solidity', permission: true, events: ['compilationFinished'] },
    editor: { name: 'editor', displayName: 'Editor', permission: true, events: ['breakpointAdded'] },
    tabs: { name: 'tabs', displayName: 'Tabs', events: [] },
    theme: { name: 'theme', displayName: 'Theme', events: ['themeChanged'] },
    externalPlugin: { name: 'externalPlugin', displayName: 'External', hash: 'sha256:external' },
    compilerArtefacts: { name: 'compilerArtefacts', displayName: 'Compiler artefacts' }
  }
  engine.manager = {
    profiles: profiles,
    permissionHandler: { askPermission: askPermission },
    isActive: async function () { return active === undefined ? true : active }
  }
  engine.events.externalPlugin = {}
  engine.events.compilerArtefacts = {}
  return engine
}

test('manager lifecycle profile events require external subscription permission', async function (t) {
  var asks = []
  var received = 0
  var engine = createEngine(async function (listener, emitter, method, message) {
    asks.push([listener.name, emitter.name, method, message])
    return false
  })

  var registered = await engine.addListener('externalPlugin', 'manager', 'profileUpdated', function () {
    received++
  })
  engine.broadcast('manager', 'profileUpdated', {
    name: 'privatePlugin',
    url: 'wss://internal.example.test/session-token'
  })

  t.equal(registered, false, 'denied manager lifecycle subscription is not registered')
  t.deepEqual(asks, [[
    'externalPlugin',
    'manager',
    'event:profileUpdated',
    'subscribe to the profileUpdated event'
  ]], 'manager event subscriptions use the normal event permission tuple')
  t.equal(received, 0, 'denied listeners receive no complete profile payload')
  t.notOk(engine.listeners['[manager] profileUpdated'], 'denied manager listener is absent from the engine')
  t.end()
})

test('declared sensitive events require permission and fail closed on denial', async function (t) {
  var permissionCalls = 0
  var received = 0
  var engine = createEngine(async function () {
    permissionCalls++
    return false
  })

  var result = await engine.addListener('externalPlugin', 'editor', 'breakpointAdded', function () {
    received++
  })
  engine.broadcast('editor', 'breakpointAdded', 'private/workspace/Secret.sol', 7)

  t.equal(result, false, 'denied declared event registration fails closed')
  t.equal(permissionCalls, 1, 'declared sensitive event requires an event-specific permission')
  t.equal(received, 0, 'internal event payload is not exposed')
  t.notOk(engine.listeners['[editor] breakpointAdded'], 'denied listener is absent from the engine')
  t.end()
})

test('permission-aware profiles cannot expose undeclared internal events', function (t) {
  var permissionCalls = 0
  var received = 0
  var engine = createEngine(async function () {
    permissionCalls++
    return true
  })

  var result = engine.addListener('externalPlugin', 'editor', 'internalLintResult', function () {
    received++
  })
  engine.broadcast('editor', 'internalLintResult', 'private/workspace/Secret.sol')

  t.equal(result, false, 'undeclared sensitive event registration fails closed')
  t.equal(permissionCalls, 0, 'undeclared event cannot manufacture a permission prompt')
  t.equal(received, 0, 'undeclared sensitive payload is not exposed')
  t.end()
})

test('undeclared events from non-sensitive profiles are never silently public', function (t) {
  var permissionCalls = 0
  var received = 0
  var engine = createEngine(async function () {
    permissionCalls++
    return true
  })

  var result = engine.addListener('externalPlugin', 'tabs', 'openFile', function () {
    received++
  })
  engine.broadcast('tabs', 'openFile', 'private/workspace/Secret.sol')

  t.equal(result, false, 'undeclared public-profile event registration fails closed')
  t.equal(permissionCalls, 0, 'non-sensitive profile cannot manufacture a permission prompt')
  t.equal(received, 0, 'undeclared file-path event is not exposed')
  t.end()
})

test('declared public events preserve the synchronous registration path', function (t) {
  var permissionCalls = 0
  var received = null
  var engine = createEngine(async function () {
    permissionCalls++
    return false
  })

  var result = engine.addListener('externalPlugin', 'theme', 'themeChanged', function (theme) {
    received = theme
  })
  engine.broadcast('theme', 'themeChanged', { name: 'Dark' })

  t.equal(result, undefined, 'declared non-sensitive event registration remains synchronous')
  t.equal(permissionCalls, 0, 'public event does not request sensitive permission')
  t.deepEqual(received, { name: 'Dark' }, 'declared public event payload is delivered')
  t.end()
})

test('sensitive event denial never attaches a callback or exposes source', async function (t) {
  var permissionCalls = 0
  var received = 0
  var engine = createEngine(async function () {
    permissionCalls++
    return false
  })

  var registered = await engine.addListener('externalPlugin', 'solidity', 'compilationFinished', function () {
    received++
  })
  engine.broadcast('solidity', 'compilationFinished', 'Secret.sol', {
    sources: { 'Secret.sol': { content: 'contract Secret {}' } }
  })

  t.equal(registered, false, 'denied subscription reports failure')
  t.equal(permissionCalls, 1, 'sensitive subscription asks exactly once')
  t.equal(received, 0, 'denied listener receives no compiler source')
  t.notOk(engine.listeners['[solidity] compilationFinished'], 'denied listener is absent from the engine')
  t.end()
})

test('sensitive event allow attaches only after permission', async function (t) {
  var releasePermission
  var permissionCalls = 0
  var receivedSource = null
  var engine = createEngine(function () {
    permissionCalls++
    return new Promise(function (resolve) { releasePermission = resolve })
  })

  var first = engine.addListener('externalPlugin', 'solidity', 'compilationFinished', function (_file, source) {
    receivedSource = source
  })
  var second = engine.addListener('externalPlugin', 'solidity', 'compilationFinished', function () {})
  await Promise.resolve()

  t.equal(permissionCalls, 1, 'concurrent subscriptions share one pending permission')
  t.notOk(engine.listeners['[solidity] compilationFinished'], 'callback is not attached while permission is pending')
  releasePermission(true)
  t.deepEqual(await Promise.all([first, second]), [true, true], 'both callers observe the shared allow result')

  var source = { sources: { 'Secret.sol': { content: 'contract Secret {}' } } }
  engine.broadcast('solidity', 'compilationFinished', 'Secret.sol', source)
  t.equal(receivedSource, source, 'allowed listener receives the event payload')
  t.end()
})

test('trusted native event listeners keep synchronous registration', function (t) {
  var permissionCalls = 0
  var received = 0
  var engine = createEngine(async function () {
    permissionCalls++
    return false
  })

  var result = engine.addListener('compilerArtefacts', 'solidity', 'compilationFinished', function () {
    received++
  })
  engine.broadcast('solidity', 'compilationFinished', 'A.sol', { sources: {} })

  t.equal(result, undefined, 'native registration remains synchronous')
  t.equal(permissionCalls, 0, 'native listener does not open a permission prompt')
  t.equal(received, 1, 'native listener is attached immediately')
  t.end()
})

test('pending event subscriptions can be cancelled and unsafe keys are rejected', async function (t) {
  var releasePermission
  var received = 0
  var engine = createEngine(function () {
    return new Promise(function (resolve) { releasePermission = resolve })
  })

  var pending = engine.addListener('externalPlugin', 'solidity', 'compilationFinished', function () {
    received++
  })
  await Promise.resolve()
  engine.removeListener('externalPlugin', 'solidity', 'compilationFinished')
  releasePermission(true)
  t.equal(await pending, false, 'cancelled pending subscription fails closed')
  engine.broadcast('solidity', 'compilationFinished', 'A.sol', { sources: {} })
  t.equal(received, 0, 'cancelled callback is never attached')
  t.equal(engine.addListener('externalPlugin', 'solidity', '__proto__', function () {}), false, 'prototype event keys are rejected')
  t.equal(engine.removeListener(BigInt(1), 'solidity', 'compilationFinished'), false, 'malformed listener keys fail closed without JSON serialization errors')
  engine.listeners['[solidity] compilationFinished'] = ['anotherPlugin']
  t.equal(engine.removeListener('missingPlugin', 'solidity', 'compilationFinished'), false, 'missing listener event state fails closed')
  t.end()
})

test('external plugins cannot pre-subscribe to an unknown future emitter', function (t) {
  var permissionCalls = 0
  var received = 0
  var engine = createEngine(async function () {
    permissionCalls++
    return true
  })

  var result = engine.addListener('externalPlugin', 'futureCompiler', 'compilationFinished', function () {
    received++
  })
  engine.manager.profiles.futureCompiler = { name: 'futureCompiler', permission: true }
  engine.broadcast('futureCompiler', 'compilationFinished', 'Secret.sol', {
    sources: { 'Secret.sol': { content: 'contract Secret {}' } }
  })

  t.equal(result, false, 'unknown emitter registration fails closed')
  t.equal(permissionCalls, 0, 'unknown emitter cannot trigger a spoofed permission prompt')
  t.equal(received, 0, 'later registration cannot revive the rejected listener')
  t.end()
})
