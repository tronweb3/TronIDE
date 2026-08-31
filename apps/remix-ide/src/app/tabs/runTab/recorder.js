/*
 * Original work Copyright © 2018-2021 Remix Team
 * Licensed under the MIT License.
 *
 * Modifications Copyright © 2022 TronIDE
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Plugin } from '@remixproject/engine'

import * as packageJson from '../../../../../../package.json'
var yo = require('yo-yo')
var remixLib = require('@remix-project/remix-lib')
var EventManager = remixLib.EventManager
var csjs = require('csjs-inject')
var css = require('../styles/run-tab-styles')

var modalDialogCustom = require('../../ui/modal-dialog-custom')
var modalDialog = require('../../ui/modaldialog')
var confirmDialog = require('../../ui/confirmDialog')
var tooltip = require('../../ui/tooltip')

var helper = require('../../../lib/helper.js')
const { isExternalPluginTransaction } = require('../../../blockchain/transaction-network-security')
const JSZip = require('jszip')
const tronboxExport = require('./model/tronbox-export')

const profile = {
  name: 'recorder',
  methods: ['runScenario'],
  version: packageJson.version
}

class RecorderUI extends Plugin {
  constructor (blockchain, fileManager, recorder, logCallBack, config, compilersArtefacts) {
    super(profile)
    this.fileManager = fileManager
    this.blockchain = blockchain
    this.recorder = recorder
    this.logCallBack = logCallBack
    this.config = config
    this.compilersArtefacts = compilersArtefacts
    this.event = new EventManager()
  }

  render () {
    var css2 = csjs`
      .container {}
      .runTxs {}
      .recorder {}
    `

    this.runButton = yo`<i class="fas fa-play runtransaction ${css2.runTxs} ${css.icon}"  title="Run Transactions" aria-hidden="true"></i>`
    this.recordButton = yo`
      <i class="fas fa-save savetransaction ${css2.recorder} ${css.icon}"
        onclick=${this.triggerRecordButton.bind(this)} title="Save Transactions" aria-hidden="true">
      </i>`

    this.runButton.onclick = () => {
      const file = this.config.get('currentFile')
      if (!file) return modalDialogCustom.alert('A scenario file has to be selected')
      this.runScenario(file)
    }
  }

  runScenario (file) {
    if (!file) return modalDialogCustom.alert('Unable to run scenerio, no specified scenario file')
    var continueCb = (error, continueTxExecution, cancelCb) => {
      if (error) {
        var msg = typeof error !== 'string' ? error.message : error
        modalDialog('Gas estimation failed', yo`<div>Gas estimation errored with the following message (see below).
        The transaction execution will likely fail. Do you want to force sending? <br>
        ${msg}
        </div>`,
        {
          label: 'Send Transaction',
          fn: () => {
            continueTxExecution()
          }
        }, {
          label: 'Cancel Transaction',
          fn: () => {
            cancelCb()
          }
        })
      } else {
        continueTxExecution()
      }
    }

    var promptCb = (okCb, cancelCb) => {
      modalDialogCustom.promptPassphrase('Passphrase requested', 'Personal mode is enabled. Please provide passphrase of account', '', okCb, cancelCb)
    }

    var alertCb = (msg) => {
      modalDialogCustom.alert(msg)
    }

    const confirmationCb = this.getConfirmationCb(modalDialog, confirmDialog)

    this.fileManager.readFile(file).then((json) => {
      // TODO: there is still a UI dependency to remove here, it's still too coupled at this point to remove easily
      this.recorder.runScenario(json, continueCb, promptCb, alertCb, confirmationCb, this.logCallBack, (error, abi, address, contractName) => {
        if (error) {
          modalDialogCustom.alert(error)
          return
        }

        this.event.trigger('newScenario', [abi, address, contractName])
      })
    }).catch((error) => {
      console.log('Error reading scenario file:', error)
      modalDialogCustom.alert(error + ' Transactions created in Injected TronWeb cannot be replayed in JavaScript VM (Tron) yet.')
    })
  }

  getConfirmationCb (modalDialog, confirmDialog) {
    // this code is the same as in contractDropdown.js. TODO need to be refactored out
    const confirmationCb = (network, tx, gasEstimation, continueTxExecution, cancelCb) => {
      if (network.name !== 'Main') {
        return continueTxExecution(null)
      }
      const amount = this.blockchain.fromWei(tx.value, true, 'ether')
      const content = confirmDialog(tx, network, amount, gasEstimation, this.blockchain.determineGasFees(tx), this.blockchain.determineGasPrice.bind(this.blockchain))

      modalDialog('Confirm transaction', content,
        {
          label: 'Confirm',
          fn: () => {
            this.config.setUnpersistedProperty('doNotShowTransactionConfirmationAgain', content.querySelector('input#confirmsetting').checked)
            // TODO: check if this is check is still valid given the refactor
            if (!content.gasPriceStatus) {
              cancelCb('Given transaction fee is not correct')
            } else {
              continueTxExecution(content.txFee)
            }
          }
        }, {
          label: 'Cancel',
          fn: () => {
            return cancelCb('Transaction canceled by user.')
          }
        }
      )
    }

    return confirmationCb
  }

  /**
    * The solc version that actually produced the last compilation. The
    * compilationFinished plugin event hardcodes languageVersion to 'soljson',
    * so the only trustworthy record is the binary's self-report inside the
    * contract metadata (compiler.version) — the same source the Contract
    * Verification panel relies on.
    */
  _compiledSolcVersion () {
    let versions = []
    let fallback = null
    try {
      const last = this.compilersArtefacts && this.compilersArtefacts.__last
      if (!last) return null
      const data = last.getData ? last.getData() : null
      const contracts = (data && data.contracts) || {}
      for (const file of Object.keys(contracts)) {
        for (const name of Object.keys(contracts[file])) {
          const rawMetadata = contracts[file][name] && contracts[file][name].metadata
          if (!rawMetadata) continue
          const metadata = typeof rawMetadata === 'string' ? JSON.parse(rawMetadata) : rawMetadata
          const compiler = metadata && metadata.compiler
          const match = compiler && typeof compiler.version === 'string' ? /\d+\.\d+\.\d+/.exec(compiler.version) : null
          if (match && !versions.includes(match[0])) versions.push(match[0])
        }
      }
      fallback = last.languageversion || null
    } catch (e) {
      return null
    }
    if (versions.length > 1) {
      throw new Error('Cannot export TronBox project: the last compilation contains multiple Solidity compiler versions (' + versions.join(', ') + '). Recompile all contracts with one compiler version before exporting.')
    }
    return versions[0] || fallback
  }

  _tronboxScenarioSource (source, scenario) {
    const fromFile = source && source !== 'the current recording'
    return {
      type: fromFile ? 'workspace-file' : 'current-recording',
      path: fromFile ? source : null,
      schemaVersion: Number.isInteger(scenario && scenario.schemaVersion) ? scenario.schemaVersion : null,
      transactionCount: Array.isArray(scenario && scenario.transactions) ? scenario.transactions.length : 0
    }
  }

  async _tronboxNetworkMetadata (scenario, scenarioSource) {
    const environment = scenario && scenario.environment
    const recordedNetwork = scenario && scenario.network
    if (recordedNetwork || environment) {
      const network = recordedNetwork && typeof recordedNetwork === 'object' ? recordedNetwork : {}
      const environmentName = typeof environment === 'string' ? environment : ''
      return {
        source: 'scenario',
        provider: environmentName === 'javascript-vm-tron' ? 'vm' : (network.provider || environmentName || 'unknown'),
        name: network.name || (typeof recordedNetwork === 'string' ? recordedNetwork : (environmentName === 'javascript-vm-tron' ? 'JavaScript VM (Tron)' : null)),
        id: network.id == null ? null : network.id
      }
    }
    // A saved scenario without network metadata may have been produced under a
    // different provider, so never substitute the environment currently open
    // in the IDE. Live Recorder journals are cleared on contextChanged and can
    // safely use a bounded fresh probe of their current environment.
    if (scenarioSource && scenarioSource.type === 'workspace-file') {
      return { source: 'unknown', provider: 'unknown', name: null, id: null }
    }
    let provider = 'unknown'
    try { provider = String(this.blockchain.getProvider() || 'unknown') } catch (e) { provider = 'unknown' }
    let detected = null
    if (typeof this.blockchain.detectNetwork === 'function') {
      detected = await new Promise((resolve) => {
        let settled = false
        const finish = (value) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(value)
        }
        const timer = setTimeout(() => finish(null), 3000)
        try { this.blockchain.detectNetwork((error, network) => finish(error ? null : network)) } catch (e) { finish(null) }
      })
    }
    return {
      source: 'current-environment',
      provider,
      name: detected?.name || (provider === 'vm' ? 'JavaScript VM (Tron)' : null),
      id: detected?.id == null ? null : detected.id
    }
  }

  /**
    * Bundle the current deploy flow as a TronBox project zip: the recorded
    * journal (or, when empty, the currently open scenario.json) translated to
    * a migration, the workspace contracts, and the official scaffolding
    * (Migrations.sol, 1_initial_migration.js, tronbox-config.js, README).
    */
  async exportTronboxProject () {
    try {
      let scenario = this.recorder.getAll()
      let source = 'the current recording'
      if (!scenario.transactions.length) {
        scenario = null
        const file = this.config.get('currentFile')
        if (file && file.endsWith('.json')) {
          // Surface a parse failure instead of swallowing it: a corrupt
          // scenario.json must report "invalid scenario JSON", not the
          // misleading "Nothing to export" fall-through below.
          let raw
          try { raw = await this.fileManager.readFile(file) } catch (e) { raw = null }
          if (raw !== null && raw !== undefined) {
            try { scenario = JSON.parse(raw); source = file } catch (e) {
              return modalDialogCustom.alert('Cannot export ' + file + ': invalid scenario JSON (' + ((e && e.message) || e) + ').')
            }
          }
        }
      }
      if (!scenario || !Array.isArray(scenario.transactions) || !scenario.transactions.length) {
        return modalDialogCustom.alert('Nothing to export: record transactions or open a scenario.json file first.')
      }

      tooltip('Preparing the TronBox project ...')
      const scenarioSource = this._tronboxScenarioSource(source, scenario)
      const network = await this._tronboxNetworkMetadata(scenario, scenarioSource)
      const files = await this._buildTronboxFiles(scenario, { scenarioSource, network })
      const zip = new JSZip()
      for (const rel of Object.keys(files)) zip.file(rel, files[rel])
      const blob = await zip.generateAsync({ type: 'blob' })
      saveAsFile(blob, 'tronbox-project.zip')
    } catch (error) {
      modalDialogCustom.alert('Export to TronBox failed: ' + ((error && error.message) || error))
    }
  }

  /**
    * Build the TronBox project as a { relPath: content } map — the scaffolding
    * files plus the workspace .sol sources. Shared by the panel's zip export and
    * the AI assistant's aiExportTronbox (which writes the files into the
    * workspace), so the two never drift.
    */
  async _buildTronboxFiles (scenario, { scenarioSource, network } = {}) {
    const files = {}
    const compiledSolcVersion = this._compiledSolcVersion()
    const scenarioSolcVersion = scenario && scenario.compilerVersion
    const compiledVersionKnown = typeof compiledSolcVersion === 'string' && /\d+\.\d+\.\d+/.test(compiledSolcVersion)
    const scenarioVersionKnown = typeof scenarioSolcVersion === 'string' && /\d+\.\d+\.\d+/.test(scenarioSolcVersion)
    const solcVersion = tronboxExport.normalizeSolcVersion(compiledVersionKnown ? compiledSolcVersion : (scenarioVersionKnown ? scenarioSolcVersion : null))
    const solcSource = compiledVersionKnown ? 'last-compilation' : (scenarioVersionKnown ? 'scenario' : 'fallback-default')
    const metadata = tronboxExport.createTronideExportMetadata({
      tronideVersion: packageJson.version,
      solcVersion,
      solcSource,
      network,
      scenarioSource: scenarioSource || this._tronboxScenarioSource('the current recording', scenario)
    })
    files['migrations/1_initial_migration.js'] = tronboxExport.INITIAL_MIGRATION
    files['migrations/2_deploy_contracts.js'] = tronboxExport.scenarioToMigration(scenario)
    files['contracts/Migrations.sol'] = tronboxExport.MIGRATIONS_SOL
    files['tronbox-config.js'] = tronboxExport.tronboxConfig(solcVersion)
    files['tronide-export.json'] = JSON.stringify(metadata, null, 2) + '\n'
    files['README.md'] = tronboxExport.README
    files['sample-env'] = tronboxExport.SAMPLE_ENV
    // workspace sources: contracts/ tree plus root-level .sol files. Other trees
    // (tests/, flattened/, .deps/) are skipped on purpose — they hold IDE-only or
    // duplicated sources that would break `tronbox compile`.
    const provider = this.fileManager.fileProviderOf('/')
    if (provider && provider.copyFolderToJson) {
      await provider.copyFolderToJson('/', ({ path, content }) => {
        const rel = (path || '').replace(/^\//, '')
        if (!rel.toLowerCase().endsWith('.sol')) return
        if (rel.startsWith('contracts/')) files[rel] = content
        else if (rel.indexOf('/') === -1) files[`contracts/${rel}`] = content
      })
    }
    return files
  }

  /**
    * AI assistant: export the recorded deploy/interaction flow into the WORKSPACE
    * as a runnable TronBox project (files under `dir`, not a zip download), so the
    * model can reference/verify it and the user sees it in the file tree. Falls
    * back to an open scenario.json when nothing is recorded. Returns a structured
    * result (never throws) with the written files, pinned solc version, and any
    * caveats parsed out of the generated migration.
    */
  async aiExportTronbox ({ dir, expectedState, mutationContext: suppliedMutationContext, expectedRecording } = {}) {
    try {
      if (!expectedRecording || typeof expectedRecording !== 'object' ||
        !['current-recording', 'workspace-file'].includes(expectedRecording.source) ||
        typeof expectedRecording.scenarioContent !== 'string') {
        return { ok: false, message: 'The confirmed recording snapshot was not provided — nothing was exported.' }
      }
      const recordingSource = expectedRecording.source
      const approvedScenarioContent = expectedRecording.scenarioContent
      const approvedScenarioPath = recordingSource === 'workspace-file' ? String(expectedRecording.path || '') : null
      if (recordingSource === 'current-recording' && !Number.isInteger(expectedRecording.generation)) {
        return { ok: false, message: 'The confirmed recording version was not provided — nothing was exported.' }
      }
      if (recordingSource === 'workspace-file' && (!approvedScenarioPath || !/\.json$/i.test(approvedScenarioPath))) {
        return { ok: false, message: 'The confirmed scenario file was not provided — nothing was exported.' }
      }

      const recordingMismatch = async () => {
        if (recordingSource === 'current-recording') {
          let currentContent
          let currentGeneration
          try {
            currentGeneration = this.recorder.getJournalGeneration()
            currentContent = JSON.stringify(this.recorder.getAll())
          } catch (e) {
            return 'Could not verify the current recording after export confirmation — nothing was exported.'
          }
          if (currentGeneration !== expectedRecording.generation || currentContent !== approvedScenarioContent) {
            return 'The confirmed recording changed while the export was running — nothing was exported. Review the recording and confirm again.'
          }
          return null
        }
        let currentFile
        let raw
        try {
          currentFile = this.config.get('currentFile')
          raw = await this.fileManager.readFile(approvedScenarioPath)
        } catch (e) {
          return 'Could not re-read ' + approvedScenarioPath + ' after export confirmation — nothing was exported.'
        }
        if (currentFile !== approvedScenarioPath) {
          return 'The active scenario file changed while the export was running — nothing was exported. Review it and confirm again.'
        }
        if (String(raw ?? '') !== approvedScenarioContent) {
          return approvedScenarioPath + ' changed while the export was running — nothing was exported. Review it and confirm again.'
        }
        return null
      }

      const initialRecordingMismatch = await recordingMismatch()
      if (initialRecordingMismatch) return { ok: false, message: initialRecordingMismatch }

      let scenario
      let source = recordingSource === 'workspace-file' ? approvedScenarioPath : 'the current recording'
      try { scenario = JSON.parse(approvedScenarioContent) } catch (e) {
        return { ok: false, message: recordingSource === 'workspace-file' ? 'Cannot export ' + approvedScenarioPath + ': invalid scenario JSON.' : 'The confirmed recording snapshot is invalid — nothing was exported.' }
      }
      if (!scenario || !Array.isArray(scenario.transactions) || !scenario.transactions.length) {
        return { ok: false, message: 'Nothing to export — deploy or call a contract first (that records it), or open a scenario.json.' }
      }
      const outDir = String(dir || 'tronbox-project').trim().replace(/^\/+|\/+$/g, '')
      if (!outDir || outDir.length > 200 || outDir.split('/').some((s) => s === '' || s === '.' || s === '..')) {
        return { ok: false, message: 'Invalid target directory.' }
      }
      // Chat captures this before showing the confirmation. Keep the fallback
      // only for older callers; a supplied generation must never be replaced
      // with the post-confirmation generation, which would re-authorize a write
      // after a checkout in the same workspace.
      let mutationContext = suppliedMutationContext
      if (mutationContext === undefined) {
        try {
          mutationContext = typeof this.fileManager.captureWorkspaceMutationContext === 'function'
            ? this.fileManager.captureWorkspaceMutationContext(outDir)
            : undefined
        } catch (e) { mutationContext = undefined }
      }
      if (!mutationContext || typeof mutationContext !== 'object' ||
        !Object.prototype.hasOwnProperty.call(mutationContext, 'workspace') ||
        typeof mutationContext.generation !== 'number') {
        return { ok: false, message: 'The confirmed workspace version for ' + outDir + '/ was not provided — nothing was exported.' }
      }
      if (typeof this.fileManager.captureWorkspaceMutationContext === 'function') {
        let currentMutationContext
        try { currentMutationContext = this.fileManager.captureWorkspaceMutationContext(outDir) } catch (e) { currentMutationContext = null }
        if (!currentMutationContext || currentMutationContext.workspace !== mutationContext.workspace ||
          currentMutationContext.generation !== mutationContext.generation) {
          return { ok: false, message: 'The workspace or Git branch changed after the export was confirmed — nothing was exported.' }
        }
      }
      const scenarioSource = this._tronboxScenarioSource(source, scenario)
      const network = await this._tronboxNetworkMetadata(scenario, scenarioSource)
      const files = await this._buildTronboxFiles(scenario, { scenarioSource, network })
      const postBuildRecordingMismatch = await recordingMismatch()
      if (postBuildRecordingMismatch) return { ok: false, message: postBuildRecordingMismatch }
      const metadata = JSON.parse(files['tronide-export.json'])
      // A re-export must not ship residue: files a previous export left under
      // outDir that this file set no longer generates (a renamed/deleted
      // contract) would make `tronbox compile` build stale sources. Snapshot
      // everything under outDir first — the caller keeps it for undo — then
      // remove the stale ones.
      const previous = []
      let hadDir = false
      try { hadDir = await this.fileManager.exists(outDir) } catch (e) {
        return { ok: false, message: 'Could not inspect ' + outDir + '/ immediately before export — nothing was changed.' }
      }
      if (hadDir) {
        const collect = async (d) => {
          const entries = await this.fileManager.readdir(d) || {}
          for (const key of Object.keys(entries).sort()) {
            if (entries[key] && entries[key].isDirectory) await collect(key)
            else {
              let content = null
              try { content = String((await this.fileManager.readFile(key)) ?? '') } catch (e) { content = null }
              previous.push({ path: key, content })
            }
          }
        }
        await collect(outDir)
        const unreadable = previous.find((f) => f.content === null)
        if (unreadable) {
          return { ok: false, message: 'Could not read ' + unreadable.path + ' under ' + outDir + '/ (needed so the export can be undone) — not touching it. Export to a different directory.' }
        }
      }
      if (expectedState) {
        const expectedFiles = Array.isArray(expectedState.files) ? expectedState.files : []
        const currentFiles = previous.map((file) => ({ path: file.path, content: file.content }))
        if (Boolean(expectedState.hadDir) !== Boolean(hadDir) ||
          JSON.stringify(expectedFiles) !== JSON.stringify(currentFiles)) {
          return { ok: false, message: outDir + '/ changed while the confirmation was open — nothing was exported. Review the directory and try again.' }
        }
      }
      const target = new Set(Object.keys(files).map((rel) => outDir + '/' + rel))
      const previousByPath = new Map(previous.map((file) => [file.path, file.content]))
      const removedStale = []
      const written = []
      const writtenContents = []
      const inspectFile = async (path) => {
        const exists = await this.fileManager.exists(path)
        if (!exists) return { exists: false, content: null }
        return { exists: true, content: String((await this.fileManager.readFile(path)) ?? '') }
      }
      const partialResult = (message, stateUnknown = false) => ({
        ok: false,
        partial: stateUnknown || written.length > 0 || removedStale.length > 0,
        files: written,
        writtenContents,
        previous,
        removedStale,
        stateUnknown,
        message
      })
      const beforeExportRecordingMismatch = await recordingMismatch()
      if (beforeExportRecordingMismatch) return partialResult(beforeExportRecordingMismatch)
      for (const f of previous) {
        if (target.has(f.path)) continue
        const beforeDeleteRecordingMismatch = await recordingMismatch()
        if (beforeDeleteRecordingMismatch) return partialResult(beforeDeleteRecordingMismatch)
        // The directory-wide snapshot above can become stale while earlier
        // provider calls are awaited. Re-check this exact file immediately
        // before deleting it so a concurrent user edit is never removed.
        let current
        try { current = await inspectFile(f.path) } catch (e) {
          return partialResult('Could not re-check stale ' + f.path + ' immediately before deleting it — export stopped without touching that file.')
        }
        if (!current.exists || current.content !== f.content) {
          return partialResult(f.path + ' changed while the export was running — export stopped without deleting that user change.')
        }
        const beforeRemoveRecordingMismatch = await recordingMismatch()
        if (beforeRemoveRecordingMismatch) return partialResult(beforeRemoveRecordingMismatch)
        try {
          await this.fileManager.remove(f.path, mutationContext)
          removedStale.push(f.path)
        } catch (e) {
          // Some providers can mutate storage and still reject (quota/I/O after
          // truncate). Observe the exact post-error state so undo includes every
          // path that was actually changed.
          try {
            const afterFailure = await inspectFile(f.path)
            if (!afterFailure.exists) removedStale.push(f.path)
            else if (afterFailure.content !== f.content) {
              written.push(f.path)
              writtenContents.push({ path: f.path, exists: true, content: afterFailure.content })
            }
          } catch (inspectError) {
            return partialResult('Could not remove stale ' + f.path + ', and its state after the provider error could not be inspected. Review that path manually before retrying. ' + ((e && e.message) || e), true)
          }
          return partialResult('Could not remove stale ' + f.path + ' left by a previous export: ' + ((e && e.message) || e))
        }
      }
      for (const rel of Object.keys(files)) {
        const p = outDir + '/' + rel
        const beforeWriteRecordingMismatch = await recordingMismatch()
        if (beforeWriteRecordingMismatch) return partialResult(beforeWriteRecordingMismatch)
        const before = previousByPath.has(p)
          ? { exists: true, content: previousByPath.get(p) }
          : { exists: false, content: null }
        // Re-check each target immediately before its write. This closes the
        // multi-await TOCTOU window left by the directory-wide confirmation CAS.
        let current
        try { current = await inspectFile(p) } catch (e) {
          return partialResult('Could not re-check ' + p + ' immediately before writing it — export stopped without touching that file.')
        }
        if (current.exists !== before.exists || (current.exists && current.content !== before.content)) {
          return partialResult(p + ' changed while the export was running — export stopped without overwriting that user change.')
        }
        const beforeWriteCallRecordingMismatch = await recordingMismatch()
        if (beforeWriteCallRecordingMismatch) return partialResult(beforeWriteCallRecordingMismatch)
        try { await this.fileManager.writeFile(p, files[rel], mutationContext) } catch (e) {
          // A provider may reject after it already truncated/wrote the file.
          // Capture that exact post-error state as a touched path; the chat can
          // then compare-and-swap it back to the original state safely.
          try {
            const afterFailure = await inspectFile(p)
            const changed = afterFailure.exists !== before.exists ||
              (afterFailure.exists && afterFailure.content !== before.content)
            if (changed) {
              written.push(p)
              writtenContents.push({ path: p, exists: afterFailure.exists, content: afterFailure.content })
            }
          } catch (inspectError) {
            return partialResult('Export FAILED while writing ' + p + ', and its state after the provider error could not be inspected. Review that path manually before retrying. ' + ((e && e.message) || e), true)
          }
          return partialResult('Export FAILED while writing ' + p + ': ' + ((e && e.message) || e) + (written.length ? '. Files changed before the failure: ' + written.join(', ') : ''))
        }
        written.push(p)
        writtenContents.push({ path: p, exists: true, content: files[rel] })
      }
      const finalRecordingMismatch = await recordingMismatch()
      if (finalRecordingMismatch) return partialResult(finalRecordingMismatch)
      // Caveats are surfaced by scenarioToMigration inside the migration text, so
      // parse them from there (single source) rather than re-deriving.
      const mig = files['migrations/2_deploy_contracts.js'] || ''
      const notes = []
      if (/\bTODO\b/.test(mig)) notes.push('some recorded steps reverted and are fenced as TODO in the migration — review them before running.')
      if (/different sender accounts/.test(mig)) notes.push('the recording used multiple sender accounts; the migration runs with the single account in tronbox-config.js.')
      return { ok: true, dir: outDir, files: written, writtenContents, previous, removedStale, replacedExisting: hadDir, solcVersion: metadata.solc.version, network: metadata.network, scenarioSource: metadata.scenarioSource, metadataPath: outDir + '/tronide-export.json', txCount: scenario.transactions.length, source, notes }
    } catch (e) {
      return { ok: false, message: (e && e.message) || String(e) }
    }
  }

  /**
    * AI assistant: capture the exact approved recording input before a write
    * confirmation. The content/generation pair is consumed by aiExportTronbox
    * as a compare-and-swap guard, so an export cannot silently switch to a
    * newer journal or scenario file after the user approves it.
    */
  async aiRecordingInfo () {
    let liveScenario
    try { liveScenario = this.recorder.getAll() } catch (e) { liveScenario = null }
    const liveTransactions = liveScenario && Array.isArray(liveScenario.transactions) ? liveScenario.transactions : []
    if (liveTransactions.length) {
      try {
        return {
          ok: true,
          txCount: liveTransactions.length,
          recordingSnapshot: {
            source: 'current-recording',
            generation: this.recorder.getJournalGeneration(),
            scenarioContent: JSON.stringify(liveScenario),
            transactionCount: liveTransactions.length
          }
        }
      } catch (e) {
        return { ok: false, txCount: liveTransactions.length, message: 'Could not snapshot the live recording safely.' }
      }
    }

    let file
    try { file = this.config.get('currentFile') } catch (e) { file = null }
    if (file && /\.json$/i.test(file)) {
      let raw
      try { raw = await this.fileManager.readFile(file) } catch (e) { raw = null }
      if (raw !== null && raw !== undefined) {
        const scenarioContent = String(raw)
        let txCount = 0
        try {
          const scenario = JSON.parse(scenarioContent)
          txCount = Array.isArray(scenario && scenario.transactions) ? scenario.transactions.length : 0
        } catch (e) {
          // Keep the exact bytes in the snapshot so export reports the actual
          // invalid JSON after confirmation instead of falling back elsewhere.
        }
        return {
          ok: true,
          txCount,
          recordingSnapshot: {
            source: 'workspace-file',
            path: file,
            scenarioContent,
            transactionCount: txCount
          }
        }
      }
    }
    return { ok: true, txCount: 0, recordingSnapshot: null }
  }

  /**
    * AI assistant: save the current recording to a workspace scenario.json.
    * Structured result, never throws.
    */
  async aiSaveScenario ({ path, expectedState, expectedWorkspace, mutationContext: suppliedMutationContext } = {}) {
    const scenario = this.recorder.getAll()
    if (!scenario || !Array.isArray(scenario.transactions) || !scenario.transactions.length) {
      return { ok: false, message: 'Nothing to save — deploy or call a contract first (that records it).' }
    }
    let p = String(path || 'scenario.json').trim().replace(/^\/+/, '')
    if (!/\.json$/i.test(p)) p += '.json'
    if (!p || p.length > 200 || p.split('/').some((s) => s === '' || s === '.' || s === '..')) return { ok: false, message: 'Invalid path.' }
    const content = JSON.stringify(scenario, null, 2)

    // The confirmation in Chat snapshots both the target and its workspace
    // before the cross-plugin call. Relative paths are resolved by the mutable
    // workspace provider, so bind every inspection and the synchronous provider
    // write to that same workspace. Otherwise a switch during an await could
    // write another project's same-named file and attach undo to the old one.
    if (!expectedState || typeof expectedState.exists !== 'boolean' ||
      (expectedState.exists && typeof expectedState.content !== 'string')) {
      return { ok: false, message: 'The confirmed state for ' + p + ' was not provided — nothing was written.' }
    }
    if (typeof expectedWorkspace !== 'string' || !expectedWorkspace) {
      return { ok: false, message: 'The confirmed workspace for ' + p + ' was not provided — nothing was written.' }
    }
    const provider = this.fileManager.fileProviderOf(p)
    if (!provider || typeof provider.getWorkspace !== 'function' || typeof provider.setIfUnchanged !== 'function') {
      return { ok: false, message: 'The workspace provider for ' + p + ' is unavailable — nothing was written.' }
    }
    // New callers supply the generation captured before confirmation. Capture
    // here only for backward compatibility; replacing a supplied stale context
    // would allow branch A's approval to write branch B.
    const mutationContext = suppliedMutationContext === undefined && typeof provider.captureMutationContext === 'function'
      ? provider.captureMutationContext()
      : suppliedMutationContext
    if (!mutationContext || typeof mutationContext !== 'object' ||
      !Object.prototype.hasOwnProperty.call(mutationContext, 'workspace') ||
      typeof mutationContext.generation !== 'number') {
      return { ok: false, message: 'The confirmed workspace version for ' + p + ' was not provided — nothing was written.' }
    }
    if (typeof provider.captureMutationContext === 'function') {
      const currentMutationContext = provider.captureMutationContext()
      if (!currentMutationContext || currentMutationContext.workspace !== mutationContext.workspace ||
        currentMutationContext.generation !== mutationContext.generation) {
        return { ok: false, message: 'The workspace or Git branch changed after the save was confirmed — nothing was written.' }
      }
    }
    const currentWorkspace = () => {
      try { return String(provider.getWorkspace() || '') } catch (e) { return '' }
    }
    const assertConfirmedWorkspace = () => {
      const actualWorkspace = currentWorkspace()
      if (actualWorkspace === expectedWorkspace) return
      const error = new Error('The workspace changed from "' + expectedWorkspace + '" to "' + (actualWorkspace || 'unknown') + '".')
      error.code = 'AI_WORKSPACE_CHANGED'
      error.actualWorkspace = actualWorkspace
      throw error
    }
    const readFromProvider = () => new Promise((resolve, reject) => {
      // provider.get resolves the workspace-qualified backing path
      // synchronously before starting its asynchronous read.
      assertConfirmedWorkspace()
      provider.get(p, (error, value) => {
        if (error) return reject(error)
        // FileProvider#get returns null when the file disappears after the
        // preceding exists() check. Preserve that missing sentinel rather than
        // collapsing it into the contents of an empty file.
        resolve(value == null ? null : String(value))
      })
    })
    const inspectFile = async () => {
      assertConfirmedWorkspace()
      const exists = await provider.exists(p)
      assertConfirmedWorkspace()
      if (!exists) return { exists: false, content: null }
      const fileContent = await readFromProvider()
      assertConfirmedWorkspace()
      if (fileContent === null) return { exists: false, content: null }
      return { exists: true, content: fileContent }
    }
    const writeInConfirmedWorkspace = (expectedFileState) => new Promise((resolve, reject) => {
      let settled = false
      const finish = (error) => {
        if (settled) return
        settled = true
        if (error) return reject(error)
        // Match FileManager._setFileInternal's editor/fileSaved side effects.
        // These are best-effort; the provider write itself has already landed.
        try { this.fileManager.syncEditor(p) } catch (e) { /* best-effort */ }
        try { this.fileManager.emit('fileSaved', p) } catch (e) { /* best-effort */ }
        resolve(true)
      }
      try {
        // No await is allowed between this check and provider.set: the
        // WorkspaceFileProvider resolves and writes the backing path
        // synchronously, closing the final workspace-switch race.
        assertConfirmedWorkspace()
        const accepted = provider.setIfUnchanged(p, content, expectedFileState, finish, mutationContext)
        if (accepted === false) finish(new Error('The workspace provider rejected the write.'))
      } catch (error) {
        finish(error)
      }
    })
    const sameState = (left, right) => left.exists === right.exists &&
      (!left.exists || left.content === right.content)
    const confirmedState = {
      exists: expectedState.exists,
      content: expectedState.exists ? expectedState.content : null
    }
    let previousState
    try { previousState = await inspectFile() } catch (e) {
      if (e && e.code === 'AI_WORKSPACE_CHANGED') {
        return {
          ok: false,
          path: p,
          expectedWorkspace,
          actualWorkspace: e.actualWorkspace,
          message: e.message + ' The recording was not written.'
        }
      }
      return { ok: false, message: 'Could not re-check ' + p + ' immediately before saving — nothing was written.' }
    }
    if (!sameState(previousState, confirmedState)) {
      return { ok: false, message: p + ' changed while the save was starting — the recording was not written.' }
    }

    try { await writeInConfirmedWorkspace(previousState) } catch (e) {
      // This code is raised only by the last synchronous pre-write workspace
      // assertion, before provider.set is invoked, so no mutation is possible.
      if (e && e.code === 'AI_WORKSPACE_CHANGED') {
        return {
          ok: false,
          path: p,
          expectedWorkspace,
          actualWorkspace: e.actualWorkspace,
          message: e.message + ' The recording was not written.'
        }
      }
      if (e && e.code === 'AI_FILE_CHANGED') {
        return {
          ok: false,
          path: p,
          workspace: expectedWorkspace,
          previousState,
          message: p + ' changed while the save was starting — the recording was not written.'
        }
      }
      // Providers can truncate or partially write a file and then reject (for
      // example, a quota/I/O failure). Observe the exact post-error state so
      // Chat can create a compare-and-swap undo for every actual mutation.
      const failureWorkspace = currentWorkspace()
      if (failureWorkspace !== expectedWorkspace) {
        return {
          ok: false,
          stateUnknown: true,
          path: p,
          workspace: expectedWorkspace,
          actualWorkspace: failureWorkspace,
          previousState,
          message: 'Could not write ' + p + ', and the active workspace changed before its post-error state could be inspected. Review "' + expectedWorkspace + '" manually before retrying. ' + ((e && e.message) || e)
        }
      }
      let currentState
      try { currentState = await inspectFile() } catch (inspectError) {
        return {
          ok: false,
          stateUnknown: true,
          path: p,
          workspace: expectedWorkspace,
          actualWorkspace: currentWorkspace(),
          previousState,
          message: 'Could not write ' + p + ', and its state after the provider error could not be inspected. Review that path manually before retrying. ' + ((e && e.message) || e)
        }
      }
      const partial = !sameState(currentState, previousState)
      return {
        ok: false,
        partial,
        path: p,
        workspace: expectedWorkspace,
        previousState,
        currentState,
        message: 'Could not write ' + p + ': ' + ((e && e.message) || e) +
          (partial ? '. The provider changed the file before reporting the failure.' : '')
      }
    }
    // Return the exact bytes sent to the provider. The chat uses this as the
    // compare-and-swap value for undo; a transient read-after-write failure must
    // not leave a successful save with a permanently unusable undo record.
    return { ok: true, path: p, workspace: expectedWorkspace, content, txCount: scenario.transactions.length }
  }

  /**
    * AI assistant: replay a scenario.json — re-execute its recorded transactions.
    * Drives the recorder model with non-interactive callbacks (auto-continue /
    * auto-confirm; the user already approved the whole replay in the chat) and
    * collects any alerts. Completion is keyed on the model's one-shot
    * `replayEnded` event (the TRUE end of the batch, carrying the terminal
    * error) — NOT on the per-contract-creation callback, which fires once per
    * deploy mid-series and would resolve early (hiding a later revert) or, for a
    * scenario with no deploy, never fire at all. The per-creation callback is
    * used only to remember the LAST deployed address. Recording is disabled
    * during replay (setListen(false)); note the model then clears the live
    * recording when the batch ends, so save/export before replaying if you need
    * to keep it. Never throws. On timeout the batch is ABORTED (it stops before
    * its next transaction — the one in flight cannot be recalled) so it can
    * never keep executing in the background after the tool reported failure;
    * and only one replay may run at a time, so a "failed" report can't be
    * followed by a double-execution of the same recorded transactions.
    */
  async aiRunScenario (options = {}) {
    const { path, scenarioContent, expectedState, mutationContext } = options
    const externalPluginTransaction = isExternalPluginTransaction(options)
    const p = String(path || 'scenario.json').trim().replace(/^\/+/, '')
    if (!p || p.split('/').some((s) => s === '' || s === '.' || s === '..')) return { ok: false, message: 'Invalid path.' }
    // data._replay is true for the whole life of ANY batch (panel- or
    // AI-started) and resets in the model's final callback — the reliable
    // "a replay is in flight" signal.
    if (this.recorder.data && this.recorder.data._replay) {
      return { ok: false, message: 'A replay is already running — wait for it to finish (or for its timeout abort) before starting another. Re-running now would execute the recorded transactions twice.' }
    }
    let raw
    if (scenarioContent !== undefined) {
      // Chat passes the exact bytes shown/approved before the confirmation
      // modal. Re-check both the workspace generation and the file content so
      // a cross-plugin race cannot execute a different scenario at `p`.
      if (typeof scenarioContent !== 'string' || !expectedState || expectedState.content !== scenarioContent || !mutationContext || typeof mutationContext.workspace !== 'string' || typeof mutationContext.generation !== 'number') {
        return { ok: false, message: 'The approved scenario snapshot is incomplete — nothing was sent.' }
      }
      let currentContext
      try { currentContext = await this.fileManager.captureWorkspaceMutationContext(p) } catch (e) { currentContext = null }
      if (!currentContext || currentContext.workspace !== mutationContext.workspace || currentContext.generation !== mutationContext.generation) {
        return { ok: false, message: 'The workspace or Git branch changed after replay approval — nothing was sent.' }
      }
      let currentContent
      try { currentContent = String(await this.fileManager.readFile(p)) } catch (e) { return { ok: false, message: 'Could not re-check the approved scenario file — nothing was sent.' } }
      if (currentContent !== scenarioContent) return { ok: false, message: p + ' changed after replay approval — nothing was sent.' }
      raw = scenarioContent
    } else {
      try { raw = await this.fileManager.readFile(p) } catch (e) { return { ok: false, message: 'No such scenario file: ' + p } }
    }
    let txCount = 0
    try { txCount = ((JSON.parse(raw) || {}).transactions || []).length } catch (e) { return { ok: false, message: p + ' is not valid scenario JSON.' } }
    if (!txCount) return { ok: false, message: p + ' has no transactions to replay.' }
    const alerts = []
    let last = { contract: null, address: null }
    return new Promise((resolve) => {
      let settled = false
      let timer = null
      let onEnded = null
      const done = (res) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); resolve(res) }
      // The recorder model fires `replayEnded` exactly once when the whole batch
      // finishes, with the terminal error (or null) — the correct completion
      // signal. The listener stays registered even after a timeout resolved the
      // tool: it is the only way to observe the batch's TRUE end (and it must
      // not fire for a later, unrelated batch — hence unregister-on-first-fire,
      // guaranteed to be OUR batch by the single-replay guard above).
      onEnded = (error) => {
        try { this.recorder.event.unregister('replayEnded', onEnded) } catch (e) { /* best-effort */ }
        if (error) return done({ ok: false, message: (typeof error === 'string' ? error : (error && error.message) || 'replay failed'), alerts })
        done({ ok: true, txCount, lastContract: last.contract, lastAddress: last.address, alerts })
      }
      // Timeout: ABORT the batch instead of abandoning it — leaving it running
      // while reporting failure invited an approved "retry" that would execute
      // every recorded transaction a second time on a real network.
      timer = setTimeout(() => {
        try { this.recorder.abortReplay('Replay aborted: timed out after 120s (a transaction may be stuck).') } catch (e) { /* best-effort */ }
        done({ ok: false, message: 'Replay timed out after 120s and was ABORTED — it stops before its next transaction, but the one in flight may still land. Check on-chain state (read_contract / get_balance) before replaying again.', alerts })
      }, 120000)
      this.recorder.event.register('replayEnded', onEnded)
      const continueCb = (error, continueTxExecution) => { if (error) alerts.push(typeof error === 'string' ? error : (error && error.message) || 'gas estimation failed'); continueTxExecution() }
      const promptCb = (okCb, cancelCb) => cancelCb() // no passphrase available programmatically
      const alertCb = (msg) => alerts.push(typeof msg === 'string' ? msg : String(msg))
      const confirmationCb = (network, tx, gasEstimation, continueTxExecution) => continueTxExecution()
      // per-creation callback: only remember the last deployed contract; do NOT
      // resolve here (replayEnded is the terminal signal).
      const onContract = (error, abi, address, contractName) => { if (!error && address) last = { contract: contractName || null, address } }
      try {
        // Pass only the unforgeable provenance bit into the model. It marks
        // every replayed record so Blockchain.runTx rechecks the live network
        // immediately before each individual transaction is committed.
        this.recorder.runScenario(raw, continueCb, promptCb, alertCb, confirmationCb, () => {}, onContract,
          externalPluginTransaction ? options : null)
      } catch (e) {
        // The batch never started — the replayEnded listener must not linger.
        try { this.recorder.event.unregister('replayEnded', onEnded) } catch (e2) { /* best-effort */ }
        done({ ok: false, message: (e && e.message) || String(e), alerts })
      }
    })
  }

  triggerRecordButton () {
    this.saveScenario(
      (path, cb) => {
        modalDialogCustom.prompt('Save transactions as scenario', 'Transactions will be saved in a file under ' + path, 'scenario.json', cb)
      },
      (error) => {
        if (error) return modalDialogCustom.alert(error)
      }
    )
  }

  saveScenario (promptCb, cb) {
    var txJSON = JSON.stringify(this.recorder.getAll(), null, 2)
    var path = this.fileManager.currentPath()
    promptCb(path, input => {
      var fileProvider = this.fileManager.fileProviderOf(path)
      if (!fileProvider) return
      var newFile = path === '/' ? input : path + '/' + input
      // helper.createNonClashingName(newFile, fileProvider, (error, newFile) => {
      //   if (error) return cb('Failed to create file. ' + newFile + ' ' + error)
      //   if (!fileProvider.set(newFile, txJSON)) return cb('Failed to create file ' + newFile)
      //   this.fileManager.open(newFile)
      // })

      const saveFile = (error, finalNewFile) => {
        if (error) {
          console.error('Error from createNonClashingName:', error, 'Proposed file was:', newFile)
          return cb('Failed to create file. ' + newFile + ' ' + error)
        }

        // console.log('[SAVE SCENARIO] Attempting to save. Original path:', path)
        // console.log('[SAVE SCENARIO] User input for filename (from promptCb scope):', input) // 确保 input 在此作用域可见
        // console.log('[SAVE SCENARIO] File provider type:', fileProvider.constructor.name) // 或其他能识别类型的方式
        // console.log('[SAVE SCENARIO] Path returned by createNonClashingName:', finalNewFile)
        // console.log('[SAVE SCENARIO] JSON content length:', txJSON.length)

        let completed = false
        let setCallbackCalled = false
        const finish = (error) => {
          if (completed) return
          completed = true
          return cb(error)
        }
        const openSavedScenario = () => {
          try {
            if (this.fileManager.openFileContent && this.fileManager.openFileContent(finalNewFile, txJSON)) return finish()
            Promise.resolve(this.fileManager.open(finalNewFile))
              .then(() => finish())
              .catch((e) => finish('Failed to open file ' + finalNewFile + ' ' + (e.message || e)))
          } catch (e) {
            return finish('Failed to open file ' + finalNewFile + ' ' + (e.message || e))
          }
        }

        const setResult = fileProvider.set(finalNewFile, txJSON, (setError) => {
          setCallbackCalled = true
          if (setError) return finish('Failed to create file ' + finalNewFile + ' ' + (setError.message || setError))
          openSavedScenario()
        })
        // console.log('[SAVE SCENARIO] Result of fileProvider.set():', setResult)

        if (!setResult) {
          // 如果 fileProvider 实例上有错误信息，尝试打印
          if (fileProvider.lastError) {
            console.error('[SAVE SCENARIO] fileProvider lastError:', fileProvider.lastError)
          }
          if (!setCallbackCalled) return finish('Failed to create file ' + finalNewFile)
        }
        if (setResult && typeof setResult.then === 'function') {
          setResult.then(() => {
            if (!setCallbackCalled) openSavedScenario()
          }).catch((setError) => {
            return finish('Failed to create file ' + finalNewFile + ' ' + (setError.message || setError))
          })
        } else if (!setCallbackCalled) {
          openSavedScenario()
        }
      }

      const finalNewFile = createNonClashingNameSync(newFile, fileProvider)
      if (finalNewFile) return saveFile(null, finalNewFile)
      helper.createNonClashingName(newFile, fileProvider, saveFile)
    })
  }
}

function saveAsFile (blob, name) {
  const node = document.createElement('a')
  node.download = name
  node.rel = 'noopener'
  node.href = URL.createObjectURL(blob)
  setTimeout(function () { URL.revokeObjectURL(node.href) }, 4E4) // 40s
  setTimeout(function () {
    try {
      node.dispatchEvent(new MouseEvent('click'))
    } catch (e) {
      var evt = document.createEvent('MouseEvents')
      evt.initMouseEvent('click', true, true, window, 0, 0, 0, 80,
        20, false, false, false, false, 0, null)
      node.dispatchEvent(evt)
    }
  }, 0)
}

function createNonClashingNameSync (name, fileProvider) {
  if (!fileProvider || fileProvider.type === 'localhost' || typeof fileProvider._exists !== 'function') return null
  if (!name) name = 'Undefined'
  var counter = ''
  var ext = 'sol'
  var reg = /(.*)\.([^.]+)/g
  var split = reg.exec(name)
  if (split) {
    name = split[1]
    ext = split[2]
  }
  var candidate = name + counter + '.' + ext
  while (fileProvider._exists(candidate)) {
    counter = (counter | 0) + 1
    candidate = name + counter + '.' + ext
  }
  return candidate
}

module.exports = RecorderUI
