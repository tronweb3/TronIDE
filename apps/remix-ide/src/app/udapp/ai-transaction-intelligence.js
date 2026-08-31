/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

const TRON_EXPLORERS = Object.freeze({
  main: 'https://tronscan.org/#/transaction/',
  nile: 'https://nile.tronscan.org/#/transaction/',
  shasta: 'https://shasta.tronscan.org/#/transaction/'
})

const KNOWN_NETWORKS = Object.freeze({
  main: 'TRON Mainnet',
  nile: 'TRON Nile',
  shasta: 'TRON Shasta'
})

export function normalizeAIProviderSelection (value) {
  const provider = String(value || '').trim()
  if (!provider) return null
  return provider === 'vm' || provider.startsWith('vm-') ? 'vm' : provider
}

// The Deploy & Run selector updates before an asynchronous TronLink permission /
// provider switch has finished. An AI request submitted in that short window must
// wait for the selected provider to become active instead of reporting the old VM
// as if it were the user's final choice.
export async function waitForAIExecutionContext ({ getActiveProvider, getSelectedProvider, timeoutMs = 10000, pollIntervalMs = 50, wait } = {}) {
  const sleep = wait || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)))
  const readActive = () => normalizeAIProviderSelection(typeof getActiveProvider === 'function' ? getActiveProvider() : null)
  const readSelected = () => normalizeAIProviderSelection(typeof getSelectedProvider === 'function' ? getSelectedProvider() : null)
  let activeProvider = readActive()
  let selectedProvider = readSelected()
  let waitedMs = 0

  while (selectedProvider && selectedProvider !== activeProvider && waitedMs < timeoutMs) {
    const delay = Math.min(pollIntervalMs, timeoutMs - waitedMs)
    await sleep(delay)
    waitedMs += delay
    activeProvider = readActive()
    selectedProvider = readSelected()
  }

  return {
    activeProvider,
    selectedProvider,
    settled: !selectedProvider || selectedProvider === activeProvider,
    waitedMs
  }
}

export function sanitizeAIEndpoint (endpoint) {
  if (!endpoint) return null
  try {
    const parsed = new URL(String(endpoint))
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return null
    // Host/path credentials and API-key query parameters must never enter the
    // AI tool transcript. Origin is enough to identify the active provider.
    return `${parsed.protocol}//${parsed.host}`
  } catch (e) { return null }
}

export function sanitizeAIErrorMessage (error) {
  if (!error) return null
  const text = String(error.message || error)
    .replace(/\b(?:https?|wss?):\/\/[^\s)]+/gi, (url) => sanitizeAIEndpoint(url) || '[redacted endpoint]')
    .replace(/\b(api[_-]?key|token|secret|authorization)=([^\s&]+)/gi, '$1=[redacted]')
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 300) || null
}

// Network identity is security-sensitive: accept only the genesis-derived ID
// produced by ExecutionContext. Never infer mainnet/Nile/Shasta from a host,
// provider label, account, or a previous task.
export function normalizeAIEnvironment ({ provider, networkStatus, walletState, accounts = [], selectedAccount, endpoint } = {}) {
  const providerKind = String(provider || 'unknown')
  if (providerKind === 'vm') {
    return {
      provider: 'vm',
      network: { known: true, stale: false, id: 'vm', name: 'JavaScript VM (Tron)' },
      walletState: 'not_applicable',
      accounts,
      selectedAccount: selectedAccount || accounts[0] || null,
      endpoint: null,
      error: null
    }
  }

  const raw = networkStatus && networkStatus.network ? networkStatus.network : networkStatus
  const rawId = raw && raw.id != null ? String(raw.id).toLowerCase() : ''
  const known = Object.prototype.hasOwnProperty.call(KNOWN_NETWORKS, rawId)
  return {
    provider: providerKind,
    network: {
      known,
      stale: !!(raw && raw.stale),
      id: known ? rawId : null,
      name: known ? KNOWN_NETWORKS[rawId] : ((raw && raw.name && String(raw.name)) || 'Unknown')
    },
    walletState: walletState || (accounts.length ? 'connected' : 'unknown'),
    accounts,
    selectedAccount: selectedAccount || accounts[0] || null,
    endpoint: sanitizeAIEndpoint(endpoint),
    error: sanitizeAIErrorMessage(networkStatus && networkStatus.error)
  }
}

// A transaction hash only has meaning on the provider/network where it was
// broadcast. Status polling must therefore keep a fixed, genesis-derived
// identity for its whole lifetime; otherwise a wallet switch can query the new
// node while still rendering the old network's metadata and explorer link.
export function createAITransactionEnvironmentFingerprint (environment = {}) {
  const provider = String(environment.provider || '').trim()
  const network = environment.network || {}
  const networkId = network.id == null ? '' : String(network.id).trim().toLowerCase()
  const endpoint = sanitizeAIEndpoint(environment.endpoint)
  const providerTransitionPending = environment.providerTransition?.pending === true
  const valid = Boolean(
    provider &&
    provider !== 'unknown' &&
    networkId &&
    networkId !== 'unknown' &&
    network.stale !== true &&
    network.known !== false &&
    !providerTransitionPending
  )
  return { provider, networkId, endpoint, valid }
}

export function compareAITransactionEnvironmentFingerprints (expected, current) {
  if (!expected?.valid || !current?.valid) {
    return { ok: false, reason: 'The active provider or network could not be verified.' }
  }
  if (expected.provider !== current.provider) {
    return { ok: false, reason: 'The active provider changed during transaction status lookup.' }
  }
  if (expected.networkId !== current.networkId) {
    return { ok: false, reason: 'The active network changed during transaction status lookup.' }
  }
  if (expected.endpoint !== current.endpoint) {
    return { ok: false, reason: 'The active node endpoint changed during transaction status lookup.' }
  }
  return { ok: true, reason: null }
}

export function tronScanTransactionUrl (networkId, txHash) {
  const id = networkId && String(networkId).toLowerCase()
  const hash = txHash && String(txHash).trim().replace(/^0x/, '')
  return id && hash && TRON_EXPLORERS[id] ? TRON_EXPLORERS[id] + hash : null
}

const receiptResult = (receipt) => {
  if (!receipt) return undefined
  if (receipt.status !== undefined) return receipt.status
  if (receipt.result !== undefined && typeof receipt.result !== 'object') return receipt.result
  if (receipt.receipt && receipt.receipt.result !== undefined) return receipt.receipt.result
  if (receipt.contractResult && receipt.contractResult.result !== undefined) return receipt.contractResult.result
  return undefined
}

const classifyReceipt = (receipt) => {
  const value = receiptResult(receipt)
  if (value === true || value === 1 || value === '0x1') return 'success'
  if (value === false || value === 0 || value === '0x0') return 'reverted'
  const upper = value == null ? '' : String(value).toUpperCase()
  if (upper === 'SUCCESS' || upper === 'SUCCEEDED') return 'success'
  if (upper === 'FAILED' || upper === 'REVERT' || upper === 'REVERTED' || upper.includes('OUT_OF_')) return 'reverted'
  // TRON gettransactioninfobyid only returns a populated object after the
  // transaction has entered a block. A receipt without an explicit failure is
  // therefore a successful inclusion (the same convention Web3Provider uses).
  if (receipt.id || receipt.blockNumber != null || receipt.block_number != null || receipt.transactionHash) return 'success'
  return 'unknown'
}

export function normalizeAITransactionStatus ({ txHash, networkId, transaction, receipt, error } = {}) {
  const hash = String(txHash || '').trim().replace(/^0x/, '')
  let status
  if (error) status = 'unknown'
  else if (receipt && Object.keys(receipt).length) status = classifyReceipt(receipt)
  else if (transaction && Object.keys(transaction).length) status = 'pending'
  else status = 'not_found'

  const result = {
    ok: status !== 'unknown',
    txHash: hash,
    status,
    blockNumber: (receipt && (receipt.blockNumber ?? receipt.block_number)) ?? null,
    energyUsed: (receipt && (receipt.energy_usage_total ?? receipt.receipt?.energy_usage_total)) ?? null,
    feeSun: (receipt && receipt.fee) ?? null,
    explorerUrl: tronScanTransactionUrl(networkId, hash),
    error: sanitizeAIErrorMessage(error)
  }
  if (status === 'pending' || status === 'unknown') {
    result.userAction = 'Wait, then query this transaction hash again. Do not resubmit the transaction blindly.'
  } else if (status === 'not_found') {
    result.userAction = 'Verify the transaction hash and selected network before considering any resubmission.'
  }
  return result
}

// A broadcast can be visible through getTransaction a few seconds before its
// receipt is indexed. Resolve that short propagation window here so the first
// status check after deploy does not turn a successful transaction into a
// misleading final "PENDING" summary. This remains read-only and never retries
// or resubmits the transaction itself.
export async function waitForAITransactionFinality ({ lookup, maxAttempts = 6, pollIntervalMs = 2000, wait } = {}) {
  if (typeof lookup !== 'function') throw new Error('A transaction status lookup is required.')
  const attempts = Math.max(1, Math.min(6, Number.isFinite(maxAttempts) ? Math.floor(maxAttempts) : 6))
  const interval = Math.max(0, Math.min(5000, Number.isFinite(pollIntervalMs) ? Math.floor(pollIntervalMs) : 2000))
  const sleep = wait || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)))
  let result

  for (let attempt = 1; attempt <= attempts; attempt++) {
    result = await lookup()
    if (!result || result.status !== 'pending' || attempt === attempts) {
      return { ...result, lookupAttempts: attempt }
    }
    await sleep(interval)
  }

  return { ...result, lookupAttempts: attempts }
}

// Convert a decimal TRX balance to SUN without floating-point rounding. This
// is used only for a conservative affordability check in preflight.
export function trxBalanceToSun (balance) {
  const text = String(balance == null ? '' : balance).trim()
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null
  const parts = text.split('.')
  const fraction = (parts[1] || '').padEnd(6, '0').slice(0, 6)
  try { return (BigInt(parts[0]) * BigInt(1000000) + BigInt(fraction || 0)).toString() } catch (e) { return null }
}

export function formatAIPreflightSummary (report = {}) {
  const env = report.environment || {}
  const network = env.network || {}
  const estimate = report.resourceEstimate || {}
  const issues = Array.isArray(report.issues) ? report.issues : []
  let feeLimit = 'unavailable'
  if (report.feeLimitSun != null) {
    const sun = String(report.feeLimitSun)
    try {
      const raw = BigInt(sun)
      const whole = raw / BigInt(1000000)
      const fraction = (raw % BigInt(1000000)).toString().padStart(6, '0').replace(/0+$/, '')
      feeLimit = `${sun} SUN (${whole.toString()}${fraction ? '.' + fraction : ''} TRX maximum)`
    } catch (e) {
      feeLimit = `${sun} SUN`
    }
  }
  const lines = [
    `Environment: ${network.name || 'Unknown'} (${env.provider || 'unknown'})`,
    `From: ${report.from || '(unavailable)'}`,
    `Value: ${report.valueSun || '0'} SUN`,
    `Balance: ${report.balanceTrx != null ? report.balanceTrx + ' TRX' : 'unavailable'}`,
    `Fee limit: ${feeLimit}`,
    `Energy estimate: ${estimate.status === 'available' ? estimate.energyRequired : 'unavailable'}`
  ]
  if (issues.length) lines.push(`Issues: ${issues.map((item) => item.message).join('; ')}`)
  return lines.join('\n')
}

const canonicalize = (value) => {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value).sort().reduce((out, key) => {
    if (value[key] !== undefined) out[key] = canonicalize(value[key])
    return out
  }, {})
}

export function createAIApprovalSnapshot ({ environment, operation, target, from, valueSun, tokenId, tokenValue, feeLimitSun } = {}) {
  const network = environment && environment.network ? environment.network : {}
  return canonicalize({
    schemaVersion: 1,
    operation: operation || null,
    provider: (environment && environment.provider) || 'unknown',
    networkId: network.id || null,
    networkKnown: network.known === true,
    networkStale: network.stale === true,
    account: from || null,
    target: target || null,
    valueSun: valueSun == null ? '0' : String(valueSun),
    tokenId: tokenId == null ? null : String(tokenId),
    tokenValue: tokenValue == null ? null : String(tokenValue),
    feeLimitSun: feeLimitSun == null ? null : String(feeLimitSun)
  })
}

export function compareAIApprovalSnapshots (approved, current) {
  if (!approved || !current || approved.schemaVersion !== 1 || current.schemaVersion !== 1) {
    return { ok: false, reason: 'The approval snapshot is missing or unsupported.' }
  }
  const approvedText = JSON.stringify(canonicalize(approved))
  const currentText = JSON.stringify(canonicalize(current))
  return approvedText === currentText
    ? { ok: true, reason: null }
    : { ok: false, reason: 'The network, account, transaction parameters, fee limit, or compiled artifact changed after approval.' }
}
