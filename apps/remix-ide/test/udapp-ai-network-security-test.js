/*
 * Dynamic regression coverage for transaction-capable AI APIs exposed by
 * udapp. Untrusted connectors may use only the in-browser VM or public TRON
 * testnets; host plugins retain the existing mainnet workflow.
 */

'use strict'

var Module = require('module')
var test = require('tape')
var networkSecurity = require('../src/blockchain/transaction-network-security')
var DEPLOYED_ADDRESS = 'TUQPrDEJkV4ttkrL7cVv1p3mikWYfM7LWt'
var DEPLOYED_ADDRESS_HEX = '0xca35b7d915458ef540ade6068dfe2f44e8fa733c'

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
        walletProviderAdapter: {
          WALLET_STATUS: {},
          WALLET_ERROR_MESSAGES: {},
          WALLET_ERROR_CODES: { WALLET_REQUEST_TIMEOUT: 'WALLET_REQUEST_TIMEOUT' },
          WALLET_NODE_TIMEOUT_MS: 1000,
          withWalletTimeout: async function (operation) { return operation }
        },
        walletAdapterManager: {},
        txFormat: {}
      },
      util: {
        addressToHex: function (address) {
          return address === DEPLOYED_ADDRESS ? DEPLOYED_ADDRESS_HEX : address
        },
        addressToBase58: function (address) {
          return address === DEPLOYED_ADDRESS_HEX ? DEPLOYED_ADDRESS : address
        }
      }
    },
    '../../lib/events': function () {},
    '../../lib/helper': { addressToString: function (value) { return value } },
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

function loadExecutionContext () {
  function FakeHttpProvider (host) { this.host = host }
  function FakeWeb3 (provider) { this.currentProvider = provider }
  FakeWeb3.providers = { HttpProvider: FakeHttpProvider }
  function FakeEventManager () { this.listeners = {} }
  FakeEventManager.prototype.register = function (name, handler) { this.listeners[name] = handler }
  FakeEventManager.prototype.trigger = function (name, args) {
    if (this.listeners[name]) this.listeners[name].apply(null, args || [])
  }
  var walletProviderAdapter = {
    getInjectedWalletProvider: function (targetWindow) {
      return { tronWeb: targetWindow && targetWindow.tronWeb, tronLink: targetWindow && targetWindow.tronLink }
    },
    clearInjectedWalletConnectionGuard: function () {},
    getInjectedWalletStatus: function () { return 'connected' },
    WALLET_ERROR_MESSAGES: {},
    WALLET_ERROR_CODES: {},
    normalizeWalletError: function (error) { return { code: 'UNKNOWN', message: String(error) } },
    createWalletError: function (code, error) { return error || new Error(code) }
  }
  return loadWithStubs('../src/blockchain/execution-context', {
    web3: FakeWeb3,
    '../lib/events': FakeEventManager,
    '@remix-project/remix-lib': { execution: { walletProviderAdapter: walletProviderAdapter } }
  }).ExecutionContext
}

async function rejection (value) {
  try {
    await value
    return null
  } catch (error) {
    return error
  }
}

function harness (RunTab, options) {
  options = options || {}
  var caller = options.caller || 'externalPlugin'
  var state = {
    permissionCalls: [],
    profileReads: 0,
    networkProbes: 0,
    transactionTouches: 0,
    replayCalls: 0,
    replayMarked: false
  }
  var target = Object.create(RunTab.prototype)
  target.currentRequest = { from: caller }
  target.askUserPermission = async function (method) {
    state.permissionCalls.push(method)
    return options.permission !== false
  }
  target.call = async function (plugin, method, requestedCaller) {
    if (plugin !== 'manager' || method !== 'getProfile') throw new Error('unexpected plugin call')
    state.profileReads++
    return options.profile || { name: requestedCaller, hash: 'remote:untrusted' }
  }
  target.blockchain = {
    getProvider: function () { return options.provider || 'injected' },
    detectNetwork: function (callback) {
      state.networkProbes++
      if (options.networkError) callback(options.networkError, options.network)
      else callback(null, options.network)
    },
    runOrCallContractMethod: function () {
      state.transactionTouches++
      var outputCb = arguments[10]
      outputCb('42')
    }
  }
  target.logCallback = function () {}
  Object.defineProperty(target, 'recorderInterface', {
    configurable: true,
    get: function () {
      state.transactionTouches++
      return {
        aiRunScenario: async function (replayOptions) {
          state.replayCalls++
          state.replayMarked = networkSecurity.isExternalPluginTransaction(replayOptions)
          return { ok: true }
        }
      }
    }
  })
  target._aiSelectedContract = function () {
    state.transactionTouches++
    return { bytecodeObject: '00', abi: [], name: 'C', contract: { file: 'C.sol' } }
  }
  // These tests isolate caller/network provenance. The canonical AI approval
  // snapshot is covered separately by the transaction-intelligence suite and
  // remains mandatory on the merged v2.3.3 deploy/write APIs.
  target._aiAssertApprovalSnapshot = async function () { return { from: null } }
  return { target: target, state: state }
}

function invokeTransactionApi (target, method) {
  if (method === 'aiDeploy') return target.aiDeploy({ contractName: 'C' })
  if (method === 'aiCallMethod') {
    return target.aiCallMethod({
      address: 'TTarget',
      contractName: 'C',
      method: 'set',
      args: ['7'],
      abi: [{ type: 'function', name: 'set', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] }]
    })
  }
  return target.aiRunScenario({ path: 'scenario.json' })
}

test('AI transaction metadata pins an explicit zero value instead of reading panel state', function (t) {
  var subject = Object.create(RunTab.prototype)
  t.deepEqual(subject._aiTxMeta({}), { value: '0' }, 'an omitted AI value is explicit zero')
  t.deepEqual(subject._aiTxMeta({ value: '0' }), { value: '0' }, 'an explicit zero stays explicit')
  t.deepEqual(subject._aiTxMeta({ tokenId: '1000001', tokenValue: '1' }), { value: '0', tokenId: '0xf4241', tokenValue: '0x1' }, 'token-only calls cannot inherit panel TRX value')
  t.end()
})

test('AI deploy treats an omitted value as zero for non-payable constructors', async function (t) {
  var subject = harness(RunTab, { network: { name: 'TRON', id: 'nile' } }).target
  var receivedMeta = null
  subject._aiDropdownLogic = function () { return { getCompilerContracts: function () { return {} } } }
  subject._aiResolveFrom = async function () { return undefined }
  subject._aiEncodeArgs = function () { return '' }
  subject.compilersArtefacts = {
    getCompilerAbstract: function () { return {} },
    addResolvedContract: function () {}
  }
  subject.blockchain.deployContractAndLibraries = function (selected, args, metadata, contracts, callbacks, confirmation, txMeta) {
    receivedMeta = txMeta
    callbacks.finalCb(null, selected, DEPLOYED_ADDRESS, { transactionHash: '0x' + 'b'.repeat(64) })
  }

  var result = await subject.aiDeploy({ contractName: 'C' })
  t.equal(result.address, DEPLOYED_ADDRESS, 'a non-payable deployment without value reaches the blockchain pipeline')
  t.equal(receivedMeta.value, '0', 'the explicit zero value is forwarded without triggering payable validation')
  t.end()
})

test('AI deploy clears its safety timeout after the blockchain callback settles', async function (t) {
  var subject = harness(RunTab, { network: { name: 'TRON', id: 'nile' } }).target
  subject._aiDropdownLogic = function () { return { getCompilerContracts: function () { return {} } } }
  subject._aiResolveFrom = async function () { return undefined }
  subject._aiEncodeArgs = function () { return '' }
  subject.compilersArtefacts = {
    getCompilerAbstract: function () { return {} },
    addResolvedContract: function () {}
  }

  var timers = []
  var cleared = []
  var originalSetTimeout = global.setTimeout
  var originalClearTimeout = global.clearTimeout
  global.setTimeout = function (callback, delay) {
    var timer = { callback: callback, delay: delay }
    timers.push(timer)
    return timer
  }
  global.clearTimeout = function (timer) { cleared.push(timer) }
  try {
    subject.blockchain.deployContractAndLibraries = function (selected, args, metadata, contracts, callbacks) {
      callbacks.finalCb(null, selected, DEPLOYED_ADDRESS, { transactionHash: '0x' + 'd'.repeat(64) })
    }
    var result = await subject.aiDeploy({ contractName: 'C' })
    t.equal(result.address, DEPLOYED_ADDRESS, 'deployment resolves from the blockchain callback')
    t.equal(timers.length, 1, 'deployment installs one safety timeout')
    t.deepEqual(cleared, timers, 'settling the deployment clears the safety timeout')
  } finally {
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
  }
  t.end()
})

var previousWindow = global.window
global.window = { _paq: [] }
var RunTab = loadRunTab()
global.window = previousWindow

test('provider context epoch tracks injected rebinds, in-place host changes, VM, and custom providers', function (t) {
  var savedWindow = global.window
  var firstInjected = { fullNode: { host: 'https://nile.trongrid.io' } }
  global.window = { tronWeb: firstInjected, tronLink: { ready: true } }
  try {
    var ExecutionContext = loadExecutionContext()
    var context = new ExecutionContext()
    context.executionContext = 'injected'
    var initial = context.getProviderContextEpoch()
    t.equal(context.getProviderContextEpoch(), initial, 'an unchanged injected provider keeps a stable epoch')

    global.window.tronWeb = { fullNode: { host: 'https://api.trongrid.io' } }
    global.window.tronLink = { ready: true }
    var rebound = context.getProviderContextEpoch()
    t.ok(rebound > initial, 'an injected provider object rebind advances the epoch')
    t.equal(context.getProviderContextEpoch(), rebound, 'the rebound provider remains stable after observation')

    global.window.tronWeb.fullNode.host = 'https://nile.trongrid.io'
    var hostChanged = context.getProviderContextEpoch()
    t.ok(hostChanged > rebound, 'an in-place injected host change advances the epoch')

    context.executionContext = 'vm'
    var vmEpoch = context.getProviderContextEpoch()
    t.ok(vmEpoch > hostChanged, 'switching to VM advances the epoch')
    t.equal(context.getProviderContextEpoch(), vmEpoch, 'the VM provider does not create false epoch churn')

    var custom = { fullNode: { host: 'https://custom-one.example' } }
    context.setWeb3('custom-one', custom)
    context.executionContext = 'custom-one'
    var customEpoch = context.getProviderContextEpoch()
    t.ok(customEpoch > vmEpoch, 'switching to a custom provider advances the epoch')
    t.equal(context.getProviderContextEpoch(), customEpoch, 'an unchanged custom provider keeps a stable epoch')

    custom.fullNode.host = 'https://custom-two.example'
    var customHostEpoch = context.getProviderContextEpoch()
    t.ok(customHostEpoch > customEpoch, 'an in-place custom host change advances the epoch')
    context.setWeb3('custom-one', { fullNode: { host: 'https://custom-two.example' } })
    t.ok(context.getProviderContextEpoch() > customHostEpoch, 'a same-host custom provider object replacement still advances the epoch')
  } finally {
    global.window = savedWindow
    t.end()
  }
})

test('external AI transaction APIs deny main, custom, and unknown networks before side effects', async function (t) {
  var networks = [
    { label: 'mainnet', value: { name: 'TRON', id: 'main' } },
    { label: 'custom', value: { name: 'Custom', id: 'Unknown' } },
    { label: 'unknown', value: { name: 'Unknown', id: 'Unknown' } }
  ]
  var methods = ['aiDeploy', 'aiCallMethod', 'aiRunScenario']

  for (const network of networks) {
    for (const method of methods) {
      var subject = harness(RunTab, { network: network.value })
      // The write-call path must not reach tx metadata/account/event state.
      subject.target._aiTxMeta = function () { subject.state.transactionTouches++; return {} }
      subject.target._aiResolveFrom = async function () { subject.state.transactionTouches++; return undefined }
      var error = await rejection(invokeTransactionApi(subject.target, method))
      t.ok(error && /allowed only on JavaScript VM, Nile, or Shasta/.test(error.message), method + ' denies ' + network.label)
      t.equal(subject.state.transactionTouches, 0, method + ' touches no transaction/replay state on ' + network.label)
      t.deepEqual(subject.state.permissionCalls, [method], method + ' asks permission before the network check')
      t.equal(subject.state.networkProbes, 1, method + ' probes the active network once')
    }
  }
  t.end()
})

test('external AI transaction APIs stop at permission denial before probing the network', async function (t) {
  for (const method of ['aiDeploy', 'aiCallMethod', 'aiRunScenario']) {
    var subject = harness(RunTab, { permission: false, network: { name: 'TRON', id: 'nile' } })
    var error = await rejection(invokeTransactionApi(subject.target, method))
    t.ok(error && new RegExp('Permission denied ' + method).test(error.message), method + ' reports permission denial')
    t.equal(subject.state.profileReads, 0, method + ' does not read caller trust after permission denial')
    t.equal(subject.state.networkProbes, 0, method + ' does not probe the network after permission denial')
    t.equal(subject.state.transactionTouches, 0, method + ' cannot touch transaction/replay state after permission denial')
  }
  t.end()
})

test('external scenario replay remains available on VM, Nile, and Shasta', async function (t) {
  var allowed = [
    { name: 'JavaScript VM (Tron)', id: '-' },
    { name: 'TRON', id: 'nile' },
    { name: 'TRON', id: 'shasta' }
  ]
  for (const network of allowed) {
    var subject = harness(RunTab, { network: network })
    var result = await subject.target.aiRunScenario({ path: 'scenario.json' })
    t.deepEqual(result, { ok: true }, network.name + '/' + network.id + ' is allowed')
    t.equal(subject.state.networkProbes, 1, 'the allowed network is verified once')
    t.equal(subject.state.replayCalls, 1, 'scenario replay runs after verification')
    t.equal(subject.state.replayMarked, true, 'scenario replay carries untrusted provenance to every transaction')
  }
  t.end()
})

test('trusted aiPanel keeps its mainnet path and external read-only calls remain unrestricted', async function (t) {
  var nativeSubject = harness(RunTab, {
    caller: 'aiPanel',
    profile: { name: 'aiPanel' },
    network: { name: 'TRON', id: 'main' }
  })
  var nativeResult = await nativeSubject.target.aiRunScenario({ path: 'scenario.json' })
  t.deepEqual(nativeResult, { ok: true }, 'trusted aiPanel can keep replaying on mainnet')
  t.equal(nativeSubject.state.networkProbes, 0, 'trusted aiPanel bypasses the external network restriction')
  t.equal(nativeSubject.state.replayCalls, 1, 'trusted aiPanel reaches the existing replay pipeline')
  t.equal(nativeSubject.state.replayMarked, false, 'trusted aiPanel replay is not marked as an external connector transaction')

  var readSubject = harness(RunTab, { network: { name: 'TRON', id: 'main' } })
  var originalSetTimeout = global.setTimeout
  global.setTimeout = function () { return 0 }
  var readResult
  try {
    readResult = await readSubject.target.aiCallMethod({
      address: 'TTarget',
      contractName: 'C',
      method: 'value',
      readOnly: true,
      abi: [{ type: 'function', name: 'value', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }]
    })
  } finally {
    global.setTimeout = originalSetTimeout
  }
  t.deepEqual(readResult, { ok: true, kind: 'read', result: '42' }, 'external read-only call still returns its result on mainnet')
  t.equal(readSubject.state.profileReads, 0, 'read-only call does not need a caller trust lookup')
  t.equal(readSubject.state.networkProbes, 0, 'read-only call does not apply the transaction network policy')
  t.equal(readSubject.state.transactionTouches, 1, 'read-only call reaches only the normal call pipeline')
  t.end()
})

test('transaction status waits through the short pending receipt window', async function (t) {
  var subject = harness(RunTab, { network: { name: 'TRON', id: 'nile' } })
  var hash = 'a'.repeat(64)
  var infoCalls = 0
  subject.target._aiEnvironmentSnapshot = async function () {
    return { provider: 'injected', network: { id: 'nile', stale: false } }
  }
  var statusProvider = {
    trx: {
      getTransaction: async function () { return { txID: hash } },
      getUnconfirmedTransactionInfo: async function () {
        infoCalls++
        return infoCalls < 3 ? {} : { id: hash, blockNumber: 42, receipt: { result: 'SUCCESS' } }
      },
      getTransactionInfo: async function () { throw new Error('solidity-node lookup should not be used for confirmation') }
    }
  }
  subject.target.blockchain.web3 = function () {
    return statusProvider
  }
  var originalSetTimeout = global.setTimeout
  global.setTimeout = function (callback) { callback(); return 0 }
  var result
  try {
    result = await subject.target.aiGetTransactionStatus({ txHash: hash })
  } finally {
    global.setTimeout = originalSetTimeout
  }

  t.equal(result.status, 'success', 'the status API returns the receipt that appears during polling')
  t.equal(result.blockNumber, 42, 'the final receipt evidence is preserved')
  t.equal(result.lookupAttempts, 3, 'the status API exposes how many lookups were needed')
  t.equal(infoCalls, 3, 'the same transaction hash is queried without resubmitting it')
  t.end()
})

test('transaction status falls back to the full-node receipt endpoint', async function (t) {
  var subject = harness(RunTab, { network: { name: 'TRON', id: 'nile' } })
  var hash = 'b'.repeat(64)
  var requested = []
  subject.target._aiEnvironmentSnapshot = async function () {
    return { provider: 'injected', network: { id: 'nile', stale: false } }
  }
  var fallbackProvider = {
    trx: {
      getTransaction: async function () { return { txID: hash } }
    },
    fullNode: {
      request: async function (endpoint, params, method) {
        requested.push({ endpoint: endpoint, params: params, method: method })
        return { id: hash, blockNumber: 43, receipt: { result: 'SUCCESS' } }
      }
    }
  }
  subject.target.blockchain.web3 = function () {
    return fallbackProvider
  }
  var result = await subject.target.aiGetTransactionStatus({ txHash: hash })

  t.equal(result.status, 'success', 'full-node receipt success is final')
  t.equal(result.blockNumber, 43, 'full-node receipt block evidence is preserved')
  t.deepEqual(requested, [{ endpoint: 'wallet/gettransactioninfobyid', params: { value: hash }, method: 'post' }], 'confirmation falls back to wallet/gettransactioninfobyid on the full node')
  t.end()
})

test('transaction status discards in-flight results when the wallet network changes', async function (t) {
  var subject = harness(RunTab, { network: { name: 'TRON', id: 'nile' } })
  var hash = 'c'.repeat(64)
  var networkId = 'nile'
  var transactionCalls = 0
  var infoCalls = 0
  subject.target._aiEnvironmentSnapshot = async function () {
    var currentId = networkId
    return {
      provider: 'injected',
      network: { known: true, id: currentId, stale: false },
      endpoint: currentId === 'nile' ? 'https://nile.trongrid.io' : 'https://api.trongrid.io'
    }
  }
  var switchingProvider = {
    trx: {
      getTransaction: async function () {
        transactionCalls++
        return { txID: hash }
      },
      getUnconfirmedTransactionInfo: async function () {
        infoCalls++
        // Simulate TronLink changing to Mainnet while the node requests are
        // in flight. The successful-looking response must be discarded.
        networkId = 'main'
        return { id: hash, blockNumber: 44, receipt: { result: 'SUCCESS' } }
      }
    }
  }
  subject.target.blockchain.web3 = function () {
    return switchingProvider
  }

  var result = await subject.target.aiGetTransactionStatus({ txHash: hash })

  t.equal(result.status, 'unknown', 'a cross-network response is never reported as final')
  t.equal(result.code, 'STATE_CHANGED', 'network drift has a canonical state-change code')
  t.equal(result.explorerUrl, null, 'old Nile metadata is not combined with a new-network response')
  t.equal(result.blockNumber, null, 'receipt data from the changed context is discarded')
  t.equal(result.lookupAttempts, 1, 'state drift stops polling immediately')
  t.equal(transactionCalls, 1, 'only the original hash is read once')
  t.equal(infoCalls, 1, 'the status resolver never resubmits a transaction')
  t.ok(/same transaction hash/.test(result.userAction) && /Do not resubmit/.test(result.userAction), 'recovery instructs a same-hash query without resubmission')
  t.end()
})

test('transaction status rejects a Nile to Mainnet to Nile ABA provider transition', async function (t) {
  var subject = harness(RunTab, { network: { name: 'TRON', id: 'nile' } })
  var hash = 'd'.repeat(64)
  var providerEpoch = 12
  var transactionCalls = 0
  var infoCalls = 0
  subject.target._aiEnvironmentSnapshot = async function () {
    // The string snapshot is Nile both before and after the RPC. Only the
    // monotonic provider epoch proves that Mainnet was active in between.
    return {
      provider: 'injected',
      network: { known: true, id: 'nile', stale: false },
      endpoint: 'https://nile.trongrid.io'
    }
  }
  var nileProvider = {
    fullNode: { host: 'https://nile.trongrid.io' },
    trx: {
      getTransaction: async function () {
        transactionCalls++
        return { txID: hash }
      },
      getUnconfirmedTransactionInfo: async function () {
        infoCalls++
        providerEpoch++ // Nile -> Mainnet
        var mainnetReceipt = { id: hash, blockNumber: 45, receipt: { result: 'SUCCESS' } }
        providerEpoch++ // Mainnet -> Nile before the post-read snapshot
        return mainnetReceipt
      }
    }
  }
  subject.target.blockchain.web3 = function () { return nileProvider }
  subject.target.blockchain.getProviderContextEpoch = function () { return providerEpoch }

  var result = await subject.target.aiGetTransactionStatus({ txHash: hash })

  t.equal(result.status, 'unknown', 'ABA evidence fails closed even though the final network string is Nile again')
  t.equal(result.code, 'STATE_CHANGED', 'ABA drift has a canonical state-change code')
  t.equal(result.explorerUrl, null, 'no Nile explorer link is attached to the intervening Mainnet receipt')
  t.equal(result.blockNumber, null, 'receipt evidence from the intervening provider is discarded')
  t.equal(result.lookupAttempts, 1, 'ABA drift stops polling immediately')
  t.equal(transactionCalls, 1, 'the original hash is read once')
  t.equal(infoCalls, 1, 'the resolver never submits or repeats a transaction')
  t.ok(/Do not resubmit/.test(result.userAction), 'recovery explicitly forbids resubmission')
  t.end()
})

test('allowed external deploy and write carry unforgeable provenance to Blockchain', async function (t) {
  var deploySubject = harness(RunTab, { network: { name: 'TRON', id: 'nile' } })
  var deployMarked = false
  deploySubject.target._aiDropdownLogic = function () { return { getCompilerContracts: function () { return {} } } }
  deploySubject.target._aiTxMeta = function () { return {} }
  deploySubject.target._aiResolveFrom = async function () { return undefined }
  deploySubject.target._aiEncodeArgs = function () { return '' }
  deploySubject.target.compilersArtefacts = {
    getCompilerAbstract: function () { return {} },
    addResolvedContract: function () {}
  }
  deploySubject.target.blockchain.deployContractAndLibraries = function (selected, args, metadata, contracts, callbacks, confirmation, txMeta) {
    deployMarked = networkSecurity.isExternalPluginTransaction(txMeta)
    callbacks.finalCb(null, selected, DEPLOYED_ADDRESS, { transactionHash: '0x' + 'a'.repeat(64) })
  }
  var originalSetTimeout = global.setTimeout
  global.setTimeout = function () { return 0 }
  var deployResult
  try {
    deployResult = await deploySubject.target.aiDeploy({ contractName: 'C', externalPluginTransaction: false })
  } finally {
    global.setTimeout = originalSetTimeout
  }
  t.equal(deployResult.address, DEPLOYED_ADDRESS, 'allowed deploy reaches the existing blockchain pipeline')
  t.equal(deployResult.txHash, '0x' + 'a'.repeat(64), 'deploy returns the exact transaction hash for status resolution')
  t.equal(deployMarked, true, 'connector JSON cannot clear the deploy provenance marker')

  var writeSubject = harness(RunTab, { network: { name: 'TRON', id: 'shasta' } })
  var writeMarked = false
  writeSubject.target.blockchain.event = { register: function () {}, unregister: function () {} }
  writeSubject.target.blockchain.runOrCallContractMethod = function () {
    writeMarked = networkSecurity.isExternalPluginTransaction(arguments[14])
    throw new Error('write reached blockchain')
  }
  global.setTimeout = function () { return 0 }
  var writeError
  try {
    writeError = await rejection(writeSubject.target.aiCallMethod({
      address: 'TTarget',
      contractName: 'C',
      method: 'set',
      abi: [{ type: 'function', name: 'set', stateMutability: 'nonpayable', inputs: [], outputs: [] }]
    }))
  } finally {
    global.setTimeout = originalSetTimeout
  }
  t.ok(writeError && /write reached blockchain/.test(writeError.message), 'allowed write reaches the existing blockchain pipeline')
  t.equal(writeMarked, true, 'write txMeta carries untrusted caller provenance')
  t.end()
})

test('VM revert is a known AI write failure, not broadcast uncertainty', async function (t) {
  var subject = harness(RunTab, { network: { name: 'TRON', id: 'nile' } }).target
  subject.blockchain.getProvider = function () { return 'vm' }
  subject.blockchain.runOrCallContractMethod = function () {
    var completionCb = arguments[15]
    completionCb('VM error: revert\nInsufficientBalance(500, 100)', { transactionHash: '0x' + 'c'.repeat(64) })
  }

  var result = await subject.aiCallMethod({
    address: 'TTarget',
    contractName: 'Guard',
    method: 'withdraw',
    args: ['500'],
    abi: [{ type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] }]
  })
  t.equal(result.ok, false, 'a deterministic VM revert returns a failed result')
  t.equal(result.txHash, '0x' + 'c'.repeat(64), 'the VM transaction hash is retained')
  t.match(result.message, /InsufficientBalance\(500, 100\)/, 'the revert reason is preserved for the model')
  t.end()
})
