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

import { ViewPlugin } from '@remixproject/engine-web'
import * as packageJson from '../../../../../package.json'
import { compareAIApprovalSnapshots, compareAITransactionEnvironmentFingerprints, createAIApprovalSnapshot, createAITransactionEnvironmentFingerprint, formatAIPreflightSummary, normalizeAIEnvironment, normalizeAITransactionStatus, sanitizeAIErrorMessage, trxBalanceToSun, waitForAIExecutionContext, waitForAITransactionFinality } from './ai-transaction-intelligence.js'
const { TransactionAttemptLogger } = require('./transaction-attempt-logger')

const $ = require('jquery')
const yo = require('yo-yo')
const ethJSUtil = require('@tvmjs/util')
const { BN } = require('ethereumjs-util')
const Web3 = require('web3')
const { execution, util } = require('@remix-project/remix-lib')
const EventManager = require('../../lib/events')
const helper = require('../../lib/helper')
const Card = require('../ui/card')
const copyToClipboard = require('../ui/copy-to-clipboard')

const css = require('../tabs/styles/run-tab-styles')
const SettingsUI = require('../tabs/runTab/settings.js')
const Recorder = require('../tabs/runTab/model/recorder.js')
const RecorderUI = require('../tabs/runTab/recorder.js')
const DropdownLogic = require('../tabs/runTab/model/dropdownlogic.js')
const ContractDropdownUI = require('../tabs/runTab/contractDropdown.js')
const toaster = require('../ui/tooltip')
const { requireUserPermission } = require('../ui/permission-security')
const {
  markExternalPluginTransaction,
  verifyPluginTransactionNetwork
} = require('../../blockchain/transaction-network-security')
const { isTrustedHostPluginProfile } = require('../../lib/plugin-trust-security')
const {
  CAPABILITY_STATUS,
  createCheckingProtocolCapabilitySnapshot,
  createProtocolCapabilitySnapshot,
  evaluateDeploymentCompatibility,
  extractBytecodeObject,
  formatDeploymentCompatibilityMessage,
  scanCompilationArtifacts
} = require('../lib/prague-osaka-compatibility')
const _paq = window._paq = window._paq || []
const walletProviderAdapter = execution.walletProviderAdapter
const walletAdapterManager = execution.walletAdapterManager
const AI_WALLET_WRITE_TIMEOUT_MS = 5 * 60 * 1000
const TRON_NETWORK_LABELS = Object.freeze({ main: 'TRON Mainnet', nile: 'TRON Nile', shasta: 'TRON Shasta' })
const TRONWEB_SAFE_CALL_VALUE_MAX = BigInt(Number.MAX_SAFE_INTEGER)
const isFailedTransactionResult = (error, txResult) => {
  if (error) return true
  const receipt = txResult && (txResult.receipt || txResult)
  const status = receipt && (receipt.status !== undefined ? receipt.status : receipt.result)
  return status === false || status === 0 || status === '0x0' ||
    String(status).toUpperCase() === 'FAILED' || String(status).toUpperCase() === 'REVERT'
}
const normalizeTronContractAddress = (address) => {
  const value = typeof address === 'string' ? address.trim() : String(address || '')
  const hexAddress = util.addressToHex(value)
  if (!hexAddress || !/^0x[0-9a-fA-F]{40}$/.test(hexAddress)) throw new Error('Invalid TRON contract address')
  const base58Address = util.addressToBase58(hexAddress)
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(base58Address)) throw new Error('Invalid TRON contract address')
  return base58Address
}

const UniversalDAppUI = require('../ui/universal-dapp-ui')

const profile = {
  name: 'udapp',
  displayName: 'Deploy & run transactions',
  icon: 'assets/img/deployAndRun.webp',
  description: 'execute and save transactions',
  kind: 'udapp',
  location: 'sidePanel',
  documentation: 'https://developers.tron.network/docs/tron-ide',
  version: packageJson.version,
  permission: true,
  events: ['newTransaction', 'environmentChanged'],
  methods: ['connectInjectedTronWeb', 'disconnectInjectedTronWeb', 'createVMAccount', 'sendTransaction', 'getAccounts', 'pendingTransactionsCount', 'getSettings', 'setEnvironmentMode', 'aiListContracts', 'aiDeploy', 'aiCallMethod', 'aiListAccounts', 'aiGetBalance', 'aiGetEnvironment', 'aiPreflightTransaction', 'aiGetTransactionStatus', 'aiExportTronbox', 'aiSaveScenario', 'aiRunScenario', 'aiRecordingInfo']
}

export class RunTab extends ViewPlugin {
  constructor (blockchain, config, fileManager, editor, filePanel, compilersArtefacts, networkModule, mainView, fileProvider) {
    super(profile)
    this.event = new EventManager()
    this.config = config
    this.blockchain = blockchain
    this.fileManager = fileManager
    this.editor = editor
    this.transactionAttemptLogger = new TransactionAttemptLogger((element) => mainView.getTerminal().logHtml(element))
    this.logCallback = (msg, context) => this.transactionAttemptLogger.log(msg, context)
    this.filePanel = filePanel
    this.compilersArtefacts = compilersArtefacts
    this.networkModule = networkModule
    this.fileProvider = fileProvider
    this._externalEventSubscriptions = []
    this._managerEventSubscriptionsRegistered = false
    this._protocolCapabilityCache = new Map()
    this._protocolCapabilityRequestId = 0
    this._protocolCapabilities = null
    this._compiledProtocolScan = { dependencies: [] }
    this.setupEvents()
  }

  _withUserPermission (method, message, action) {
    if (!this.currentRequest) return action()
    return requireUserPermission(this, method, message).then(action)
  }

  _createAITransactionCancelState (taskId) {
    if (!taskId || !this.currentRequest) return null
    const request = this.currentRequest
    return { isCancelled: () => this.currentRequest !== request }
  }

  _assertAITransactionActive (cancelState) {
    if (cancelState && cancelState.isCancelled()) {
      throw new Error('Transaction stopped before signing or broadcast.')
    }
  }

  async _isTrustedHostCaller (caller) {
    if (!caller) return false
    try {
      const callerProfile = await this.call('manager', 'getProfile', caller)
      return Boolean(callerProfile && callerProfile.name === caller && isTrustedHostPluginProfile(callerProfile))
    } catch (e) {
      return false
    }
  }

  async _assertExternalTransactionNetworkAllowed () {
    const caller = this.currentRequest && this.currentRequest.from
    if (!caller || await this._isTrustedHostCaller(caller)) return false

    await verifyPluginTransactionNetwork((callback) => this.blockchain.detectNetwork(callback))
    // true means the transaction must retain this untrusted-caller provenance
    // all the way to Blockchain.runTx's commit-time network recheck.
    return true
  }

  // --- Programmatic deploy/interact for the AI assistant ---------------------
  // These expose the SAME blockchain pipeline the Deploy & Run UI drives
  // (compile artifact -> constructor/tx encoding -> sign -> receipt), so an AI
  // action deploys/calls exactly as a manual click would: on Injected the
  // wallet still prompts for every signature; on the JavaScript VM it runs
  // free. The AI panel gates every deploy and every state-changing call behind
  // an explicit user confirmation before it calls these.

  _aiDropdownLogic () {
    if (!this._aiDL) this._aiDL = new DropdownLogic(this.compilersArtefacts, this.config, this.editor, this)
    return this._aiDL
  }

  // The tx encoder (txFormat.encodeParams) expects the UI's STRING form:
  // it does `JSON.parse('[' + params + ']')`, so a raw args array throws
  // ("str.charAt is not a function"). Turn [7, "T..."] into `7, "T..."` —
  // JSON.stringify per element gives numbers/bools bare and strings quoted,
  // matching what the input fields produce. A string is passed through as-is.
  _aiEncodeArgs (args) {
    if (typeof args === 'string') return args
    if (!Array.isArray(args) || args.length === 0) return ''
    return args.map((a) => {
      try { return JSON.stringify(a) } catch (e) { return String(a) }
    }).join(', ')
  }

  // Normalize the optional money fields of an AI deploy/call. Amounts are
  // integer strings — `value` in SUN (1 TRX = 1,000,000 SUN), `tokenValue` in
  // the TRC10 token's raw units. AI calls always carry an explicit value,
  // including zero, so a stale Deploy & Run panel amount cannot leak into the
  // approved transaction when the model omits `value`.
  _aiTxMeta ({ value, tokenId, tokenValue } = {}) {
    // The runner input contract differs per field: `value` (SUN) is parsed
    // radix-10, but tokenId/tokenValue are parsed radix-16 on the injected
    // runner (txRunnerWeb3.runInTron) — matching the panel's getExtendValue,
    // which emits "0x"+hex. A bare decimal there is silently reinterpreted as
    // hex on a real wallet (e.g. "20" -> 0x20 = 32). So keep value decimal and
    // emit the TRC10 fields as 0x-hex.
    const norm = (v, label, radix) => {
      if (v === undefined || v === null || v === '') return undefined
      let n
      try { n = BigInt(v) } catch (e) { throw new Error(`${label} must be a plain integer (got "${v}").`) }
      if (n < BigInt(0)) throw new Error(`${label} cannot be negative.`)
      if (n === BigInt(0)) return undefined
      return radix === 16 ? '0x' + n.toString(16) : n.toString()
    }
    const normValue = norm(value, 'value (in SUN)', 10)
    const normTokenId = norm(tokenId, 'token_id', 16)
    const normTokenValue = norm(tokenValue, 'token_value', 16)
    if (normTokenValue && !normTokenId) throw new Error('token_value needs token_id (the TRC10 token to send).')
    if (normTokenId && !normTokenValue) throw new Error('token_id needs token_value (how much of the token to send).')
    const meta = { value: normValue || '0' }
    if (normTokenId) { meta.tokenId = normTokenId; meta.tokenValue = normTokenValue }
    return meta
  }

  // Validate an AI-supplied sender against the environment's accounts and
  // return the canonical form to send FROM. undefined => use the account
  // selected in the Deploy & Run panel (the existing default).
  async _aiResolveFrom (from) {
    if (from === undefined || from === null || String(from).trim() === '') return undefined
    const wanted = String(from).trim()
    let accounts = []
    try { accounts = await this.blockchain.getAccounts() || [] } catch (e) { accounts = [] }
    const match = (accounts || []).find((a) => String(a).toLowerCase() === wanted.toLowerCase())
    if (!match) throw new Error(`"${wanted}" is not one of the available accounts — use list_accounts to see them.`)
    return match
  }

  // List the environment's accounts with balances (TRX). VM gives the
  // deterministic set; injected gives the connected wallet's address(es).
  async aiListAccounts () {
    await requireUserPermission(this, 'aiListAccounts', 'read accounts and balances')
    let accounts = []
    try { accounts = await this.blockchain.getAccounts() || [] } catch (e) { accounts = [] }
    if (!accounts.length) return { ok: false, message: 'No accounts available — on Injected, connect your wallet first.' }
    const out = []
    for (const address of accounts) {
      const balance = await new Promise((resolve) => {
        try { this.blockchain.getBalanceInEther(address, (err, b) => resolve(err ? null : b)) } catch (e) { resolve(null) }
      })
      out.push({ address, balanceTrx: balance })
    }
    return { ok: true, environment: this.blockchain.getProvider(), accounts: out }
  }

  // Balance (in TRX) of a single address in the current environment.
  async aiGetBalance ({ address } = {}) {
    await requireUserPermission(this, 'aiGetBalance', 'read an account balance')
    if (!address) throw new Error('Provide an address to check the balance of.')
    const balance = await new Promise((resolve, reject) => {
      try { this.blockchain.getBalanceInEther(String(address).trim(), (err, b) => err ? reject(err) : resolve(b)) } catch (e) { reject(e) }
    })
    return { ok: true, address: String(address).trim(), balanceTrx: balance }
  }

  _aiDetectNetworkStatus () {
    return new Promise((resolve) => {
      let settled = false
      const done = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }
      const timer = setTimeout(() => {
        const cached = this.blockchain.getCurrentNetworkStatus && this.blockchain.getCurrentNetworkStatus()
        done(cached || { error: new Error('Network detection timed out') })
      }, 10000)
      try {
        this.blockchain.detectNetwork((error, network) => done({ network, error }))
      } catch (error) {
        done({ error })
      }
    })
  }

  async _aiEnvironmentSnapshot () {
    const providerTransition = await waitForAIExecutionContext({
      getActiveProvider: () => this.blockchain.getProvider(),
      getSelectedProvider: () => this.settingsUI && this.settingsUI.selectExEnv && this.settingsUI.selectExEnv.value
    })
    const provider = providerTransition.activeProvider || this.blockchain.getProvider()
    const networkStatus = await this._aiDetectNetworkStatus()
    let accounts = []
    try { accounts = await this.blockchain.getAccounts() || [] } catch (e) { accounts = [] }
    let selectedAccount = null
    try { selectedAccount = this.settingsUI && this.settingsUI.getSelectedAccount() } catch (e) { selectedAccount = null }
    if (selectedAccount && !accounts.some((account) => String(account).toLowerCase() === String(selectedAccount).toLowerCase())) selectedAccount = null
    let endpoint = null
    try {
      const web3 = this.blockchain.web3()
      endpoint = (web3 && web3.fullNode && web3.fullNode.host) || (web3 && web3.currentProvider && web3.currentProvider.host) || null
    } catch (e) { endpoint = null }
    const walletState = provider === 'injected'
      ? walletProviderAdapter.getInjectedWalletStatus(window)
      : (provider === 'vm' ? 'not_applicable' : (accounts.length ? 'connected' : 'unknown'))
    const environment = normalizeAIEnvironment({ provider, networkStatus, walletState, accounts, selectedAccount, endpoint })
    if (!providerTransition.settled) {
      environment.providerTransition = {
        pending: true,
        selectedProvider: providerTransition.selectedProvider,
        activeProvider: provider
      }
    }
    return environment
  }

  // Read-only execution context snapshot. A missing genesis-derived network ID
  // stays Unknown; callers must not guess a chain from a node URL or old task.
  async aiGetEnvironment () {
    await requireUserPermission(this, 'aiGetEnvironment', 'read the active transaction environment')
    const environment = await this._aiEnvironmentSnapshot()
    return { ok: true, ...environment }
  }

  _aiPanelFeeLimit () {
    try {
      const el = this.settingsUI && this.settingsUI.el && this.settingsUI.el.querySelector('#gasLimit')
      return el && el.value !== '' ? String(el.value) : null
    } catch (e) { return null }
  }

  _aiInteger (value, label, optional = false) {
    if ((value === undefined || value === null || value === '') && optional) return null
    if (!/^\d+$/.test(String(value == null ? '' : value))) throw new Error(`${label} must be a non-negative integer.`)
    return BigInt(String(value))
  }

  async _aiBalance (address) {
    if (!address) return null
    return new Promise((resolve) => {
      try { this.blockchain.getBalanceInEther(address, (error, value) => resolve(error ? null : value)) } catch (e) { resolve(null) }
    })
  }

  async _aiEstimateWriteEnergy ({ environment, address, funABI, args, from, valueSun, tokenId, tokenValue, feeLimitSun }) {
    if (environment.provider === 'vm') return { status: 'unavailable', reason: 'The JavaScript VM does not expose the TRON estimateenergy RPC.' }
    if (!environment.network.known) return { status: 'unavailable', reason: 'The current TRON network is unknown.' }
    let tronWeb
    try { tronWeb = this.blockchain.web3() } catch (e) { tronWeb = null }
    if (!tronWeb || !tronWeb.transactionBuilder || typeof tronWeb.transactionBuilder.estimateEnergy !== 'function') {
      return { status: 'unavailable', reason: 'The current provider does not expose estimateEnergy.' }
    }
    try {
      const functionSelector = Web3.utils._jsonInterfaceMethodToString ? Web3.utils._jsonInterfaceMethodToString(funABI) : ''
      if (!functionSelector) return { status: 'unavailable', reason: 'The method selector could not be encoded.' }
      const parameters = (funABI.inputs || []).map((input, index) => ({ type: input.type, value: args[index] }))
      const safeNumber = (value, label) => {
        if (value == null) return undefined
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds the safe integer range.`)
        return Number(value)
      }
      const options = {}
      const callValue = safeNumber(valueSun, 'value')
      const feeLimit = safeNumber(feeLimitSun, 'fee_limit')
      const normalizedTokenId = safeNumber(tokenId, 'token_id')
      const normalizedTokenValue = safeNumber(tokenValue, 'token_value')
      if (callValue) options.callValue = callValue
      if (feeLimit != null) options.feeLimit = feeLimit
      if (normalizedTokenId) options.tokenId = normalizedTokenId
      if (normalizedTokenValue) options.tokenValue = normalizedTokenValue
      const estimate = await walletProviderAdapter.withWalletTimeout(
        tronWeb.transactionBuilder.estimateEnergy(address, functionSelector, options, parameters, from),
        walletProviderAdapter.WALLET_NODE_TIMEOUT_MS,
        walletProviderAdapter.WALLET_ERROR_CODES.WALLET_REQUEST_TIMEOUT
      )
      if (!estimate || estimate.energy_required == null || estimate.result?.result === false) {
        return { status: 'unavailable', reason: 'The provider returned no usable energy estimate.' }
      }
      return { status: 'available', energyRequired: estimate.energy_required }
    } catch (error) {
      return { status: 'unavailable', reason: sanitizeAIErrorMessage(error) || 'Energy estimation failed.' }
    }
  }

  _aiArtifactFingerprint (abi, bytecode = '') {
    const encoded = JSON.stringify({ abi: abi || [], bytecode: bytecode || '' })
    return Web3.utils.sha3(encoded) || null
  }

  // Read-only transaction preflight. It validates the exact environment,
  // account, value and ABI before any wallet prompt or broadcast can happen.
  async aiPreflightTransaction ({ operation, contractName, address, method, args = [], abi: explicitAbi, from, value, tokenId, tokenValue, feeLimit, skipResourceEstimate = false } = {}) {
    await requireUserPermission(this, 'aiPreflightTransaction', 'inspect a proposed transaction')
    const kind = String(operation || '').toLowerCase()
    if (!['deploy', 'write'].includes(kind)) throw new Error('operation must be "deploy" or "write".')
    const environment = await this._aiEnvironmentSnapshot()
    const issues = []
    const blocker = (code, message) => issues.push({ severity: 'blocker', code, message })
    const warning = (code, message) => issues.push({ severity: 'warning', code, message })
    if (!environment.network.known) blocker('NETWORK_UNKNOWN', 'The current network is unknown; select and verify a TRON network before sending.')
    if (environment.network.stale) blocker('NETWORK_STALE', 'The network identity is from a stale cached probe; wait for a fresh network check before sending.')
    if (environment.provider === 'injected' && environment.walletState !== 'connected') blocker('WALLET_NOT_CONNECTED', `Injected wallet state is ${environment.walletState}.`)

    let sender = from || environment.selectedAccount || null
    if (sender) {
      try { sender = await this._aiResolveFrom(sender) } catch (error) { blocker('ACCOUNT_UNAVAILABLE', error.message); sender = null }
    } else {
      blocker('ACCOUNT_UNAVAILABLE', 'No sender account is available in the current environment.')
    }

    let valueSun = BigInt(0)
    let feeLimitSun = null
    let normalizedTokenId = null
    let normalizedTokenValue = null
    try {
      valueSun = this._aiInteger(value == null || value === '' ? '0' : value, 'value')
      feeLimitSun = this._aiInteger(feeLimit == null || feeLimit === '' ? this._aiPanelFeeLimit() : feeLimit, 'fee_limit', true)
      normalizedTokenId = this._aiInteger(tokenId, 'token_id', true)
      normalizedTokenValue = this._aiInteger(tokenValue, 'token_value', true)
      if ((normalizedTokenId == null) !== (normalizedTokenValue == null)) blocker('TOKEN_PAIR_INVALID', 'token_id and token_value must be provided together.')
    } catch (error) { blocker('AMOUNT_INVALID', error.message) }
    if (environment.provider === 'injected' && valueSun > TRONWEB_SAFE_CALL_VALUE_MAX) {
      blocker('INJECTED_VALUE_PRECISION_UNSUPPORTED', 'Injected TronWeb cannot serialize transaction values above the JavaScript safe-integer range without changing the amount.')
    }
    const runtimeValidation = execution.runtimeFacade.createRuntimeFacade({
      kind: 'tvm',
      environment: environment.provider,
      account: sender
    }).validateTransaction({
      tokenId: normalizedTokenId == null ? undefined : normalizedTokenId.toString(),
      tokenValue: normalizedTokenValue == null ? undefined : normalizedTokenValue.toString(),
      feeLimit: feeLimitSun == null ? undefined : feeLimitSun.toString(),
      callValue: valueSun.toString(),
      from: sender,
      to: address
    })
    runtimeValidation.errors.forEach((message) => blocker('RUNTIME_VALIDATION_FAILED', message))
    runtimeValidation.warnings.forEach((message) => warning('RUNTIME_VALIDATION_WARNING', message))
    if (feeLimitSun == null) warning('FEE_LIMIT_UNAVAILABLE', 'No fee limit is available; review it in Deploy & Run before sending.')

    const balanceTrx = await this._aiBalance(sender)
    const balanceSun = trxBalanceToSun(balanceTrx)
    if (sender && balanceSun == null) warning('BALANCE_UNAVAILABLE', 'The sender balance could not be read.')
    if (balanceSun != null && valueSun > BigInt(balanceSun)) blocker('INSUFFICIENT_VALUE_BALANCE', 'The sender balance is lower than the transaction value.')

    let target = { contractName: contractName || null, address: address || null, method: method || null, args }
    let resourceEstimate = { status: 'unavailable', reason: 'No estimator was run.' }
    try {
      if (kind === 'deploy') {
        if (!contractName) throw new Error('contract_name is required for a deployment preflight.')
        const selected = this._aiSelectedContract(contractName)
        if (!selected.bytecodeObject || selected.bytecodeObject.length === 0) throw new Error(`"${contractName}" has no deployable bytecode.`)
        const constructorABI = (selected.abi || []).find((entry) => entry.type === 'constructor') || { inputs: [], stateMutability: 'nonpayable' }
        if ((constructorABI.inputs || []).length !== args.length) throw new Error(`Constructor expects ${(constructorABI.inputs || []).length} argument(s), received ${args.length}.`)
        execution.txHelper.encodeParams(constructorABI, args.slice())
        if (valueSun > BigInt(0) && constructorABI.stateMutability !== 'payable') throw new Error(`The ${contractName} constructor is not payable.`)
        target = { ...target, artifactFingerprint: this._aiArtifactFingerprint(selected.abi, selected.bytecodeObject) }
        resourceEstimate = { status: 'unavailable', reason: 'Deployment energy estimation is not exposed by the current IDE pipeline.' }
      } else {
        if (!address || !contractName || !method) throw new Error('address, contract_name and method are required for a write preflight.')
        const resolved = this._aiResolveCallTarget({ address, contractName, abi: explicitAbi })
        const funABI = (resolved.abi || []).find((entry) => entry.type === 'function' && entry.name === method)
        if (!funABI) throw new Error(`No function "${method}" on ${contractName}.`)
        const readOnly = funABI.stateMutability === 'view' || funABI.stateMutability === 'pure' || funABI.constant === true
        if (readOnly) throw new Error(`"${method}" is read-only; use read_contract instead.`)
        if ((funABI.inputs || []).length !== args.length) throw new Error(`${method} expects ${(funABI.inputs || []).length} argument(s), received ${args.length}.`)
        execution.txHelper.encodeParams(funABI, args.slice())
        if (valueSun > BigInt(0) && funABI.stateMutability !== 'payable') throw new Error(`"${method}" is not payable.`)
        target = { ...target, artifactFingerprint: this._aiArtifactFingerprint(resolved.abi) }
        resourceEstimate = skipResourceEstimate
          ? { status: 'unavailable', reason: 'Energy estimation was skipped during the final approval-context recheck.' }
          : await this._aiEstimateWriteEnergy({ environment, address, funABI, args, from: sender, valueSun, tokenId: normalizedTokenId, tokenValue: normalizedTokenValue, feeLimitSun })
      }
    } catch (error) {
      blocker('TRANSACTION_INVALID', error.message || String(error))
    }
    if (resourceEstimate.status === 'unavailable') warning('ENERGY_ESTIMATE_UNAVAILABLE', resourceEstimate.reason)

    const report = {
      ok: true,
      ready: !issues.some((issue) => issue.severity === 'blocker'),
      operation: kind,
      environment,
      target,
      from: sender,
      valueSun: valueSun.toString(),
      balanceTrx,
      feeLimitSun: feeLimitSun == null ? null : feeLimitSun.toString(),
      resourceEstimate,
      issues
    }
    report.approvalSnapshot = createAIApprovalSnapshot({
      environment,
      operation: kind,
      target,
      from: sender,
      valueSun,
      tokenId: normalizedTokenId,
      tokenValue: normalizedTokenValue,
      feeLimitSun
    })
    report.summary = formatAIPreflightSummary(report)
    return report
  }

  async _aiAssertApprovalSnapshot (approved, intent, approvalDeadline) {
    if (!approved) throw new Error('The transaction has no approval snapshot. Run preflight and approve it again.')
    if (!Number.isFinite(approvalDeadline) || approvalDeadline < Date.now() || approvalDeadline > Date.now() + 2 * 60 * 1000) {
      throw new Error('The transaction approval is missing, expired, or has an invalid lifetime. Approve a fresh preflight.')
    }
    const current = await this.aiPreflightTransaction({ ...intent, skipResourceEstimate: true })
    if (Date.now() > approvalDeadline) throw new Error('The transaction approval expired during the final context check. Approve a fresh preflight.')
    if (!current.ready) throw new Error(`Transaction context is no longer safe: ${current.summary}`)
    const comparison = compareAIApprovalSnapshots(approved, current.approvalSnapshot)
    if (!comparison.ok) throw new Error(`${comparison.reason} Run preflight and approve the updated transaction again.`)
    return current
  }

  _aiWeb3Lookup (method, hash, boundWeb3 = null) {
    return new Promise((resolve, reject) => {
      let settled = false
      const done = (error, value) => {
        if (settled) return
        settled = true
        error ? reject(error) : resolve(value)
      }
      try {
        const web3 = boundWeb3 || this.blockchain.web3()
        const fn = web3 && web3.eth && web3.eth[method]
        if (typeof fn !== 'function') return done(new Error(`Provider does not expose eth.${method}.`))
        const returned = fn.call(web3.eth, hash, done)
        if (returned && typeof returned.then === 'function') returned.then((value) => done(null, value)).catch(done)
      } catch (error) { done(error) }
    })
  }

  _aiTransactionRpcContext () {
    const provider = this.blockchain.web3()
    if (!provider) throw new Error('No active RPC provider is available.')
    const node = provider.fullNode || provider.currentProvider || provider.solidityNode || null
    const endpoint = String((node && node.host) || '')
    let epoch = null
    if (typeof this.blockchain.getProviderContextEpoch === 'function') {
      const value = this.blockchain.getProviderContextEpoch()
      if (Number.isSafeInteger(value) && value >= 0) epoch = value
    }
    return { provider, node, endpoint, epoch }
  }

  _aiCompareTransactionRpcContexts (expected, current) {
    if (!expected || !current || expected.provider !== current.provider || expected.node !== current.node) {
      return { ok: false, reason: 'The active RPC provider changed during transaction status lookup.' }
    }
    if (expected.endpoint !== current.endpoint) {
      return { ok: false, reason: 'The active RPC endpoint changed during transaction status lookup.' }
    }
    if (expected.epoch != null && current.epoch !== expected.epoch) {
      return { ok: false, reason: 'The RPC provider context changed during transaction status lookup.' }
    }
    return { ok: true, reason: null }
  }

  // Read-only resolution for TX_UNKNOWN. It never retries or resubmits a write;
  // pending/unknown explicitly instructs the caller to query the same hash.
  async aiGetTransactionStatus ({ txHash } = {}) {
    await requireUserPermission(this, 'aiGetTransactionStatus', 'read a transaction status')
    const hash = String(txHash || '').trim().replace(/^0x/, '')
    if (!/^[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Provide a 64-character TRON transaction hash.')
    const environment = await this._aiEnvironmentSnapshot()
    const initialFingerprint = createAITransactionEnvironmentFingerprint(environment)
    const stateChangedResult = (currentEnvironment, reason) => ({
      environment: currentEnvironment || environment,
      ...normalizeAITransactionStatus({ txHash: hash, networkId: null, error: new Error(reason) }),
      code: 'STATE_CHANGED',
      userAction: 'The provider or network changed during this lookup. Select the original network and query the same transaction hash again. Do not resubmit the transaction.'
    })
    if (!initialFingerprint.valid) {
      return { ...stateChangedResult(environment, 'The active provider or network could not be verified before transaction status lookup.'), lookupAttempts: 0 }
    }
    let initialRpcContext
    try {
      initialRpcContext = this._aiTransactionRpcContext()
    } catch (error) {
      return { ...stateChangedResult(environment, 'The active RPC provider could not be bound before transaction status lookup.'), lookupAttempts: 0 }
    }
    const lookup = async () => {
      let currentEnvironment
      try {
        currentEnvironment = await this._aiEnvironmentSnapshot()
      } catch (error) {
        return stateChangedResult(environment, 'The active provider or network could not be rechecked before transaction status lookup.')
      }
      let fingerprintComparison = compareAITransactionEnvironmentFingerprints(
        initialFingerprint,
        createAITransactionEnvironmentFingerprint(currentEnvironment)
      )
      if (!fingerprintComparison.ok) return stateChangedResult(currentEnvironment, fingerprintComparison.reason)
      let rpcContextComparison
      try {
        rpcContextComparison = this._aiCompareTransactionRpcContexts(initialRpcContext, this._aiTransactionRpcContext())
      } catch (error) {
        return stateChangedResult(currentEnvironment, 'The active RPC provider could not be rechecked before transaction status lookup.')
      }
      if (!rpcContextComparison.ok) return stateChangedResult(currentEnvironment, rpcContextComparison.reason)

      let transaction = null
      let receipt = null
      let lookupError = null
      try {
        // Use the provider object bound at lookup start rather than re-reading
        // whichever live wallet object happens to be active for this attempt.
        const web3 = initialRpcContext.provider
        if (environment.provider !== 'vm' && web3 && web3.trx) {
          const guarded = (operation) => walletProviderAdapter.withWalletTimeout(
            operation,
            walletProviderAdapter.WALLET_NODE_TIMEOUT_MS,
            walletProviderAdapter.WALLET_ERROR_CODES.WALLET_REQUEST_TIMEOUT
          )
          // TronWeb's getTransactionInfo() intentionally reads the Solidity
          // node (walletsolidity/gettransactioninfobyid). That endpoint can
          // lag behind a transaction that is already included on the full
          // node, which leaves the UI stuck at PENDING. Resolve the receipt
          // from the full node instead; getUnconfirmedTransactionInfo is
          // TronWeb's public wrapper for wallet/gettransactioninfobyid and
          // also returns the receipt after inclusion.
          const getFullNodeTransactionInfo = () => {
            if (typeof web3.trx.getUnconfirmedTransactionInfo === 'function') {
              return web3.trx.getUnconfirmedTransactionInfo(hash)
            }
            if (web3.fullNode && typeof web3.fullNode.request === 'function') {
              return web3.fullNode.request('wallet/gettransactioninfobyid', { value: hash }, 'post')
            }
            throw new Error('Provider does not expose a full-node transaction-info method.')
          }
          const results = await Promise.allSettled([
            guarded(web3.trx.getTransaction(hash)),
            guarded(getFullNodeTransactionInfo())
          ])
          if (results[0].status === 'fulfilled') transaction = results[0].value
          if (results[1].status === 'fulfilled') receipt = results[1].value
          const rejected = results.find((result) => result.status === 'rejected')
          if (!transaction && !receipt && rejected) lookupError = rejected.reason
        } else {
          const results = await Promise.allSettled([
            this._aiWeb3Lookup('getTransaction', '0x' + hash, web3),
            this._aiWeb3Lookup('getTransactionReceipt', '0x' + hash, web3)
          ])
          if (results[0].status === 'fulfilled') transaction = results[0].value
          if (results[1].status === 'fulfilled') receipt = results[1].value
          const rejected = results.find((result) => result.status === 'rejected')
          if (!transaction && !receipt && rejected) lookupError = rejected.reason
        }
      } catch (error) { lookupError = error }

      // The wallet can switch while either full-node request is in flight.
      // Recheck after both reads and discard their data on drift, so a response
      // from the new network can never inherit the old explorer/metadata.
      try {
        currentEnvironment = await this._aiEnvironmentSnapshot()
      } catch (error) {
        return stateChangedResult(environment, 'The active provider or network could not be rechecked after transaction status lookup.')
      }
      fingerprintComparison = compareAITransactionEnvironmentFingerprints(
        initialFingerprint,
        createAITransactionEnvironmentFingerprint(currentEnvironment)
      )
      if (!fingerprintComparison.ok) return stateChangedResult(currentEnvironment, fingerprintComparison.reason)
      try {
        rpcContextComparison = this._aiCompareTransactionRpcContexts(initialRpcContext, this._aiTransactionRpcContext())
      } catch (error) {
        return stateChangedResult(currentEnvironment, 'The active RPC provider could not be rechecked after transaction status lookup.')
      }
      if (!rpcContextComparison.ok) return stateChangedResult(currentEnvironment, rpcContextComparison.reason)

      return {
        environment,
        ...normalizeAITransactionStatus({ txHash: hash, networkId: initialFingerprint.networkId, transaction, receipt, error: lookupError })
      }
    }
    return waitForAITransactionFinality({ lookup })
  }

  _aiSelectedContract (contractName) {
    const dl = this._aiDropdownLogic()
    if (!this.compilersArtefacts || !this.compilersArtefacts.__last) {
      throw new Error('Nothing compiled yet — compile a contract first.')
    }
    const selected = dl.getSelectedContract(contractName, '__last')
    if (!selected) throw new Error(`No compiled contract named "${contractName}". Compile it, then check the exact contract name.`)
    return selected
  }

  // Export the recorded deploy/interaction flow as a TronBox project. The
  // recorder UI is a sub-component of this tab (not an engine-registered plugin),
  // so the AI tool routes through udapp (which IS registered) and delegates.
  async aiExportTronbox (opts = {}) {
    await requireUserPermission(this, 'aiExportTronbox', 'export the recorded transactions')
    if (!this.recorderInterface || !this.recorderInterface.aiExportTronbox) return { ok: false, message: 'The recorder is not available.' }
    return this.recorderInterface.aiExportTronbox(opts)
  }

  // Save the current recording to a workspace scenario.json (delegates to the
  // recorder sub-component; see aiExportTronbox for why this routes through udapp).
  async aiSaveScenario (opts = {}) {
    await requireUserPermission(this, 'aiSaveScenario', 'save the recorded transactions')
    if (!this.recorderInterface || !this.recorderInterface.aiSaveScenario) return { ok: false, message: 'The recorder is not available.' }
    return this.recorderInterface.aiSaveScenario(opts)
  }

  // Replay a scenario.json — re-execute its recorded transactions.
  async aiRunScenario (opts = {}) {
    await requireUserPermission(this, 'aiRunScenario', 'replay recorded transactions')
    const externalPluginTransaction = await this._assertExternalTransactionNetworkAllowed()
    if (!this.recorderInterface || !this.recorderInterface.aiRunScenario) return { ok: false, message: 'The recorder is not available.' }
    // Copy only string-keyed connector data. The internal Symbol marker cannot
    // be supplied or cleared through the external payload.
    const replayOptions = { ...opts }
    if (externalPluginTransaction) markExternalPluginTransaction(replayOptions)
    return this.recorderInterface.aiRunScenario(replayOptions)
  }

  // Live recording journal info (tx count) — read-only; lets the chat warn
  // before a replay clears the journal and put real counts in write confirms.
  async aiRecordingInfo () {
    await requireUserPermission(this, 'aiRecordingInfo', 'read transaction recording information')
    if (!this.recorderInterface || !this.recorderInterface.aiRecordingInfo) return { ok: false, message: 'The recorder is not available.' }
    return this.recorderInterface.aiRecordingInfo()
  }

  // List the contracts available to deploy from the last compilation.
  async aiListContracts () {
    await requireUserPermission(this, 'aiListContracts', 'read compiled contract names')
    if (!this.compilersArtefacts || !this.compilersArtefacts.__last) return { ok: false, message: 'Nothing compiled yet — compile a contract first.' }
    const contracts = []
    try {
      this.compilersArtefacts.__last.visitContracts((c) => { contracts.push(c.name) })
    } catch (e) { return { ok: false, message: 'Could not read the last compilation.' } }
    return { ok: true, contracts, environment: this.blockchain.getProvider() }
  }

  // Deploy a compiled contract. `args` are the constructor arguments in order.
  // value (SUN) / tokenId+tokenValue fund a payable constructor. `from` picks
  // the sending account (defaults to the panel's selected account).
  async aiDeploy ({ contractName, args = [], value, tokenId, tokenValue, from, approvalSnapshot, approvalDeadline, taskId } = {}) {
    await requireUserPermission(this, 'aiDeploy', 'deploy a compiled contract')
    const cancelState = this._createAITransactionCancelState(taskId)
    this._assertAITransactionActive(cancelState)
    const externalPluginTransaction = await this._assertExternalTransactionNetworkAllowed()
    this._assertAITransactionActive(cancelState)
    const approvedContext = await this._aiAssertApprovalSnapshot(approvalSnapshot, { operation: 'deploy', contractName, args, value, tokenId, tokenValue, from }, approvalDeadline)
    this._assertAITransactionActive(cancelState)
    const selectedContract = this._aiSelectedContract(contractName)
    if (!selectedContract.bytecodeObject || selectedContract.bytecodeObject.length === 0) {
      throw new Error(`"${contractName}" has no bytecode (it may be abstract or an interface) — it cannot be deployed.`)
    }
    const txMeta = this._aiTxMeta({ value, tokenId, tokenValue }) || {}
    if (cancelState) txMeta.cancelState = cancelState
    if (externalPluginTransaction) markExternalPluginTransaction(txMeta)
    // _aiTxMeta always carries an explicit string zero so an omitted value
    // cannot inherit a stale panel amount. Treat only a non-zero value as a
    // transfer; string "0" is not truthy money.
    if (txMeta.value !== undefined && txMeta.value !== '0') {
      const ctor = (selectedContract.abi || []).find((f) => f.type === 'constructor')
      if (!ctor || ctor.stateMutability !== 'payable') {
        throw new Error(`The ${contractName} constructor is not payable — deploy without value.`)
      }
    }
    const fromAddr = await this._aiResolveFrom(approvedContext.from)
    if (fromAddr) txMeta.from = fromAddr
    let contractMetadata = null
    try { contractMetadata = await this.call('compilerMetadata', 'deployMetadataOf', selectedContract.name, selectedContract.contract.file) } catch (e) { contractMetadata = null }
    const compilerContracts = this._aiDropdownLogic().getCompilerContracts()
    const encodedArgs = this._aiEncodeArgs(args)

    return new Promise((resolve, reject) => {
      let settled = false
      let timer = null
      const done = (fn) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        fn()
      }
      const statusCb = (msg, context) => { try { this.logCallback(msg, context) } catch (e) {} }
      const continueCb = (error, continueTxExecution) => {
        if (error) return done(() => reject(new Error(typeof error === 'string' ? error : (error.message || 'gas estimation failed'))))
        continueTxExecution()
      }
      // Personal-mode passphrase prompts can't be answered programmatically.
      const promptCb = (okCb, cancelCb) => cancelCb()
      // Gas confirmation: auto-continue. This is NOT the security gate — the AI
      // panel already confirmed with the user, and on Injected the wallet
      // prompts for the real signature next.
      const confirmationCb = (network, tx, gasEstimation, continueTxExecution) => continueTxExecution()
      const finalCb = (error, contractObject, address, txResult) => {
        if (error) return done(() => reject(new Error(typeof error === 'string' ? error : (error.message || 'deployment failed'))))
        // Register the deployed instance in the Deploy & Run panel exactly as
        // the manual deploy path does (contractDropdown finalCb): otherwise an
        // AI-deployed contract is live on-chain but has no instance card in the
        // panel, so the user can't interact with it through the normal UI.
        // Best-effort — the on-chain deploy has already succeeded either way.
        try {
          if (this.contractDropdownUI) {
            this.contractDropdownUI.event.trigger('clearInstance') // drops the "no instances" notice
            this.contractDropdownUI.event.trigger('newContractInstanceAdded', [contractObject, address, contractObject.name])
          }
          const data = this.compilersArtefacts.getCompilerAbstract(contractObject.contract.file)
          this.compilersArtefacts.addResolvedContract(helper.addressToString(address), data)
        } catch (e) { console.error('[aiDeploy] instance UI registration failed (deploy still succeeded):', e) }
        const txHash = txResult && (txResult.transactionHash || (txResult.receipt && txResult.receipt.transactionHash) || txResult.txID)
        const rawDeployedAddress = address || (contractObject && contractObject.address) || null
        let deployedAddress = null
        try {
          deployedAddress = rawDeployedAddress ? normalizeTronContractAddress(rawDeployedAddress) : null
        } catch (e) {
          return done(() => reject(new Error('Deployment completed with an invalid TRON contract address. Inspect the transaction receipt before retrying.')))
        }
        done(() => resolve({ ok: true, address: deployedAddress, contractName, txHash: txHash || null }))
      }
      // Safety net: never hang the tool loop if a callback path goes silent.
      timer = setTimeout(() => done(() => reject(new Error('Deployment did not complete in time (the wallet prompt may be waiting, or the network is slow).'))), AI_WALLET_WRITE_TIMEOUT_MS)
      try {
        this._assertAITransactionActive(cancelState)
        this.blockchain.deployContractAndLibraries(selectedContract, encodedArgs, contractMetadata, compilerContracts, { continueCb, promptCb, statusCb, finalCb }, confirmationCb, txMeta)
      } catch (e) { done(() => reject(e)) }
    })
  }

  // Resolve the ABI (and, when known, the compiled contract object) for an AI
  // read/write. Order: an explicit `abi` array (works for contracts whose
  // source is NOT in the workspace), the address-registered compilation
  // (aiDeploy registers every deploy there), the last compilation, then any
  // per-file compilation holding the name — so calling contract A keeps
  // working after file B was compiled more recently.
  _aiResolveCallTarget ({ address, contractName, abi }) {
    if (abi !== undefined && abi !== null) {
      if (!Array.isArray(abi) || abi.length === 0 || abi.some((e) => !e || typeof e !== 'object' || !e.type)) {
        throw new Error('abi must be a non-empty JSON ABI array (objects with a "type" field).')
      }
      return { abi, object: null }
    }
    const findByName = (abstract) => {
      if (!abstract || typeof abstract.visitContracts !== 'function') return null
      let hit = null
      try {
        abstract.visitContracts((c) => {
          if (c && c.name === contractName && c.object) { hit = c; return true }
          return false
        })
      } catch (e) { hit = null }
      return hit
    }
    const candidates = []
    if (this.compilersArtefacts) {
      if (address) {
        const forms = [String(address), String(address).toLowerCase()]
        try {
          const hexAddress = util.addressToHex(String(address))
          if (hexAddress) {
            forms.push(hexAddress, String(hexAddress).toLowerCase())
            try { forms.push(helper.addressToString(hexAddress)) } catch (e) { /* keep the normalized hex form */ }
          }
        } catch (e) { /* keep the raw forms */ }
        try { forms.push(helper.addressToString(address)) } catch (e) { /* keep the raw forms */ }
        for (const f of forms) {
          try { const hitAbstract = this.compilersArtefacts.get(f); if (hitAbstract) candidates.push(hitAbstract) } catch (e) {}
        }
      }
      candidates.push(this.compilersArtefacts.__last)
      const perFile = this.compilersArtefacts.compilersArtefactsPerFile || {}
      for (const file of Object.keys(perFile).reverse()) candidates.push(perFile[file])
    }
    for (const cand of candidates) {
      const hit = findByName(cand)
      if (hit) return { abi: hit.object.abi, object: hit }
    }
    throw new Error(`No compiled contract named "${contractName}". Compile its source file first, or pass the contract's ABI in the "abi" parameter.`)
  }

  // Call/transact a method on a deployed contract. Reads (view/pure) return the
  // decoded value; writes return the transaction hash once mined.
  // value (SUN) / tokenId+tokenValue attach money to a payable method.
  // `from` picks the sending account (defaults to the panel's selected one).
  async aiCallMethod ({ address, contractName, method, args = [], readOnly = false, value, tokenId, tokenValue, abi: explicitAbi, from, approvalSnapshot, approvalDeadline, taskId } = {}) {
    await requireUserPermission(this, 'aiCallMethod', 'call or transact with a deployed contract')
    const cancelState = this._createAITransactionCancelState(taskId)
    if (!address) throw new Error('Provide the deployed contract address.')
    const executionAddress = this.blockchain.getProvider() === 'vm' ? util.addressToHex(String(address)) : address
    if (!executionAddress) throw new Error('Provide a valid deployed contract address.')
    const resolved = this._aiResolveCallTarget({ address, contractName, abi: explicitAbi })
    const abi = resolved.abi
    const funABI = (abi || []).find((f) => f.type === 'function' && f.name === method)
    if (!funABI) throw new Error(`No function "${method}" on ${contractName}. Check the ABI / method name.`)
    const lookupOnly = funABI.stateMutability === 'view' || funABI.stateMutability === 'pure' || funABI.constant === true
    const externalPluginTransaction = !lookupOnly && await this._assertExternalTransactionNetworkAllowed()
    this._assertAITransactionActive(cancelState)
    const hasExplicitTransfer = (value !== undefined && value !== null && String(value) !== '') ||
      (tokenId !== undefined && tokenId !== null && String(tokenId) !== '') ||
      (tokenValue !== undefined && tokenValue !== null && String(tokenValue) !== '')
    const txMeta = this._aiTxMeta({ value, tokenId, tokenValue }) || {}
    if (cancelState && !lookupOnly) txMeta.cancelState = cancelState
    if (externalPluginTransaction) markExternalPluginTransaction(txMeta)
    if (hasExplicitTransfer && lookupOnly) throw new Error(`"${method}" is read-only — a call cannot carry value or tokens.`)
    if (txMeta.value !== undefined && txMeta.value !== '0' && funABI.stateMutability !== 'payable') {
      throw new Error(`"${method}" is not payable — send the transaction without value.`)
    }
    const approvedContext = !lookupOnly
      ? await this._aiAssertApprovalSnapshot(approvalSnapshot, { operation: 'write', address, contractName, method, args, abi: explicitAbi, value, tokenId, tokenValue, from }, approvalDeadline)
      : null
    this._assertAITransactionActive(cancelState)
    const fromAddr = await this._aiResolveFrom(approvedContext ? approvedContext.from : from)
    if (fromAddr) txMeta.from = fromAddr
    // read_contract passes readOnly:true — refuse to silently transact a
    // state-changing method (that path belongs to write_contract, which asks
    // the user to confirm the signature/gas first).
    if (readOnly && !lookupOnly) throw new Error(`"${method}" is a state-changing function — use write_contract (it confirms the signature with the user) instead of read_contract.`)
    const logMsg = `${lookupOnly ? 'call' : 'transact'} to ${contractName}.${method}`
    const encodedArgs = this._aiEncodeArgs(args)

    return new Promise((resolve, reject) => {
      let settled = false
      let timer = null
      let completionTriggered = false
      const done = (fn) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); fn() }
      const logCallback = (msg) => {
        try { this.logCallback(msg) } catch (e) {}
        // Blockchain invokes completionCb before logging a transaction error.
        // Do not race its deterministic VM-revert result with a generic
        // rejection; build/encoding errors never trigger completionCb and
        // still fail through this guard.
        if (/errored:/.test(String(msg)) && !completionTriggered) done(() => reject(new Error(String(msg))))
      }
      const outputCb = (returnValue) => {
        done(() => resolve({ ok: true, kind: 'read', result: this._aiStringifyReturn(returnValue, funABI) }))
      }
      const continueCb = (error, continueTxExecution) => {
        if (error) return done(() => reject(new Error(typeof error === 'string' ? error : (error.message || 'gas estimation failed'))))
        continueTxExecution()
      }
      const promptCb = (okCb, cancelCb) => cancelCb()
      const confirmationCb = (network, tx, gasEstimation, continueTxExecution) => continueTxExecution()

      // Blockchain.runOrCallContractMethod now returns the exact completion
      // callback for writes. Do not infer ownership from a shared
      // transactionExecuted event: a concurrent manual transaction to the same
      // contract must never resolve this AI call.
      const completionCb = (error, txResult) => {
        completionTriggered = true
        const hash = txResult && (txResult.transactionHash || (txResult.receipt && txResult.receipt.transactionHash) || txResult.txID)
        if (error) {
          // The VM simulator reports a deterministic revert through the
          // callback error path (there is no receipt with status=FAILED). It
          // is a known execution failure, not an uncertain broadcast, so keep
          // it as a failed tool result and let the Task Runtime continue with
          // the canonical EXECUTION_REVERTED status. Injected-wallet/provider
          // errors remain fail-closed and uncertain.
          let provider = null
          try { provider = this.blockchain && this.blockchain.getProvider && this.blockchain.getProvider() } catch (e) {}
          if (provider === 'vm' && /\b(?:VM error|revert|reverted)\b/i.test(String(error))) {
            const message = typeof error === 'string' ? error : (error.message || 'transaction reverted')
            // The simulator has already provided a definitive outcome. When
            // a hash is available, decode the same execution result used by
            // the terminal into the compact custom-error/Panic/reason form;
            // fall back to the verbose message if decoding is unavailable.
            return this._aiRevertReason(hash, abi, resolved.object)
              .then((reason) => done(() => resolve({ ok: false, kind: 'write', txHash: hash || null, message: `${logMsg} ${reason || message}` })))
              .catch(() => done(() => resolve({ ok: false, kind: 'write', txHash: hash || null, message: `${logMsg} ${message}` })))
          }
          return done(() => reject(new Error(typeof error === 'string' ? error : (error.message || 'transaction failed'))))
        }
        const receipt = txResult && (txResult.receipt || txResult)
        const status = receipt && (receipt.status !== undefined ? receipt.status : (receipt.result !== undefined ? receipt.result : undefined))
        const reverted = status === false || status === '0x0' || status === 0 || String(status).toUpperCase() === 'FAILED' || String(status).toUpperCase() === 'REVERT'
        if (reverted) {
          this._aiRevertReason(hash, abi, resolved.object).then((reason) => {
            done(() => resolve({
              ok: false,
              kind: 'write',
              txHash: hash || null,
              message: `${logMsg} ${reason || 'reverted (transaction failed on-chain)'}.`
            }))
          }).catch(() => done(() => resolve({
            ok: false,
            kind: 'write',
            txHash: hash || null,
            message: `${logMsg} reverted (transaction failed on-chain).`
          })))
          return
        }
        done(() => resolve({ ok: true, kind: 'write', txHash: hash || null }))
      }

      timer = setTimeout(() => done(() => reject(new Error(`${logMsg} did not complete in time (the wallet prompt may be waiting, or the network is slow).`))), AI_WALLET_WRITE_TIMEOUT_MS)

      try {
        this._assertAITransactionActive(cancelState)
        this.blockchain.runOrCallContractMethod(
          contractName, abi, funABI, resolved.object, encodedArgs, executionAddress, encodedArgs, lookupOnly,
          logMsg, logCallback, outputCb, confirmationCb, continueCb, promptCb, txMeta, completionCb)
      } catch (e) { done(() => reject(e)) }
    })
  }

  // Decode a reverted write's reason from the VM execution result using the
  // contract ABI (custom errors, Error(string), Panic). Returns a concise
  // one-line reason or null when nothing decodable is available (e.g. the
  // injected path, where the wallet/receipt carries no execResult here).
  // Decode a reverted write's reason (custom error name+args / require string /
  // Panic) into a concise line. On the JS VM the exec result — with the revert
  // return data — is not in the transactionExecuted payload; fetch it from the
  // simulator by tx hash, then reuse checkVMError. Returns null when nothing is
  // decodable (e.g. the injected path, where web3 has no simulator result).
  async _aiRevertReason (hash, abi, contractObject) {
    try {
      if (!hash) return null
      const web3 = this.blockchain && this.blockchain.web3 && this.blockchain.web3()
      if (!web3 || !web3.eth || typeof web3.eth.getExecutionResultFromSimulator !== 'function') return null
      const execResult = await web3.eth.getExecutionResultFromSimulator(hash)
      if (!execResult || !execResult.returnValue) return null
      // contractObject is the compiled contract (its .object holds devdoc/userdoc)
      // — the same shape blockchain.runTx passes as args.data.contract. May be
      // null for explicit-abi calls; checkVMError tolerates that.
      const vmError = execution.txExecution.checkVMError(execResult, abi, contractObject)
      return (vmError && vmError.reason) || null
    } catch (e) { return null }
  }

  _aiStringifyReturn (returnValue, funABI) {
    try {
      if (returnValue == null) return null
      // The VM/injected pipelines deliver the RAW ABI-encoded return bytes
      // (a Buffer/Uint8Array, sometimes a 0x-hex string). Decode them with the
      // same decoder the Deploy & Run cards use — indexing the buffer like a
      // web3-decoded object reads BYTE 0 of the 32-byte word (0 for any small
      // value), which made every read_contract readback report 0 (DEF-AI-2).
      const looksLikeRawBytes = (returnValue instanceof Uint8Array) ||
        (typeof Buffer !== 'undefined' && Buffer.isBuffer(returnValue)) ||
        (typeof returnValue === 'string' && returnValue.startsWith('0x'))
      if (looksLikeRawBytes && funABI && funABI.outputs && funABI.outputs.length > 0) {
        const decoded = execution.txFormat.decodeResponse(returnValue, funABI)
        if (decoded && decoded.error) return decoded.error
        return decoded
      }
      if (typeof returnValue === 'string' || typeof returnValue === 'number' || typeof returnValue === 'boolean') return returnValue
      if (returnValue.toString && returnValue._isBigNumber) return returnValue.toString()
      // web3 decoded object: pick the named/indexed outputs
      const out = {}
      const names = (funABI.outputs || []).map((o, i) => o.name || String(i))
      let any = false
      for (const n of names) { if (returnValue[n] !== undefined) { out[n] = returnValue[n] && returnValue[n].toString ? returnValue[n].toString() : returnValue[n]; any = true } }
      if (any) return out
      return JSON.parse(JSON.stringify(returnValue, (k, v) => (typeof v === 'bigint' ? v.toString() : v)))
    } catch (e) { return String(returnValue) }
  }

  _registerExternalListener (emitter, eventName, handler, scope) {
    if (!emitter || !handler) return
    if (emitter.on) emitter.on(eventName, handler)
    else if (emitter.addListener) emitter.addListener(eventName, handler)
    else if (emitter.register) emitter.register(eventName, handler)
    else return
    this._externalEventSubscriptions.push({ emitter, eventName, handler, scope })
  }

  _removeExternalListeners (filter) {
    const remaining = []
    this._externalEventSubscriptions.forEach((subscription) => {
      const { emitter, eventName, handler } = subscription
      if (filter && !filter(subscription)) {
        remaining.push(subscription)
        return
      }
      if (emitter.removeListener) emitter.removeListener(eventName, handler)
      else if (emitter.off) emitter.off(eventName, handler)
      else if (emitter.unregister) emitter.unregister(eventName, handler)
    })
    this._externalEventSubscriptions = remaining
  }

  _clearRenderSubscriptions () {
    this._removeExternalListeners((subscription) => subscription.scope === 'render')
    // @remixproject/engine stores one callback per listener/emitter/event.
    // off() is event-scoped in this engine version; a handler argument would be ignored.
    this._clearManagerEventSubscriptions()
  }

  _clearManagerEventSubscriptions () {
    if (!this._managerEventSubscriptionsRegistered) return
    this.off('manager', 'pluginActivated')
    this.off('manager', 'pluginDeactivated')
    this.off('filePanel', 'setWorkspace')
    this._managerEventSubscriptionsRegistered = false
  }

  _activeWorkspaceName () {
    try {
      const workspaceProvider = this.fileManager?.getProvider?.('workspace')
      return workspaceProvider?.getWorkspace?.() || null
    } catch (e) {
      return null
    }
  }

  _protocolCapabilityEnvironment () {
    const context = this._deploymentExecutionContext()
    let endpoint = null
    try {
      const tronWeb = this.blockchain.web3()
      endpoint = tronWeb?.fullNode?.host || tronWeb?.fullNode?.url || null
      if (endpoint) endpoint = new URL(endpoint, window.location.href).origin
    } catch (e) {}
    return { ...context, endpoint }
  }

  _protocolCapabilityContextKey () {
    const environment = this._protocolCapabilityEnvironment()
    return JSON.stringify({
      provider: environment.provider,
      networkId: environment.network?.id || null,
      contextEpoch: environment.contextEpoch,
      endpoint: environment.endpoint
    })
  }

  _setProtocolCapabilities (snapshot) {
    this._protocolCapabilities = snapshot
    this._renderProtocolCapabilityState()
    return snapshot
  }

  _protocolCapabilityStatusLabel (status) {
    return {
      [CAPABILITY_STATUS.ACTIVE]: 'Active',
      [CAPABILITY_STATUS.INACTIVE]: 'Inactive',
      [CAPABILITY_STATUS.UNKNOWN]: 'Unknown',
      [CAPABILITY_STATUS.UNSUPPORTED]: 'Unsupported',
      [CAPABILITY_STATUS.CHECKING]: 'Checking'
    }[status] || 'Unknown'
  }

  _renderProtocolCapabilityBadge (element, capabilityState) {
    if (!element) return
    const status = capabilityState?.status || CAPABILITY_STATUS.UNKNOWN
    const className = {
      [CAPABILITY_STATUS.ACTIVE]: 'badge-success',
      [CAPABILITY_STATUS.INACTIVE]: 'badge-warning',
      [CAPABILITY_STATUS.UNKNOWN]: 'badge-danger',
      [CAPABILITY_STATUS.UNSUPPORTED]: 'badge-secondary',
      [CAPABILITY_STATUS.CHECKING]: 'badge-info'
    }[status]
    element.className = `badge badge-pill ${className}`
    element.dataset.status = status
    element.textContent = this._protocolCapabilityStatusLabel(status)
  }

  _renderProtocolCapabilityState () {
    if (!this.protocolCapabilitiesCard) return
    const snapshot = this._protocolCapabilities || createCheckingProtocolCapabilitySnapshot(this._protocolCapabilityEnvironment())
    this._renderProtocolCapabilityBadge(this.protocolPragueStatus, snapshot.prague)
    this._renderProtocolCapabilityBadge(this.protocolOsakaStatus, snapshot.osaka)

    const dependencies = this._compiledProtocolScan?.dependencies || []
    this.protocolArtifactRequirements.textContent = dependencies.length
      ? `Compiled bytecode uses: ${dependencies.map((dependency) => dependency.label).join(', ')}.`
      : 'Compiled bytecode: no Prague/Osaka dependency detected.'

    if (this.protocolCapabilitiesCheckedAt) {
      this.protocolCapabilitiesCheckedAt.textContent = snapshot.checkedAt
        ? `Checked ${new Date(snapshot.checkedAt).toLocaleTimeString()}`
        : 'Waiting for provider check'
    }
  }

  _setProtocolCompatibilityMessage (message, kind = 'warning') {
    if (!this.protocolCapabilitiesMessage) return
    this.protocolCapabilitiesMessage.textContent = message || ''
    this.protocolCapabilitiesMessage.className = `mt-2 small ${kind === 'danger' ? 'text-danger' : 'text-warning'}`
    this.protocolCapabilitiesMessage.style.display = message ? 'block' : 'none'
  }

  async _requestProtocolCapabilities (force = false) {
    const environment = this._protocolCapabilityEnvironment()
    const contextKey = this._protocolCapabilityContextKey()
    const cached = this._protocolCapabilityCache.get(contextKey)
    if (!force && cached && cached.checkedAt && Date.now() - cached.checkedAt < 30000) {
      return this._setProtocolCapabilities(cached)
    }

    const requestId = ++this._protocolCapabilityRequestId
    this._setProtocolCapabilities(createCheckingProtocolCapabilitySnapshot(environment))
    if (environment.provider === 'vm') {
      const snapshot = createProtocolCapabilitySnapshot(environment)
      this._protocolCapabilityCache.set(contextKey, snapshot)
      return this._setProtocolCapabilities(snapshot)
    }

    let chainParameters
    let error
    try {
      const tronWeb = this.blockchain.web3()
      let request
      if (tronWeb?.trx?.getChainParameters) {
        request = Promise.resolve(tronWeb.trx.getChainParameters())
      } else if (tronWeb?.fullNode?.request) {
        request = Promise.resolve(tronWeb.fullNode.request('wallet/getchainparameters', {}, 'post'))
      } else {
        throw new Error('The current provider does not support chain parameter lookup.')
      }
      let timeout
      try {
        chainParameters = await Promise.race([
          request,
          new Promise((resolve, reject) => {
            timeout = setTimeout(() => reject(new Error('Chain parameter lookup timed out.')), 8000)
          })
        ])
      } finally {
        clearTimeout(timeout)
      }
    } catch (requestError) {
      error = requestError
    }

    // A provider/network switch while the request was in flight invalidates
    // the response. Never paint or authorize with capability data from the
    // environment that just disappeared.
    if (requestId !== this._protocolCapabilityRequestId || contextKey !== this._protocolCapabilityContextKey()) {
      return this._protocolCapabilities
    }
    const snapshot = createProtocolCapabilitySnapshot({ ...environment, chainParameters, error })
    this._protocolCapabilityCache.set(contextKey, snapshot)
    return this._setProtocolCapabilities(snapshot)
  }

  _scanCompilerProtocolRequirements (compiler) {
    // Compatibility messages describe the artifact that was validated at the
    // time of the deploy attempt. A new compilation replaces that artifact,
    // so retaining the old blocker/warning mislabels the newly selected
    // contract until the user clicks Deploy again.
    this._setProtocolCompatibilityMessage('')
    const dependencyMap = new Map()
    if (compiler && typeof compiler.visitContracts === 'function') {
      compiler.visitContracts((contract) => {
        const artifact = contract?.object
        const scan = scanCompilationArtifacts({
          creationBytecode: artifact?.evm?.bytecode,
          runtimeBytecode: artifact?.evm?.deployedBytecode
        })
        scan.dependencies.forEach((dependency) => {
          if (!dependencyMap.has(dependency.id)) dependencyMap.set(dependency.id, { ...dependency, scopes: [], matches: [] })
          const aggregate = dependencyMap.get(dependency.id)
          dependency.scopes.forEach((scope) => {
            if (!aggregate.scopes.includes(scope)) aggregate.scopes.push(scope)
          })
          aggregate.matches.push(...dependency.matches)
        })
      })
    }
    this._compiledProtocolScan = { dependencies: Array.from(dependencyMap.values()) }
    this._renderProtocolCapabilityState()
  }

  _deploymentBytecodeScan (data) {
    const originalCreation = extractBytecodeObject(data?.contractBytecode)
    let creationBytecode = originalCreation
    // Linked deployment data preserves the byte length of Solidity's library
    // placeholders. Scan that executable prefix instead of rejecting the
    // unresolved artifact or interpreting constructor arguments as opcodes.
    if (creationBytecode.includes('_') && typeof data?.dataHex === 'string') {
      const executableData = data.dataHex.replace(/^0x/i, '')
      creationBytecode = executableData.slice(0, creationBytecode.replace(/^0x/i, '').length)
    }
    return scanCompilationArtifacts({
      creationBytecode,
      runtimeBytecode: data?.deployedBytecode
    })
  }

  _validateDeploymentCompatibility (data, callback) {
    let completed = false
    const done = (error) => {
      if (completed) return
      completed = true
      callback(error)
    }
    ;(async () => {
      const scan = this._deploymentBytecodeScan(data)
      if (!scan.dependencies.length) {
        this._setProtocolCompatibilityMessage('')
        return done(null)
      }

      const checkedAt = this._protocolCapabilities?.checkedAt || 0
      const force = !checkedAt || Date.now() - checkedAt > 60000
      const snapshot = await this._requestProtocolCapabilities(force)
      const evaluation = evaluateDeploymentCompatibility(scan, snapshot)
      if (!evaluation.compatible) {
        const message = formatDeploymentCompatibilityMessage(evaluation)
        this._setProtocolCompatibilityMessage(message, 'danger')
        toaster(message)
        return done(new Error(message))
      }
      if (evaluation.warnings.length) {
        const warning = evaluation.warnings.map((item) => item.message).join(' ')
        this._setProtocolCompatibilityMessage(warning)
        toaster(warning)
      } else {
        this._setProtocolCompatibilityMessage('')
      }
      done(null)
    })().catch((error) => {
      const message = `Deployment blocked: compatibility check failed (${error.message || error}).`
      this._setProtocolCompatibilityMessage(message, 'danger')
      toaster(message)
      done(new Error(message))
    })
  }

  _deploymentExecutionContext () {
    const networkStatus = this.blockchain.getCurrentNetworkStatus?.()
    const network = networkStatus?.network || null
    let contextEpoch = null
    if (typeof this.blockchain.getProviderContextEpoch === 'function') {
      const value = this.blockchain.getProviderContextEpoch()
      if (Number.isSafeInteger(value) && value >= 0) contextEpoch = value
    }
    return {
      provider: this.blockchain.getProvider?.() || null,
      network: network ? { name: network.name || null, id: network.id || null } : null,
      contextEpoch,
      workspace: this._activeWorkspaceName()
    }
  }

  _clearPublishedDeployment (reason) {
    if (typeof window === 'undefined') return
    delete window.__tronideLastDeployment
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('tronideDeploymentContextCleared', { detail: { reason } }))
    }
  }

  _clearPublishedDeploymentIfStale (reason) {
    if (typeof window === 'undefined' || !window.__tronideLastDeployment) return
    const deployment = window.__tronideLastDeployment
    const current = this._deploymentExecutionContext()
    const staleEpoch = deployment.contextEpoch != null && current.contextEpoch != null && deployment.contextEpoch !== current.contextEpoch
    const staleProvider = deployment.provider && current.provider && deployment.provider !== current.provider
    const staleWorkspace = Object.prototype.hasOwnProperty.call(deployment, 'workspace') && deployment.workspace !== current.workspace
    const currentNetworkId = current.provider === 'vm' ? 'vm' : current.network?.id
    const staleNetwork = deployment.networkId && currentNetworkId && deployment.networkId !== currentNetworkId
    if (staleEpoch || staleProvider || staleWorkspace || staleNetwork) this._clearPublishedDeployment(reason)
  }

  setupEvents () {
    this._onNewTransaction = (tx, receipt) => {
      this.emit('newTransaction', tx, receipt)
    }
    this._registerExternalListener(this.blockchain.events, 'newTransaction', this._onNewTransaction)
    // Publish one deployment-completed signal for both the manual Deploy
    // button and the AI deployment pipeline. The AI panel consumes this same
    // signal to render its five explicit post-deployment actions, so a normal
    // Deploy & Run deployment no longer has a separate, missing next-step UX.
    this._onContractDeploymentStarted = (timestamp, tx, payload) => {
      if (!tx || tx.useCall || tx.to || !payload || !payload.contractName) return
      // Bind the eventual receipt to the workspace/provider/network that
      // initiated it. A late receipt must never repopulate a new context.
      payload.tronideDeploymentContext = this._deploymentExecutionContext()
    }
    this._registerExternalListener(this.blockchain.event, 'initiatingTransaction', this._onContractDeploymentStarted)
    this._onContractDeploymentCompleted = (error, from, to, data, call, txResult, timestamp, payload) => {
      // A failed VM deployment can still carry a deterministic contractAddress
      // in its receipt. Only publish a deployment context after a successful
      // creation; otherwise the AI panel offers success-oriented next steps
      // for a transaction that actually reverted.
      if (isFailedTransactionResult(error, txResult) || call || to) return
      const receipt = txResult && (txResult.receipt || txResult)
      const rawAddress = receipt && (receipt.contractAddress || receipt.contract_address)
      if (!rawAddress) return

      const capturedContext = payload?.tronideDeploymentContext || null
      const currentContext = this._deploymentExecutionContext()
      if (capturedContext?.contextEpoch != null && currentContext.contextEpoch != null && capturedContext.contextEpoch !== currentContext.contextEpoch) return
      if (capturedContext && capturedContext.workspace !== currentContext.workspace) return

      let contractAddress = null
      try {
        contractAddress = normalizeTronContractAddress(rawAddress)
      } catch (e) {
        console.debug('[udapp] could not normalize deployed contract address:', e)
        return
      }
      if (!contractAddress) return

      const transactionHash = receipt.transactionHash || txResult.transactionHash || txResult.txID || txResult.txid || null
      const provider = capturedContext?.provider || currentContext.provider
      const networkInfo = capturedContext?.network || currentContext.network
      const networkId = provider === 'vm' ? 'vm' : ((networkInfo && networkInfo.id) || null)
      const deployment = {
        contractAddress,
        contractName: (payload && payload.contractName) || (data && data.contractName) || 'Contract',
        transactionHash: transactionHash || null,
        network: provider === 'vm' ? 'JavaScript VM (Tron)' : (TRON_NETWORK_LABELS[networkId] || (networkInfo && (networkInfo.name || networkInfo.id)) || 'network pending'),
        networkId,
        provider: provider || null,
        contextEpoch: capturedContext?.contextEpoch ?? currentContext.contextEpoch,
        workspace: capturedContext?.workspace ?? currentContext.workspace,
        timestamp: timestamp || Date.now()
      }
      if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
      window.__tronideLastDeployment = deployment
      window.dispatchEvent(new CustomEvent('tronideDeploymentCompleted', { detail: deployment }))
    }
    this._registerExternalListener(this.blockchain.event, 'transactionExecuted', this._onContractDeploymentCompleted)
    this._publishEnvironmentChanged = (networkStatus = null) => {
      const network = networkStatus?.network || this.blockchain.getCurrentNetworkStatus?.()?.network || null
      this.emit('environmentChanged', {
        provider: this.blockchain.getProvider(),
        network: network ? { name: network.name || null, id: network.id || null } : null
      })
    }
    this._onBlockchainContextChanged = (networkStatus = null) => {
      this._clearPublishedDeployment('execution-context-changed')
      this._publishEnvironmentChanged(networkStatus)
      this._requestProtocolCapabilities(true).catch((error) => console.debug('[udapp] protocol capability refresh failed:', error))
    }
    this._onBlockchainNetworkStatus = (networkStatus = null) => {
      this._publishEnvironmentChanged(networkStatus)
      this._clearPublishedDeploymentIfStale('network-changed')
      this._requestProtocolCapabilities(false).catch((error) => console.debug('[udapp] protocol capability refresh failed:', error))
    }
    this._registerExternalListener(this.blockchain.event, 'contextChanged', this._onBlockchainContextChanged)
    this._registerExternalListener(this.blockchain.event, 'networkStatus', this._onBlockchainNetworkStatus)
  }

  getSettings () {
    return this._withUserPermission('getSettings', 'read deployment settings', () => {
      return new Promise((resolve, reject) => {
        if (!this.container) reject(new Error('UI not ready'))
        else {
          resolve({
            selectedAccount: this.settingsUI.getSelectedAccount(),
            selectedEnvMode: this.blockchain.getProvider(),
            networkEnvironment: this.container.querySelector('*[data-id="settingsNetworkEnv"]').textContent
          }
          )
        }
      })
    })
  }

  async setEnvironmentMode (env) {
    await requireUserPermission(this, 'setEnvironmentMode', 'change the environment used')
    toaster(yo`
        <div>
          <i class="fas fa-exclamation-triangle text-danger mr-1"></i>
          <span>
            ${(this.currentRequest && this.currentRequest.from) || 'TronIDE'}
            <span class="font-weight-bold text-warning">
              is changing your environment to
            </span> ${env}
          </span>
        </div>
      `, '', { time: 3000 })
    this.settingsUI.setExecutionContext(env)
  }

  async connectInjectedTronWeb () {
    await requireUserPermission(this, 'connectInjectedTronWeb', 'connect the injected wallet')
    if (!this.settingsUI) throw new Error('Deploy & Run is not ready')
    const hadInjectedAccount = typeof window !== 'undefined' && window.tronWeb && window.tronWeb.defaultAddress && window.tronWeb.defaultAddress.base58

    if (this.blockchain.getProvider() === 'injected') {
      try {
        const accounts = await this.blockchain.getAccounts()
        if (accounts && accounts[0]) {
          await this.settingsUI.fillAccountsList()
          toaster('TronLink is already connected.')
          return { connected: true, alreadyConnected: true, account: accounts[0] }
        }
      } catch (e) {
        this.settingsUI.clearAccountsList()
      }
    }

    if (this.blockchain.getProvider() !== 'injected') this.settingsUI.clearAccountsList()
    this.settingsUI.pendingAccountsProvider = 'injected'
    this.settingsUI.loadedAccountsProvider = 'injected'

    const walletState = walletAdapterManager.createWalletAdapterManagerState(window)
    const tronlinkAdapter = walletState.adapters && walletState.adapters.find((adapter) => adapter.kind === 'tronlink')
    if (!tronlinkAdapter || tronlinkAdapter.status === walletProviderAdapter.WALLET_STATUS.unavailable) {
      const error = (tronlinkAdapter && tronlinkAdapter.reason) || walletProviderAdapter.WALLET_ERROR_MESSAGES.WALLET_UNAVAILABLE
      this.settingsUI.clearAccountsList()
      toaster(`Cannot connect TronLink: ${error}`)
      return { connected: false, error, code: walletProviderAdapter.WALLET_ERROR_CODES.WALLET_UNAVAILABLE }
    }

    try {
      await walletAdapterManager.connectWalletAdapter('tronlink', window)
    } catch (error) {
      const normalized = walletProviderAdapter.normalizeWalletError(error)
      this.settingsUI.clearAccountsList()
      toaster(`Cannot connect TronLink: ${normalized.message}`)
      return { connected: false, error: normalized.message, code: normalized.code }
    }

    return new Promise((resolve) => {
      this.settingsUI.setExecutionContext({ context: 'injected' }, async (error) => {
        if (error) {
          const normalized = walletProviderAdapter.normalizeWalletError(error)
          this.settingsUI.clearAccountsList()
          toaster(`Cannot connect TronLink: ${normalized.message}`)
          return resolve({ connected: false, error: normalized.message, code: normalized.code })
        }

        await this.settingsUI.fillAccountsList()

        try {
          const accounts = await this.blockchain.getAccounts()
          if (accounts && accounts[0]) {
            toaster(hadInjectedAccount ? 'TronLink is already connected.' : 'TronLink connected.')
            return resolve({ connected: true, alreadyConnected: Boolean(hadInjectedAccount), account: accounts[0] })
          }
        } catch (e) {
          const normalized = walletProviderAdapter.normalizeWalletError(e)
          this.settingsUI.clearAccountsList()
          toaster(normalized.message)
          return resolve({ connected: false, error: normalized.message, code: normalized.code })
        }

        const status = walletProviderAdapter.getInjectedWalletStatus(window)
        const message = status === walletProviderAdapter.WALLET_STATUS.locked
          ? walletProviderAdapter.WALLET_ERROR_MESSAGES.WALLET_LOCKED
          : walletProviderAdapter.WALLET_ERROR_MESSAGES.WALLET_UNAUTHORIZED
        toaster(message)
        resolve({ connected: false, error: message, status })
      })
    })
  }

  async disconnectInjectedTronWeb () {
    await requireUserPermission(this, 'disconnectInjectedTronWeb', 'disconnect the injected wallet')
    // Provider events can repeat or race with a user changing environments.
    // Only tear down an injected context; an existing VM/custom context must
    // keep its accounts and state intact.
    if (!this.settingsUI || this.blockchain.getProvider() !== 'injected') return { disconnected: true }
    this.settingsUI.clearAccountsList()
    this.settingsUI.pendingAccountsProvider = 'vm'
    this.settingsUI.loadedAccountsProvider = 'vm'

    return new Promise((resolve) => {
      this.settingsUI.setExecutionContext({ context: 'vm', fork: 'tron' }, (error) => {
        if (error) return resolve({ disconnected: false, error })
        this.settingsUI.clearAccountsList()
        resolve({ disconnected: true })
      })
    })
  }

  createVMAccount (newAccount) {
    return this._withUserPermission('createVMAccount', 'create a virtual machine account', () => {
      return this.blockchain.createVMAccount(newAccount)
    })
  }

  sendTransaction (tx) {
    return this._withUserPermission('sendTransaction', 'send a transaction', () => {
      _paq.push(['trackEvent', 'udapp', 'sendTx'])
      return this.blockchain.sendTransaction(tx)
    })
  }

  getAccounts (cb) {
    return this._withUserPermission('getAccounts', 'read available accounts', () => {
      return this.blockchain.getAccounts(cb)
    })
  }

  pendingTransactionsCount () {
    return this._withUserPermission('pendingTransactionsCount', 'read the pending transaction count', () => {
      return this.blockchain.pendingTransactionsCount()
    })
  }

  renderProtocolCapabilities () {
    this.protocolPragueStatus = yo`<span class="badge badge-pill badge-info" data-id="protocolPragueStatus" data-status="checking">Checking</span>`
    this.protocolOsakaStatus = yo`<span class="badge badge-pill badge-info" data-id="protocolOsakaStatus" data-status="checking">Checking</span>`
    this.protocolArtifactRequirements = yo`<div class="small text-muted mt-2" data-id="protocolArtifactRequirements"></div>`
    this.protocolCapabilitiesCheckedAt = yo`<span class="small text-muted" data-id="protocolCapabilitiesCheckedAt">Waiting for provider check</span>`
    this.protocolCapabilitiesMessage = yo`<div class="mt-2 small text-warning" data-id="protocolCapabilitiesMessage" style="display: none"></div>`
    this.protocolCapabilitiesCard = yo`
      <div class="border-0 list-group-item" data-id="protocolCapabilitiesCard">
        <div class="d-flex justify-content-between align-items-center">
          <span class="font-weight-bold">Protocol compatibility</span>
          <button class="btn btn-sm btn-link p-0" type="button" data-id="protocolCapabilitiesRefresh"
            title="Refresh Prague and Osaka chain parameters"
            onclick=${() => this._requestProtocolCapabilities(true)}>
            <i class="fas fa-sync-alt" aria-hidden="true"></i> Refresh
          </button>
        </div>
        <div class="d-flex align-items-center mt-2">
          <span class="mr-1">Prague</span>${this.protocolPragueStatus}
          <span class="ml-3 mr-1">Osaka</span>${this.protocolOsakaStatus}
        </div>
        ${this.protocolArtifactRequirements}
        <div class="mt-1">${this.protocolCapabilitiesCheckedAt}</div>
        ${this.protocolCapabilitiesMessage}
      </div>`
    this._renderProtocolCapabilityState()
  }

  renderContainer () {
    this.container = yo`<div class="${css.runTabView} run-tab" id="runTabView" data-id="runTabView"></div>`

    var el = yo`
    <div class="list-group list-group-flush">
      ${this.settingsUI.render()}
      ${this.protocolCapabilitiesCard}
      ${this.contractDropdownUI.render()}
      ${this.recorderCard.render()}
      ${this.instanceContainer}
    </div>
    `
    this.container.appendChild(el)
    return this.container
  }

  renderInstanceContainer () {
    this.instanceContainer = yo`<div class="${css.instanceContainer} border-0 list-group-item"></div>`

    const instanceContainerTitle = yo`
      <div class="d-flex justify-content-between align-items-center pl-2 ml-1 mb-2"
        title="Autogenerated generic user interfaces for interaction with deployed contracts">
        Deployed Contracts
        <i class="mr-2 ${css.icon} far fa-trash-alt tooltip-above ta-right ta-clear" data-id="deployAndRunClearInstances" onclick=${() => this.event.trigger('clearInstance', [])}
          data-title="Clear instances list and reset recorder" aria-hidden="true">
        </i>
      </div>`

    this.noInstancesText = yo`
      <span class="mx-2 mt-3 alert alert-warning" data-id="deployAndRunNoInstanceText" role="alert">
        Currently you have no contract instances to interact with.
      </span>`

    this.event.register('clearInstance', () => {
      this.instanceContainer.innerHTML = '' // clear the instances list
      this.instanceContainer.appendChild(instanceContainerTitle)
      this.instanceContainer.appendChild(this.noInstancesText)
    })

    this.instanceContainer.appendChild(instanceContainerTitle)
    this.instanceContainer.appendChild(this.noInstancesText)
  }

  renderSettings () {
    if (this.settingsUI && this.settingsUI.destroy) this.settingsUI.destroy()
    this.settingsUI = new SettingsUI(this.blockchain, this.networkModule)

    this.settingsUI.event.register('clearInstance', () => {
      this.event.trigger('clearInstance', [])
    })
  }

  renderDropdown (udappUI, fileManager, compilersArtefacts, config, editor, logCallback) {
    const dropdownLogic = new DropdownLogic(compilersArtefacts, config, editor, this)
    this.contractDropdownUI = new ContractDropdownUI(this.blockchain, dropdownLogic, logCallback, this)

    this._onCurrentFileChanged = this.contractDropdownUI.changeCurrentFile.bind(this.contractDropdownUI)
    this._registerExternalListener(fileManager.events, 'currentFileChanged', this._onCurrentFileChanged, 'render')

    // When the last file closes, compile-tab resets its artifacts — the Deploy
    // & Run contract list must follow, or it keeps offering a stale compilation
    // the compiler no longer shows (TC-CMP-010 / TC-IX-CMP-002).
    this._onNoFileSelected = () => {
      this.contractDropdownUI.updateCompiledContracts(false)
      this._scanCompilerProtocolRequirements(null)
    }
    this._registerExternalListener(fileManager.events, 'noFileSelected', this._onNoFileSelected, 'render')

    dropdownLogic.event.register('newlyCompiled', (success, data, source, compiler) => {
      this._scanCompilerProtocolRequirements(success ? compiler : null)
    })
    this._scanCompilerProtocolRequirements(compilersArtefacts.__last)

    this.contractDropdownUI.event.register('clearInstance', () => {
      const noInstancesText = this.noInstancesText
      if (noInstancesText.parentNode) { noInstancesText.parentNode.removeChild(noInstancesText) }
    })
    this.contractDropdownUI.event.register('newContractABIAdded', (abi, address) => {
      this.instanceContainer.appendChild(udappUI.renderInstanceFromABI(abi, address, '<at address>'))
    })
    this.contractDropdownUI.event.register('newContractInstanceAdded', (contractObject, address, value) => {
      this.instanceContainer.appendChild(udappUI.renderInstance(contractObject, address, value))
    })
  }

  renderRecorder (udappUI, fileManager, config, logCallback) {
    this.recorderCount = yo`<span>0</span>`

    const recorder = new Recorder(this.blockchain)
    recorder.event.register('recorderCountChange', (count) => {
      this.recorderCount.innerText = count
    })
    this.event.register('clearInstance', recorder.clearAll.bind(recorder))
    this.event.register('clearInstance', recorder.clearAddressBook.bind(recorder))

    this.recorderInterface = new RecorderUI(this.blockchain, fileManager, recorder, logCallback, config, this.compilersArtefacts)

    this.recorderInterface.event.register('newScenario', (abi, address, contractName) => {
      var noInstancesText = this.noInstancesText
      if (noInstancesText.parentNode) { noInstancesText.parentNode.removeChild(noInstancesText) }
      this.instanceContainer.appendChild(udappUI.renderInstanceFromABI(abi, address, contractName))
    })

    this.recorderInterface.render()
  }

  renderRecorderCard () {
    const collapsedView = yo`
      <div class="d-flex flex-column">
        <div class="ml-2 badge badge-pill badge-primary" title="The number of recorded transactions">${this.recorderCount}</div>
      </div>`

    // Address book: contracts created by recorded/replayed transactions. The
    // section element is created once and mutated in place (same pattern as
    // the recorderCount badge), so it stays current across expand/collapse.
    const addressBookEntries = yo`<div data-id="recorderAddressBookEntries"></div>`
    const addressBookSection = yo`
      <div class="mt-2 pt-2 border-top" data-id="recorderAddressBook" style="display: none">
        <div class="${css.recorderDescription}" title="Contracts created by the recorded or replayed transactions">Deployed contracts</div>
        ${addressBookEntries}
      </div>`
    const renderAddressBook = (book) => {
      addressBookSection.style.display = book && book.length ? 'block' : 'none'
      addressBookEntries.innerHTML = ''
      ;(book || []).forEach((entry) => {
        const address = util.addressToBase58(entry.address)
        // both name and address must be allowed to shrink/truncate or a long
        // contract name pushes the address and copy icon out of the sidebar
        const copyIcon = copyToClipboard(() => address, 'Copy the deployed address')
        copyIcon.classList.add('flex-shrink-0')
        addressBookEntries.appendChild(yo`
          <div class="d-flex align-items-center" data-id="recorderAddressBookEntry">
            <span class="mr-1 font-weight-bold text-truncate" style="min-width: 0" data-id="recorderAddressBookName" title="${entry.name}">${entry.name}</span>
            <span class="text-truncate" style="min-width: 0" data-id="recorderAddressBookAddress" title="${address}">${address}</span>
            ${copyIcon}
          </div>`)
      })
    }
    // Deploy flow: per-step status of the last scenario replay. Rows are
    // created on replayStarted and updated in place; a failed step stops the
    // flow there, so later rows keep their pending state.
    const deployFlowSteps = yo`<div data-id="recorderDeployFlowSteps"></div>`
    const deployFlowSection = yo`
      <div class="mt-2 pt-2 border-top" data-id="recorderDeployFlow" style="display: none">
        <div class="${css.recorderDescription}" title="Per-step result of the last scenario replay">Deploy flow</div>
        ${deployFlowSteps}
      </div>`
    const stepIcons = {
      pending: 'far fa-circle text-muted',
      running: 'fas fa-spinner fa-spin',
      success: 'fas fa-check text-success',
      failed: 'fas fa-times text-danger'
    }
    let deployFlowRows = []
    const resetDeployFlow = () => {
      deployFlowSection.style.display = 'none'
      deployFlowSteps.innerHTML = ''
      deployFlowRows = []
    }

    const recorder = this.recorderInterface.recorder
    recorder.event.register('replayStarted', (steps) => {
      resetDeployFlow()
      deployFlowSection.style.display = 'block'
      deployFlowRows = steps.map((step) => {
        const label = step.type === 'constructor' ? `Deploy ${step.contractName || ''}` : (step.name || step.type)
        const row = yo`
          <div class="d-flex align-items-center px-1" data-id="recorderDeployFlowStep" data-status="pending">
            <i class="mr-1 ${stepIcons.pending}" aria-hidden="true"></i>
            <span class="text-truncate" style="min-width: 0">${step.index + 1}. ${label}</span>
          </div>`
        deployFlowSteps.appendChild(row)
        return row
      })
    })
    recorder.event.register('replayStepUpdated', (index, status, error) => {
      const row = deployFlowRows[index]
      if (!row || !stepIcons[status]) return
      row.setAttribute('data-status', status)
      row.querySelector('i').className = `mr-1 ${stepIcons[status]}`
      if (status === 'failed') {
        row.classList.add('alert-danger', 'font-weight-bold')
        if (error) row.title = error
      }
    })
    this.event.register('clearInstance', resetDeployFlow)

    recorder.event.register('addressBookUpdated', renderAddressBook)
    renderAddressBook(recorder.getAddressBook())

    // Bridge to TronBox: download the recorded flow as a ready-to-migrate
    // TronBox project (complementary export, not an in-browser CLI).
    const exportTronboxButton = yo`
      <button class="btn btn-sm btn-secondary mt-2 align-self-start" data-id="recorderExportTronbox"
        title="Download this deploy flow as a TronBox project (contracts, migrations, network config)"
        onclick=${() => this.recorderInterface.exportTronboxProject()}>
        Export to TronBox
      </button>`

    const expandedView = yo`
      <div class="d-flex flex-column">
        <div class="${css.recorderDescription} mt-2">
          Transactions created in JavaScript VM (Tron) can be replayed in Injected TronWeb.
          Transactions created in Injected TronWeb cannot be replayed in JavaScript VM (Tron) yet.
        </div>
        <div class="${css.transactionActions}">
          ${this.recorderInterface.recordButton}
          ${this.recorderInterface.runButton}
        </div>
        ${deployFlowSection}
        ${addressBookSection}
        ${exportTronboxButton}
      </div>`

    this.recorderCard = new Card({}, {}, { title: 'Transactions recorded', collapsedView: collapsedView })
    this.recorderCard.event.register('expandCollapseCard', (arrow, body, status) => {
      body.innerHTML = ''
      status.innerHTML = ''
      if (arrow === 'down') {
        status.appendChild(collapsedView)
        body.appendChild(expandedView)
      } else if (arrow === 'up') {
        status.appendChild(collapsedView)
      }
    })
  }

  render () {
    this._clearRenderSubscriptions()
    this.udappUI = new UniversalDAppUI(this.blockchain, this.logCallback)
    this.blockchain.resetAndInit(this.config, {
      getAddress: (cb) => {
        let called = false
        const cbOnce = (err, res) => {
          if (called) return
          called = true
          cb(err, res)
        }
        ;(async () => {
          // Read from the active Settings instance rather than a document-wide
          // jQuery id lookup. Provider switches can leave a stale/hidden
          // #txorigin node around briefly; selecting that node returned
          // undefined even while the visible VM account selector was ready.
          let selectedAddress
          try { selectedAddress = this.settingsUI && this.settingsUI.getSelectedAccount() } catch (e) {
            const accountSelect = document.querySelector('#runTabView #txorigin')
            selectedAddress = accountSelect && accountSelect.value
          }
          if (this.blockchain.getProvider() !== 'injected') {
            if (selectedAddress) return cbOnce(null, selectedAddress)
            try {
              const accounts = await this.blockchain.getAccounts()
              if (accounts && accounts[0]) return cbOnce(null, accounts[0])
            } catch (e) { return cbOnce(e) }
            return cbOnce(new Error('No account is available in the selected environment.'))
          }

          try {
            const accounts = await this.blockchain.getAccounts()
            if (accounts && accounts[0]) return cbOnce(null, accounts[0])
          } catch (e) {
            this.settingsUI.clearAccountsList()
          }

          this.settingsUI.setExecutionContext({ context: 'injected' }, async (error) => {
            if (error) {
              const normalized = walletProviderAdapter.normalizeWalletError(error)
              return cbOnce(normalized.message)
            }
            await this.settingsUI.fillAccountsList()
            try {
              const accounts = await this.blockchain.getAccounts()
              if (accounts && accounts[0]) return cbOnce(null, accounts[0])
            } catch (e) {
              this.settingsUI.clearAccountsList()
              const normalized = walletProviderAdapter.normalizeWalletError(e)
              return cbOnce(normalized.message)
            }
            cbOnce(walletProviderAdapter.WALLET_ERROR_MESSAGES.WALLET_DISCONNECTED)
          })
        })().catch((error) => cbOnce(error))
      },
      getValue: (cb) => {
        let called = false
        const cbOnce = (err, res) => {
          if (called) return
          called = true
          cb(err, res)
        }
        ;(async () => {
          try {
            const validationError = await this.settingsUI.validateTrxBalance()
            if (validationError) return cbOnce(validationError)

            const number = document.querySelector('#value').value
            const select = document.getElementById('unit')
            const index = select.selectedIndex
            const selectedUnit = select.querySelectorAll('option')[index].dataset.unit
            let unit = 'mwei' // default
            if (['mwei', 'wei'].indexOf(selectedUnit) >= 0) {
              unit = selectedUnit
            }
            cbOnce(null, Web3.utils.toWei(number, unit))
          } catch (e) {
            cbOnce(e)
          }
        })()
      },
      getGasLimit: (cb) => {
        let called = false
        const cbOnce = (err, res) => {
          if (called) return
          called = true
          cb(err, res)
        }
        try {
          const validationError = this.settingsUI.validateValueExtend('gasLimit')
          if (validationError) return cbOnce(validationError)

          cbOnce(null, '0x' + new BN($('#gasLimit').val(), 10).toString(16))
        } catch (e) {
          cbOnce(e.message)
        }
      },
      getExtendValue: (cb) => {
        let called = false
        const cbOnce = (err, res) => {
          if (called) return
          called = true
          cb(err, res)
        }
        ;(async () => {
          try {
            let validationError = await this.settingsUI.validateTrc10Fields()
            if (validationError) return cbOnce(validationError)

            this.settingsUI.validateValueExtend('userFeePer')
            this.settingsUI.validateValueExtend('originEnergy')

            const tokenIdValue = new BN(String($('#tokenId').val() || '0'), 10)
            const tokenValueValue = new BN(String($('#tokenValue').val() || '0'), 10)

            const tokenId = '0x' + tokenIdValue.toString(16)
            const tokenValue = '0x' + tokenValueValue.toString(16)
            const userFeePercentage = new BN($('#userFeePer').val(), 10).toNumber()
            const originEnergyLimit = new BN($('#originEnergy').val(), 10).toNumber()

            cbOnce(null, {
              tokenId,
              tokenValue,
              userFeePercentage,
              originEnergyLimit
            })
          } catch (e) {
            cbOnce(e.message)
          }
        })()
      },
      validateDeploymentCompatibility: (data, cb) => this._validateDeploymentCompatibility(data, cb)
    })
    this.renderInstanceContainer()
    this.renderSettings()
    this.renderProtocolCapabilities()
    this.renderDropdown(this.udappUI, this.fileManager, this.compilersArtefacts, this.config, this.editor, this.logCallback)
    this.renderRecorder(this.udappUI, this.fileManager, this.config, this.logCallback)
    this.renderRecorderCard()

    const addPluginProvider = (profile) => {
      if (profile.kind === 'provider') {
        ((profile, app) => {
          const web3Provider = {
            async sendAsync (payload, callback) {
              try {
                const result = await app.call(profile.name, 'sendAsync', payload)
                callback(null, result)
              } catch (e) {
                callback(e)
              }
            }
          }
          app.blockchain.addProvider({ name: profile.displayName, provider: web3Provider })
        })(profile, this)
      }
    }
    const removePluginProvider = (profile) => {
      if (profile.kind === 'provider') this.blockchain.removeProvider(profile.displayName)
    }
    this._addPluginProvider = (profile) => addPluginProvider(profile)
    this._removePluginProvider = (profile) => removePluginProvider(profile)
    this.on('manager', 'pluginActivated', this._addPluginProvider)
    this.on('manager', 'pluginDeactivated', this._removePluginProvider)
    // A deployed-instance card is bound to the workspace (and network) it was
    // created in; switching workspace must clear them — otherwise the old
    // workspace's instances stay visible and the user can fire transactions at a
    // stale address/network. Mirrors compile-tab resetting results on switch.
    this._onWorkspaceChanged = () => {
      this.event.trigger('clearInstance', [])
      this._clearPublishedDeployment('workspace-changed')
    }
    this.on('filePanel', 'setWorkspace', this._onWorkspaceChanged)
    this._managerEventSubscriptionsRegistered = true
    const container = this.renderContainer()
    this._requestProtocolCapabilities(false).catch((error) => console.debug('[udapp] protocol capability refresh failed:', error))
    return container
  }

  onDeactivation () {
    this._protocolCapabilityRequestId++
    this._clearManagerEventSubscriptions()
    this._removeExternalListeners()
    if (this.settingsUI && this.settingsUI.destroy) this.settingsUI.destroy()
    this._onNewTransaction = null
    this._onContractDeploymentStarted = null
    this._onContractDeploymentCompleted = null
    this._onBlockchainContextChanged = null
    this._onBlockchainNetworkStatus = null
    this._onWorkspaceChanged = null
    this._onCurrentFileChanged = null
    this._addPluginProvider = null
    this._removePluginProvider = null
  }
}
