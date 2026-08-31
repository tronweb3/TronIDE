/*
 * Focused regression tests for Recorder's fail-closed replay and journal
 * generation guards. These tests load the model without a browser or a
 * blockchain provider.
 */

'use strict'

var Module = require('module')
var test = require('tape')

function EventManager () {
  this.listeners = {}
}

EventManager.prototype.register = function (name, handler) {
  if (!this.listeners[name]) this.listeners[name] = []
  this.listeners[name].push(handler)
}

EventManager.prototype.trigger = function (name, args) {
  ;(this.listeners[name] || []).slice().forEach(function (handler) {
    handler.apply(null, args || [])
  })
}

function loadRecorderModel () {
  var originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === '@remix-project/remix-lib') {
      return {
        EventManager: EventManager,
        execution: {
          txFormat: {
            encodeData: function () { return { data: '00' } },
            linkLibraryStandardFromlinkReferences: function () { return '00' }
          },
          txHelper: {
            serializeInputs: function () { return '()' },
            getFunction: function () { return { type: 'function', name: 'set' } },
            getConstructorInterface: function () { return { type: 'constructor', name: 'constructor' } },
            getFallbackInterface: function () { return { type: 'fallback', name: 'fallback' } },
            getReceiveInterface: function () { return { type: 'receive', name: 'receive' } }
          }
        }
      }
    }
    if (request === '../../../../lib/helper') return { addressToString: function (value) { return value } }
    return originalLoad.call(this, request, parent, isMain)
  }
  var modulePath = require.resolve('../src/app/tabs/runTab/model/recorder')
  delete require.cache[modulePath]
  try {
    return require(modulePath)
  } finally {
    Module._load = originalLoad
  }
}

function sleep (ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms) })
}

test('Recorder resolves only mapped senders and deployed targets', function (t) {
  var Recorder = loadRecorderModel()
  var recorder = Object.create(Recorder.prototype)
  recorder.data = { _createdContractsReverse: { 100: 'TResolved' } }

  t.deepEqual(recorder.resolveAddress({ from: 'account{0}', to: 'created{100}' }, { 'account{0}': 'TSender' }), {
    from: 'TSender',
    to: 'TResolved'
  }, 'mapped sender and target resolve')
  t.throws(function () {
    recorder.resolveAddress({ from: 'account{99}', to: 'created{100}' }, { 'account{0}': 'TSender' })
  }, /Cannot resolve recorded sender/, 'missing account token fails closed')
  t.throws(function () {
    recorder.resolveAddress({ from: 'account{0}', to: 'created{999}' }, { 'account{0}': 'TSender' })
  }, /Cannot resolve recorded contract/, 'missing created target fails closed')
  t.end()
})

test('Recorder resolves nested address tokens without mutating the scenario', function (t) {
  var Recorder = loadRecorderModel()
  var recorder = Object.create(Recorder.prototype)
  recorder.data = { _createdContracts: { TCreated: '123' }, _createdContractsReverse: { 123: 'TCreated' } }
  var nested = [{ owner: 'TCreated', values: ['TCreated', 7] }]
  var tokenized = recorder._tokenizeCreatedAddresses(nested)
  t.deepEqual(tokenized, [{ owner: 'created{123}', values: ['created{123}', 7] }], 'arrays and tuple-like objects are tokenized')
  t.deepEqual(nested, [{ owner: 'TCreated', values: ['TCreated', 7] }], 'input parameters are not mutated')
  t.deepEqual(recorder._resolveCreatedAddresses(tokenized), nested, 'nested tokens resolve back to the new address')
  t.throws(function () { recorder._resolveCreatedAddresses([{ owner: 'created{999}' }]) }, /Cannot resolve recorded contract/, 'nested unresolved token fails closed')
  t.end()
})

test('Recorder journal generation changes for appends, failures and clears', function (t) {
  var Recorder = loadRecorderModel()
  var blockchain = { event: new EventManager(), getAccounts: function () {} }
  var recorder = new Recorder(blockchain)

  t.equal(recorder.getJournalGeneration(), 0, 'new recorder starts at generation zero')
  recorder.append(1, { type: 'function', name: 'set' })
  t.equal(recorder.getJournalGeneration(), 1, 'append advances the journal generation')
  blockchain.event.trigger('transactionExecuted', [null, null, null, null, null, { result: 'FAILED' }, 1])
  t.equal(recorder.getJournalGeneration(), 2, 'recording a failed outcome advances the generation')
  t.equal(recorder.getAll().transactions[0].record.failed, true, 'failed outcome is attached to the journal entry')
  recorder.clearAll()
  t.equal(recorder.getJournalGeneration(), 3, 'clear advances the journal generation')
  t.end()
})

test('Recorder ignores a late account lookup after clear and context change', async function (t) {
  var Recorder = loadRecorderModel()
  var blockchain = { event: new EventManager(), getAccounts: function (callback) { setTimeout(function () { callback(null, ['TSender']) }, 10) } }
  var recorder = new Recorder(blockchain)
  blockchain.event.trigger('initiatingTransaction', [1, { from: 'TSender', to: null, value: '0', tokenId: '0x1', tokenValue: '0x2' }, {
    funArgs: [],
    contractABI: [],
    contractName: 'C',
    contractBytecode: '00',
    linkReferences: {},
    funAbi: { name: 'constructor', type: 'constructor' }
  }])
  recorder.clearAll()
  await sleep(25)
  t.equal(recorder.data.journal.length, 0, 'late callback cannot resurrect a cleared journal')

  recorder.data._replay = true
  blockchain.event.trigger('contextChanged')
  t.equal(recorder.data._replay, false, 'context change stops replay state')
  t.equal(recorder.data._abortReplay, 'Replay aborted: execution context changed.', 'context change records an abort reason')
  t.end()
})

test('Recorder rejects malformed scenarios without entering replay mode', function (t) {
  var Recorder = loadRecorderModel()
  var recorder = Object.create(Recorder.prototype)
  recorder.data = { _replay: false }
  recorder.event = new EventManager()
  var ended = []
  recorder.event.register('replayEnded', function (error) { ended.push(error) })
  recorder.runScenario(JSON.stringify({ transactions: { bad: true } }), function () {}, function () {}, function () {}, function () {}, function () {}, function () {})
  t.equal(recorder.data._replay, false, 'malformed input never enables replay')
  t.equal(ended.length, 1, 'malformed input emits one terminal replay event')
  t.ok(/transaction/.test(String(ended[0])), 'terminal event explains the malformed transactions field')
  t.end()
})
