/* Exercise Blockchain.runTx itself to prove the commit-time network guard runs
 * before initiatingTransaction/rawRun and binds the fresh network snapshot. */

'use strict'

var Module = require('module')
var test = require('tape')
var networkSecurity = require('../src/blockchain/transaction-network-security')

function loadBlockchain () {
  var originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'web3') return function () {}
    if (request === 'ethereumjs-util') {
      return { toBuffer: function (value) { return value }, addHexPrefix: function (value) { return value }, BN: function () {} }
    }
    if (request === './execution-context') return { ExecutionContext: function () {} }
    if (request === './providers/vm.js' || request === './providers/injected.js' || request === './providers/node.js') return function () {}
    if (request === '@remix-project/remix-lib') {
      return {
        util: {},
        EventManager: function () {},
        helpers: { txResultHelper: function (result) { return result } },
        execution: {
          txFormat: {},
          txExecution: {},
          typeConversion: {},
          txListener: function () {},
          TxRunner: function () {},
          TxRunnerWeb3: function () {},
          txHelper: {},
          runtimeFacade: {
            createRuntimeFacade: function () {
              return {
                validateTransaction: function () { return { ok: true } },
                createTransactionSummary: function (summary) { return summary },
                createTransactionSnapshot: function (snapshot) { return snapshot },
                normalizeReceipt: function (receipt) { return receipt }
              }
            }
          }
        }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  var babelRegister = require('@babel/register')
  babelRegister({
    extensions: ['.js'],
    cache: false,
    babelrc: false,
    configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]]
  })
  var modulePath = require.resolve('../src/blockchain/blockchain')
  delete require.cache[modulePath]
  try {
    return require(modulePath)
  } finally {
    Module._load = originalLoad
    babelRegister.revert()
  }
}

function createSubject (Blockchain, network, networkError) {
  var state = { probes: 0, rawRuns: 0, initiating: 0, rawTx: null }
  var blockchain = Object.create(Blockchain.prototype)
  blockchain.transactionContextAPI = {}
  blockchain.networkStatus = { network: network }
  blockchain._networkSnapshotFresh = true
  blockchain.executionContext = {
    isVM: function () { return false },
    web3: function () { return {} },
    getProvider: function () { return 'injected' },
    detectNetwork: function (callback) {
      state.probes++
      callback(networkError || null, network)
    }
  }
  blockchain.event = {
    trigger: function (name) {
      if (name === 'initiatingTransaction') state.initiating++
    }
  }
  blockchain.txRunner = {
    rawRun: function (tx, confirmationCb, continueCb, promptCb, callback) {
      state.rawRuns++
      state.rawTx = tx
      callback(null, { receipt: { status: true, contractAddress: null }, transactionHash: '0x1' })
    }
  }
  blockchain.web3 = function () {
    return { eth: { getExecutionResultFromSimulator: async function () { return {} } } }
  }
  return { blockchain: blockchain, state: state }
}

function transactionArgs () {
  return {
    from: 'TFrom',
    to: 'TTarget',
    value: '0',
    useCall: false,
    data: {
      dataHex: '00',
      funAbi: { type: 'function', name: 'set' },
      funArgs: [],
      contractBytecode: '',
      contractName: 'C',
      contractABI: [],
      timestamp: 1
    }
  }
}

function runTx (subject, args) {
  return new Promise(function (resolve) {
    subject.blockchain.runTx(args, function () {}, function () {}, function () {}, function (error, result) {
      resolve({ error: error, result: result })
    })
  })
}

test('Blockchain.runTx revalidates marked transactions at the commit boundary', async function (t) {
  var Blockchain = loadBlockchain()

  var denied = createSubject(Blockchain, { name: 'TRON', id: 'main' })
  var deniedArgs = networkSecurity.markExternalPluginTransaction(transactionArgs())
  var deniedResult = await runTx(denied, deniedArgs)
  t.ok(deniedResult.error && /allowed only on JavaScript VM, Nile, or Shasta/.test(deniedResult.error.message), 'a network switched to mainnet is rejected')
  t.equal(denied.state.probes, 1, 'the live network is probed at commit time')
  t.equal(denied.state.initiating, 0, 'a denied transaction emits no initiating event')
  t.equal(denied.state.rawRuns, 0, 'a denied transaction never reaches rawRun/signing/broadcast')

  var failedProbe = createSubject(Blockchain, { name: 'TRON', id: 'nile' }, new Error('offline'))
  var failedResult = await runTx(failedProbe, networkSecurity.markExternalPluginTransaction(transactionArgs()))
  t.ok(failedResult.error && /Could not verify the active network/.test(failedResult.error.message), 'probe errors fail closed')
  t.equal(failedProbe.state.rawRuns, 0, 'a probe error never reaches rawRun')

  var allowed = createSubject(Blockchain, { name: 'TRON', id: 'shasta' })
  var allowedResult = await runTx(allowed, networkSecurity.markExternalPluginTransaction(transactionArgs()))
  t.error(allowedResult.error, 'an allowed testnet transaction succeeds')
  t.equal(allowed.state.probes, 1, 'allowed marked transaction is revalidated once')
  t.equal(allowed.state.rawRuns, 1, 'allowed marked transaction reaches rawRun once')
  t.equal(allowed.state.rawTx.pendingTransactionSnapshot.network, 'TRON/shasta', 'fresh allowlisted network becomes the wallet snapshot baseline')

  var manual = createSubject(Blockchain, { name: 'TRON', id: 'main' })
  var manualResult = await runTx(manual, transactionArgs())
  t.error(manualResult.error, 'manual/native transaction behavior is unchanged')
  t.equal(manual.state.probes, 0, 'manual/native transaction receives no external-only probe')
  t.equal(manual.state.rawRuns, 1, 'manual/native transaction still reaches rawRun')
  t.end()
})

test('Blockchain.sendTransaction binds the allowlisted network before rawRun', async function (t) {
  var Blockchain = loadBlockchain()
  var input = { from: 'TFrom', to: 'TTarget', data: '0x00', useCall: false }
  var allowed = createSubject(Blockchain, { name: 'TRON', id: 'nile' })

  await allowed.blockchain.sendTransaction(input)
  t.equal(allowed.state.probes, 1, 'raw plugin transaction probes the live network')
  t.equal(allowed.state.rawRuns, 1, 'allowed raw plugin transaction reaches rawRun')
  t.equal(allowed.state.rawTx.pendingTransactionSnapshot.account, 'TFrom', 'wallet account is bound before signing')
  t.equal(allowed.state.rawTx.pendingTransactionSnapshot.network, 'TRON/nile', 'allowlisted network is bound before signing')
  t.notEqual(allowed.state.rawTx, input, 'caller payload is not mutated with host security state')
  t.notOk(input.pendingTransactionSnapshot, 'security snapshot is absent from caller-owned input')

  var denied = createSubject(Blockchain, { name: 'TRON', id: 'main' })
  var deniedError
  try {
    await denied.blockchain.sendTransaction(input)
  } catch (error) {
    deniedError = error
  }
  t.ok(deniedError && /allowed only on JavaScript VM, Nile, or Shasta/.test(deniedError.message), 'mainnet raw plugin transaction is denied')
  t.equal(denied.state.rawRuns, 0, 'denied raw plugin transaction never reaches rawRun')
  t.end()
})
