/*
 * Focused tests for the Recorder UI's AI TronBox handoff guards. The browser
 * component is loaded with small dependency stubs so compiler-version and
 * recording-snapshot logic stay executable without a DOM or provider.
 */

'use strict'

var Module = require('module')
var test = require('tape')

function EventManager () {}

function loadRecorderUI () {
  var originalLoad = Module._load
  var previousWindow = global.window
  var previousDocument = global.document
  function Plugin (profile) { this.profile = profile }
  var stubs = {
    '@remixproject/engine': { Plugin: Plugin },
    'yo-yo': function () { return {} },
    '@remix-project/remix-lib': { EventManager: EventManager },
    'csjs-inject': function () { return {} },
    '../styles/run-tab-styles': {},
    '../../ui/modal-dialog-custom': {},
    '../../ui/modaldialog': function () {},
    '../../ui/confirmDialog': function () {},
    '../../ui/tooltip': function () {},
    '../../../lib/helper.js': {},
    '../../../blockchain/transaction-network-security': { isExternalPluginTransaction: function () { return false } },
    jszip: function () {}
  }
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  global.window = {}
  global.document = {}
  var babelRegister = require('@babel/register')
  // This focused test supplies its own dependency stubs, so do not load the
  // repository-wide Babel config (which would pull the entire Nx/React
  // toolchain into the small CI dependency sandbox).
  babelRegister({
    extensions: ['.js'],
    cache: false,
    babelrc: false,
    configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs']
  })
  var modulePath = require.resolve('../src/app/tabs/runTab/recorder.js')
  delete require.cache[modulePath]
  try {
    return require(modulePath)
  } finally {
    Module._load = originalLoad
    babelRegister.revert()
    if (previousWindow === undefined) delete global.window
    else global.window = previousWindow
    if (previousDocument === undefined) delete global.document
    else global.document = previousDocument
  }
}

function compilerArtefacts (versions) {
  var contracts = {}
  versions.forEach(function (version, index) {
    contracts['File' + index + '.sol'] = { ['Contract' + index]: { metadata: JSON.stringify({ compiler: { version: version } }) } }
  })
  return { __last: { getData: function () { return { contracts: contracts } }, languageversion: versions[0] } }
}

test('Recorder UI rejects mixed compiler versions instead of pinning an arbitrary one', function (t) {
  var RecorderUI = loadRecorderUI()
  var ui = Object.create(RecorderUI.prototype)
  ui.compilersArtefacts = compilerArtefacts(['0.8.20+commit.a1', '0.8.20+commit.b2'])
  t.equal(ui._compiledSolcVersion(), '0.8.20', 'compiler metadata is normalized to the shared version')

  ui.compilersArtefacts = compilerArtefacts(['0.8.20', '0.7.6'])
  t.throws(function () { ui._compiledSolcVersion() }, /multiple Solidity compiler versions/, 'mixed compiler metadata fails closed')
  t.end()
})

test('Recorder UI snapshots the approved live or workspace recording for export', async function (t) {
  var RecorderUI = loadRecorderUI()
  var liveScenario = { accounts: {}, transactions: [{ timestamp: 1, record: { type: 'function', name: 'store' } }], abis: {} }
  var live = new RecorderUI(null, null, {
    getAll: function () { return liveScenario },
    getJournalGeneration: function () { return 7 }
  }, null, { get: function () { return 'notes.txt' } }, null)
  var liveInfo = await live.aiRecordingInfo()
  t.equal(liveInfo.recordingSnapshot.source, 'current-recording', 'live journals produce a generation-bound snapshot')
  t.equal(liveInfo.recordingSnapshot.generation, 7, 'live snapshot carries the journal generation')
  t.equal(liveInfo.recordingSnapshot.scenarioContent, JSON.stringify(liveScenario), 'live snapshot carries exact scenario bytes')

  var workspaceContent = JSON.stringify({ transactions: [{ timestamp: 2, record: { type: 'constructor' } }] })
  var workspace = new RecorderUI(null, { readFile: async function () { return workspaceContent } }, {
    getAll: function () { return { transactions: [] } }
  }, null, { get: function () { return 'scenario.JSON' } }, null)
  var workspaceInfo = await workspace.aiRecordingInfo()
  t.equal(workspaceInfo.recordingSnapshot.source, 'workspace-file', 'an open scenario file is captured when the journal is empty')
  t.equal(workspaceInfo.recordingSnapshot.path, 'scenario.JSON', 'workspace snapshot binds the exact current file')
  t.equal(workspaceInfo.recordingSnapshot.scenarioContent, workspaceContent, 'workspace snapshot carries exact file bytes')

  var rejected = await workspace.aiExportTronbox({ dir: 'tronbox-project', mutationContext: { workspace: 'default', generation: 0 } })
  t.equal(rejected.ok, false, 'export without a confirmed recording snapshot is fail-closed')
  t.match(rejected.message, /confirmed recording snapshot/, 'missing snapshot explains the refusal')

  var generation = 1
  var writes = []
  var raceScenario = { accounts: {}, transactions: [{ timestamp: 3, record: { type: 'constructor', contractName: 'Storage' } }], abis: {} }
  var raceRecorder = new RecorderUI(null, {
    captureWorkspaceMutationContext: function () { return { workspace: 'default', generation: 0 } },
    exists: async function () { return false },
    writeFile: async function (path) {
      writes.push(path)
      generation = 2
    }
  }, {
    getAll: function () { return raceScenario },
    getJournalGeneration: function () { return generation }
  }, null, { get: function () { return null } }, null)
  raceRecorder._tronboxNetworkMetadata = async function () { return { source: 'unknown', provider: 'unknown', name: null, id: null } }
  raceRecorder._buildTronboxFiles = async function () {
    return {
      'tronide-export.json': JSON.stringify({ solc: { version: '0.8.20' }, network: {}, scenarioSource: {} }),
      'migrations/2_deploy_contracts.js': '// migration'
    }
  }
  var raceInfo = await raceRecorder.aiRecordingInfo()
  var raced = await raceRecorder.aiExportTronbox({
    dir: 'tronbox-project',
    expectedRecording: raceInfo.recordingSnapshot,
    expectedState: { hadDir: false, files: [] },
    mutationContext: { workspace: 'default', generation: 0 }
  })
  t.equal(raced.ok, false, 'a recording change during export stops the batch')
  t.equal(writes.length, 1, 'the race stops before the next file write')
  t.match(raced.message, /recording changed/, 'the race result identifies the stale approval')
  t.end()
})
