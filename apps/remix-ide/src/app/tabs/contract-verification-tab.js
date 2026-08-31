/*
 * Modifications Copyright © 2022 TronIDE
 * Licensed under the Apache License, Version 2.0
 */

import { ViewPlugin } from '@remixproject/engine-web'
import * as packageJson from '../../../../../package.json'
import { TronWeb } from 'tronweb'

const yo = require('yo-yo')
const csjs = require('csjs-inject')
const globalRegistry = require('../../global/registry')
const tooltip = require('../ui/tooltip')
const modalDialog = require('../ui/modaldialog')

const tronScanContractApiOverrides = {
  mainnet: process.env.TRONSCAN_MAINNET_CONTRACT_API_URLS || '',
  nile: process.env.TRONSCAN_NILE_CONTRACT_API_URLS || '',
  shasta: process.env.TRONSCAN_SHASTA_CONTRACT_API_URLS || ''
}

function parseEndpointList (rawValue, fallback) {
  const values = String(rawValue || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  const safeValues = values.filter((value) => {
    try {
      const parsed = new URL(value)
      const isLocalHttp = parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]')
      return parsed.protocol === 'https:' || isLocalHttp
    } catch (error) {
      console.debug('[contractVerification] ignoring invalid TronScan API endpoint override', value, error)
      return false
    }
  })

  return safeValues.length ? Array.from(new Set(safeValues.concat(fallback))) : fallback
}

function getContractApiOverrides (rawValue, fallback) {
  return parseEndpointList(rawValue, fallback)
}

async function fetchJsonWithTimeout (url, timeoutMs = 12000) {
  const controller = new AbortController()
  let timer = null
  const request = (async () => {
    const response = await window.fetch(url, { signal: controller.signal })
    // fetch() resolves after headers arrive. Parse the body inside the same
    // timeout so a proxy that stalls mid-response cannot leave the UI/tool hung.
    const payload = response.ok ? await response.json() : null
    return { response, payload }
  })()
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      const error = new Error(`TronScan request timed out after ${timeoutMs}ms`)
      error.name = 'AbortError'
      reject(error)
    }, timeoutMs)
  })
  try {
    return await Promise.race([request, timeout])
  } finally {
    clearTimeout(timer)
  }
}

function isValidTronAddress (address) {
  if (!address || typeof address !== 'string') return false
  try {
    return TronWeb.isAddress(address)
  } catch (error) {
    console.debug('[contractVerification] TronWeb.isAddress threw for', address, error)
    return false
  }
}

// TronScan's /api/contract endpoint only matches the base58 (T...) form: a 41...
// hex (or 0x...) address returns a bare non-contract skeleton, so an existing
// contract entered as hex looked "not found". Normalize any valid input to base58
// before querying. base58 input is returned unchanged.
function toBase58Address (address) {
  let hex = null
  if (/^41[0-9a-fA-F]{40}$/.test(address)) hex = address
  else if (/^0x[0-9a-fA-F]{40}$/.test(address)) hex = '41' + address.slice(2)
  if (!hex) return address
  try {
    return TronWeb.address.fromHex(hex)
  } catch (error) {
    console.debug('[contractVerification] could not normalize hex address to base58', address, error)
    return address
  }
}

// TronScan's /api/contract endpoint always echoes a one-element `data` array,
// even for an address that is not a deployed contract. For a non-contract it
// returns only the bare account skeleton (address/balance/balanceInUsd/
// trxCount/creator) with no contract-identifying fields, so a non-empty object
// is NOT sufficient proof that the contract exists. We require at least one
// field that TronScan only emits for an actual contract record.
function hasContractIdentity (value) {
  if (!value || typeof value !== 'object') return false
  const verifyStatus = value.verify_status !== undefined ? value.verify_status : value.verifyStatus
  if (typeof verifyStatus === 'number') return true
  if (value.contractInfo || value.source_code || value.sourceCode || value.bytecode || value.byte_code) return true
  if (value.name || value.contractName || value.contract_name) return true
  if (value.date_created !== undefined || value.methodMap !== undefined || value.tokenInfo !== undefined) return true
  return false
}

function asContractObject (value) {
  return hasContractIdentity(value) ? value : null
}

function extractContractFromStatusPayload (payload) {
  if (!payload || typeof payload !== 'object') return null
  if (Array.isArray(payload)) return asContractObject(payload[0])
  if (Object.prototype.hasOwnProperty.call(payload, 'data')) {
    const data = payload.data
    return asContractObject(Array.isArray(data) ? data[0] : data)
  }
  return asContractObject(payload)
}

const icon = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%23888" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.6-2.8 8.2-7 10-4.2-1.8-7-5.4-7-10V6l7-3z"/><path d="M8.8 12.2l2.1 2.1 4.4-5"/><path d="M8.5 17h7" opacity=".55"/></svg>'

const profile = {
  name: 'contractVerification',
  displayName: 'Contract Verification',
  // `aiCheckVerification` is a read-only TronScan status lookup used by the AI
  // assistant's check_verification tool; no UI side effects.
  methods: ['aiCheckVerification', 'aiPrepareVerification'],
  events: [],
  icon,
  description: 'Prepare and check TRON contract verification through TronScan.',
  kind: 'analysis',
  location: 'sidePanel',
  documentation: 'https://developers.tron.network/docs/tron-ide',
  version: packageJson.version
}

const css = csjs`
  .container {
    color: var(--text);
    padding: 0 12px 24px;
  }
  .intro {
    position: relative;
    overflow: hidden;
    border: 1px solid var(--light);
    background: var(--body-bg);
    border-radius: 6px;
    padding: 12px 12px 12px 14px;
    margin-bottom: 12px;
  }
  .intro::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: #C8302D;
  }
  .introHeader {
    display: flex;
    align-items: center;
    gap: 9px;
    margin-bottom: 7px;
  }
  .introIcon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 26px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: rgba(200, 48, 45, .14);
    color: #E05B58;
    font-size: 14px;
    font-weight: 700;
  }
  .introEyebrow {
    color: var(--secondary);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .08em;
    line-height: 1.2;
    text-transform: uppercase;
  }
  .introTitle {
    color: var(--text);
    font-size: 14px;
    font-weight: 600;
    line-height: 1.25;
  }
  .introCopy {
    color: var(--secondary);
    font-size: 12px;
    line-height: 1.45;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .statusBlock {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .statusLabel {
    color: var(--secondary);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .06em;
    text-transform: uppercase;
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: 10px;
    border: 1px solid var(--light);
    border-radius: 6px;
    background: var(--body-bg);
    padding: 12px;
  }
  .sectionHeader {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    border-bottom: 1px solid var(--light);
    padding-bottom: 9px;
  }
  .stepNumber {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 24px;
    width: 24px;
    height: 24px;
    border: 1px solid rgba(200, 48, 45, .45);
    border-radius: 50%;
    background: rgba(200, 48, 45, .1);
    color: #E05B58;
    font-size: 11px;
    font-weight: 700;
  }
  .sectionHeading {
    min-width: 0;
  }
  .sectionTitle {
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
    line-height: 1.3;
  }
  .sectionDescription {
    color: var(--secondary);
    font-size: 11px;
    line-height: 1.4;
    margin-top: 2px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: .02em;
    color: var(--secondary);
  }
  .input,
  .select {
    box-sizing: border-box;
    min-height: 36px;
    border: 1px solid var(--light);
    border-radius: 4px;
    background: var(--input, #35384C);
    color: var(--text, #dfe1ea);
    padding: 8px 10px;
    width: 100%;
    font-size: 12px;
    font-weight: 400;
    letter-spacing: normal;
  }
  .input::placeholder {
    color: var(--secondary);
    opacity: .8;
  }
  .input:focus,
  .select:focus {
    border-color: #C8302D;
    background: var(--input, #35384C);
    color: var(--text, #dfe1ea);
    outline: 1px solid rgba(200, 48, 45, .25);
  }
  .select:disabled,
  .input:disabled {
    cursor: not-allowed;
    opacity: .65;
  }
  .actionGrid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .actionWide {
    grid-column: 1 / -1;
  }
  .button,
  .linkButton {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 34px;
    border: 1px solid var(--light);
    border-radius: 4px;
    background: var(--body-bg);
    color: var(--text);
    padding: 7px 8px;
    cursor: pointer;
    font-size: 12px;
    line-height: 1.25;
    text-align: center;
    text-decoration: none;
  }
  .button:hover,
  .linkButton:hover {
    border-color: #C8302D;
    color: #C8302D;
    text-decoration: none;
  }
  .button:focus-visible,
  .linkButton:focus-visible,
  .guideSummary:focus-visible {
    outline: 2px solid rgba(200, 48, 45, .55);
    outline-offset: 2px;
  }
  .primaryButton {
    border-color: #C8302D;
    background: #C8302D;
    color: #fff;
    font-weight: 600;
  }
  .primaryButton:hover {
    border-color: #E05B58;
    background: #E05B58;
    color: #fff;
  }
  .button:disabled {
    border-color: var(--light);
    background: var(--body-bg);
    color: var(--secondary);
    cursor: not-allowed;
    opacity: .5;
  }
  .status {
    border: 1px solid var(--light);
    border-left: 3px solid var(--secondary);
    border-radius: 4px;
    background: var(--body-bg);
    padding: 9px 10px;
    min-height: 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--secondary);
    word-break: break-word;
  }
  .status[data-status="ready"] {
    border-color: #28a745;
    color: var(--text);
  }
  .status[data-status="error"] {
    border-color: #dc3545;
    color: #dc3545;
  }
  .status[data-status="loading"] {
    border-color: #4C8BF5;
  }
  .note {
    color: var(--secondary);
    font-size: 11px;
    line-height: 1.45;
  }
  .hint {
    border-left: 2px solid var(--secondary);
    padding-left: 8px;
  }
  .subgroup {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .subgroup + .subgroup {
    border-top: 1px solid var(--light);
    padding-top: 10px;
  }
  .subgroupTitle {
    color: var(--text);
    font-size: 12px;
    font-weight: 600;
  }
  .subgroupDescription {
    color: var(--secondary);
    font-size: 11px;
    line-height: 1.4;
    margin-top: -4px;
  }
  .noteCallout {
    border-radius: 4px;
    background: rgba(127, 127, 127, .09);
    padding: 8px 9px;
  }
  .guide {
    border: 1px solid var(--light);
    border-radius: 6px;
    background: var(--body-bg);
  }
  .guideSummary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 11px 12px;
    color: var(--text);
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    list-style: none;
  }
  .guideSummary::-webkit-details-marker {
    display: none;
  }
  .guideSummary::after {
    content: '+';
    color: var(--secondary);
    font-size: 16px;
    font-weight: 400;
  }
  .guide[open] .guideSummary::after {
    content: '−';
  }
  .guideContent {
    border-top: 1px solid var(--light);
    padding: 10px 12px 12px;
  }
  .checklist {
    padding: 0 0 0 18px;
    margin: 0;
    color: var(--secondary);
    font-size: 11px;
    line-height: 1.5;
  }
  .checklist li {
    margin: 4px 0;
  }
  .scopeNote {
    border-left: 2px solid var(--light);
    padding-left: 9px;
  }
  .metadataCard {
    border: 1px solid var(--light);
    background: var(--body-bg);
    border-radius: 4px;
    padding: 10px;
    color: var(--secondary);
    font-size: 12px;
    line-height: 1.5;
  }
  .metadataCard strong {
    color: var(--text);
  }
  .metadataGrid {
    display: grid;
    grid-template-columns: minmax(90px, auto) minmax(0, 1fr);
    gap: 4px 10px;
    margin: 8px 0;
  }
  .metadataValue {
    color: var(--text);
    overflow-wrap: anywhere;
  }
`

export class ContractVerificationTab extends ViewPlugin {
  constructor () {
    super(profile)
    this.el = null
    this.state = {
      network: 'mainnet',
      contractAddress: '',
      status: 'Compile and select the deployed main contract, then download its flattened .sol file for TronScan.',
      statusType: 'idle',
      workspaceReady: false,
      compiling: false,
      compileNeedsSuccess: false,
      checking: false,
      checkContext: '',
      contractSelection: '',
      packageText: '',
      packageFingerprint: '',
      packageContext: '',
      flattenText: '',
      flattenName: '',
      flattenFingerprint: ''
    }
    this._compileTimeout = null
    this._compileRunStarted = false
    this._compileTarget = ''
    this._compileWorkspace = ''
    this._compileSourceHash = ''
    this._statusRequestId = 0
    this._acceptCompilerEvents = false
    this._active = false
    this._workspaceName = ''
    this._workspaceEventsRegistered = false
    this._savedFlatten = null
    this._compilerEventsRegistered = false
    this._onCompilationFinished = (finishedTarget, source) => {
      // Plugin event registration replays its remembered value synchronously.
      // Ignore that replay, then match a panel compile by target, workspace and
      // source content so an older/timed-out job cannot complete a newer one.
      if (!this._acceptCompilerEvents) return
      const eventSourceHash = this.compilationSourceHash(source, finishedTarget)
      const startedHere = this.state.compiling && this._compileRunStarted &&
        this.sameCompileTarget(finishedTarget, this._compileTarget) &&
        this._compileWorkspace === this._workspaceName &&
        !!eventSourceHash && eventSourceHash === this._compileSourceHash
      if (this.state.compiling && this._compileRunStarted && !startedHere) return
      if (!startedHere && this.state.compileNeedsSuccess) return
      if (startedHere) {
        this.state.compiling = false
        this._compileRunStarted = false
        this.clearCompileTimeout()
        this.clearCompileIdentity()
      }
      // Compiler artefacts are populated by another compilationFinished
      // consumer. Defer this read by one task so the picker sees that freshly
      // stored result regardless of listener registration order.
      setTimeout(() => {
        // A compile started from this panel replaces the workflow's selected
        // input, so discard outputs made from an older compilation. For an
        // external compile, reconcile the picker and generated previews against
        // the new compiler artifact. The overwrite flow keeps its own scoped
        // snapshot instead of exempting every same-named flattened path.
        const compilation = this.getLatestCompilation()
        if (startedHere && compilation) this.state.compileNeedsSuccess = false
        if (startedHere) this.clearGeneratedArtifacts()
        else this.reconcileGeneratedArtifacts(compilation)
        if (startedHere) {
          if (compilation && compilation.deployable) {
            this.state.status = `Compiled ${compilation.fileName}. ${compilation.contractName} is selected and ready to flatten.`
            this.state.statusType = 'ready'
          } else if (compilation) {
            this.state.status = 'Compilation finished, but it contains only interfaces or abstract contracts. Compile the deployed implementation contract.'
            this.state.statusType = 'error'
          } else {
            this.state.status = 'Compilation finished, but no Solidity contract artifact was found.'
            this.state.statusType = 'error'
          }
        }
        this.update()
        if (!this._active && !this.state.compiling) {
          this.unregisterCompilerEvents()
          this.unregisterWorkspaceEvents()
        }
      }, 0)
    }
    this._onCompilationFailed = (data, failedTarget, source) => {
      if (!this._acceptCompilerEvents) return
      // Ignore a remembered failure replayed by the plugin engine when this
      // listener is first registered. It only belongs to this workflow after
      // compileCurrentFile has set the in-progress flag.
      if (!this.state.compiling || !this._compileRunStarted) return
      const eventSourceHash = this.compilationSourceHash(source, failedTarget)
      const hasCompileContext = !!failedTarget || !!eventSourceHash
      if (hasCompileContext && (!this.sameCompileTarget(failedTarget, this._compileTarget) || !eventSourceHash || eventSourceHash !== this._compileSourceHash || this._compileWorkspace !== this._workspaceName)) return
      this.state.compiling = false
      this._compileRunStarted = false
      this.clearCompileIdentity()
      this.clearCompileTimeout()
      this.setStatus('Compilation failed. Fix the Solidity compiler errors, then compile again.', 'error')
      if (!this._active) {
        this.unregisterCompilerEvents()
        this.unregisterWorkspaceEvents()
      }
    }
    this._onWorkspaceChanged = (workspace) => this.applyWorkspaceContext(workspace)
    this.tronScanTargets = {
      mainnet: {
        label: 'Mainnet',
        apis: getContractApiOverrides(tronScanContractApiOverrides.mainnet, [
          'https://apilist.tronscanapi.com/api/contract'
        ]),
        verify: 'https://tronscan.org/#/contracts/verify'
      },
      nile: {
        label: 'Nile',
        apis: getContractApiOverrides(tronScanContractApiOverrides.nile, [
          'https://nileapi.tronscan.org/api/contract'
        ]),
        verify: 'https://nile.tronscan.org/#/contracts/verify'
      },
      shasta: {
        label: 'Shasta',
        apis: getContractApiOverrides(tronScanContractApiOverrides.shasta, [
          'https://shastapi.tronscan.org/api/contract'
        ]),
        verify: 'https://shasta.tronscan.org/#/contracts/verify'
      }
    }
  }

  render () {
    if (this.el) return this.el
    this.el = this.renderComponent()
    return this.el
  }

  onActivation () {
    this._active = true
    this.state.workspaceReady = false
    this.reconcileGeneratedArtifacts(this.getLatestCompilation())
    this.registerCompilerEvents()
    if (!this._workspaceEventsRegistered) {
      this.on('filePanel', 'setWorkspace', this._onWorkspaceChanged)
      this._workspaceEventsRegistered = true
    }
    this.update()
    this.refreshWorkspaceContext().then((ready) => {
      if (!ready && this._active) this.setStatus('Could not determine the current workspace. Verification output actions stay disabled.', 'error')
      else this.update()
    })
  }

  onDeactivation () {
    this._active = false
    // Keep compiler tracking alive while a panel-started compile is in flight;
    // otherwise reopening the panel could start a second compile and attribute
    // the first job's completion to it.
    if (!this.state.compiling) {
      this.unregisterCompilerEvents()
      this.unregisterWorkspaceEvents()
    }
    if (this.state.checking) {
      this.state.checking = false
      this.state.checkContext = ''
      this._statusRequestId++
      if (!this.state.compiling) {
        this.state.status = 'TronScan status check stopped when the panel closed. Run the check again.'
        this.state.statusType = 'idle'
      }
    }
  }

  registerCompilerEvents () {
    if (this._compilerEventsRegistered) return
    this._acceptCompilerEvents = false
    this.on('solidity', 'compilationFinished', this._onCompilationFinished)
    this.on('solidity', 'compilationFailed', this._onCompilationFailed)
    this._compilerEventsRegistered = true
    this._acceptCompilerEvents = true
  }

  unregisterCompilerEvents () {
    if (!this._compilerEventsRegistered) return
    this.off('solidity', 'compilationFinished')
    this.off('solidity', 'compilationFailed')
    this._acceptCompilerEvents = false
    this._compilerEventsRegistered = false
  }

  unregisterWorkspaceEvents () {
    if (!this._workspaceEventsRegistered) return
    this.off('filePanel', 'setWorkspace')
    this._workspaceEventsRegistered = false
  }

  workspaceName (workspace) {
    return typeof workspace === 'string' ? workspace : (workspace && workspace.name) || ''
  }

  applyWorkspaceContext (workspace) {
    const name = this.workspaceName(workspace)
    if (!name) return
    const changed = !!this._workspaceName && name !== this._workspaceName
    this._workspaceName = name
    this.state.workspaceReady = true
    if (!changed) return
    if (this.state.compiling) {
      this.state.compiling = false
      this._compileRunStarted = false
      this.clearCompileTimeout()
      this.clearCompileIdentity()
    }
    this._savedFlatten = null
    this.clearGeneratedArtifacts()
    this.state.compileNeedsSuccess = true
    this.state.checking = false
    this.state.checkContext = ''
    this._statusRequestId++
    this.setStatus('Workspace changed. Use “Compile current .sol” here before generating verification outputs.', 'idle')
    if (!this._active && !this.state.compiling) {
      this.unregisterCompilerEvents()
      this.unregisterWorkspaceEvents()
    }
  }

  async refreshWorkspaceContext () {
    try {
      const workspace = await this.call('filePanel', 'getCurrentWorkspace')
      this.applyWorkspaceContext(workspace)
      return !!this.workspaceName(workspace)
    } catch (error) {
      this.state.workspaceReady = false
      console.debug('[contractVerification] could not read current workspace', error)
      return false
    }
  }

  async getCurrentWorkspaceName () {
    try {
      const workspace = await this.call('filePanel', 'getCurrentWorkspace')
      this.applyWorkspaceContext(workspace)
      return this.workspaceName(workspace)
    } catch (error) {
      this.state.workspaceReady = false
      console.debug('[contractVerification] could not resolve workspace for flattened source', error)
      return ''
    }
  }

  getTarget (network = this.state.network) {
    return this.tronScanTargets[String(network || '').toLowerCase()] || null
  }

  update () {
    if (this.el) yo.update(this.el, this.renderComponent())
  }

  setStatus (status, statusType = 'idle') {
    this.state.status = status
    this.state.statusType = statusType
    this.update()
  }

  savePackageHistory (packageText) {
    try {
      const packageData = JSON.parse(packageText)
      const parsed = JSON.parse(window.localStorage.getItem('tronide.contractVerification.history') || '[]')
      const history = Array.isArray(parsed) ? parsed : []
      const next = {
        network: packageData.network,
        contractAddress: packageData.contractAddress,
        contractName: packageData.contractName,
        compilerVersion: packageData.compilerVersion,
        generatedAt: packageData.generatedAt
      }
      const distinct = history.filter((item) => !(item && item.network === next.network && item.contractAddress === next.contractAddress && item.contractName === next.contractName && item.compilerVersion === next.compilerVersion))
      window.localStorage.setItem('tronide.contractVerification.history', JSON.stringify([next].concat(distinct).slice(0, 5)))
    } catch (error) {
      console.debug('[contractVerification] failed to persist package history', error)
    }
  }

  getPackageHistory () {
    try {
      const parsed = JSON.parse(window.localStorage.getItem('tronide.contractVerification.history') || '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      console.debug('[contractVerification] failed to read package history', error)
      return []
    }
  }

  contractChoiceId (fileName, contractName) {
    return `${encodeURIComponent(fileName)}::${encodeURIComponent(contractName)}`
  }

  hasDeployableBytecode (contract) {
    const bytecode = contract && contract.evm && contract.evm.bytecode && contract.evm.bytecode.object
    return typeof bytecode === 'string' && bytecode.replace(/^0x/, '').length > 0
  }

  getCompilationChoices (contracts) {
    const choices = []
    for (const fileName of Object.keys(contracts || {})) {
      for (const contractName of Object.keys(contracts[fileName] || {})) {
        const contract = contracts[fileName][contractName]
        choices.push({
          id: this.contractChoiceId(fileName, contractName),
          fileName,
          contractName,
          contract,
          deployable: this.hasDeployableBytecode(contract)
        })
      }
    }
    return choices
  }

  getLatestCompilation (usePanelSelection = true) {
    const artefacts = globalRegistry.get('compilersartefacts')
    const compilerData = artefacts && artefacts.api && artefacts.api.get ? artefacts.api.get('__last') : null
    if (!compilerData || !compilerData.getContracts) return null
    const contracts = compilerData.getContracts() || {}
    const source = compilerData.getSourceCode ? compilerData.getSourceCode() : {}
    const choices = this.getCompilationChoices(contracts)
    if (!choices.length) return null

    // A compilation often enumerates imported interfaces before the user's
    // actual contract (for example IERC1155Errors). Prefer a deployable contract
    // defined in a root source file, then any deployable contract. Once the user
    // explicitly selects a contract, keep that exact artifact for package and
    // flatten operations.
    const sources = source && source.sources ? source.sources : {}
    const roots = this.findSourceRoots(sources)
    const requested = usePanelSelection && choices.find((choice) => choice.id === this.state.contractSelection && choice.deployable)
    const selected = requested || choices.find((choice) => choice.deployable && roots.includes(choice.fileName)) || choices.find((choice) => choice.deployable) || choices[0]
    return {
      compilerVersion: compilerData.languageversion,
      contractName: selected.contractName,
      fileName: selected.fileName,
      contract: selected.contract,
      selection: selected.id,
      deployable: selected.deployable,
      choices,
      contracts,
      source
    }
  }

  selectContract (selection) {
    this.state.contractSelection = selection
    // These artifacts describe one exact compiled contract. Never leave a
    // previous contract's metadata or flattened preview visible after switching.
    this.state.packageText = ''
    this.state.packageFingerprint = ''
    this.state.packageContext = ''
    this.state.flattenText = ''
    this.state.flattenName = ''
    this.state.flattenFingerprint = ''
    this.setStatus('Contract selection changed. Preview or download a fresh flattened Solidity file and settings reference.', 'idle')
  }

  clearGeneratedArtifacts () {
    this.state.contractSelection = ''
    this.state.packageText = ''
    this.state.packageFingerprint = ''
    this.state.packageContext = ''
    this.state.flattenText = ''
    this.state.flattenName = ''
    this.state.flattenFingerprint = ''
  }

  clearCompileTimeout () {
    if (!this._compileTimeout) return
    clearTimeout(this._compileTimeout)
    this._compileTimeout = null
  }

  hashText (value) {
    const text = String(value || '')
    let hash = 2166136261
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(16)
  }

  normalizeCompileTarget (value) {
    return String(value || '').replace(/^browser\//, '').replace(/^\/+/, '')
  }

  sameCompileTarget (left, right) {
    return this.normalizeCompileTarget(left) === this.normalizeCompileTarget(right)
  }

  compilationSourceHash (source, target) {
    const sources = source && source.sources ? source.sources : {}
    const key = Object.keys(sources).find((fileName) => this.sameCompileTarget(fileName, target || (source && source.target)))
    const entry = key && sources[key]
    return entry && typeof entry.content === 'string' ? this.hashText(entry.content) : ''
  }

  clearCompileIdentity () {
    this._compileTarget = ''
    this._compileWorkspace = ''
    this._compileSourceHash = ''
  }

  getCompilationFingerprint (compilation) {
    if (!compilation) return ''
    const sources = compilation.source && compilation.source.sources ? compilation.source.sources : {}
    const sourceText = Object.keys(sources).sort().map((fileName) => `${fileName}\n${(sources[fileName] && sources[fileName].content) || ''}`).join('\n---\n')
    const contractText = compilation.contract && compilation.contract.metadata
      ? compilation.contract.metadata
      : JSON.stringify(compilation.contract || {})
    return [compilation.compilerVersion || '', compilation.selection || this.contractChoiceId(compilation.fileName || '', compilation.contractName || ''), this.hashText(sourceText), this.hashText(contractText)].join(':')
  }

  getPackageContext () {
    return `${this.state.network}:${String(this.state.contractAddress || '').trim()}`
  }

  clearPackageReference () {
    this.state.packageText = ''
    this.state.packageFingerprint = ''
    this.state.packageContext = ''
  }

  clearFlattenedOutput () {
    this.state.flattenText = ''
    this.state.flattenName = ''
    this.state.flattenFingerprint = ''
  }

  reconcileGeneratedArtifacts (compilation = this.getLatestCompilation()) {
    const fingerprint = this.getCompilationFingerprint(compilation)
    let changed = false
    if (this.state.packageText && (this.state.packageFingerprint !== fingerprint || this.state.packageContext !== this.getPackageContext())) {
      this.clearPackageReference()
      changed = true
    }
    if (this.state.flattenText && this.state.flattenFingerprint !== fingerprint) {
      this.clearFlattenedOutput()
      changed = true
    }
    if (changed) {
      this.state.status = 'Compilation or verification inputs changed. Generate fresh outputs before copying, downloading, or saving.'
      this.state.statusType = 'idle'
    }
    return changed
  }

  setNetwork (network) {
    if (!this.tronScanTargets[network] || network === this.state.network) return
    this.state.network = network
    const invalidated = !!this.state.packageText || this.state.checking || !!this.state.checkContext
    this.clearPackageReference()
    this.state.checkContext = ''
    this.state.checking = false
    this._statusRequestId++
    if (invalidated) {
      this.state.status = 'Network changed. Run the TronScan check and show the settings reference again for this network.'
      this.state.statusType = 'idle'
    }
    this.update()
  }

  setContractAddress (address) {
    const changed = address !== this.state.contractAddress
    this.state.contractAddress = address
    if (!changed) return
    const invalidated = !!this.state.packageText || this.state.checking || !!this.state.checkContext
    this.clearPackageReference()
    this.state.checkContext = ''
    this.state.checking = false
    this._statusRequestId++
    if (invalidated) {
      this.state.status = 'Contract address changed. Run the TronScan check and show the settings reference again for this address.'
      this.state.statusType = 'idle'
      this.update()
    }
  }

  async compileCurrentFile () {
    if (!this.state.workspaceReady || this.state.compiling || this.state.checking) return
    let currentFile = ''
    // Disable every action immediately. Resolving the current file and waking
    // the compiler are asynchronous, and an old artifact must not remain usable
    // during that preparation window.
    this.state.compiling = true
    this.state.compileNeedsSuccess = true
    this.clearGeneratedArtifacts()
    this.setStatus('Preparing the current Solidity file for compilation...', 'loading')
    this.clearCompileTimeout()
    this._compileTimeout = setTimeout(() => {
      if (!this.state.compiling) return
      this.state.compiling = false
      this._compileRunStarted = false
      this.clearCompileIdentity()
      this._compileTimeout = null
      const subject = currentFile ? `Compilation of ${currentFile}` : 'Compiler preparation'
      this.setStatus(`${subject} did not finish within two minutes. Compile again after the Solidity compiler is available.`, 'error')
      if (!this._active) {
        this.unregisterCompilerEvents()
        this.unregisterWorkspaceEvents()
      }
    }, 120000)
    try {
      try {
        currentFile = await this.call('fileManager', 'getCurrentFile')
      } catch (error) {
        console.debug('[contractVerification] no current file to compile', error)
      }
      if (!currentFile) throw new Error('Open the deployed contract\'s .sol file in the editor first.')
      if (!/\.sol$/i.test(currentFile)) throw new Error(`The current file is not Solidity: ${currentFile}`)
      const workspace = await this.getCurrentWorkspaceName()
      if (!workspace) throw new Error('Could not determine the current workspace. Compilation was not started.')
      const sourceText = await this.call('fileManager', 'readFile', currentFile)
      this._compileTarget = currentFile
      this._compileWorkspace = workspace
      this._compileSourceHash = this.hashText(sourceText)

      const compilerActive = await this.call('manager', 'isActive', 'solidity').catch(() => false)
      if (!compilerActive) await this.call('manager', 'activatePlugin', 'solidity')

      this.setStatus(`Compiling ${currentFile}...`, 'loading')
      // The compile API starts an asynchronous solc run; the event handlers
      // above update the picker only after that run succeeds or fails.
      this._compileRunStarted = true
      await this.call('solidity', 'compile', currentFile)
    } catch (error) {
      this.state.compiling = false
      this._compileRunStarted = false
      this.clearCompileIdentity()
      this.clearCompileTimeout()
      this.setStatus(error.message || error, 'error')
      if (!this._active) {
        this.unregisterCompilerEvents()
        this.unregisterWorkspaceEvents()
      }
    }
  }

  readCompilationSettings (contract) {
    try {
      const metadata = contract && contract.metadata ? JSON.parse(contract.metadata) : null
      return metadata && metadata.settings ? metadata.settings : {}
    } catch (error) {
      console.debug('[contractVerification] failed to parse contract metadata', error)
      return {}
    }
  }

  // --- Flatten ------------------------------------------------------------
  // Resolve an import spec against the importing file's directory so a './X.sol'
  // / '../lib/Y.sol' maps back to a key in the compiler's resolved sources map.
  resolveImportPath (importerPath, spec, sourceKeys, warnings) {
    const normalize = (p) => {
      const parts = []
      for (const seg of p.split('/')) {
        if (seg === '' || seg === '.') continue
        if (seg === '..') parts.pop()
        else parts.push(seg)
      }
      return parts.join('/')
    }
    // Resolving by basename is ambiguous when two distinct source paths share
    // the same file name: we would silently inline whichever one `find` returns
    // first, which may be the wrong file. Surface a warning in that case.
    const byBasename = (base, exclude) => {
      const matches = sourceKeys.filter((k) => k.endsWith('/' + base) || k === base)
      if (matches.length > 1 && warnings) {
        const distinct = Array.from(new Set(matches))
        warnings.push(`Ambiguous import "${spec}" in ${importerPath || exclude}: ${distinct.length} source files share the basename "${base}" (${distinct.join(', ')}). Inlined "${matches[0]}"; verify this is the intended file.`)
      }
      return matches[0]
    }
    if (spec.startsWith('.')) {
      const dir = importerPath.indexOf('/') >= 0 ? importerPath.slice(0, importerPath.lastIndexOf('/')) : ''
      const resolved = normalize(`${dir}/${spec}`)
      if (sourceKeys.includes(resolved)) return resolved
      // Fallback: match by basename (handles minor path-shape differences).
      const base = resolved.slice(resolved.lastIndexOf('/') + 1)
      return byBasename(base, importerPath) || resolved
    }
    if (sourceKeys.includes(spec)) return spec
    const base = spec.slice(spec.lastIndexOf('/') + 1)
    return byBasename(base, importerPath) || spec
  }

  // Blank out line and block comments so that an `import "..."` (and SPDX/pragma
  // lines) that only appear inside a comment are not mistaken for real code.
  // Newlines are preserved so the per-line SPDX/pragma scan keeps its structure;
  // other characters become spaces.
  stripComments (content) {
    let out = ''
    let i = 0
    const n = content.length
    while (i < n) {
      const c = content[i]
      const next = content[i + 1]
      if (c === '/' && next === '/') {
        while (i < n && content[i] !== '\n') { out += ' '; i++ }
        continue
      }
      if (c === '/' && next === '*') {
        out += '  '
        i += 2
        while (i < n && !(content[i] === '*' && content[i + 1] === '/')) { out += content[i] === '\n' ? '\n' : ' '; i++ }
        if (i < n) { out += '  '; i += 2 }
        continue
      }
      // Skip over string/char literals verbatim so a `/*` or `import` inside a
      // string is not interpreted as a comment opener / statement.
      if (c === '"' || c === "'") {
        const quote = c
        out += c
        i++
        while (i < n && content[i] !== quote) {
          if (content[i] === '\\' && i + 1 < n) { out += content[i] + content[i + 1]; i += 2; continue }
          out += content[i]
          i++
        }
        if (i < n) { out += content[i]; i++ }
        continue
      }
      out += c
      i++
    }
    return out
  }

  extractImports (content) {
    // Capture the quoted path of every `import ... "PATH";` (handles default,
    // named `{A}` and `* as X` forms, single or double quotes). Walk a
    // comment-stripped copy and only treat an `import` keyword that sits outside
    // a string literal as a real import, so an `import "..."` written inside a
    // comment or a string literal is ignored.
    const scrubbed = this.stripComments(content)
    const imports = []
    const importRe = /\bimport\b[^;]*?["']([^"']+)["'][^;]*;/g
    let m
    while ((m = importRe.exec(scrubbed)) !== null) {
      // Reject a match whose `import` keyword is itself inside a string literal
      // (e.g. `string s = "import \"./Fake.sol\";";`).
      const before = scrubbed.slice(0, m.index)
      const dq = (before.match(/"/g) || []).length
      const sq = (before.match(/'/g) || []).length
      if (dq % 2 === 0 && sq % 2 === 0) imports.push(m[1])
    }
    return imports
  }

  findSourceRoots (sources, warnings = []) {
    const keys = Object.keys(sources || {})
    const importedBySomeone = new Set()
    for (const key of keys) {
      const content = (sources[key] && sources[key].content) || ''
      for (const spec of this.extractImports(content)) {
        const dependency = this.resolveImportPath(key, spec, keys, warnings)
        if (sources[dependency] && dependency !== key) importedBySomeone.add(dependency)
      }
    }
    return keys.filter((key) => !importedBySomeone.has(key))
  }

  flattenSources () {
    const compilation = this.getLatestCompilation()
    if (!compilation) {
      throw new Error('Compile a Solidity contract first, then flatten its sources.')
    }
    const sources = compilation.source && compilation.source.sources ? compilation.source.sources : {}
    const keys = Object.keys(sources)
    if (!keys.length) throw new Error('No source files found in the latest compilation.')
    const warnings = []
    // Flatten from the explicitly selected contract's source file. Falling back
    // to a root is only defensive for malformed/stale compiler artifacts.
    const roots = this.findSourceRoots(sources, warnings)
    const entry = keys.includes(compilation.fileName) ? compilation.fileName : (roots[0] || keys[0])
    // Keep the selected contract name when its source file is the entry. This is
    // important when one file defines multiple contracts.
    const contractsByFile = compilation.contracts || {}
    const entryContracts = contractsByFile[entry] ? Object.keys(contractsByFile[entry]) : []
    const entryContractName = entry === compilation.fileName ? compilation.contractName : (entryContracts[0] || compilation.contractName)

    // Depth-first topological order with cycle detection.
    const order = []
    const state = {} // path -> 'visiting' | 'done'
    const visit = (path) => {
      if (state[path] === 'done') return
      if (state[path] === 'visiting') throw new Error(`Circular import detected at ${path}; cannot flatten.`)
      state[path] = 'visiting'
      const content = (sources[path] && sources[path].content) || ''
      for (const spec of this.extractImports(content)) {
        const dep = this.resolveImportPath(path, spec, keys, warnings)
        if (sources[dep]) visit(dep)
      }
      state[path] = 'done'
      order.push(path)
    }
    visit(entry)
    // Any sources not reachable from the entry (defensive) appended after.
    for (const k of keys) if (state[k] !== 'done') visit(k)

    // Concatenate: hoist a single SPDX license, a single version pragma, and a
    // deduped set of abicoder/experimental pragmas into the header; strip every
    // per-file copy (incl. block-comment SPDX and block-comment pragmas) so the
    // flattened file compiles standalone instead of redeclaring them.
    let license = ''
    let pragma = ''
    const extraPragmas = [] // deduped `pragma abicoder ...` / `pragma experimental ...`
    const seenExtraPragma = new Set()
    // SPDX in either `//` or `/* ... */` comment form.
    const spdxLineRe = /\/\/\s*SPDX-License-Identifier:\s*([^\s*]+)/
    const spdxBlockRe = /\/\*\s*SPDX-License-Identifier:\s*([^\s*]+)[^]*?\*\//
    // Pragma statements (version, abicoder, experimental) detected on the
    // comment-stripped text so a commented-out pragma is neither hoisted nor
    // left behind, but real pragmas are reliably matched.
    const versionPragmaRe = /pragma\s+solidity\b[^;]*;/g
    const otherPragmaRe = /pragma\s+(?:abicoder|experimental)\b[^;]*;/g

    const bodies = []
    for (const path of order) {
      const raw = (sources[path] && sources[path].content) || ''
      const scrubbed = this.stripComments(raw)

      // Hoist the first SPDX (either comment form) and pragmas.
      const spdxMatch = raw.match(spdxLineRe) || raw.match(spdxBlockRe)
      if (spdxMatch && !license) license = spdxMatch[1]
      let mm
      versionPragmaRe.lastIndex = 0
      while ((mm = versionPragmaRe.exec(scrubbed)) !== null) { if (!pragma) pragma = mm[0].replace(/\s+/g, ' ').trim() }
      otherPragmaRe.lastIndex = 0
      while ((mm = otherPragmaRe.exec(scrubbed)) !== null) {
        const norm = mm[0].replace(/\s+/g, ' ').trim()
        if (!seenExtraPragma.has(norm)) { seenExtraPragma.add(norm); extraPragmas.push(norm) }
      }

      // Strip per-file SPDX (both comment forms), pragmas, and imports from the
      // body so the hoisted header copies are not duplicated. Pragmas/imports
      // are removed line-wise on the comment-stripped text (preserving real
      // comments) by blanking only the matched statements.
      const rawLines = raw.split('\n')
      const scrubbedLines = scrubbed.split('\n')
      const kept = []
      let dropImportUntilSemicolon = false
      for (let li = 0; li < rawLines.length; li++) {
        const sline = scrubbedLines[li] || ''
        if (dropImportUntilSemicolon) {
          // Continuation of a multi-line `import { ... } from "...";`.
          if (sline.indexOf(';') >= 0) dropImportUntilSemicolon = false
          continue
        }
        if (/^\s*pragma\s+solidity\b/.test(sline)) continue
        if (/^\s*pragma\s+(?:abicoder|experimental)\b/.test(sline)) continue
        if (/^\s*import\b/.test(sline)) {
          if (sline.indexOf(';') < 0) dropImportUntilSemicolon = true
          continue
        }
        kept.push(rawLines[li])
      }
      const body = kept.join('\n')
        .replace(/\/\/\s*SPDX-License-Identifier:[^\n]*/g, '')
        .replace(/\/\*\s*SPDX-License-Identifier:[^]*?\*\//g, '')
      bodies.push(`// File: ${path}\n${body.trim()}`)
    }
    const header = [
      '// SPDX-License-Identifier: ' + (license || 'UNLICENSED'),
      pragma || 'pragma solidity ^0.8.0;',
      ...extraPragmas,
      '',
      '// Flattened by TronIDE from ' + entry + '. Imports inlined in dependency order.',
      ''
    ].join('\n')
    return { entry, contractName: entryContractName, content: header + '\n' + bodies.join('\n\n') + '\n', warnings: Array.from(new Set(warnings)) }
  }

  flatten () {
    try {
      if (!this.state.workspaceReady || this.state.compileNeedsSuccess || this.state.compiling) throw new Error('Compile the deployed contract successfully in the current workspace before flattening its sources.')
      const compilation = this.getLatestCompilation()
      if (!compilation || !compilation.deployable) throw new Error('Compile and select a deployable Solidity contract before flattening its sources.')
      const result = this.flattenSources()
      this.state.flattenText = result.content
      this.state.flattenName = `${result.contractName || 'Contract'}_flat.sol`
      this.state.flattenFingerprint = this.getCompilationFingerprint(compilation)
      const warns = result.warnings || []
      const base = `Flattened ${result.entry} into a single file. Preview below — copy or save it for TronScan verification.`
      this.setStatus(warns.length ? `${base} Warning: ${warns.join(' ')}` : base, warns.length ? 'idle' : 'ready')
      this.update()
    } catch (error) {
      this.setStatus(error.message || error, 'error')
      this.update()
    }
  }

  async copyFlatten () {
    let snapshot = null
    try {
      this.reconcileGeneratedArtifacts()
      if (!this.state.flattenText) this.flatten()
      if (!this.state.flattenText) return
      snapshot = {
        content: this.state.flattenText,
        fingerprint: this.getCompilationFingerprint(this.getLatestCompilation())
      }
      await navigator.clipboard.writeText(snapshot.content)
      if (snapshot.content !== this.state.flattenText || snapshot.fingerprint !== this.getCompilationFingerprint(this.getLatestCompilation())) return
      this.setStatus('Flattened source copied to clipboard.', 'ready')
    } catch (error) {
      if (snapshot && (snapshot.content !== this.state.flattenText || snapshot.fingerprint !== this.getCompilationFingerprint(this.getLatestCompilation()))) return
      this.setStatus(error.message || error, 'error')
    }
  }

  downloadFlatten () {
    try {
      this.reconcileGeneratedArtifacts()
      if (!this.state.flattenText) this.flatten()
      if (!this.state.flattenText) return
      const node = document.createElement('a')
      const requestedName = this.state.flattenName || 'Contract_flat.sol'
      node.download = requestedName.replace(/[^a-zA-Z0-9_.-]/g, '_')
      node.rel = 'noopener'
      node.href = URL.createObjectURL(new Blob([this.state.flattenText], { type: 'text/plain;charset=utf-8' }))
      document.body.appendChild(node)
      node.click()
      node.remove()
      setTimeout(function () { URL.revokeObjectURL(node.href) }, 4E4)
      this.setStatus('Flattened Solidity file downloaded. Upload this .sol under "Contract File(s)" on TronScan.', 'ready')
    } catch (error) {
      this.setStatus(error.message || error, 'error')
    }
  }

  async saveFlatten () {
    try {
      const workspace = await this.getCurrentWorkspaceName()
      if (this.state.compileNeedsSuccess || this.state.compiling) throw new Error('Compile the deployed contract successfully in this workspace before saving a flattened source.')
      const compilation = this.getLatestCompilation()
      // Bind the save intent before regenerating the preview or opening an
      // overwrite confirmation. A Git checkout changes the workspace
      // provider's generation even when the workspace name stays the same, so
      // comparing this context also catches same-workspace branch switches.
      let mutationContext
      try {
        mutationContext = await this.call('fileManager', 'captureWorkspaceMutationContext', 'flattened')
      } catch (error) {
        throw new Error('Could not bind the current workspace version. Nothing was saved.')
      }
      if (!mutationContext || mutationContext.workspace !== workspace || !Number.isInteger(mutationContext.generation)) {
        throw new Error('Could not bind the current workspace version. Nothing was saved.')
      }
      const assertMutationContext = async () => {
        let currentContext
        try {
          currentContext = await this.call('fileManager', 'captureWorkspaceMutationContext', 'flattened')
        } catch (error) {
          throw new Error('Could not re-check the workspace version after confirmation. Nothing was saved.')
        }
        if (!currentContext || currentContext.workspace !== mutationContext.workspace || currentContext.generation !== mutationContext.generation) {
          throw new Error('The workspace or Git branch changed while the save confirmation was open. Nothing was saved.')
        }
      }
      // Keep the last generated source only for the explicit overwrite flow.
      // Copy/download always reconcile against the current compilation, while
      // Save may restore a hand-edited generated file after confirmation.
      const hasFreshPreview = !!(this.state.flattenText && this.state.flattenFingerprint === this.getCompilationFingerprint(compilation))
      const saved = !hasFreshPreview && workspace && this._savedFlatten && this._savedFlatten.workspace === workspace && compilation && compilation.fileName === this._savedFlatten.path
        ? this._savedFlatten
        : null
      if (!saved) {
        this.reconcileGeneratedArtifacts(compilation)
        if (!this.state.flattenText) this.flatten()
        if (!this.state.flattenText) return
      }
      const flattenName = saved ? saved.name : (this.state.flattenName || 'Contract_flat.sol')
      const path = `flattened/${flattenName}`
      const content = saved ? saved.content : this.state.flattenText
      const writeAndOpen = async (expected) => {
        await assertMutationContext()
        const currentWorkspace = await this.getCurrentWorkspaceName()
        if (!workspace || currentWorkspace !== workspace) throw new Error('Workspace changed before the flattened source could be saved. Generate it again in the current workspace.')
        const existsNow = await this.call('fileManager', 'exists', path)
        if (!!existsNow !== expected.exists) throw new Error(`${path} changed while the save confirmation was open. Nothing was overwritten.`)
        if (expected.exists) {
          const contentNow = await this.call('fileManager', 'readFile', path)
          if (contentNow !== expected.content) throw new Error(`${path} changed while the save confirmation was open. Nothing was overwritten.`)
        }
        await assertMutationContext()
        await this.call('fileManager', 'writeFile', path, content, mutationContext)
        await this.call('fileManager', 'open', path)
        this._savedFlatten = { workspace, path, name: flattenName, content }
        this.setStatus(`Saved flattened source to ${path}.`, 'ready')
      }
      // contractVerification is a native plugin, so fileManager.writeFile no
      // longer prompts. Never silently clobber a flat file the user has edited
      // (v2.3.0 pattern e / DEF-R1-1): confirm the overwrite when the target
      // exists and differs. Identical or absent targets write straight through.
      let exists = false
      try {
        exists = await this.call('fileManager', 'exists', path)
      } catch (error) {
        throw new Error(`Could not check whether ${path} already exists. Nothing was saved.`)
      }
      let existing = null
      if (exists) {
        try {
          existing = await this.call('fileManager', 'readFile', path)
        } catch (error) {
          throw new Error(`Could not read the existing ${path}. Nothing was overwritten.`)
        }
        if (existing !== content) {
          modalDialog(`Overwrite ${path}?`, yo`
            <div data-id="contractVerificationOverwriteBody">${path} already exists and differs from the freshly flattened source. Overwrite it?</div>`,
          { label: 'Overwrite', fn: () => { writeAndOpen({ exists: true, content: existing }).catch((error) => this.setStatus(error.message || error, 'error')) } },
          { label: 'Cancel', fn: () => { this.setStatus(`Kept the existing ${path}; flattened source not saved.`, 'idle') } })
          return
        }
      }
      await writeAndOpen({ exists, content: existing })
    } catch (error) {
      this.setStatus(error.message || error, 'error')
    }
  }
  // --------------------------------------------------------------------------

  // Build reference verification metadata JSON for a given address from a
  // compilation object (getLatestCompilation()'s shape). Address-parameterized
  // so both the panel (state.contractAddress) and the AI tool can call it.
  buildVerificationPackage (contractAddress, compilation, network = this.state.network) {
    if (!contractAddress) {
      throw new Error('Enter the deployed TRON contract address before showing or downloading its verification settings reference.')
    }
    if (!isValidTronAddress(contractAddress)) {
      throw new Error('Invalid TRON contract address. Enter a base58check T... or 41... hex address before showing or downloading the settings reference.')
    }
    if (!compilation.deployable && !this.hasDeployableBytecode(compilation.contract)) {
      throw new Error(`"${compilation.contractName}" has no deployable bytecode. Select the actual deployed main contract, not an interface or abstract contract.`)
    }
    const settings = this.readCompilationSettings(compilation.contract)
    const sourceFiles = compilation.source && compilation.source.sources ? compilation.source.sources : {}
    const target = this.getTarget(network)
    if (!target) throw new Error(`Unsupported TRON network: ${network}. Use mainnet, nile, or shasta.`)
    return JSON.stringify({
      tool: 'TronIDE Contract Verification MVP',
      network: target.label,
      contractAddress,
      contractName: compilation.contractName,
      sourceFile: compilation.fileName,
      compilerVersion: compilation.compilerVersion,
      optimization: settings.optimizer || null,
      evmVersion: settings.evmVersion || null,
      libraries: settings.libraries || null,
      standardJsonInput: {
        language: 'Solidity',
        sources: sourceFiles,
        settings
      },
      abi: compilation.contract.abi || [],
      bytecode: compilation.contract.evm && compilation.contract.evm.bytecode ? compilation.contract.evm.bytecode.object : '',
      generatedAt: new Date().toISOString(),
      note: 'Reference metadata only. TronScan does not accept this JSON as the contract file. Upload the flattened .sol source and manually match these compiler/settings fields.'
    }, null, 2)
  }

  createVerificationPackage () {
    if (!this.state.workspaceReady || this.state.compileNeedsSuccess || this.state.compiling) {
      throw new Error('Compile the deployed contract successfully before showing or downloading its TronScan settings reference.')
    }
    const compilation = this.getLatestCompilation()
    if (!compilation) {
      throw new Error('Compile a Solidity contract first, then show or download its TronScan settings reference.')
    }
    return this.buildVerificationPackage((this.state.contractAddress || '').trim(), compilation)
  }

  setPackageReference (packageText, compilation = this.getLatestCompilation()) {
    this.state.packageText = packageText
    this.state.packageFingerprint = this.getCompilationFingerprint(compilation)
    this.state.packageContext = this.getPackageContext()
  }

  getPackagePreview () {
    try {
      return this.state.packageText ? JSON.parse(this.state.packageText) : null
    } catch (error) {
      console.debug('[contractVerification] failed to parse generated settings reference', error)
      return null
    }
  }

  // Programmatic verification-settings builder for the AI assistant. TronScan
  // source submission is a manual external step (no public submit API), so this
  // returns the metadata + the TronScan verify URL; the assistant explains that
  // the user must upload Solidity source and match the fields manually.
  // `input`: { address, network, contractName?, sourceFile? }.
  async aiPrepareVerification (input) {
    const opts = (input && typeof input === 'object') ? input : { address: input }
    const address = String(opts.address || '').trim()
    const network = String(opts.network || '').toLowerCase()
    if (!address) return { ok: false, message: 'Provide the deployed TRON contract address.' }
    if (!isValidTronAddress(address)) return { ok: false, message: 'Invalid TRON address — use a base58 "T..." (34 chars) or a 41... hex address.' }
    const target = this.getTarget(network)
    if (!target) return { ok: false, message: 'Provide the TRON network: mainnet, nile, or shasta.' }
    // The tool's explicit inputs are authoritative. Keep the revealed panel in
    // sync, but do not let an old panel contract selection choose the AI default.
    this.setNetwork(network)
    this.setContractAddress(address)
    const workspace = await this.getCurrentWorkspaceName()
    if (!workspace) return { ok: false, message: 'Could not determine the current workspace. Verification settings were not prepared.' }
    if (this.state.compileNeedsSuccess || this.state.compiling) return { ok: false, message: 'Compile the contract successfully before preparing verification settings.' }
    const compilation = this.getLatestCompilation(false)
    if (!compilation) return { ok: false, message: 'Compile the contract first, then prepare the verification metadata.' }
    let { contractName, contract, fileName } = compilation
    if (opts.contractName) {
      const matches = []
      for (const f of Object.keys(compilation.contracts || {})) {
        if (compilation.contracts[f] && compilation.contracts[f][opts.contractName] && (!opts.sourceFile || opts.sourceFile === f)) matches.push({ contract: compilation.contracts[f][opts.contractName], fileName: f })
      }
      if (!matches.length) {
        const names = Object.keys(compilation.contracts || {}).flatMap((f) => Object.keys(compilation.contracts[f] || {}))
        return { ok: false, message: `No compiled contract named "${opts.contractName}"${opts.sourceFile ? ` in ${opts.sourceFile}` : ''}. Compiled: ${names.join(', ') || '(none)'}.` }
      }
      if (matches.length > 1) return { ok: false, message: `More than one source defines "${opts.contractName}". Provide source_file (${matches.map((match) => match.fileName).join(', ')}).` }
      contractName = opts.contractName; contract = matches[0].contract; fileName = matches[0].fileName
    }
    try {
      const selection = this.contractChoiceId(fileName, contractName)
      const preparedCompilation = { compilerVersion: compilation.compilerVersion, contractName, fileName, contract, source: compilation.source, selection }
      const pkg = this.buildVerificationPackage(address, preparedCompilation, network)
      this.state.contractSelection = selection
      this.setPackageReference(pkg, preparedCompilation)
      this.state.status = `Verification settings reference prepared for ${contractName} on ${target.label}. The AI will ask before saving the JSON file.`
      this.state.statusType = 'ready'
      this.update()
      return { ok: true, network: target.label, contractName, compilerVersion: compilation.compilerVersion, tronscanVerifyUrl: target.verify, package: pkg }
    } catch (e) { return { ok: false, message: (e && e.message) || String(e) } }
  }

  generatePackage () {
    try {
      const packageText = this.createVerificationPackage()
      this.setPackageReference(packageText)
      this.savePackageHistory(packageText)
      this.setStatus('Verification settings reference shown below. It is kept in this browser tab only; TronScan does not accept this JSON as the contract file.', 'ready')
    } catch (error) {
      this.setStatus(error.message || error, 'error')
    }
  }

  async copyPackage () {
    let snapshot = null
    try {
      const packageText = this.createVerificationPackage()
      this.setPackageReference(packageText)
      this.savePackageHistory(packageText)
      snapshot = {
        content: packageText,
        context: this.getPackageContext(),
        fingerprint: this.getCompilationFingerprint(this.getLatestCompilation())
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(packageText)
        if (snapshot.content !== this.state.packageText || snapshot.context !== this.getPackageContext() || snapshot.fingerprint !== this.getCompilationFingerprint(this.getLatestCompilation())) return
        this.setStatus('Verification settings JSON copied. Do not paste the full JSON into TronScan; upload the flattened .sol and fill the matching fields.', 'ready')
      } else {
        this.downloadPackage()
      }
    } catch (error) {
      if (snapshot && (snapshot.content !== this.state.packageText || snapshot.context !== this.getPackageContext() || snapshot.fingerprint !== this.getCompilationFingerprint(this.getLatestCompilation()))) return
      this.setStatus(error.message || error, 'error')
    }
  }

  downloadPackage () {
    try {
      const packageText = this.createVerificationPackage()
      this.setPackageReference(packageText)
      this.savePackageHistory(packageText)
      const node = document.createElement('a')
      node.download = 'tronide-verification-settings-reference.json'
      node.rel = 'noopener'
      node.href = URL.createObjectURL(new Blob([packageText], { type: 'application/json' }))
      document.body.appendChild(node)
      node.click()
      node.remove()
      setTimeout(function () { URL.revokeObjectURL(node.href) }, 4E4)
      this.setStatus('Verification settings JSON downloaded for reference. TronScan does not accept it as the contract file.', 'ready')
    } catch (error) {
      this.setStatus(error.message || error, 'error')
    }
  }

  // Programmatic TronScan verification-status lookup for the AI assistant.
  // Read-only, no UI/state side effects: returns a plain result the tool relays.
  async aiCheckVerification (input) {
    const opts = (input && typeof input === 'object') ? input : { address: input }
    const addr = String(opts.address || '').trim()
    const network = String(opts.network || '').toLowerCase()
    if (!addr) return { ok: false, message: 'Provide a deployed TRON contract address.' }
    if (!isValidTronAddress(addr)) return { ok: false, message: 'Invalid TRON address — use a base58 "T..." (34 chars) or a 41... hex address.' }
    const queryAddress = toBase58Address(addr)
    const target = this.getTarget(network)
    if (!target) return { ok: false, message: 'Provide the TRON network: mainnet, nile, or shasta.' }
    const contractApis = target.apis || (target.api ? [target.api] : [])
    if (!contractApis.length) return { ok: false, message: 'No TronScan contract API is configured for the current network.' }
    const queries = contractApis.flatMap((api) => [`${api}?contract=${encodeURIComponent(queryAddress)}`, `${api}?address=${encodeURIComponent(queryAddress)}`])
    let contract = null
    let reachedEndpoint = false
    for (const query of queries) {
      try {
        const { response, payload } = await fetchJsonWithTimeout(query)
        if (response.ok) {
          reachedEndpoint = true
          contract = extractContractFromStatusPayload(payload)
          if (contract) break
        }
      } catch (e) { /* try the next endpoint */ }
    }
    if (!contract) {
      return reachedEndpoint
        ? { ok: true, verified: false, found: false, network: target.label, message: 'TronScan has no contract at this address on ' + target.label + '.' }
        : { ok: false, message: 'Could not reach TronScan to check the status.' }
    }
    const verified = !!(contract.verify_status === 2 || contract.verifyStatus === 2 || contract.contractInfo || contract.source_code || contract.sourceCode)
    const name = contract.name || contract.contractName || contract.contract_name || null
    return { ok: true, verified, found: true, name, network: target.label }
  }

  async checkStatus () {
    if (this.state.checking || this.state.compiling) return
    const address = this.state.contractAddress.trim()
    if (!address) {
      this.setStatus('Enter a deployed TRON contract address before checking TronScan status.', 'error')
      return
    }
    if (!isValidTronAddress(address)) {
      this.setStatus('Invalid TRON address. Enter a base58check address starting with "T" (34 chars) or a 41... hex address.', 'error')
      return
    }
    const network = this.state.network
    const requestContext = `${network}:${address}`
    const requestId = ++this._statusRequestId
    this.state.checking = true
    this.state.checkContext = ''
    this.setStatus('Checking TronScan contract status...', 'loading')
    // TronScan only matches the base58 form, so query with it even when the user
    // typed a 41.../0x hex address (otherwise a real contract reads as not-found).
    const queryAddress = toBase58Address(address)
    const target = this.getTarget(network)
    const contractApis = target.apis || (target.api ? [target.api] : [])
    const queries = contractApis.flatMap((api) => [`${api}?contract=${encodeURIComponent(queryAddress)}`, `${api}?address=${encodeURIComponent(queryAddress)}`])
    try {
      let contract = null
      let reachedEndpoint = false
      let lastError = null
      for (const query of queries) {
        try {
          const { response, payload } = await fetchJsonWithTimeout(query)
          if (requestId !== this._statusRequestId) return
          if (response.ok) {
            reachedEndpoint = true
            contract = extractContractFromStatusPayload(payload)
            if (contract) break
            console.debug('[contractVerification] contract status endpoint reported no contract for the address', query, payload)
            continue
          }
          lastError = new Error(`TronScan endpoint returned ${response.status}`)
          console.debug('[contractVerification] contract status endpoint returned a non-OK status', query, response.status)
        } catch (error) {
          if (requestId !== this._statusRequestId) return
          lastError = error
          console.debug('[contractVerification] contract status endpoint failed', query, error)
        }
      }
      if (requestId !== this._statusRequestId) return
      if (!contract) {
        // We could reach TronScan but it has no contract record for this
        // (valid-format) address: report "not found" rather than a found/error.
        if (reachedEndpoint) {
          this.state.checkContext = requestContext
          this.setStatus('TronScan has no contract at this address on the selected network. Check the address and network, or confirm the contract is deployed.', 'error')
          return
        }
        throw lastError || new Error('TronScan did not return a readable contract response.')
      }
      const verified = contract && (contract.verify_status === 2 || contract.verifyStatus === 2 || contract.contractInfo || contract.source_code || contract.sourceCode)
      const name = contract && (contract.name || contract.contractName || contract.contract_name)
      this.state.checkContext = requestContext
      this.setStatus(verified ? `TronScan reports this contract as verified${name ? `: ${name}` : ''}.` : 'TronScan found the contract, but source verification is not detected yet.', verified ? 'ready' : 'idle')
    } catch (error) {
      if (requestId !== this._statusRequestId) return
      this.state.checkContext = requestContext
      this.setStatus(`Unable to query TronScan from this browser session. Open TronScan manually or try again later. ${error.message || error}`, 'error')
    } finally {
      if (requestId === this._statusRequestId) {
        this.state.checking = false
        this.update()
      }
    }
  }

  renderComponent () {
    const compilation = this.getLatestCompilation()
    const compilationChoices = compilation ? compilation.choices : []
    const hasDeployableContract = compilationChoices.some((choice) => choice.deployable)
    const workflowDisabled = !this.state.workspaceReady || this.state.compiling || this.state.compileNeedsSuccess || !hasDeployableContract
    const packagePreview = this.getPackagePreview()
    const optimizer = packagePreview && packagePreview.optimization
    return yo`
      <div class=${css.container} data-id="contractVerificationPlugin">
        <div class=${css.intro}>
          <div class=${css.introHeader}>
            <span class=${css.introIcon} aria-hidden="true">✓</span>
            <div>
              <div class=${css.introEyebrow}>TronScan workflow</div>
              <div class=${css.introTitle}>Verify a deployed contract</div>
            </div>
          </div>
          <div class=${css.introCopy}>Prepare the exact source and compiler settings in three focused steps, then finish the submission on TronScan.</div>
        </div>
        <div class=${css.form} aria-label="TronScan verification MVP">
          <div class=${css.statusBlock}>
            <div class=${css.statusLabel}>Workflow status</div>
            <div class=${css.status} data-id="contractVerificationStatusResult" data-status=${this.state.statusType} role="status" aria-live="polite" aria-busy=${this.state.compiling || this.state.checking}>${this.state.status}</div>
          </div>

          <section class=${css.section} data-id="contractVerificationStepCompile">
            <div class=${css.sectionHeader}>
              <span class=${css.stepNumber} aria-hidden="true">1</span>
              <div class=${css.sectionHeading}>
                <div class=${css.sectionTitle}>Compile the deployed source</div>
                <div class=${css.sectionDescription}>Use the same implementation contract and compiler configuration as the deployment.</div>
              </div>
            </div>
            <label class=${css.field}>
              Compiled main contract
              <select class=${css.select} data-id="contractVerificationContractSelect" disabled=${workflowDisabled} onchange=${(event) => this.selectContract(event.target.value)}>
                ${hasDeployableContract
                  ? compilationChoices.map((choice) => yo`<option value=${choice.id} selected=${choice.id === compilation.selection} disabled=${!choice.deployable}>${choice.contractName} — ${choice.fileName}${choice.deployable ? '' : ' (interface/abstract — no bytecode)'}</option>`)
                  : yo`<option value="">${compilationChoices.length ? 'No deployable contract found' : 'Compile a contract first'}</option>`}
              </select>
            </label>
            <div class=${css.actionGrid}>
              <button class="${css.button} ${css.primaryButton} ${css.actionWide}" data-id="contractVerificationCompileCurrent" disabled=${!this.state.workspaceReady || this.state.compiling || this.state.checking} onclick=${() => this.compileCurrentFile()}>${this.state.compiling ? 'Compiling...' : 'Compile current .sol'}</button>
            </div>
            ${this.state.compileNeedsSuccess && !this.state.compiling
              ? yo`<div class="${css.note} ${css.hint}" data-id="contractVerificationCompileHint">The latest compile produced no deployable artifact. Fix the source, then compile it again.</div>`
              : (!hasDeployableContract ? yo`<div class="${css.note} ${css.hint}" data-id="contractVerificationCompileHint">${compilationChoices.length ? 'Only interfaces or abstract contracts were compiled. Open and compile the deployed implementation.' : 'No compiled artifact is available. Open and compile the deployed contract.'}</div>` : '')}
          </section>

          <section class=${css.section} data-id="contractVerificationStepStatus">
            <div class=${css.sectionHeader}>
              <span class=${css.stepNumber} aria-hidden="true">2</span>
              <div class=${css.sectionHeading}>
                <div class=${css.sectionTitle}>Check the deployed address</div>
                <div class=${css.sectionDescription}>Choose the exact network before querying the public TronScan record.</div>
              </div>
            </div>
            <label class=${css.field}>
              Network
              <select class=${css.select} data-id="contractVerificationNetworkSelect" onchange=${(event) => this.setNetwork(event.target.value)}>
                ${Object.keys(this.tronScanTargets).map((key) => yo`<option value=${key} selected=${this.state.network === key}>${this.tronScanTargets[key].label}</option>`)}
              </select>
            </label>
            <label class=${css.field}>
              Contract address
              <input class=${css.input} data-id="contractVerificationAddressInput" placeholder="Base58 T... or 41... hex" value=${this.state.contractAddress} oninput=${(event) => this.setContractAddress(event.target.value)} />
            </label>
            <div class=${css.actionGrid}>
              <button class="${css.button} ${css.primaryButton}" data-id="contractVerificationCheckStatus" disabled=${this.state.checking || this.state.compiling} onclick=${() => this.checkStatus()}>${this.state.checking ? 'Checking...' : 'Check status'}</button>
              <a class=${css.linkButton} data-id="contractVerificationOpenTronScan" aria-label="Open verification lookup" target="_blank" rel="noopener noreferrer" href=${this.getTarget().verify}>Open TronScan ↗</a>
            </div>
          </section>

          <section class=${css.section} data-id="contractVerificationStepFiles">
            <div class=${css.sectionHeader}>
              <span class=${css.stepNumber} aria-hidden="true">3</span>
              <div class=${css.sectionHeading}>
                <div class=${css.sectionTitle}>Prepare verification files</div>
                <div class=${css.sectionDescription}>Export the Solidity upload first; use the JSON only as a settings reference.</div>
              </div>
            </div>
            <div class=${css.subgroup}>
              <div class=${css.subgroupTitle}>Flattened Solidity source</div>
              <div class=${css.subgroupDescription}>This is the contract file you upload to TronScan.</div>
              <div class=${css.actionGrid} aria-label="Flatten sources">
                <button class=${css.button} data-id="contractVerificationFlatten" disabled=${workflowDisabled} onclick=${() => this.flatten()}>Preview source</button>
                <button class=${css.button} data-id="contractVerificationCopyFlatten" disabled=${workflowDisabled} onclick=${() => this.copyFlatten()}>Copy source</button>
                <button class=${css.button} aria-label="Download flattened .sol" data-id="contractVerificationDownloadFlatten" disabled=${workflowDisabled} onclick=${() => this.downloadFlatten()}>Download .sol</button>
                <button class=${css.button} aria-label="Save flattened .sol to workspace" data-id="contractVerificationSaveFlatten" disabled=${workflowDisabled} onclick=${() => this.saveFlatten()}>Save to workspace</button>
              </div>
            </div>
            <div class=${css.subgroup}>
              <div class=${css.subgroupTitle}>Compiler settings reference</div>
              <div class=${css.subgroupDescription}>Keep this beside TronScan while matching compiler and optimizer fields.</div>
              <div class=${css.actionGrid} aria-label="Verification metadata">
                <button class="${css.button} ${css.actionWide}" data-id="contractVerificationGeneratePackage" disabled=${workflowDisabled} onclick=${() => this.generatePackage()}>Preview settings</button>
                <button class=${css.button} data-id="contractVerificationCopyPackage" disabled=${workflowDisabled} onclick=${() => this.copyPackage()}>Copy JSON</button>
                <button class=${css.button} data-id="contractVerificationDownloadPackage" disabled=${workflowDisabled} onclick=${() => this.downloadPackage()}>Download JSON</button>
              </div>
              <div class="${css.note} ${css.noteCallout}">Reference only — do not upload the settings JSON to TronScan.</div>
            </div>
          ${packagePreview ? yo`
            <div class=${css.metadataCard} data-id="contractVerificationMetadataPreview">
              <strong>Verification settings reference (not for upload)</strong>
              <div class=${css.metadataGrid}>
                <span>Network</span><span class=${css.metadataValue}>${packagePreview.network || '—'}</span>
                <span>Address</span><span class=${css.metadataValue}>${packagePreview.contractAddress || '—'}</span>
                <span>Contract</span><span class=${css.metadataValue}>${packagePreview.contractName || '—'} — ${packagePreview.sourceFile || '—'}</span>
                <span>Compiler</span><span class=${css.metadataValue}>${packagePreview.compilerVersion || '—'}</span>
                <span>Optimizer</span><span class=${css.metadataValue}>${optimizer ? `${optimizer.enabled ? 'enabled' : 'disabled'}${optimizer.runs !== undefined ? `, ${optimizer.runs} runs` : ''}` : 'not specified'}</span>
                <span>EVM version</span><span class=${css.metadataValue}>${packagePreview.evmVersion || 'default'}</span>
              </div>
              <details>
                <summary>Advanced JSON reference</summary>
                <textarea class=${css.input} readonly rows="12" data-id="contractVerificationMetadataText" style="width:100%;font-family:monospace;white-space:pre;margin-top:8px">${this.state.packageText}</textarea>
              </details>
            </div>
          ` : ''}
          ${this.state.flattenText ? yo`
            <details class=${css.note} data-id="contractVerificationFlattenPreview" open>
              <summary>Flattened source preview (${this.state.flattenName || 'Contract_flat.sol'})</summary>
              <textarea class=${css.input} readonly rows="14" data-id="contractVerificationFlattenText" style="width:100%;font-family:monospace;white-space:pre">${this.state.flattenText}</textarea>
            </details>
          ` : ''}
          </section>

          <details class=${css.guide}>
            <summary class=${css.guideSummary}>Manual submission checklist</summary>
            <div class=${css.guideContent}>
              <ul class=${css.checklist} data-id="contractVerificationPackageChecklist">
                <li>Compile the exact source that was deployed.</li>
                <li>Select the actual deployable main contract — not an imported interface or abstract contract.</li>
                <li>Download the flattened .sol and upload it under "Contract File(s)" on TronScan.</li>
                <li>Match the compiler version, optimizer runs, VM version, license, and main contract name.</li>
                <li>The metadata JSON is a reference checklist only; TronScan does not accept it as an upload.</li>
              </ul>
            </div>
          </details>
          ${this.getPackageHistory().length ? yo`
            <div class=${css.note} data-id="contractVerificationPackageHistory">
              Recent settings references: ${this.getPackageHistory().map((item) => `${item.contractName || 'contract'} · ${item.network || 'network'} · ${item.generatedAt || ''}`).join(' | ')}
            </div>
          ` : ''}
          <div class="${css.note} ${css.scopeNote}">TronScan submission is manual: upload the generated .sol file. TronIDE does not store API keys or verification receipts.<br />Sourcify, Etherscan, Blockscout, and Routescan are EVM-only services and are unavailable here.</div>
        </div>
      </div>
    `
  }
}

export default ContractVerificationTab
