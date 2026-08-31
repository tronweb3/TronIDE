/*
 * Executable regressions for permission-map prototype safety, canCall request
 * binding, cross-tab grant merging, and native-name provenance.
 */

'use strict'

var Module = require('module')
var test = require('tape')
var permissionSecurity = require('../src/app/ui/permission-security')
var trustSecurity = require('../src/lib/plugin-trust-security')

function memoryStorage (initial) {
  var values = { ...(initial || {}) }
  return {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null },
    setItem: function (key, value) { values[key] = String(value) },
    removeItem: function (key) { delete values[key] },
    snapshot: function () { return { ...values } }
  }
}

function loadWithStubs (relativePath, stubs) {
  var originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  var babelRegister = require('@babel/register')
  babelRegister({ extensions: ['.js'], cache: false })
  var modulePath = require.resolve(relativePath)
  delete require.cache[modulePath]
  try {
    return require(modulePath)
  } finally {
    Module._load = originalLoad
    babelRegister.revert()
  }
}

function loadPermissionHandler () {
  return loadWithStubs('../src/app/ui/persmission-handler', {
    'yo-yo': function () { return {} },
    'csjs-inject': function () { return {} },
    './tooltip': function () {},
    './modaldialog': function () {},
    '../../global/registry': { get: function () { return { api: { fixInvert: function () {} } } } }
  })
}

function loadPluginManagerSettings (sanitizePermissions) {
  function yo () { return {} }
  yo.update = function () {}
  return loadWithStubs('../src/app/components/plugin-manager-settings', {
    'yo-yo': yo,
    'csjs-inject': function () { return {} },
    '../ui/modaldialog': function () {},
    '../ui/persmission-handler': { sanitizePermissions: sanitizePermissions }
  }).PluginManagerSettings
}

function loadRemixAppManager () {
  // Use an ES5-style constructor because this module's test Babel transform
  // lowers `super()` to `.call(this)`, matching the published engine class.
  function PluginManager (profile) {
    this.profile = profile || {
      name: 'manager',
      methods: ['getProfile', 'updateProfile', 'activatePlugin', 'deactivatePlugin', 'isActive', 'canCall'],
      events: ['pluginActivated', 'pluginDeactivated', 'profileAdded', 'profileUpdated']
    }
    this.profiles = {}
    this.actives = []
  }
  Object.defineProperty(PluginManager.prototype, 'requestFrom', {
    get: function () { return (this.currentRequest && this.currentRequest.from) || 'manager' }
  })
  PluginManager.prototype.getProfile = function (name) {
    return Promise.resolve(this.profiles[name])
  }
  PluginManager.prototype.addProfile = function (profiles) {
    this.addedProfiles = profiles
    return profiles
  }
  PluginManager.prototype.updateProfile = async function (profile) {
    this.updatedProfile = profile
    if (profile && this.profiles && this.profiles[profile.name]) {
      var from = await this.getProfile(this.requestFrom)
      await this.canUpdateProfile(from, profile)
      this.profiles[profile.name] = { ...this.profiles[profile.name], ...profile }
    }
    return profile
  }
  PluginManager.prototype.canUpdateProfile = function () { return Promise.resolve(true) }

  function SecureIframePlugin (profile) {
    this.profile = { ...profile }
    this.baseDispatches = 0
  }
  Object.defineProperty(SecureIframePlugin.prototype, 'name', {
    get: function () { return this.profile.name }
  })
  SecureIframePlugin.prototype.callPluginMethod = function () {
    this.baseDispatches++
    return 'iframe transport result'
  }

  return loadWithStubs('../src/remixAppManager', {
    '@remixproject/engine': { PluginManager: PluginManager },
    './app/components/secure-iframe-plugin': { SecureIframePlugin: SecureIframePlugin },
    './lib/query-params': function () { this.get = function () { return {} } },
    './lib/url-param-security': { filterUrlPluginNames: function (names) { return names } },
    './app/ui/persmission-handler': { PermissionHandler: function () {} }
  })
}

function loadLocalPlugin () {
  var originalLoad = Module._load
  var stubs = {
    'yo-yo': function () { return {} },
    '../ui/modaldialog': function () {},
    '@remix-project/remix-lib': {
      workspace: {
        pluginSecurity: {
          validateLocalPluginUrl: function (url) { return { ok: true, normalizedUrl: url, errors: [], warnings: [] } },
          summarizePluginPermissions: function () { return [] }
        }
      }
    }
  }
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  var modulePath = require.resolve('../src/app/components/local-plugin')
  delete require.cache[modulePath]
  try {
    return require(modulePath)
  } finally {
    Module._load = originalLoad
  }
}

function parsedPermissions (storage) {
  return JSON.parse(storage.getItem('plugins/permissions') || '{}')
}

async function rejection (value) {
  try {
    await value
    return null
  } catch (error) {
    return error
  }
}

test('permission maps reject prototype keys without creating inherited grants', async function (t) {
  var previousStorage = global.localStorage
  var storage = memoryStorage({ permissionVersion: '1', 'plugins/permissions': '{}' })
  global.localStorage = storage
  var permissionModule = loadPermissionHandler()
  var PermissionHandler = permissionModule.PermissionHandler

  var malicious = JSON.parse('{"fileManager":{"__proto__":{"externalPlugin":{"allow":true,"hash":"evil"}},"writeFile":{"__proto__":{"allow":true,"hash":"evil"},"externalPlugin":{"allow":false,"hash":"safe"}}},"__proto__":{"writeFile":{"externalPlugin":{"allow":true,"hash":"evil"}}}}')
  var sanitized = permissionModule.sanitizePermissions(malicious)
  t.equal(Object.getPrototypeOf(sanitized), null, 'top-level permission map has no prototype')
  t.equal(Object.getPrototypeOf(sanitized.fileManager), null, 'method permission map has no prototype')
  t.equal(Object.getPrototypeOf(sanitized.fileManager.writeFile), null, 'caller permission map has no prototype')
  t.equal(permissionSecurity.hasOwnPermission(sanitized, '__proto__'), false, 'dangerous target key is dropped')
  t.equal(permissionSecurity.hasOwnPermission(sanitized.fileManager, '__proto__'), false, 'dangerous method key is dropped')
  t.equal(permissionSecurity.hasOwnPermission(sanitized.fileManager.writeFile, '__proto__'), false, 'dangerous caller key is dropped')

  delete Object.prototype.externalPlugin
  var handler = new PermissionHandler()
  t.throws(function () {
    // This is the write the Accept callback would perform. It must fail before
    // assigning through Object.prototype when the requested method is special.
    handler.updatePermission(
      { name: 'externalPlugin', hash: 'evil' },
      { name: 'fileManager' },
      '__proto__',
      true,
      true
    )
  }, /Invalid permission key/, 'accepting a synthetic __proto__ capability cannot be persisted')
  t.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'externalPlugin'), false, 'Object.prototype remains unmodified')

  var prompts = 0
  handler.openPermission = async function () { prompts++; return false }
  t.equal(await handler._askPermission(
    { name: 'externalPlugin', hash: 'safe' },
    { name: 'fileManager' },
    'writeFile'
  ), false, 'a later writeFile call does not inherit the synthetic grant')
  t.equal(prompts, 1, 'writeFile still requires its own permission decision')
  t.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'externalPlugin'), false, 'the follow-up lookup also leaves Object.prototype clean')

  global.localStorage = previousStorage
  t.end()
})

test('generic callPluginMethod installer gates once and preserves internal dispatch shape', async function (t) {
  var originalCalls = 0
  var permissionCalls = []
  var marker = { direct: true }
  var plugin = {
    profile: { name: 'sensitiveTarget', methods: ['read'] },
    currentRequest: { from: 'externalPlugin' },
    askUserPermission: async function (method, message) {
      permissionCalls.push([method, message])
      return false
    },
    callPluginMethod: function () {
      originalCalls++
      return marker
    }
  }

  var messageCalls = 0
  permissionSecurity.installPermissionedCallPluginMethod(plugin, function (method) { messageCalls++; return 'use ' + method })
  t.equal(plugin.profile.permission, true, 'installer marks the instance profile as permission-aware')
  var error = await rejection(plugin.callPluginMethod('read', []))
  t.ok(error && /Permission denied read/.test(error.message), 'external deny rejects dispatch')
  t.equal(originalCalls, 0, 'external deny never calls the original dispatcher')
  t.deepEqual(permissionCalls, [['read', 'use read']], 'message factory and permission run exactly once')

  plugin.askUserPermission = async function (method) { permissionCalls.push([method, 'allow']); return true }
  t.equal(await plugin.callPluginMethod('read', []), marker, 'external allow returns the original result')
  t.equal(originalCalls, 1, 'external allow calls the original dispatcher once')

  delete plugin.currentRequest
  var internalResult = plugin.callPluginMethod('read', [])
  t.equal(internalResult, marker, 'internal dispatch retains the original synchronous return shape')
  t.equal(typeof internalResult.then, 'undefined', 'internal dispatch is not converted to a Promise')
  t.equal(originalCalls, 2, 'internal dispatch calls the original once')
  t.equal(messageCalls, 2, 'internal dispatch does not invoke the external prompt message factory')

  plugin.currentRequest = { from: 'externalPlugin' }
  permissionSecurity.installPermissionedCallPluginMethod(plugin, function () { return 'second wrapper' })
  permissionCalls = []
  await plugin.callPluginMethod('read', [])
  t.deepEqual(permissionCalls, [['read', 'allow']], 'double installation does not add a second permission check')
  t.equal(originalCalls, 3, 'double installation still invokes the original only once')
  t.equal(messageCalls, 3, 'double installation keeps only the first message factory')
  t.end()
})

test('late permission approval cannot execute after the originating request expires', async function (t) {
  var resolvePermission
  var actionCalls = 0
  var originalRequest = { from: 'externalPlugin', path: 'sensitiveTarget' }
  var plugin = {
    profile: { name: 'sensitiveTarget', methods: ['read'] },
    currentRequest: originalRequest,
    askUserPermission: function () {
      return new Promise(function (resolve) { resolvePermission = resolve })
    },
    callPluginMethod: function () {
      actionCalls++
      return 'sensitive result'
    }
  }

  permissionSecurity.installPermissionedCallPluginMethod(plugin)
  var pending = plugin.callPluginMethod('read', [])
  // PluginQueueItem does this when its RPC times out, then may immediately put
  // another caller on the same target while the old modal is still visible.
  plugin.currentRequest = { from: 'nextPlugin', path: 'sensitiveTarget' }
  resolvePermission(true)

  var error = await rejection(pending)
  t.ok(error && /Permission request expired read/.test(error.message), 'late approval is rejected after request identity changes')
  t.equal(actionCalls, 0, 'expired approval never reaches the sensitive implementation')

  plugin.currentRequest = originalRequest
  plugin.askUserPermission = async function () { return true }
  t.equal(await plugin.callPluginMethod('read', []), 'sensitive result', 'an in-scope approval still executes normally')
  t.equal(actionCalls, 1, 'valid request executes exactly once')
  t.end()
})

test('generic installer preserves connector profile metadata and internal handshake dispatch', async function (t) {
  var transportCalls = []
  var permissionCalls = 0
  var transportResult = { pendingTransportRequest: true }
  var originalMethods = ['execute']
  var originalEvents = ['changed']
  var originalCanActivate = ['filePanel']
  var connector = {
    profile: {
      name: 'remixd',
      url: 'ws://127.0.0.1:65520',
      hash: 'sha256:connector',
      methods: originalMethods,
      events: originalEvents,
      canActivate: originalCanActivate
    },
    currentRequest: { from: 'externalPlugin' },
    askUserPermission: async function () {
      permissionCalls++
      return false
    },
    callPluginMethod: function (method, args) {
      transportCalls.push([method, args])
      return transportResult
    },
    handshake: function () {
      return this.callPluginMethod('handshake', [this.profile.name, 'engine'])
    }
  }

  permissionSecurity.installPermissionedCallPluginMethod(connector)
  t.equal(connector.profile.url, 'ws://127.0.0.1:65520', 'installer preserves websocket transport metadata')
  t.equal(connector.profile.hash, 'sha256:connector', 'installer preserves connector identity metadata')
  t.notEqual(connector.profile.methods, originalMethods, 'installer detaches the exposed method array')
  t.notEqual(connector.profile.events, originalEvents, 'installer detaches the event array')
  t.notEqual(connector.profile.canActivate, originalCanActivate, 'installer detaches activation metadata')

  var handshakeResult = connector.handshake()
  t.equal(handshakeResult, transportResult, 'connector handshake keeps its original synchronous return shape')
  t.deepEqual(transportCalls, [['handshake', ['remixd', 'engine']]], 'internal handshake reaches the connector transport once')
  t.equal(permissionCalls, 0, 'an in-flight request does not turn an internal reconnect handshake into a user prompt')

  var denied = await rejection(connector.callPluginMethod('execute', ['status']))
  t.ok(denied && /Permission denied execute/.test(denied.message), 'normal external connector dispatch remains permission-gated')
  t.equal(transportCalls.length, 1, 'denied external dispatch never reaches the connector transport')
  t.equal(permissionCalls, 1, 'normal external connector dispatch asks exactly once')
  t.end()
})

test('PermissionHandler rebases one modal decision on latest localStorage', function (t) {
  var previousStorage = global.localStorage
  var storage = memoryStorage({ permissionVersion: '1' })
  global.localStorage = storage
  var permissionModule = loadPermissionHandler()
  var handler = new permissionModule.PermissionHandler()

  storage.setItem('plugins/permissions', JSON.stringify({
    settings: { get: { pluginB: { allow: true, hash: 'b1' } } }
  }))
  handler.permissions = permissionModule.sanitizePermissions({
    fileManager: { writeFile: { stalePlugin: { allow: true, hash: 'stale' } } }
  })
  handler.updatePermission(
    { name: 'pluginA', hash: 'a1' },
    { name: 'fileManager' },
    'writeFile',
    true,
    true
  )

  var afterAllow = parsedPermissions(storage)
  t.equal(afterAllow.settings.get.pluginB.allow, true, 'a grant added outside the stale modal is preserved')
  t.equal(afterAllow.fileManager.writeFile.pluginA.allow, true, 'the current modal writes only its target tuple')
  t.equal(afterAllow.fileManager.writeFile.stalePlugin, undefined, 'the stale in-memory snapshot is not restored')

  afterAllow.udapp = { sendTransaction: { pluginC: { allow: false, hash: 'c1' } } }
  storage.setItem('plugins/permissions', JSON.stringify(afterAllow))
  handler.updatePermission(
    { name: 'pluginA', hash: 'a1' },
    { name: 'fileManager' },
    'writeFile',
    false,
    false
  )
  var afterForget = parsedPermissions(storage)
  t.equal(afterForget.fileManager, undefined, 'forgetting a choice removes only its empty target branch')
  t.equal(afterForget.settings.get.pluginB.allow, true, 'an unrelated remembered grant survives forget')
  t.equal(afterForget.udapp.sendTransaction.pluginC.allow, false, 'a newer cross-tab deny survives forget')

  global.localStorage = previousStorage
  t.end()
})

test('PluginManagerSettings replays only edited tuples onto latest storage', function (t) {
  var previousWindow = global.window
  var storage = memoryStorage({
    'plugins/permissions': JSON.stringify({
      fileManager: { writeFile: { pluginA: { allow: true, hash: 'a1' } } },
      settings: { get: { pluginB: { allow: true, hash: 'b1' } } }
    })
  })
  global.window = { localStorage: storage }
  var permissionModule = loadPermissionHandler()
  var PluginManagerSettings = loadPluginManagerSettings(permissionModule.sanitizePermissions)
  var settings = new PluginManagerSettings()
  settings.pendingPermissionMutations = []
  settings.permissions = settings._getFromLocal()

  settings.togglePermission('fileManager', 'writeFile', 'pluginA')
  storage.setItem('plugins/permissions', JSON.stringify({
    fileManager: { writeFile: { pluginA: { allow: true, hash: 'a1' } } },
    settings: { get: { pluginB: { allow: false, hash: 'b2' } } },
    udapp: { sendTransaction: { pluginC: { allow: true, hash: 'c1' } } }
  }))
  settings.onValidation()

  var afterToggle = parsedPermissions(storage)
  t.equal(afterToggle.fileManager.writeFile.pluginA.allow, false, 'the checkbox edit is committed')
  t.equal(afterToggle.settings.get.pluginB.hash, 'b2', 'a newer unrelated tuple is not overwritten')
  t.equal(afterToggle.udapp.sendTransaction.pluginC.allow, true, 'a tuple added while the modal was open survives')

  settings.pendingPermissionMutations = []
  settings.permissions = settings._getFromLocal()
  settings.clearPersmission('pluginA', 'fileManager', 'writeFile')
  afterToggle.editor = { getCurrentFile: { pluginD: { allow: true, hash: 'd1' } } }
  storage.setItem('plugins/permissions', JSON.stringify(afterToggle))
  settings.onValidation()
  var afterClear = parsedPermissions(storage)
  t.equal(afterClear.fileManager, undefined, 'clearing one tuple removes only its now-empty branch')
  t.equal(afterClear.editor.getCurrentFile.pluginD.allow, true, 'a concurrent grant survives tuple deletion')

  settings.pendingPermissionMutations = []
  settings.permissions = settings._getFromLocal()
  settings.clearAllPersmission('settings')
  settings.onValidation()
  var afterTargetClear = parsedPermissions(storage)
  t.equal(afterTargetClear.settings, undefined, 'clear-target removes the selected plugin grants')
  t.equal(afterTargetClear.udapp.sendTransaction.pluginC.allow, true, 'clear-target does not clear the full permission store')
  t.equal(afterTargetClear.editor.getCurrentFile.pluginD.allow, true, 'other targets remain after clear-target')

  global.window = previousWindow
  t.end()
})

test('canCall binds permission tuples to the real target and exposed safe method', async function (t) {
  var previousWindow = global.window
  global.window = { _paq: [] }
  var managerModule = loadRemixAppManager()
  var RemixAppManager = managerModule.RemixAppManager
  var manager = Object.create(RemixAppManager.prototype)
  var asks = []
  manager.permissionHandler = {
    askPermission: async function (from, to, method) {
      asks.push([from.name, to.name, method])
      return false
    }
  }
  manager.profiles = {
    externalPlugin: { name: 'externalPlugin', hash: 'p1', methods: ['ping'] },
    fileManager: { name: 'fileManager', permission: true, methods: ['writeFile'] },
    dGitProvider: { name: 'dGitProvider', methods: ['pull'] },
    aiPanel: { name: 'aiPanel', methods: [] }
  }

  manager.currentRequest = { from: 'externalPlugin' }
  t.equal(await manager.canCall('externalPlugin', 'externalPlugin', '__proto__'), false, 'a direct synthetic __proto__ tuple is rejected')
  t.equal(await manager.canCall('externalPlugin', 'fileManager', 'writeFile'), false, 'a caller cannot spoof a different nested target')
  t.equal(asks.length, 0, 'invalid tuples never reach the permission store')

  manager.currentRequest = { from: 'fileManager' }
  t.equal(await manager.canCall('externalPlugin', 'fileManager', 'constructor'), false, 'dangerous method keys are rejected explicitly')
  t.equal(await manager.canCall('externalPlugin', 'fileManager', 'notExposed'), false, 'unexposed target methods are rejected')
  t.equal(await manager.canCall('externalPlugin', 'fileManager', 'writeFile'), false, 'a valid tuple delegates to the permission handler result')
  t.deepEqual(asks, [['externalPlugin', 'fileManager', 'writeFile']], 'the delegated tuple uses registered profiles and the real target')

  manager.currentRequest = { from: 'dGitProvider' }
  t.equal(await manager.canCall('externalPlugin', 'dGitProvider', 'pull'), false, 'explicit permission targets need not carry profile.permission metadata')
  t.deepEqual(asks[1], ['externalPlugin', 'dGitProvider', 'pull'], 'legacy dGit permission prompts remain reachable')

  manager.currentRequest = { from: 'fileManager' }
  t.equal(await manager.canCall('aiPanel', 'fileManager', 'writeFile'), true, 'a registered required host plugin keeps native bypass')
  global.window = previousWindow
  t.end()
})

test('manager profiles are permission-gated and redact direct untrusted reads', async function (t) {
  var previousWindow = global.window
  var previousStorage = global.localStorage
  var storage = memoryStorage()
  global.window = { _paq: [], localStorage: storage }
  global.localStorage = storage
  var managerModule = loadRemixAppManager()
  var manager = new managerModule.RemixAppManager()
  var privateMarker = Symbol('private profile provenance')
  var target = {
    name: 'sensitiveTarget',
    displayName: 'Sensitive target',
    methods: ['read'],
    events: ['changed'],
    canActivate: ['theme'],
    permission: true,
    url: 'wss://internal.example.test/session-token',
    hash: 'sha256:private-content-id',
    securityWarnings: ['internal diagnostic'],
    permissionSummary: ['write workspace files'],
    futurePrivateField: { secret: true }
  }
  target[privateMarker] = true
  manager.profiles = {
    externalPlugin: {
      name: 'externalPlugin',
      methods: ['ping'],
      events: [],
      url: 'ws://localhost:65520',
      hash: 'sha256:external',
      securityWarnings: ['loopback connector'],
      permissionSummary: ['read files']
    },
    fileManager: { name: 'fileManager', methods: ['readFile'] },
    sensitiveTarget: target
  }

  t.equal(manager.profile.permission, true, 'manager lifecycle events are marked permission-aware')

  manager.currentRequest = { from: 'externalPlugin' }
  var publicProfile = await manager.getProfile('sensitiveTarget')
  t.notEqual(publicProfile, target, 'an untrusted direct read receives a detached profile')
  t.deepEqual(publicProfile.methods, ['read'], 'public methods remain available for capability discovery')
  t.deepEqual(publicProfile.events, ['changed'], 'public events remain available for capability discovery')
  t.deepEqual(publicProfile.canActivate, ['theme'], 'public activation declarations remain available')
  t.equal(publicProfile.url, undefined, 'connector URL is redacted')
  t.equal(publicProfile.hash, undefined, 'content identity hash is redacted')
  t.equal(publicProfile.securityWarnings, undefined, 'security diagnostics are redacted')
  t.equal(publicProfile.permissionSummary, undefined, 'permission summaries are redacted')
  t.equal(publicProfile.futurePrivateField, undefined, 'unknown future fields fail closed')
  t.equal(publicProfile[privateMarker], undefined, 'symbol provenance does not cross the public boundary')
  publicProfile.methods.push('mutated')
  publicProfile.events.push('mutated')
  publicProfile.canActivate.push('fileManager')
  t.deepEqual(target.methods, ['read'], 'public method arrays cannot mutate manager state')
  t.deepEqual(target.events, ['changed'], 'public event arrays cannot mutate manager state')
  t.deepEqual(target.canActivate, ['theme'], 'public activation arrays cannot mutate manager state')
  t.equal(await manager.getProfile('__proto__'), undefined, 'inherited profile keys are never returned')

  manager.currentRequest = { from: 'fileManager' }
  t.equal(await manager.getProfile('sensitiveTarget'), target, 'a registered trusted host caller receives the full profile')
  delete manager.currentRequest
  t.equal(await manager.getProfile('sensitiveTarget'), target, 'an internal manager read receives the full profile')

  // The engine invokes updateProfile with the connector request still active.
  // Its superclass then calls this.getProfile(requestFrom), which must see the
  // complete current record in order to validate unchanged handshake fields.
  var updateRequest = { from: 'externalPlugin' }
  manager.currentRequest = updateRequest
  await manager.updateProfile({
    name: 'externalPlugin',
    methods: ['ping', 'pong'],
    events: ['ready'],
    url: 'ws://localhost:65520',
    hash: 'sha256:external',
    securityWarnings: ['loopback connector'],
    permissionSummary: ['read files']
  })
  t.deepEqual(manager.profiles.externalPlugin.methods, ['ping', 'pong'], 'request-scoped full reads preserve handshake method updates')
  t.deepEqual(manager.profiles.externalPlugin.events, ['ready'], 'request-scoped full reads preserve handshake event updates')
  var afterUpdate = await manager.getProfile('externalPlugin')
  t.equal(afterUpdate.url, undefined, 'the full-read scope is cleared after a successful update')
  t.equal(afterUpdate.hash, undefined, 'post-update external reads remain redacted')

  var updateError = await rejection(manager.updateProfile({
    name: 'externalPlugin',
    url: 'ws://attacker.example.test'
  }))
  t.ok(updateError && /cannot be changed/.test(updateError.message), 'identity-changing profile updates still fail')
  t.equal((await manager.getProfile('externalPlugin')).url, undefined, 'the full-read scope is also cleared after rejection')

  global.window = previousWindow
  global.localStorage = previousStorage
  t.end()
})

test('bundled iframe utilities reject external dispatch before reaching their transport', async function (t) {
  var previousWindow = global.window
  var previousStorage = global.localStorage
  var storage = memoryStorage()
  global.window = { _paq: [], localStorage: storage }
  global.localStorage = storage
  var managerModule = loadRemixAppManager()
  var manager = new managerModule.RemixAppManager()
  var plugins = await manager.registeredPlugins()
  var scriptRunner = plugins.find(function (plugin) { return plugin.name === 'scriptRunner' })

  t.ok(scriptRunner, 'scriptRunner connector is registered')
  t.equal(scriptRunner.profile.permission, true, 'bundled iframe connector is permission-aware')
  scriptRunner.currentRequest = { from: 'externalPlugin', path: 'scriptRunner' }
  scriptRunner.askUserPermission = async function () { return false }
  var error = await rejection(scriptRunner.callPluginMethod('execute', ['window.remix.call("fileManager", "readFile", "secret")']))
  t.ok(error && /Permission denied execute/.test(error.message), 'external script execution requires an explicit grant')
  t.equal(scriptRunner.baseDispatches, 0, 'denial happens before code reaches the iframe transport')

  delete scriptRunner.currentRequest
  t.equal(scriptRunner.callPluginMethod('execute', ['trusted host script']), 'iframe transport result', 'trusted host dispatch keeps the connector path')
  t.equal(scriptRunner.baseDispatches, 1, 'trusted host dispatch reaches the transport once')

  global.window = previousWindow
  global.localStorage = previousStorage
  t.end()
})

test('only registered host names can receive native trust', async function (t) {
  var previousWindow = global.window
  var previousStorage = global.localStorage
  var storage = memoryStorage()
  global.window = { _paq: [], localStorage: storage }
  global.localStorage = storage
  var managerModule = loadRemixAppManager()
  var RemixAppManager = managerModule.RemixAppManager

  ;['vyper', 'workshops', 'hardhat-provider'].forEach(function (name) {
    t.equal(managerModule.isNative(name), false, name + ' no longer occupies an unregistered native slot')
  })
  t.equal(managerModule.isNative('debugger'), true, 'a bundled extension name remains reserved')
  t.equal(managerModule.isNative('fileManager'), true, 'a required service remains native')
  t.equal(managerModule.isNative('home'), true, 'the bundled Home view name remains reserved')
  t.equal(trustSecurity.isTrustedHostPluginProfile({ name: 'fileManager' }), true, 'required host profiles share the canonical trust decision')
  t.equal(trustSecurity.isTrustedHostPluginProfile({ name: 'home' }), false, 'the Home name alone does not grant native trust')
  t.equal(trustSecurity.isTrustedHostPluginProfile(trustSecurity.markTrustedPluginProfile({ name: 'home' })), true, 'the host-marked Home view bypasses user permission prompts')
  t.equal(trustSecurity.isTrustedHostPluginProfile({ name: 'fileManager', hash: 'local:forged' }), false, 'a local profile cannot gain required-service trust by name')
  t.equal(trustSecurity.isTrustedHostPluginProfile({ name: 'debugger' }), false, 'an unmarked bundled name is not a trusted host profile')
  t.equal(managerModule.canActivate({ name: 'debugger' }, { name: 'filePanel' }), false, 'an unmarked bundled name cannot activate a target')
  t.equal(managerModule.canActivate({ name: 'externalPlugin', canActivate: ['filePanel'] }, { name: 'filePanel' }), true, 'explicit canActivate metadata remains supported for untrusted plugins')

  var manager = Object.create(RemixAppManager.prototype)
  t.throws(function () {
    manager.addProfile({ name: 'debugger', hash: 'local:forged', methods: [] })
  }, /reserved/, 'manager rejects a local profile claiming a trusted name')
  t.throws(function () {
    manager.addProfile({ name: 'debugger', methods: [] })
  }, /reserved/, 'name alone cannot forge a bundled extension profile')
  var trustedDebugger = trustSecurity.markTrustedPluginProfile({ name: 'debugger', methods: [] })
  t.equal(managerModule.canActivate(trustedDebugger, { name: 'filePanel' }), true, 'a host-marked bundled profile can activate targets')
  t.doesNotThrow(function () { manager.addProfile(trustedDebugger) }, 'a host-marked bundled profile can register')
  t.equal(trustSecurity.isTrustedPluginProfile(manager.addedProfiles), true, 'the unforgeable trust marker survives manager cloning')
  t.equal(trustSecurity.isTrustedHostPluginProfile(manager.addedProfiles), true, 'the marked bundled profile uses the same canonical trust decision')
  t.equal(await manager.canDeactivatePlugin({ name: 'debugger' }, { name: 'externalPlugin' }), false, 'an unmarked bundled name cannot deactivate a plugin')
  t.equal(await manager.canDeactivatePlugin(trustedDebugger, { name: 'externalPlugin' }), true, 'a host-marked bundled profile can deactivate a non-required plugin')
  t.equal(await manager.canDeactivatePlugin({ name: 'fileManager' }, { name: 'externalPlugin' }), true, 'a required host profile can deactivate a non-required plugin')
  t.equal(await manager.canDeactivatePlugin(trustedDebugger, { name: 'fileManager' }), false, 'required targets remain non-deactivatable')

  var handshakeUpdate = { name: 'externalPlugin', methods: ['ping'], events: ['ready'], canActivate: ['theme'] }
  await manager.updateProfile(handshakeUpdate)
  handshakeUpdate.methods.push('poisoned')
  handshakeUpdate.canActivate.push('fileManager')
  t.deepEqual(manager.updatedProfile.methods, ['ping'], 'updateProfile clones handshake method metadata before the superclass merge')
  t.deepEqual(manager.updatedProfile.canActivate, ['theme'], 'updateProfile cannot reintroduce a shared activation-capability array')

  var LocalPlugin = loadLocalPlugin()
  var local = new LocalPlugin()
  local.profile = { name: 'debugger', url: 'http://localhost:8080', location: 'sidePanel', methods: [] }
  t.throws(function () { local.create() }, /reserved by TronIDE/, 'the Local Plugin form rejects reserved names before registration')
  local.profile = { name: 'vyper', url: 'http://localhost:8080', location: 'sidePanel', methods: [] }
  t.doesNotThrow(function () { local.create() }, 'a removed optional name is usable without receiving native trust')

  global.window = previousWindow
  global.localStorage = previousStorage
  t.end()
})
