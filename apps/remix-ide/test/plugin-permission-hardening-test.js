/*
 * Regression coverage for plugin identity, permission decisions, and guarded
 * file-system capabilities found during the v2.3.2 analogue sweep.
 */

'use strict'

var Module = require('module')
var fs = require('fs')
var path = require('path')
var test = require('tape')
var permissionSecurity = require('../src/app/ui/permission-security')
var profileSecurity = require('../src/lib/plugin-profile-security')
var sourceRoot = path.join(__dirname, '..', 'src')

function readSource (relativePath) {
  return fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8')
}

function exposedProfileMethods (relativePath) {
  var source = readSource(relativePath)
  var profileStart = source.indexOf('const profile = {')
  var profileEnd = source.indexOf('\n}', profileStart)
  if (profileStart < 0 || profileEnd < 0) throw new Error('Cannot find profile in ' + relativePath)
  var methods = source.slice(profileStart, profileEnd).match(/methods:\s*\[([\s\S]*?)\]/)
  if (!methods) return []
  return Array.from(methods[1].matchAll(/'([^']+)'/g), function (match) { return match[1] })
}

function loadFileManagerWithStubs () {
  var originalLoad = Module._load

  function Plugin () {}

  var stubs = {
    antd: { notification: { warning: function () {} } },
    '@remixproject/engine': { Plugin: Plugin },
    '../../global/registry': { get: function () { return { api: {} } } },
    '../ui/modal-dialog-custom': { alert: function () {} },
    '../../lib/helper.js': {
      extractNameFromKey: function (value) { return value.split('/').pop() },
      createNonClashingNameAsync: async function (value) { return value },
      createNonClashingDirNameAsync: async function (value) { return value }
    }
  }

  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }

  var babelRegister = require('@babel/register')
  babelRegister({ extensions: ['.js'], cache: false })
  var modulePath = require.resolve('../src/app/files/fileManager')
  delete require.cache[modulePath]
  try {
    return require(modulePath)
  } finally {
    Module._load = originalLoad
    babelRegister.revert()
  }
}

function loadRemixdHandleWithStubs () {
  var originalLoad = Module._load

  function WebsocketPlugin (profile) {
    this.profile = profile
  }
  WebsocketPlugin.prototype.connect = function (url) {
    this.connectedUrl = url
    return url
  }
  function SecureWebsocketPlugin (profile) {
    WebsocketPlugin.call(this, profile)
  }
  SecureWebsocketPlugin.prototype = Object.create(WebsocketPlugin.prototype)
  SecureWebsocketPlugin.prototype.constructor = SecureWebsocketPlugin

  var stubs = {
    'is-electron': function () { return false },
    '@remixproject/engine-web': { WebsocketPlugin: WebsocketPlugin },
    '../components/secure-websocket-plugin': {
      SecureWebsocketPlugin: SecureWebsocketPlugin,
      requestLocalSessionUrl: function (url) { return Promise.resolve(url) }
    },
    'yo-yo': function () { return {} },
    'csjs-inject': function () { return {} },
    '../ui/modaldialog': function () {},
    '../ui/modal-dialog-custom': { alert: function () {} },
    '../ui/copy-to-clipboard': function () {}
  }

  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }

  var babelRegister = require('@babel/register')
  babelRegister({ extensions: ['.js'], cache: false })
  var modulePath = require.resolve('../src/app/files/remixd-handle')
  delete require.cache[modulePath]
  try {
    return require(modulePath).RemixdHandle
  } finally {
    Module._load = originalLoad
    babelRegister.revert()
  }
}

function permissionedFileManager (FileManager, allow) {
  var manager = Object.create(FileManager.prototype)
  manager.currentRequest = { from: 'externalPlugin' }
  manager.permissionCalls = []
  manager.askUserPermission = async function (method) {
    manager.permissionCalls.push(method)
    return allow
  }
  manager.limitPluginScope = function (path) { return path }
  manager.emit = function () {}
  return manager
}

async function rejectedError (promise) {
  try {
    await promise
    return null
  } catch (error) {
    return error
  }
}

test('remembered plugin permissions are valid only for the current profile hash', function (t) {
  var decide = permissionSecurity.rememberedPermissionDecision
  t.equal(decide({ allow: true, hash: 'v2' }, 'v2'), true, 'matching remembered allow is reused')
  t.equal(decide({ allow: false, hash: 'v2' }, 'v2'), false, 'matching remembered deny is reused')
  t.equal(decide({ allow: false, hash: 'v1' }, 'v2'), null, 'stale deny asks again after an upgrade')
  t.equal(decide({ allow: true, hash: 'v1' }, 'v2'), null, 'stale allow asks again after an upgrade')
  t.equal(decide({ allow: true }, 'v2'), null, 'a malformed remembered entry fails closed to a prompt')
  t.end()
})

test('permission prompts are serialized and the queue survives rejection', async function (t) {
  var queue = new permissionSecurity.SerialTaskQueue()
  var order = []
  var releaseFirst
  var first = queue.enqueue(function () {
    order.push('first:start')
    return new Promise(function (resolve) {
      releaseFirst = function () {
        order.push('first:end')
        resolve('first')
      }
    })
  })
  var second = queue.enqueue(function () {
    order.push('second')
    return 'second'
  })

  await Promise.resolve()
  t.deepEqual(order, ['first:start'], 'the second permission request cannot overtake the first')
  releaseFirst()
  t.deepEqual(await Promise.all([first, second]), ['first', 'second'], 'both requests retain their own result')
  t.deepEqual(order, ['first:start', 'first:end', 'second'], 'permission requests execute FIFO')

  var rejected = await rejectedError(queue.enqueue(function () { throw new Error('declined') }))
  t.ok(rejected && /declined/.test(rejected.message), 'a declined request still rejects its own caller')
  t.equal(await queue.enqueue(function () { return 'continued' }), 'continued', 'a rejection does not strand later requests')
  t.end()
})

test('trusted host callers bypass the nested permission queue', async function (t) {
  var permissionCalls = 0
  var plugin = {
    currentRequest: { from: 'filePanel' },
    askUserPermission: async function () {
      permissionCalls++
      throw new Error('trusted callers must not wait for manager.canCall')
    }
  }
  permissionSecurity.installPermissionCallerProfileResolver(plugin, function (name) {
    return name === 'filePanel' ? { name: 'filePanel' } : null
  })

  t.equal(await permissionSecurity.requireUserPermission(plugin, 'createWorkspace'), true, 'registered host call is approved locally')
  t.equal(permissionCalls, 0, 'trusted host call does not enter the asynchronous manager queue')
  t.end()
})

test('runtime profile updates cannot rewrite permission-bound identity', function (t) {
  var current = {
    name: 'demo',
    displayName: 'Demo',
    url: 'https://localhost:3000/demo/',
    hash: 'sha256:new',
    version: '2.0.0',
    canActivate: ['fileManager'],
    methods: ['ping'],
    events: ['ready']
  }

  t.doesNotThrow(function () {
    profileSecurity.assertSafeProfileUpdate(current, { name: 'demo', methods: ['ping', 'pong'], events: ['ready'] })
  }, 'methods/events handshake updates remain compatible')
  t.doesNotThrow(function () {
    profileSecurity.assertSafeProfileUpdate(current, { ...current, methods: ['ping', 'pong'] })
  }, 'clients may resend an otherwise unchanged full profile')
  ;['hash', 'version', 'url', 'canActivate', 'displayName'].forEach(function (field) {
    var update = { name: 'demo' }
    update[field] = field === 'canActivate' ? ['manager'] : 'attacker-value'
    t.throws(function () { profileSecurity.assertSafeProfileUpdate(current, update) }, /cannot be changed/, field + ' cannot change at runtime')
  })
  t.throws(function () {
    profileSecurity.assertSafeProfileUpdate(current, { name: 'demo', methods: 'writeFile' })
  }, /array of strings/, 'malformed method handshakes are rejected')
  t.throws(function () {
    profileSecurity.assertSafeProfileUpdate(current, { name: 'demo', unexpectedCapability: true })
  }, /cannot be changed/, 'unknown profile fields cannot be injected')
  t.throws(function () {
    profileSecurity.assertSafeProfileUpdate(current, JSON.parse('{"name":"demo","__proto__":{}}'))
  }, /cannot be changed/, 'a __proto__ own property cannot bypass the field guard')

  var managerCopy = profileSecurity.clonePluginProfile(current)
  current.methods.push('poisoned')
  current.events.push('poisoned')
  t.deepEqual(managerCopy.methods, ['ping'], 'manager method metadata does not share the connector array')
  t.deepEqual(managerCopy.events, ['ready'], 'manager event metadata does not share the connector array')
  t.end()
})

test('Remixd keeps its session token out of the registered plugin profile', function (t) {
  var RemixdHandle = loadRemixdHandleWithStubs()
  var remixd = new RemixdHandle({}, {})
  var registeredUrl = remixd.profile.url
  var sessionUrl = registeredUrl + '?remixdToken=session-secret'

  remixd.sessionUrl = sessionUrl
  t.equal(remixd.connect(registeredUrl), sessionUrl, 'the websocket receives the authenticated session endpoint')
  t.equal(remixd.connectedUrl, sessionUrl, 'the transport connects with the session token')
  t.equal(remixd.profile.url, registeredUrl, 'the permission-bound registered URL stays immutable')
  t.equal(readSource('app/files/remixd-handle.js').includes('this.profile.url ='), false, 'runtime connection code cannot mutate profile.url')
  t.end()
})

test('FileManager blocks denied writes and preserves allowed/internal writes', async function (t) {
  var FileManager = loadFileManagerWithStubs()
  var denied = permissionedFileManager(FileManager, false)
  var deniedWrites = 0
  var deniedAdds = 0
  var deniedLookups = 0
  denied._exists = async function () { deniedLookups++; return false }
  denied._setFileInternal = async function () { deniedWrites++; return true }
  denied.emit = function (event) { if (event === 'fileAdded') deniedAdds++ }

  var error = await rejectedError(denied.writeFile('contracts/denied.sol', 'DENIED'))
  t.ok(error && /Permission denied writeFile/.test(error.message), 'remembered deny rejects writeFile')
  t.deepEqual(denied.permissionCalls, ['writeFile'], 'writeFile checks its own capability')
  t.equal(deniedLookups, 0, 'writeFile denial happens before the first existence lookup')
  t.equal(deniedWrites, 0, 'denied content never reaches the provider')
  t.equal(deniedAdds, 0, 'a denied new file is not announced as added')

  var allowed = permissionedFileManager(FileManager, true)
  var allowedWrites = 0
  allowed._exists = async function () { return false }
  allowed._setFileInternal = async function () { allowedWrites++; return true }
  allowed.emit = function () {}
  await allowed.writeFile('contracts/artifacts/allowed.json', 'ALLOWED')
  t.equal(allowedWrites, 1, 'an allowed external write executes exactly once')

  var internal = permissionedFileManager(FileManager, false)
  delete internal.currentRequest
  var internalWrites = 0
  internal.askUserPermission = function () { throw new Error('internal writes must not ask') }
  internal._exists = async function () { return false }
  internal._setFileInternal = async function () { internalWrites++; return true }
  internal.emit = function () {}
  await internal.writeFile('contracts/internal.sol', 'INTERNAL')
  t.equal(internalWrites, 1, 'internal IDE writes remain functional without a prompt')
  internal.currentFile = function () { return 'contracts/internal.sol' }
  internal.openedFiles = { 'contracts/internal.sol': 'contracts/internal.sol' }
  t.equal(internal.getCurrentFile(), 'contracts/internal.sol', 'internal current-file reads remain synchronous')
  t.equal(internal.getOpenedFiles(), internal.openedFiles, 'internal opened-file reads retain the existing return shape')
  t.end()
})

test('FileManager setFile binds the workspace before permission and fails closed during rewrites', async function (t) {
  var FileManager = loadFileManagerWithStubs()
  var manager = permissionedFileManager(FileManager, true)
  var capturedPath = null
  var receivedContext = null
  var releasePermission
  manager._captureWorkspaceMutationContext = function (path) {
    capturedPath = path
    return { workspace: 'workspace-a', generation: 7 }
  }
  manager._writeFile = async function (path, content, context) {
    receivedContext = { path: path, content: content, context: context }
    return true
  }
  manager.askUserPermission = function () {
    return new Promise(function (resolve) { releasePermission = resolve })
  }

  var pending = manager.setFile('contracts/A.sol', 'A')
  await new Promise(function (resolve) { setImmediate(resolve) })
  t.equal(capturedPath, 'contracts/A.sol', 'setFile captures the workspace before awaiting permission')
  t.equal(receivedContext, null, 'setFile does not write while permission is pending')
  releasePermission(true)
  await pending
  t.deepEqual(receivedContext, {
    path: 'contracts/A.sol',
    content: 'A',
    context: { workspace: 'workspace-a', generation: 7 }
  }, 'setFile passes the captured context to its write core')

  var locked = permissionedFileManager(FileManager, true)
  var permissionCalls = 0
  locked.askUserPermission = function () {
    permissionCalls++
    return true
  }
  locked._workspaceRewriteLock = { token: 1 }
  var error = await rejectedError(locked.setFile('contracts/A.sol', 'A'))
  t.ok(error && /while Git is switching/.test(error.message), 'setFile rejects while a workspace rewrite is active')
  t.equal(permissionCalls, 0, 'rewrite rejection happens before permission or provider access')
  t.end()
})

test('FileManager protects workspace contents and destructive capabilities', async function (t) {
  var FileManager = loadFileManagerWithStubs()

  var deniedRead = permissionedFileManager(FileManager, false)
  var contentReads = 0
  deniedRead._handleExists = async function () { t.fail('denied read must not inspect existence') }
  deniedRead._handleIsFile = async function () {}
  deniedRead.getFileContent = function () { contentReads++; return 'secret' }
  var readError = await rejectedError(deniedRead.readFile('contracts/Secret.sol'))
  t.ok(readError && /Permission denied readFile/.test(readError.message), 'readFile deny rejects')
  t.deepEqual(deniedRead.permissionCalls, ['readFile'], 'readFile checks its own capability')
  t.equal(contentReads, 0, 'denied source content is never read')

  var allowedRead = permissionedFileManager(FileManager, true)
  allowedRead._handleExists = async function () {}
  allowedRead._handleIsFile = async function () {}
  allowedRead.getFileContent = function () { return 'source' }
  t.equal(await allowedRead.readFile('contracts/Allowed.sol'), 'source', 'allowed source reads still work')

  var deniedList = permissionedFileManager(FileManager, false)
  var directoryReads = 0
  deniedList._handleExists = async function () { t.fail('denied listing must not inspect existence') }
  deniedList._handleIsDir = async function () {}
  deniedList.fileProviderOf = function () {
    return { resolveDirectory: function () { directoryReads++ } }
  }
  var listError = await rejectedError(deniedList.readdir('contracts'))
  t.ok(listError && /Permission denied readdir/.test(listError.message), 'readdir deny rejects')
  t.deepEqual(deniedList.permissionCalls, ['readdir'], 'readdir checks its own capability')
  t.equal(directoryReads, 0, 'denied directory contents are never enumerated')

  var allowedList = permissionedFileManager(FileManager, true)
  allowedList._handleExists = async function () {}
  allowedList._handleIsDir = async function () {}
  allowedList.fileProviderOf = function () {
    return { resolveDirectory: function (path, callback) { callback(null, { 'contracts/A.sol': { isDirectory: false } }) } }
  }
  t.deepEqual(await allowedList.readdir('contracts'), { 'contracts/A.sol': { isDirectory: false } }, 'allowed directory listing still works')

  var cases = [
    {
      method: 'rename',
      run: function (manager) { return manager.rename('old.sol', 'new.sol') },
      setup: function (manager, mutate) {
        manager._handleExists = async function () {}
        manager.isFile = async function () { return true }
        manager._exists = async function () { return false }
        manager.fileProviderOf = function () { return { rename: function () { mutate() } } }
      }
    },
    {
      method: 'mkdir',
      run: function (manager) { return manager.mkdir('new-dir') },
      setup: function (manager, mutate) {
        manager._exists = async function () { return false }
        manager.fileProviderOf = function () { return { createDir: function () { mutate() } } }
      }
    },
    {
      method: 'remove',
      run: function (manager) { return manager.remove('contracts') },
      setup: function (manager, mutate) {
        manager._handleExists = async function () {}
        manager.fileProviderOf = function () { return { remove: function () { mutate() } } }
      }
    }
  ]

  for (const entry of cases) {
    var denied = permissionedFileManager(FileManager, false)
    var deniedMutations = 0
    entry.setup(denied, function () { deniedMutations++ })
    var error = await rejectedError(entry.run(denied))
    t.ok(error && new RegExp('Permission denied ' + entry.method).test(error.message), entry.method + ' deny rejects')
    t.deepEqual(denied.permissionCalls, [entry.method], entry.method + ' checks its own capability')
    t.equal(deniedMutations, 0, entry.method + ' cannot mutate after a deny')

    var allowed = permissionedFileManager(FileManager, true)
    var allowedMutations = 0
    entry.setup(allowed, function () { allowedMutations++ })
    await entry.run(allowed)
    t.equal(allowedMutations, 1, entry.method + ' still executes once when allowed')
  }
  t.end()
})

test('FileManager denies every exposed capability before provider access or side effects', async function (t) {
  var FileManager = loadFileManagerWithStubs()
  var cases = [
    { method: 'file', run: (manager) => manager.file(), hook: '_currentFileOrThrow' },
    { method: 'exists', run: (manager) => manager.exists('contracts/A.sol'), hook: '_exists' },
    { method: 'open', run: (manager) => manager.open('contracts/A.sol'), hook: '_open' },
    { method: 'writeFile', run: (manager) => manager.writeFile('contracts/A.sol', 'A'), hook: '_writeFile' },
    { method: 'readFile', run: (manager) => manager.readFile('contracts/A.sol'), hook: '_readFile' },
    { method: 'copyFile', run: (manager) => manager.copyFile('contracts/A.sol', 'scripts'), hook: '_copyFile' },
    { method: 'copyDir', run: (manager) => manager.copyDir('contracts', 'scripts'), hook: '_copyDir' },
    { method: 'rename', run: (manager) => manager.rename('contracts/A.sol', 'contracts/B.sol'), hook: '_handleExists' },
    { method: 'mkdir', run: (manager) => manager.mkdir('contracts/new'), hook: '_mkdir' },
    { method: 'readdir', run: (manager) => manager.readdir('contracts'), hook: '_readdir' },
    { method: 'remove', run: (manager) => manager.remove('contracts/A.sol'), hook: '_handleExists' },
    { method: 'getCurrentFile', run: (manager) => manager.getCurrentFile(), hook: '_currentFileOrThrow' },
    { method: 'getOpenedFiles', run: (manager) => manager.getOpenedFiles(), openedFiles: true },
    { method: 'getFile', run: (manager) => manager.getFile('contracts/A.sol'), hook: '_readFile' },
    { method: 'getFolder', run: (manager) => manager.getFolder('contracts'), hook: '_readdir' },
    { method: 'setFile', run: (manager) => manager.setFile('contracts/A.sol', 'A'), hook: '_writeFile' },
    { method: 'switchFile', run: (manager) => manager.switchFile('contracts/A.sol'), hook: '_open' },
    { method: 'refresh', run: (manager) => manager.refresh(), hook: '_refresh' },
    { method: 'getProviderOf', run: (manager) => manager.getProviderOf('contracts/A.sol'), hook: 'fileProviderOf', silentDeny: true },
    { method: 'getProviderByName', run: (manager) => manager.getProviderByName('workspace'), hook: 'getProvider', silentDeny: true },
    { method: 'saveCurrentFileChecked', run: (manager) => manager.saveCurrentFileChecked(), hook: '_saveCurrentFileChecked' },
    { method: 'captureWorkspaceMutationContext', run: (manager) => manager.captureWorkspaceMutationContext('contracts/A.sol'), hook: '_captureWorkspaceMutationContext' },
    { method: 'beginWorkspaceRewrite', run: (manager) => manager.beginWorkspaceRewrite(), hook: '_beginWorkspaceRewrite' },
    { method: 'endWorkspaceRewrite', run: (manager) => manager.endWorkspaceRewrite(1), hook: '_endWorkspaceRewrite' },
    { method: 'syncEditor', run: (manager) => manager.syncEditor('contracts/A.sol'), hook: '_syncEditor' },
    { method: 'reconcileOpenFilesAfterRewrite', run: (manager) => manager.reconcileOpenFilesAfterRewrite(1), hook: '_reconcileOpenFilesAfterRewrite' }
  ]

  t.deepEqual(exposedProfileMethods('app/files/fileManager.js'), cases.map(function (entry) { return entry.method }), 'every exposed FileManager method has a dynamic deny-before-touch case')

  for (const entry of cases) {
    var manager = permissionedFileManager(FileManager, false)
    var touches = 0
    if (entry.openedFiles) {
      Object.defineProperty(manager, 'openedFiles', {
        configurable: true,
        get: function () { touches++; return {} }
      })
    } else {
      manager[entry.hook] = function () { touches++; return true }
    }

    var value = undefined
    var error = undefined
    try {
      value = await entry.run(manager)
    } catch (caught) {
      error = caught
    }
    if (entry.silentDeny) {
      t.equal(error, undefined, entry.method + ' preserves its legacy non-throwing denial')
      t.equal(value, undefined, entry.method + ' returns no provider to a denied caller')
    } else {
      t.ok(error && new RegExp('Permission denied ' + entry.method).test(error.message), entry.method + ' rejects a denied caller')
    }
    t.deepEqual(manager.permissionCalls, [entry.method], entry.method + ' asks only for its own capability')
    t.equal(touches, 0, entry.method + ' is denied before its first provider access or side effect')
  }
  t.end()
})

test('FileManager compound copies use one top-level permission decision', async function (t) {
  var FileManager = loadFileManagerWithStubs()
  var fileCopy = permissionedFileManager(FileManager, true)
  var fileReads = 0
  var fileWrites = 0
  fileCopy._handleExists = async function () {}
  fileCopy._handleIsFile = async function () {}
  fileCopy._handleIsDir = async function () {}
  fileCopy._readFile = async function () { fileReads++; return 'SOURCE' }
  fileCopy._writeFile = async function () { fileWrites++ }
  fileCopy._saveActiveCopySource = async function () {}
  fileCopy._permissionlessFileLookup = function () { return { exists: async function () { return false } } }

  await fileCopy.copyFile('contracts/A.sol', 'scripts')
  t.deepEqual(fileCopy.permissionCalls, ['copyFile'], 'copyFile prompts exactly once for copyFile')
  t.equal(fileReads, 1, 'copyFile reads through its permissionless internal core after approval')
  t.equal(fileWrites, 1, 'copyFile writes through its permissionless internal core after approval')

  var dirCopy = permissionedFileManager(FileManager, true)
  var directoryReads = 0
  var directoryCreates = 0
  var nestedCopies = 0
  dirCopy._handleExists = async function () {}
  dirCopy._handleIsDir = async function () {}
  dirCopy._readdir = async function () {
    directoryReads++
    return { 'contracts/A.sol': { isDirectory: false } }
  }
  dirCopy._mkdir = async function () { directoryCreates++ }
  dirCopy._copyFile = async function () { nestedCopies++ }
  dirCopy._saveActiveCopySource = async function () {}
  dirCopy._permissionlessFileLookup = function () { return { exists: async function () { return false } } }

  await dirCopy.copyDir('contracts', 'scripts')
  t.deepEqual(dirCopy.permissionCalls, ['copyDir'], 'copyDir prompts exactly once for the recursive operation')
  t.equal(directoryReads, 1, 'copyDir enumerates the approved source')
  t.equal(directoryCreates, 1, 'copyDir creates the approved destination tree')
  t.equal(nestedCopies, 1, 'copyDir copies nested files without additional prompts')
  t.end()
})

test('FileManager durably saves an active copy source before reading it', async function (t) {
  var FileManager = loadFileManagerWithStubs()
  var manager = permissionedFileManager(FileManager, true)
  var currentFile = 'contracts/Active.sol'
  var order = []
  manager._deps = { config: { get: function () { return currentFile } } }
  manager.editor = { current: function () { return currentFile } }
  manager._captureWorkspaceMutationContext = function () { return undefined }
  manager._saveCurrentFileChecked = async function () { order.push('save') }
  manager._copyFile = async function () { order.push('copy-file') }
  manager._copyDir = async function () { order.push('copy-dir') }

  await manager.copyFile('contracts/Active.sol', 'scripts')
  t.deepEqual(order, ['save', 'copy-file'], 'an active file is durable before copyFile reads it')

  order = []
  await manager.copyDir('contracts', 'scripts')
  t.deepEqual(order, ['save', 'copy-dir'], 'an active descendant is durable before copyDir enumerates it')

  order = []
  await manager.copyDir('tests', 'scripts')
  t.deepEqual(order, ['copy-dir'], 'copying an unrelated directory does not save another source')
  t.end()
})

test('FileManager keeps provider permission keys distinct', async function (t) {
  var FileManager = loadFileManagerWithStubs()
  var denied = permissionedFileManager(FileManager, false)
  var providerReads = 0
  denied.fileProviderOf = function () { providerReads++; return {} }
  t.equal(await denied.getProviderOf('contracts/A.sol'), undefined, 'denied getProviderOf returns no provider')
  t.deepEqual(denied.permissionCalls, ['getProviderOf'], 'getProviderOf no longer inherits getProviderByName grants')
  t.equal(providerReads, 0, 'denied provider lookup is not executed')

  var allowed = permissionedFileManager(FileManager, true)
  var sentinel = {}
  allowed.fileProviderOf = function () { return sentinel }
  t.equal(await allowed.getProviderOf('contracts/A.sol'), sentinel, 'allowed getProviderOf still returns its provider')
  t.end()
})

test('FileManager keeps provider namespaces bounded and drops stale reads', async function (t) {
  var FileManager = loadFileManagerWithStubs()
  var browserProvider = { type: 'browser' }
  var workspaceProvider = { type: 'workspace' }
  var localhostProvider = { type: 'localhost' }
  var manager = Object.create(FileManager.prototype)
  manager.mode = 'browser'
  manager.currentRequest = { from: 'externalPlugin' }
  manager._deps = {
    filesProviders: {
      browser: browserProvider,
      workspace: workspaceProvider,
      localhost: localhostProvider
    }
  }

  t.throws(function () { manager.limitPluginScope('browser') }, /root paths/, 'plugins cannot enumerate the BrowserFS root')
  t.throws(function () { manager.limitPluginScope('browserfoo/secret.sol') }, /root paths/, 'provider names require a path boundary')
  t.equal(manager.limitPluginScope('browser/contracts/A.sol'), 'contracts/A.sol', 'the scoped browser prefix maps to a workspace path')
  t.equal(manager.fileProviderOf('browserfoo/secret.sol'), workspaceProvider, 'malformed browser prefixes stay in the workspace provider')
  t.equal(manager.fileProviderOf('browser/contracts/A.sol'), browserProvider, 'the exact browser provider prefix remains available internally')
  t.equal(manager.fileProviderOf('localhostfoo/file.sol'), workspaceProvider, 'malformed localhost prefixes do not select remixd')

  manager.currentRequest = undefined
  manager._fileReadEpoch = 0
  manager.openedFiles = {}
  var currentFile = ''
  var pendingRead
  var opened = 0
  manager._deps.config = {
    get: function () { return currentFile },
    set: function (key, value) { if (key === 'currentFile') currentFile = value }
  }
  manager.editor = {
    current: function () { return null },
    open: function () { opened++ },
    openReadOnly: function () { opened++ }
  }
  manager.events = { emit: function () {} }
  manager.emit = function () {}
  manager.saveCurrentFile = function () {}
  var deferredProvider = {
    getPathFromUrl: function (path) { return path },
    captureMutationContext: function () { return { workspace: 'one', generation: 1 } },
    isReadOnly: function () { return false },
    get: function (path, callback) { pendingRead = callback }
  }
  manager._deps.filesProviders.workspace = deferredProvider
  var pendingOpen = manager.openFile('contracts/A.sol')
  manager.closeAllFiles()
  pendingRead(null, 'stale branch content')
  t.equal(await pendingOpen, false, 'a read callback invalidated by closeAllFiles cannot open a stale tab')
  t.equal(opened, 0, 'stale content never reaches the editor')
  t.equal(Object.keys(manager.openedFiles).length, 0, 'stale open state is not reintroduced')
  t.end()
})

test('plugin permission and modal security helpers remain wired into the IDE', function (t) {
  var handler = readSource('app/ui/persmission-handler.js')
  var modal = readSource('app/ui/modaldialog.js')
  var localPlugin = readSource('app/components/local-plugin.js')
  var manager = readSource('remixAppManager.js')
  var settings = readSource('app/components/plugin-manager-settings.js')
  var footerRule = settings.slice(settings.indexOf('.permissions {'), settings.indexOf('.permissions button'))

  t.ok(handler.includes('new SerialTaskQueue()'), 'PermissionHandler serializes prompt decisions')
  t.ok(handler.includes('rememberedPermissionDecision('), 'remembered allow and deny both use hash-aware decisions')
  t.ok(handler.includes('this.permissions = createPermissionMap()'), 'Reset all permissions clears live in-memory state with a null-prototype map')
  t.ok(handler.includes('<input type="checkbox" checked'), 'an existing remembered choice is visibly checked')
  t.equal(handler.includes('switchMode'), false, 'the invalid checkbox pseudo-attribute cannot return')

  t.ok(localPlugin.includes('profile.url = validation.normalizedUrl || profile.url'), 'local plugin identity uses the normalized URL')
  t.ok(localPlugin.includes('profile.hash = localPluginProfileHash(profile)'), 'local plugin grants bind to the full connection profile')
  t.ok(manager.includes('assertSafeProfileUpdate(from, to)'), 'runtime profile updates pass through the identity guard')
  t.ok(manager.includes('const cloned = clonePluginProfile(profile)') && manager.includes('profiles.map(cloneAndValidate)'), 'manager registration breaks connector profile sharing before trust validation')

  t.ok(modal.includes('const modalQueue = []') && modal.includes('activeRequest'), 'legacy modals use one global FIFO')
  t.equal(modal.includes('incomingModal'), false, 'the callback-fan-out incomingModal workaround cannot return')
  t.ok(modal.includes('const container = html(opts)'), 'each queued modal owns a detached container')

  t.equal(footerRule.includes('position: sticky'), false, 'plugin manager footer stays in normal flow')
  t.equal(footerRule.includes('bottom: 0'), false, 'plugin manager footer cannot float over actions')
  var interpolationStart = '$' + '{'
  t.ok(settings.includes(interpolationStart + 'methodName}-' + interpolationStart + 'fromName}'), 'permission setting IDs are caller-specific')
  t.end()
})
