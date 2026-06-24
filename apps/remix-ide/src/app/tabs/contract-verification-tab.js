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
  methods: [],
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
    padding: 0 16px 20px;
  }
  .intro {
    border: 1px solid var(--light);
    border-left: 4px solid #C8302D;
    background: var(--body-bg);
    padding: 12px;
    margin-bottom: 12px;
    line-height: 1.45;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 12px;
    color: var(--secondary);
  }
  .input,
  .select {
    border: 1px solid var(--secondary);
    background: var(--input, #35384C);
    color: var(--text, #dfe1ea);
    padding: 8px 10px;
    width: 100%;
  }
  .input::placeholder {
    color: var(--secondary);
    opacity: 1;
  }
  .input:focus,
  .select:focus {
    border-color: #C8302D;
    background: var(--input, #35384C);
    color: var(--text, #dfe1ea);
    outline: 1px solid rgba(200, 48, 45, .25);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .button,
  .linkButton {
    border: 1px solid var(--light);
    background: var(--body-bg);
    color: var(--text);
    padding: 7px 10px;
    cursor: pointer;
    text-decoration: none;
  }
  .button:hover,
  .linkButton:hover {
    border-color: #C8302D;
    color: #C8302D;
    text-decoration: none;
  }
  .status {
    border: 1px solid var(--light);
    background: var(--body-bg);
    padding: 10px;
    min-height: 42px;
    line-height: 1.45;
    color: var(--secondary);
    word-break: break-word;
  }
  .status[data-status="ready"] {
    border-color: #28a745;
  }
  .status[data-status="error"] {
    border-color: #dc3545;
    color: #dc3545;
  }
  .note {
    color: var(--secondary);
    font-size: 12px;
    line-height: 1.45;
  }
  .checklist {
    border: 1px solid var(--light);
    background: var(--body-bg);
    padding: 10px 12px;
    margin: 0;
    color: var(--secondary);
    font-size: 12px;
    line-height: 1.5;
  }
  .checklist li {
    margin: 2px 0;
  }
`

export class ContractVerificationTab extends ViewPlugin {
  constructor () {
    super(profile)
    this.el = null
    this.state = {
      network: 'mainnet',
      contractAddress: '',
      status: 'Enter a deployed TRON contract address, then check TronScan or generate a package from the latest compilation.',
      statusType: 'idle',
      packageText: ''
    }
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
    this.update()
  }

  getTarget () {
    return this.tronScanTargets[this.state.network] || this.tronScanTargets.mainnet
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
      const history = JSON.parse(window.localStorage.getItem('tronide.contractVerification.history') || '[]')
      history.unshift({
        network: packageData.network,
        contractAddress: packageData.contractAddress,
        contractName: packageData.contractName,
        compilerVersion: packageData.compilerVersion,
        generatedAt: packageData.generatedAt
      })
      window.localStorage.setItem('tronide.contractVerification.history', JSON.stringify(history.slice(0, 5)))
    } catch (error) {
      console.debug('[contractVerification] failed to persist package history', error)
    }
  }

  getPackageHistory () {
    try {
      return JSON.parse(window.localStorage.getItem('tronide.contractVerification.history') || '[]')
    } catch (error) {
      console.debug('[contractVerification] failed to read package history', error)
      return []
    }
  }

  getLatestCompilation () {
    const artefacts = globalRegistry.get('compilersartefacts')
    const compilerData = artefacts && artefacts.api && artefacts.api.get ? artefacts.api.get('__last') : null
    if (!compilerData || !compilerData.getContracts) return null
    const contracts = compilerData.getContracts() || {}
    const source = compilerData.getSourceCode ? compilerData.getSourceCode() : {}
    const fileName = Object.keys(contracts)[0]
    if (!fileName) return null
    const contractName = Object.keys(contracts[fileName] || {})[0]
    if (!contractName) return null
    return {
      compilerVersion: compilerData.languageversion,
      contractName,
      fileName,
      contract: contracts[fileName][contractName],
      source
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

  createVerificationPackage () {
    const compilation = this.getLatestCompilation()
    if (!compilation) {
      throw new Error('Compile a Solidity contract first, then generate the TronScan verification package.')
    }
    const contractAddress = (this.state.contractAddress || '').trim()
    if (!contractAddress) {
      throw new Error('Enter the deployed TRON contract address before generating the package; a package without an address cannot be submitted to TronScan.')
    }
    if (!isValidTronAddress(contractAddress)) {
      throw new Error('Invalid TRON contract address. Enter a base58check T... or 41... hex address before generating the package.')
    }
    const settings = this.readCompilationSettings(compilation.contract)
    const sourceFiles = compilation.source && compilation.source.sources ? compilation.source.sources : {}
    return JSON.stringify({
      tool: 'TronIDE Contract Verification MVP',
      network: this.getTarget().label,
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
      note: 'TronScan source submission remains a manual external step; paste the matching source/settings on the TronScan verification page.'
    }, null, 2)
  }

  generatePackage () {
    try {
      this.state.packageText = this.createVerificationPackage()
      this.savePackageHistory(this.state.packageText)
      this.setStatus('Verification package generated from the latest compilation. Copy or download it, then submit manually on TronScan.', 'ready')
    } catch (error) {
      this.setStatus(error.message || error, 'error')
    }
  }

  async copyPackage () {
    try {
      const packageText = this.state.packageText || this.createVerificationPackage()
      this.state.packageText = packageText
      this.savePackageHistory(packageText)
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(packageText)
        this.setStatus('Verification package copied. Open TronScan and paste the matching source/settings there.', 'ready')
      } else {
        this.downloadPackage()
      }
    } catch (error) {
      this.setStatus(error.message || error, 'error')
    }
  }

  downloadPackage () {
    try {
      const packageText = this.state.packageText || this.createVerificationPackage()
      this.state.packageText = packageText
      this.savePackageHistory(packageText)
      const node = document.createElement('a')
      node.download = 'tronide-contract-verification-package.json'
      node.rel = 'noopener'
      node.href = URL.createObjectURL(new Blob([packageText], { type: 'application/json' }))
      setTimeout(function () { URL.revokeObjectURL(node.href) }, 4E4)
      node.dispatchEvent(new MouseEvent('click'))
      this.setStatus('Verification package downloaded. Use it as the source/settings checklist on TronScan.', 'ready')
    } catch (error) {
      this.setStatus(error.message || error, 'error')
    }
  }

  async checkStatus () {
    const address = this.state.contractAddress.trim()
    if (!address) {
      this.setStatus('Enter a deployed TRON contract address before checking TronScan status.', 'error')
      return
    }
    if (!isValidTronAddress(address)) {
      this.setStatus('Invalid TRON address. Enter a base58check address starting with "T" (34 chars) or a 41... hex address.', 'error')
      return
    }
    this.setStatus('Checking TronScan contract status...', 'loading')
    // TronScan only matches the base58 form, so query with it even when the user
    // typed a 41.../0x hex address (otherwise a real contract reads as not-found).
    const queryAddress = toBase58Address(address)
    const target = this.getTarget()
    const contractApis = target.apis || (target.api ? [target.api] : [])
    const queries = contractApis.flatMap((api) => [`${api}?contract=${encodeURIComponent(queryAddress)}`, `${api}?address=${encodeURIComponent(queryAddress)}`])
    try {
      let contract = null
      let reachedEndpoint = false
      let lastError = null
      for (const query of queries) {
        try {
          const response = await window.fetch(query)
          if (response.ok) {
            reachedEndpoint = true
            const payload = await response.json()
            contract = extractContractFromStatusPayload(payload)
            if (contract) break
            console.debug('[contractVerification] contract status endpoint reported no contract for the address', query, payload)
            continue
          }
          lastError = new Error(`TronScan endpoint returned ${response.status}`)
          console.debug('[contractVerification] contract status endpoint returned a non-OK status', query, response.status)
        } catch (error) {
          lastError = error
          console.debug('[contractVerification] contract status endpoint failed', query, error)
        }
      }
      if (!contract) {
        // We could reach TronScan but it has no contract record for this
        // (valid-format) address: report "not found" rather than a found/error.
        if (reachedEndpoint) {
          this.setStatus('TronScan has no contract at this address on the selected network. Check the address and network, or confirm the contract is deployed.', 'error')
          return
        }
        throw lastError || new Error('TronScan did not return a readable contract response.')
      }
      const verified = contract && (contract.verify_status === 2 || contract.verifyStatus === 2 || contract.contractInfo || contract.source_code || contract.sourceCode)
      const name = contract && (contract.name || contract.contractName || contract.contract_name)
      this.setStatus(verified ? `TronScan reports this contract as verified${name ? `: ${name}` : ''}.` : 'TronScan found the contract, but source verification is not detected yet.', verified ? 'ready' : 'idle')
    } catch (error) {
      this.setStatus(`Unable to query TronScan from this browser session. Open TronScan manually or try again later. ${error.message || error}`, 'error')
    }
  }

  renderComponent () {
    return yo`
      <div class=${css.container} data-id="contractVerificationPlugin">
        <div class=${css.intro}>
          <strong>TronScan verification MVP</strong><br />
          Query public contract status, generate a local package from the latest Solidity compilation, then submit manually on TronScan.
        </div>
        <div class=${css.form} aria-label="TronScan verification MVP">
          <label class=${css.field}>
            Network
            <select class=${css.select} data-id="contractVerificationNetworkSelect" onchange=${(event) => { this.state.network = event.target.value; this.update() }}>
              ${Object.keys(this.tronScanTargets).map((key) => yo`<option value=${key} selected=${this.state.network === key}>${this.tronScanTargets[key].label}</option>`)}
            </select>
          </label>
          <label class=${css.field}>
            Contract address
            <input class=${css.input} data-id="contractVerificationAddressInput" placeholder="Base58 T... or 41... hex" value=${this.state.contractAddress} oninput=${(event) => { this.state.contractAddress = event.target.value }} />
          </label>
          <div class=${css.actions}>
            <button class=${css.button} data-id="contractVerificationCheckStatus" onclick=${() => this.checkStatus()}>Check status</button>
            <button class=${css.button} data-id="contractVerificationGeneratePackage" onclick=${() => this.generatePackage()}>Generate package</button>
            <button class=${css.button} data-id="contractVerificationCopyPackage" onclick=${() => this.copyPackage()}>Copy package</button>
            <button class=${css.button} data-id="contractVerificationDownloadPackage" onclick=${() => this.downloadPackage()}>Download JSON</button>
            <a class=${css.linkButton} data-id="contractVerificationOpenTronScan" aria-label="Open verification lookup" target="_blank" rel="noopener noreferrer" href=${this.getTarget().verify}>Open TronScan</a>
          </div>
          <div class=${css.status} data-id="contractVerificationStatusResult" data-status=${this.state.statusType}>${this.state.status}</div>
          <ul class=${css.checklist} data-id="contractVerificationPackageChecklist">
            <li>Compile the exact source that was deployed.</li>
            <li>Confirm network and contract address before opening TronScan.</li>
            <li>Use the generated Standard JSON input, optimizer, library, and compiler version fields.</li>
            <li>Copy or download the package before leaving this browser session.</li>
          </ul>
          ${this.getPackageHistory().length ? yo`
            <div class=${css.note} data-id="contractVerificationPackageHistory">
              Recent packages: ${this.getPackageHistory().map((item) => `${item.contractName || 'contract'} · ${item.network || 'network'} · ${item.generatedAt || ''}`).join(' | ')}
            </div>
          ` : ''}
          <div class=${css.note}>TronScan source submission remains a manual external step. TronIDE does not store API keys or verification receipts in this MVP.</div>
          <div class=${css.note}>Sourcify, Etherscan, Blockscout, and Routescan are EVM services and are not marked available for TRON verification in this release.</div>
        </div>
      </div>
    `
  }
}

export default ContractVerificationTab
