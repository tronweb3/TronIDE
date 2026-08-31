/*
 * Every API exposed by a permission-aware target must deny an external caller
 * before touching target state. Internal calls keep their historical return
 * shape so UI code is not forced through an asynchronous RPC path.
 */

'use strict'

var Module = require('module')
var fs = require('fs')
var path = require('path')
var test = require('tape')
var rpcSecurity = require('../src/lib/provider-rpc-security')
var sourceRoot = path.join(__dirname, '..', 'src')

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

function jsxRuntime () {
  return { jsxDEV: function () { return {} }, Fragment: 'fragment' }
}

function loadSettingsTab () {
  function ViewPlugin () {}
  return loadWithStubs('../src/app/tabs/settings-tab', {
    react: {},
    'react/jsx-dev-runtime': jsxRuntime(),
    '@remixproject/engine-web': { ViewPlugin: ViewPlugin },
    'react-dom': {},
    '@remix-ui/settings': { RemixUiSettings: function () {} },
    '../../global/registry': { get: function () { return { api: {} } } }
  })
}

function loadCompileTab () {
  function ViewPlugin () {}
  return loadWithStubs('../src/app/tabs/compile-tab', {
    react: {},
    'react/jsx-dev-runtime': jsxRuntime(),
    'react-dom': {},
    '@remix-ui/solidity-compiler': {
      SolidityCompiler: function () {},
      CompileTab: function () {},
      parseContracts: function () { return {} }
    },
    '@remix-project/remix-solidity': { compile: async function () { return {} } },
    '@remixproject/engine-web': { ViewPlugin: ViewPlugin },
    jquery: function () { return { keydown: function () {} } },
    'yo-yo': function () { return {} },
    '../../lib/query-params': function () {},
    '../ui/tooltip': function () {},
    '../../global/registry': { get: function () { return { api: { events: { on: function () {} } } } } }
  })
}

function loadRunTab () {
  function ViewPlugin () {}
  function noop () {}
  return loadWithStubs('../src/app/udapp/run-tab', {
    '@remixproject/engine-web': { ViewPlugin: ViewPlugin },
    jquery: function () { return {} },
    'yo-yo': function () { return {} },
    '@tvmjs/util': {},
    'ethereumjs-util': { BN: function () {} },
    web3: function () {},
    '@remix-project/remix-lib': {
      execution: {
        walletProviderAdapter: { WALLET_STATUS: {}, WALLET_ERROR_MESSAGES: {}, WALLET_ERROR_CODES: {} },
        walletAdapterManager: {}
      },
      util: {}
    },
    '../../lib/events': function () {},
    '../../lib/helper': {},
    '../ui/card': function () {},
    '../ui/copy-to-clipboard': noop,
    '../tabs/styles/run-tab-styles': {},
    '../tabs/runTab/settings.js': function () {},
    '../tabs/runTab/model/recorder.js': function () {},
    '../tabs/runTab/recorder.js': function () {},
    '../tabs/runTab/model/dropdownlogic.js': function () {},
    '../tabs/runTab/contractDropdown.js': function () {},
    '../ui/tooltip': noop,
    '../ui/universal-dapp-ui': function () {}
  }).RunTab
}

function loadFilePanel () {
  function ViewPlugin () {}
  return loadWithStubs('../src/app/panels/file-panel', {
    react: {},
    'react/jsx-dev-runtime': jsxRuntime(),
    'react-dom': {},
    '@remixproject/engine-web': { ViewPlugin: ViewPlugin },
    '@remix-ui/workspace': { Workspace: function () {} },
    'ethereumjs-util': { bufferToHex: function () { return '' }, keccakFromString: function () { return '' } },
    '../../lib/helper': { checkSpecialChars: function () { return false }, checkSlash: function () { return false } },
    '../files/remixd-handle.js': { RemixdHandle: function () {} },
    '../files/git-handle.js': { GitHandle: function () {} },
    '../files/slither-handle.js': { SlitherHandle: function () {} },
    '../../global/registry': { get: function () { return { api: {} } } },
    '../editor/examples': {},
    '../search/workspace-search': {
      searchWorkspaceFiles: function () { return {} },
      collectSearchableFiles: async function () { return { files: [], skippedFiles: [], warnings: [] } },
      DEFAULT_LIMITS: {},
      DEFAULT_EXCLUDE_PATTERN: ''
    },
    '@remix-project/remix-lib': {
      workspace: {
        tronTemplates: {
          getTronTemplate: function () { return null },
          TRON_TEMPLATES: [{ id: 'blank', name: 'Blank', description: 'Empty workspace' }]
        }
      }
    },
    '../../lib/gist-handler': function () {},
    '../../lib/query-params': function () {},
    '../../lib/url-param-security': { normalizeUrlImport: function (url) { return url } },
    '../../lib/last-workspace': { get: function () { return null } },
    '../ui/modal-dialog-custom': { alert: function () {} }
  })
}

function permissionDispatchPlugin () {}
permissionDispatchPlugin.prototype.callPluginMethod = function (key, args) {
  this.baseDispatches = (this.baseDispatches || 0) + 1
  return this[key](...(args || []))
}

function loadDGitProvider () {
  return loadWithStubs('../src/app/files/dgitProvider', {
    '@remixproject/engine': { Plugin: permissionDispatchPlugin },
    'isomorphic-git': {},
    'isomorphic-git/http/web': {},
    'ipfs-http-client': function () {},
    'file-saver': { saveAs: function () {} },
    '../../lib/github-auth': { getSession: function () { return '' } },
    jszip: function () {},
    'form-data': function () {},
    axios: {}
  })
}

function loadNetworkModule () {
  function Provider () {}
  return loadWithStubs('../src/app/tabs/network-module', {
    '@remixproject/engine': { Plugin: permissionDispatchPlugin },
    web3: { Web3: { providers: { IpcProvider: Provider, HttpProvider: Provider } } }
  }).NetworkModule
}

function loadWeb3Provider () {
  function BN () {}
  BN.prototype.toString = function () { return '0' }
  return loadWithStubs('../src/app/tabs/web3-provider', {
    '@remixproject/engine': { Plugin: permissionDispatchPlugin },
    'ethereumjs-util': { BN: BN },
    '@remix-project/remix-lib': {
      util: {
        addressToBase58: function (address) { return address },
        addressToHex: function (address) { return address }
      }
    }
  }).Web3ProviderModule
}

function loadTerminal () {
  function noopConstructor () {}
  function yo () { return {} }
  return loadWithStubs('../src/app/panels/terminal', {
    '@remixproject/engine': { Plugin: permissionDispatchPlugin },
    dompurify: { sanitize: function (value) { return value } },
    'yo-yo': yo,
    'javascript-serialize': function () {},
    'js-beautify': function () {},
    'component-type': function () {},
    '../../lib/events': noopConstructor,
    '../../lib/cmdInterpreterAPI': noopConstructor,
    '../ui/auto-complete-popup': noopConstructor,
    '../../app/ui/txLogger': noopConstructor,
    'csjs-inject': function () { return {} },
    './styles/terminal-styles': {}
  })
}

function exposedMethods (relativePath) {
  var source = fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8')
  var start = source.indexOf('const profile = {')
  var end = source.indexOf('\n}', start)
  if (start < 0 || end < 0) throw new Error('Cannot find profile in ' + relativePath)
  var profileSource = source.slice(start, end)
  var methods = profileSource.match(/methods:\s*\[([\s\S]*?)\]/)
  if (!methods) return []
  return Array.from(methods[1].matchAll(/'([^']+)'/g), function (match) { return match[1] })
}

function profileUsesPermission (relativePath) {
  var source = fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8')
  var start = source.indexOf('const profile = {')
  var end = source.indexOf('\n}', start)
  return start >= 0 && end >= 0 && /permission:\s*true/.test(source.slice(start, end))
}

function deniedTarget (Target) {
  var target = Object.create(Target.prototype)
  target.currentRequest = { from: 'externalPlugin' }
  target.permissionCalls = []
  target.askUserPermission = async function (method) {
    target.permissionCalls.push(method)
    return false
  }

  var touches = 0
  var permissionProperties = new Set(['currentRequest', 'askUserPermission', '_withUserPermission'])
  var proxy = new Proxy(target, {
    get: function (object, property, receiver) {
      if (typeof property === 'symbol' || permissionProperties.has(property)) {
        return Reflect.get(object, property, receiver)
      }
      touches++
      return Reflect.get(object, property, receiver)
    }
  })
  return { target: target, proxy: proxy, touches: function () { return touches } }
}

async function rejection (value) {
  try {
    await value
    return null
  } catch (error) {
    return error
  }
}

test('settings exposes only a permission-gated read and keeps internal get synchronous', async function (t) {
  var SettingsTab = loadSettingsTab()
  var denied = deniedTarget(SettingsTab)
  var error = await rejection(SettingsTab.prototype.get.call(denied.proxy, 'settings/private'))
  t.ok(error && /Permission denied get/.test(error.message), 'external get rejects after a deny')
  t.deepEqual(denied.target.permissionCalls, ['get'], 'get asks for its own exposed capability')
  t.equal(denied.touches(), 0, 'denied get cannot read the config object')
  t.deepEqual(exposedMethods('app/tabs/settings-tab.js'), ['get'], 'the static profile is fully represented by the deny test')

  var internal = Object.create(SettingsTab.prototype)
  var value = { private: true }
  internal.config = { get: function () { return value } }
  internal.askUserPermission = function () { throw new Error('internal get must not prompt') }
  t.equal(internal.get('settings/private'), value, 'internal get retains its synchronous return value')
  t.end()
})

test('solidity denies every exposed compiler API before compiler state is touched', async function (t) {
  var CompileTab = loadCompileTab()
  var cases = [
    { method: 'getCompilationResult', args: [] },
    { method: 'compile', args: ['contracts/A.sol'] },
    { method: 'compileWithParameters', args: [{}, {}] },
    { method: 'setCompilerConfig', args: [{}] },
    { method: 'compileFile', args: [{ path: ['contracts/A.sol'] }] },
    { method: 'getCompilerVersion', args: [] }
  ]

  t.deepEqual(exposedMethods('app/tabs/compile-tab.js'), cases.map(function (entry) { return entry.method }), 'every exposed compiler method has a dynamic deny case')
  for (const entry of cases) {
    var denied = deniedTarget(CompileTab)
    var result = CompileTab.prototype[entry.method].apply(denied.proxy, entry.args)
    var error = await rejection(result)
    t.ok(error && new RegExp('Permission denied ' + entry.method).test(error.message), entry.method + ' rejects a denied caller')
    t.deepEqual(denied.target.permissionCalls, [entry.method], entry.method + ' asks exactly once for itself')
    t.equal(denied.touches(), 0, entry.method + ' denial happens before compiler/UI access')
  }

  var marker = { compilation: true }
  var internal = Object.create(CompileTab.prototype)
  internal.compileTabLogic = {
    compiler: { state: { lastCompilationResult: marker } },
    compileFile: function () { return marker }
  }
  internal.renderComponent = function () {}
  internal.askUserPermission = function () { throw new Error('internal compiler calls must not prompt') }
  t.equal(internal.getCompilationResult(), marker, 'internal compilation reads remain synchronous')
  t.equal(internal.compile('contracts/A.sol'), marker, 'internal compile keeps its direct return shape')
  t.equal(internal.setCompilerConfig({ optimize: true }), undefined, 'internal config updates keep returning undefined')
  t.end()
})

test('udapp denies every exposed wallet, transaction, account, and AI API before side effects', async function (t) {
  var previousWindow = global.window
  global.window = { _paq: [] }
  var RunTab
  try {
    RunTab = loadRunTab()
  } finally {
    // Keep the stub until method tests finish because sendTransaction uses the
    // module-level _paq reference captured during load.
  }

  var cases = [
    { method: 'connectInjectedTronWeb', args: [] },
    { method: 'disconnectInjectedTronWeb', args: [] },
    { method: 'createVMAccount', args: [{}] },
    { method: 'sendTransaction', args: [{}] },
    { method: 'getAccounts', args: [function () {}] },
    { method: 'pendingTransactionsCount', args: [] },
    { method: 'getSettings', args: [] },
    { method: 'setEnvironmentMode', args: ['vm'] },
    { method: 'aiListContracts', args: [] },
    { method: 'aiDeploy', args: [{}] },
    { method: 'aiCallMethod', args: [{}] },
    { method: 'aiListAccounts', args: [] },
    { method: 'aiGetBalance', args: [{}] },
    { method: 'aiGetEnvironment', args: [] },
    { method: 'aiPreflightTransaction', args: [{}] },
    { method: 'aiGetTransactionStatus', args: [{}] },
    { method: 'aiExportTronbox', args: [{}] },
    { method: 'aiSaveScenario', args: [{}] },
    { method: 'aiRunScenario', args: [{}] },
    { method: 'aiRecordingInfo', args: [] }
  ]

  t.deepEqual(exposedMethods('app/udapp/run-tab.js'), cases.map(function (entry) { return entry.method }), 'every exposed udapp method has a dynamic deny case')
  for (const entry of cases) {
    var denied = deniedTarget(RunTab)
    var result = RunTab.prototype[entry.method].apply(denied.proxy, entry.args)
    var error = await rejection(result)
    t.ok(error && new RegExp('Permission denied ' + entry.method).test(error.message), entry.method + ' rejects a denied caller')
    t.deepEqual(denied.target.permissionCalls, [entry.method], entry.method + ' asks exactly once for itself')
    t.equal(denied.touches(), 0, entry.method + ' denial happens before wallet/account/transaction access')
  }

  var marker = { direct: true }
  var internal = Object.create(RunTab.prototype)
  internal.blockchain = {
    createVMAccount: function () { return marker },
    sendTransaction: function () { return marker },
    getAccounts: function () { return marker },
    pendingTransactionsCount: function () { return 7 }
  }
  internal.askUserPermission = function () { throw new Error('internal udapp calls must not prompt') }
  t.equal(internal.createVMAccount({}), marker, 'internal VM account creation keeps its direct return shape')
  t.equal(internal.sendTransaction({}), marker, 'internal transaction dispatch keeps its direct return shape')
  t.equal(internal.getAccounts(), marker, 'internal account reads keep their direct return shape')
  t.equal(internal.pendingTransactionsCount(), 7, 'internal pending count remains synchronous')

  global.window = previousWindow
  t.end()
})

test('filePanel denies every exposed workspace API before request, provider, or UI access', async function (t) {
  var FilePanel = loadFilePanel()
  var cases = [
    { method: 'createNewFile', args: [] },
    { method: 'uploadFile', args: [{}] },
    { method: 'getCurrentWorkspace', args: [] },
    { method: 'getWorkspaces', args: [] },
    { method: 'createWorkspace', args: ['new-workspace'] },
    { method: 'openCreateWorkspaceDialog', args: [] },
    { method: 'setWorkspace', args: ['workspace'] },
    { method: 'registerContextMenuItem', args: [{ id: 'victim', name: 'action', path: [] }] },
    { method: 'getWorkspaceTemplates', args: [] },
    { method: 'aiSearchWorkspace', args: [{ query: 'secret' }] }
  ]

  t.deepEqual(exposedMethods('app/panels/file-panel.js'), cases.map(function (entry) { return entry.method }), 'every exposed filePanel method has a dynamic deny case')
  for (const entry of cases) {
    var denied = deniedTarget(FilePanel)
    var result = FilePanel.prototype[entry.method].apply(denied.proxy, entry.args)
    var error = await rejection(result)
    t.ok(error && new RegExp('Permission denied ' + entry.method).test(error.message), entry.method + ' rejects a denied caller')
    t.deepEqual(denied.target.permissionCalls, [entry.method], entry.method + ' asks exactly once for itself')
    t.equal(denied.touches(), 0, entry.method + ' denial happens before request/provider/UI access')
  }

  var internal = Object.create(FilePanel.prototype)
  internal.registeredMenuItems = []
  internal.removedMenuItems = []
  internal.renderComponent = function () {}
  internal.askUserPermission = function () { throw new Error('internal filePanel calls must not prompt') }
  t.equal(internal.registerContextMenuItem({ id: 'solidity', name: 'compileFile', extension: ['.sol'] }), undefined, 'internal context-menu registration remains synchronous')
  t.equal(internal.registeredMenuItems[0].id, 'solidity', 'internal context-menu identity is preserved')
  var templates = internal.getWorkspaceTemplates()
  t.ok(Array.isArray(templates) && templates[0].id === 'blank', 'internal template reads remain synchronous')

  var external = Object.create(FilePanel.prototype)
  external.currentRequest = { from: 'externalPlugin' }
  external.askUserPermission = async function () { return true }
  external.registeredMenuItems = []
  external.removedMenuItems = []
  external.renderComponent = function () {}
  await external.registerContextMenuItem({ id: 'fileManager', name: 'writeFile', path: [], sticky: true })
  t.equal(external.registeredMenuItems[0].id, 'externalPlugin', 'external action dispatch is bound to the real caller')
  t.equal(external.registeredMenuItems[0].sticky, false, 'external actions cannot make themselves undeletable')
  t.end()
})

async function verifyGenericTargetGate (t, Target, relativePath) {
  var methods = exposedMethods(relativePath)
  t.ok(profileUsesPermission(relativePath), relativePath + ' declares a permission-aware profile')
  t.ok(methods.length > 0, relativePath + ' exposes methods to cover')
  for (const method of methods) {
    var denied = deniedTarget(Target)
    denied.target.baseDispatches = 0
    var result = Target.prototype.callPluginMethod.call(denied.proxy, method, [])
    var error = await rejection(result)
    t.ok(error && new RegExp('Permission denied ' + method).test(error.message), method + ' rejects a denied caller')
    t.deepEqual(denied.target.permissionCalls, [method], method + ' asks exactly once for itself')
    t.equal(denied.target.baseDispatches, 0, method + ' denial happens before base dispatch')
    t.equal(denied.touches(), 0, method + ' denial happens before target state access')
  }

  var marker = { internal: true }
  var internal = Object.create(Target.prototype)
  internal[methods[0]] = function () { return marker }
  internal.askUserPermission = function () { throw new Error('internal dispatch must not prompt') }
  t.equal(Target.prototype.callPluginMethod.call(internal, methods[0], []), marker, 'internal dispatch keeps its direct return shape')
}

test('dGitProvider gates its complete exposed git/IPFS surface at engine dispatch', async function (t) {
  var DGitProvider = loadDGitProvider()
  await verifyGenericTargetGate(t, DGitProvider, 'app/files/dgitProvider.js')
  var source = fs.readFileSync(path.join(sourceRoot, 'app/files/dgitProvider.js'), 'utf8')
  t.equal(source.includes("askUserPermission('pull'"), false, 'pull does not open a duplicate inner permission prompt')
  t.end()
})

test('dGitProvider gives force push its own destructive permission target', async function (t) {
  var DGitProvider = loadDGitProvider()
  var commandGuard = Object.create(DGitProvider.prototype)
  t.throws(function () { commandGuard._safeGitCommand({ dir: '/other/workspace' }, ['url']) }, /Unsupported Git command option/)
  t.throws(function () { commandGuard._safeGitCommand({ filepath: '../outside' }, ['filepath']) }, /current workspace/)
  var target = Object.create(DGitProvider.prototype)
  target.currentRequest = { from: 'externalPlugin' }
  target.permissionCalls = []
  target.baseDispatches = 0
  target.askUserPermission = async function (method) {
    target.permissionCalls.push(method)
    return false
  }
  var denied = DGitProvider.prototype.callPluginMethod.call(target, 'pushRemote', [{ force: true }])
  var error = await rejection(denied)
  t.ok(error && /Permission denied forcePushRemote/.test(error.message), 'force push is denied under its dedicated permission')
  t.deepEqual(target.permissionCalls, ['forcePushRemote'], 'force push does not reuse ordinary push permission')
  t.equal(target.baseDispatches, 0, 'force push denial happens before dispatch')

  var ordinary = Object.create(DGitProvider.prototype)
  ordinary.currentRequest = { from: 'externalPlugin' }
  ordinary.permissionCalls = []
  ordinary.askUserPermission = async function (method) {
    ordinary.permissionCalls.push(method)
    return false
  }
  var ordinaryDenied = DGitProvider.prototype.callPluginMethod.call(ordinary, 'pushRemote', [{ force: false }])
  await rejection(ordinaryDenied)
  t.deepEqual(ordinary.permissionCalls, ['pushRemote'], 'ordinary push keeps the ordinary permission target')
  t.end()
})

test('network gates provider reads and mutations before blockchain access', async function (t) {
  var NetworkModule = loadNetworkModule()
  await verifyGenericTargetGate(t, NetworkModule, 'app/tabs/network-module.js')
  t.end()
})

test('web3Provider gates dispatch and restricts accepted external RPC to read-only methods', async function (t) {
  var Web3ProviderModule = loadWeb3Provider()
  await verifyGenericTargetGate(t, Web3ProviderModule, 'app/tabs/web3-provider.js')

  var dangerous = [
    'eth_sendTransaction', 'eth_sendRawTransaction', 'eth_sign', 'personal_sign',
    'wallet_requestPermissions', 'admin_addPeer', 'miner_start', 'debug_setHead',
    'hardhat_reset', 'evm_mine', 'wallet/broadcasttransaction', 'wallet/createtransaction'
  ]
  dangerous.forEach(function (method) {
    t.equal(rpcSecurity.isReadOnlyProviderMethod(method), false, method + ' is outside the external read-only allowlist')
  })
  ;['eth_getBalance', 'eth_call', 'eth_getTransactionReceipt', 'wallet/getaccount', 'wallet/triggerconstantcontract'].forEach(function (method) {
    t.equal(rpcSecurity.isReadOnlyProviderMethod(method), true, method + ' remains available after permission')
  })

  var deniedRpc = Object.create(Web3ProviderModule.prototype)
  deniedRpc.currentRequest = { from: 'externalPlugin' }
  deniedRpc.call = async function () { return { name: 'externalPlugin' } }
  var blockchainReads = 0
  Object.defineProperty(deniedRpc, 'blockchain', {
    configurable: true,
    get: function () { blockchainReads++; return {} }
  })
  var error = await rejection(deniedRpc.sendAsync({ jsonrpc: '2.0', id: 1, method: 'eth_sendTransaction', params: [{}] }))
  t.ok(error && /read-only provider methods/.test(error.message), 'permission alone cannot authorize an external transaction RPC')
  t.equal(blockchainReads, 0, 'dangerous RPC is rejected before provider access')

  var readRpc = Object.create(Web3ProviderModule.prototype)
  readRpc.currentRequest = { from: 'externalPlugin' }
  readRpc.call = async function () { return { name: 'externalPlugin' } }
  var providerCalls = 0
  readRpc.blockchain = {
    web3: function () {
      return {
        currentProvider: {
          sendAsync: function (payload, callback) {
            providerCalls++
            callback(null, { jsonrpc: '2.0', id: payload.id, result: '0x1' })
          }
        }
      }
    }
  }
  var readResult = await readRpc.sendAsync({ jsonrpc: '2.0', id: 2, method: 'eth_getBalance', params: ['0x0', 'latest'] })
  t.equal(readResult.result, '0x1', 'an allowlisted read reaches the provider')
  t.equal(providerCalls, 1, 'the read-only provider call executes once')

  var tronRpc = Object.create(Web3ProviderModule.prototype)
  tronRpc.currentRequest = { from: 'externalPlugin' }
  tronRpc.call = async function () { return { name: 'externalPlugin' } }
  var tronCalls = 0
  tronRpc.blockchain = {
    web3: function () {
      return {
        fullNode: {
          request: async function (endpoint) { tronCalls++; return { endpoint: endpoint } }
        }
      }
    }
  }
  var tronResult = await tronRpc.sendAsync({ jsonrpc: '2.0', id: 3, method: 'wallet/getaccount', params: [{ address: 'T...' }] })
  t.equal(tronResult.result.endpoint, 'wallet/getaccount', 'an allowlisted TRON read reaches fullNode')
  t.equal(tronCalls, 1, 'the TRON read executes once')

  var trustedRpc = Object.create(Web3ProviderModule.prototype)
  trustedRpc.currentRequest = { from: 'aiPanel' }
  trustedRpc.call = async function () { return { name: 'aiPanel' } }
  var trustedCalls = 0
  trustedRpc.blockchain = {
    web3: function () {
      return {
        currentProvider: {
          send: function (payload, callback) { trustedCalls++; callback(null, { id: payload.id, result: 'native' }) }
        }
      }
    }
  }
  var trustedResult = await trustedRpc.sendAsync({ jsonrpc: '2.0', id: 4, method: 'eth_sendTransaction', params: [{}] })
  t.equal(trustedResult.result, 'native', 'a registered required host caller retains provider compatibility')
  t.equal(trustedCalls, 1, 'trusted host RPC executes once')
  t.end()
})

test('terminal plugin logging cannot dispatch executable commands', function (t) {
  var Terminal = loadTerminal()
  var terminal = Object.create(Terminal.prototype)
  var scripts = 0
  var infos = 0
  terminal.currentRequest = { from: 'externalPlugin', path: 'terminal' }
  terminal.commands = {
    script: function () { scripts++ },
    info: function () { infos++ }
  }

  t.throws(function () {
    terminal.log({ type: 'script', value: 'window.remix.call("fileManager", "readFile", "secret")' })
  }, /display messages/, 'engine-dispatched script commands are rejected')
  t.equal(scripts, 0, 'rejected script never reaches the terminal command handler')
  t.doesNotThrow(function () { terminal.log({ type: 'info', value: 'safe output' }) }, 'display-only plugin logs remain supported')
  t.equal(infos, 1, 'safe display message reaches its renderer once')

  delete terminal.currentRequest
  t.doesNotThrow(function () { terminal.log({ type: 'script', value: 'trusted host script' }) }, 'direct host command dispatch retains existing behavior')
  t.equal(scripts, 1, 'direct host script reaches the command handler')
  t.end()
})
