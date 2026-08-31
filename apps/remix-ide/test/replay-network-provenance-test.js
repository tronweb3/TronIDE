/* Dynamic coverage that every transaction produced by a restricted replay
 * inherits the RunTab caller-provenance marker before Blockchain.runTx. */

'use strict'

var Module = require('module')
var test = require('tape')
var networkSecurity = require('../src/blockchain/transaction-network-security')

function loadRecorderModel () {
  var originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === '@remix-project/remix-lib') {
      return {
        EventManager: function () {},
        execution: {
          txFormat: {
            encodeData: function () { return { data: '00' } },
            linkLibraryStandardFromlinkReferences: function () { return '' }
          },
          txHelper: {
            getFunction: function () { return { type: 'function', name: 'set' } }
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

function replayRecords () {
  return [1, 2].map(function (timestamp) {
    return {
      timestamp: timestamp,
      record: { type: 'function', abi: 'abi-key', name: 'set', inputs: '()', parameters: [] }
    }
  })
}

function runReplay (Recorder, securityContext) {
  return new Promise(function (resolve) {
    var marked = []
    var recorder = Object.create(Recorder.prototype)
    recorder.data = { _abortReplay: null, _createdContractsReverse: {} }
    recorder.setListen = function () {}
    recorder.clearAll = function () {}
    recorder.resolveAddress = function (record) { return Object.assign({}, record) }
    recorder.event = {
      trigger: function (name) {
        if (name === 'replayEnded') resolve(marked)
      }
    }
    recorder.blockchain = {
      runTx: function (record, confirmationCb, continueCb, promptCb, callback) {
        marked.push(networkSecurity.isExternalPluginTransaction(record))
        callback(null, {}, null)
      }
    }
    recorder.run(
      replayRecords(), [], {}, { 'abi-key': [] }, {},
      function () {}, function () {}, function () {}, function () {}, function () {}, function () {}, securityContext
    )
  })
}

test('restricted replay marks every record while manual replay stays unchanged', async function (t) {
  var Recorder = loadRecorderModel()
  var restricted = networkSecurity.markExternalPluginTransaction({})
  t.deepEqual(await runReplay(Recorder, restricted), [true, true], 'each transaction in a restricted batch inherits provenance')
  t.deepEqual(await runReplay(Recorder, null), [false, false], 'manual/native replay records remain unrestricted')
  t.end()
})
