export const WALLET_STATUS = {
  unavailable: 'unavailable',
  locked: 'locked',
  unauthorized: 'unauthorized',
  connecting: 'connecting',
  connected: 'connected',
  disconnected: 'disconnected',
  wrongNetwork: 'wrongNetwork',
  error: 'error'
} as const

export const WALLET_ERROR_CODES = {
  WALLET_DISCONNECTED: 'WALLET_DISCONNECTED',
  WALLET_CONNECTION_REJECTED: 'WALLET_CONNECTION_REJECTED',
  USER_REJECTED: 'USER_REJECTED',
  WALLET_LOCKED: 'WALLET_LOCKED',
  WALLET_UNAUTHORIZED: 'WALLET_UNAUTHORIZED',
  WALLET_REQUEST_TIMEOUT: 'WALLET_REQUEST_TIMEOUT',
  WALLET_UNAVAILABLE: 'WALLET_UNAVAILABLE',
  WALLET_ACCOUNT_CHANGED: 'WALLET_ACCOUNT_CHANGED',
  WALLET_NETWORK_CHANGED: 'WALLET_NETWORK_CHANGED',
  WALLET_WRONG_NETWORK: 'WALLET_WRONG_NETWORK',
  WALLET_CAPABILITY_MISSING: 'WALLET_CAPABILITY_MISSING',
  WALLET_ADDRESS_INVALID: 'WALLET_ADDRESS_INVALID',
  WALLET_SIGN_REJECTED: 'WALLET_SIGN_REJECTED',
  WALLET_SIGN_TIMEOUT: 'WALLET_SIGN_TIMEOUT',
  WALLET_BROADCAST_FAILED: 'WALLET_BROADCAST_FAILED',
  WALLET_UNKNOWN_ERROR: 'WALLET_UNKNOWN_ERROR'
} as const

export const WALLET_ERROR_MESSAGES = {
  [WALLET_ERROR_CODES.WALLET_DISCONNECTED]: 'Wallet disconnected. Please reconnect TronLink.',
  [WALLET_ERROR_CODES.WALLET_CONNECTION_REJECTED]: 'Connection request was rejected.',
  [WALLET_ERROR_CODES.USER_REJECTED]: 'Confirmation declined by user.',
  [WALLET_ERROR_CODES.WALLET_LOCKED]: 'Please unlock TronLink and try again.',
  // A locked wallet and an unauthorized site are indistinguishable from the
  // page (TronLink reports ready=false with no address in both cases), so
  // this message covers both states (TC-WAL-002/003).
  [WALLET_ERROR_CODES.WALLET_UNAUTHORIZED]: 'Please unlock TronLink and approve the connection to this site.',
  [WALLET_ERROR_CODES.WALLET_REQUEST_TIMEOUT]: 'Wallet request timed out. Please try again.',
  [WALLET_ERROR_CODES.WALLET_UNAVAILABLE]: 'TronLink is not available in this browser.',
  [WALLET_ERROR_CODES.WALLET_ACCOUNT_CHANGED]: 'Wallet account changed. Please reconnect TronLink.',
  [WALLET_ERROR_CODES.WALLET_NETWORK_CHANGED]: 'Wallet network changed. Please review the selected network.',
  [WALLET_ERROR_CODES.WALLET_WRONG_NETWORK]: 'Wallet network does not match the selected TronIDE environment.',
  [WALLET_ERROR_CODES.WALLET_CAPABILITY_MISSING]: 'Wallet action unsupported. Please update TronLink or use another provider.',
  [WALLET_ERROR_CODES.WALLET_ADDRESS_INVALID]: 'Unable to verify wallet address format. Please reconnect TronLink.',
  [WALLET_ERROR_CODES.WALLET_SIGN_REJECTED]: 'Transaction signature was rejected by the wallet.',
  [WALLET_ERROR_CODES.WALLET_SIGN_TIMEOUT]: 'Transaction signature timed out. Please try again.',
  [WALLET_ERROR_CODES.WALLET_BROADCAST_FAILED]: 'Transaction broadcast failed. Please verify the wallet network and try again.',
  [WALLET_ERROR_CODES.WALLET_UNKNOWN_ERROR]: 'Wallet request failed. Please try again.'
} as const

export type WalletStatus = typeof WALLET_STATUS[keyof typeof WALLET_STATUS]
export type WalletErrorCode = typeof WALLET_ERROR_CODES[keyof typeof WALLET_ERROR_CODES]

export interface NormalizedWalletError {
  code: WalletErrorCode
  message: string
  originalError?: unknown
}

// TronLink's tron_requestAccounts never settles when the bridge is dead — the
// extension was disabled or removed but window.tronLink / window.tronWeb still
// linger on the page until a reload. Without a bound the request hangs forever,
// so the module-level pendingConnectionRequest guard below never clears and
// every later caller (askPermission → connectInjectedTronWeb sign/deploy) is
// handed the same stuck promise. Cap the wait so the guard always releases and
// the connection can be retried (mirrors top-header's requestTronAccountsWithTimeout).
const WALLET_CONNECT_TIMEOUT_MS = 60000

let pendingConnectionRequest: Promise<string[]> | null = null

function requestAccountsWithTimeout (tronLink: any, scope: any, timeoutMs = WALLET_CONNECT_TIMEOUT_MS): Promise<unknown> {
  const setTimer = (scope && scope.setTimeout) || (typeof setTimeout !== 'undefined' ? setTimeout : undefined)
  const clearTimer = (scope && scope.clearTimeout) || (typeof clearTimeout !== 'undefined' ? clearTimeout : undefined)
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimer
      ? setTimer(() => {
        if (settled) return
        settled = true
        reject(createWalletError(WALLET_ERROR_CODES.WALLET_REQUEST_TIMEOUT))
      }, timeoutMs)
      : undefined
    Promise.resolve()
      .then(() => tronLink.request({ method: 'tron_requestAccounts' }))
      .then((value: unknown) => { if (settled) return; settled = true; if (clearTimer && timer !== undefined) clearTimer(timer); resolve(value) })
      .catch((error: unknown) => { if (settled) return; settled = true; if (clearTimer && timer !== undefined) clearTimer(timer); reject(error) })
  })
}

export function getInjectedWalletProvider (scope: any = typeof window !== 'undefined' ? window : undefined) {
  if (!scope) return { tronLink: null, tronWeb: null }
  return {
    tronLink: scope.tronLink || null,
    tronWeb: scope.tronWeb || null
  }
}

export function getInjectedWalletStatus (scope: any = typeof window !== 'undefined' ? window : undefined): WalletStatus {
  const { tronLink, tronWeb } = getInjectedWalletProvider(scope)
  if (!tronLink || !tronWeb) return WALLET_STATUS.unavailable

  const account = tronWeb.defaultAddress && tronWeb.defaultAddress.base58
  if (tronLink.ready && account) return WALLET_STATUS.connected
  if (tronLink.ready === false && account) return WALLET_STATUS.disconnected
  if (tronLink.ready === false) return WALLET_STATUS.unauthorized
  if (!account) return WALLET_STATUS.locked
  return WALLET_STATUS.error
}

export function clearInjectedWalletConnectionGuard () {
  pendingConnectionRequest = null
}

export async function requestInjectedWalletAccounts (scope: any = typeof window !== 'undefined' ? window : undefined): Promise<string[]> {
  const { tronLink, tronWeb } = getInjectedWalletProvider(scope)
  if (!tronLink || !tronWeb) throw createWalletError(WALLET_ERROR_CODES.WALLET_UNAVAILABLE)

  const account = tronWeb.defaultAddress && tronWeb.defaultAddress.base58
  if (tronLink.ready && account) return [account]
  if (pendingConnectionRequest) return pendingConnectionRequest

  pendingConnectionRequest = Promise.resolve()
    .then(async () => {
      if (!tronLink.request) throw createWalletError(WALLET_ERROR_CODES.WALLET_UNAVAILABLE)
      await requestAccountsWithTimeout(tronLink, scope)
      const connectedAccount = tronWeb.defaultAddress && tronWeb.defaultAddress.base58
      if (!connectedAccount) throw createWalletError(WALLET_ERROR_CODES.WALLET_UNAUTHORIZED)
      return [connectedAccount]
    })
    .catch((error) => {
      throw createWalletError(normalizeWalletError(error).code, error)
    })
    .finally(() => {
      pendingConnectionRequest = null
    })

  return pendingConnectionRequest
}

export function createWalletError (code: WalletErrorCode, originalError?: unknown): Error & NormalizedWalletError {
  const normalized = normalizeWalletError(originalError || code)
  const finalCode = code || normalized.code
  const error = new Error(WALLET_ERROR_MESSAGES[finalCode] || normalized.message) as Error & NormalizedWalletError
  error.code = finalCode
  error.originalError = originalError
  return error
}

// Bound an injected-provider call that can hang forever against a zombie bridge
// (the extension was disabled/removed but window.tronWeb lingers, so the signing
// popup never answers and the await never settles). A hang rejects with a wallet
// timeout error — which the caller surfaces, clearing any stuck "pending…" /
// "Signing…" / blank-balance state so the user can retry — while a normal, fast
// call passes straight through. Timeouts are generous so a real slow op (an
// interactive signature, a congested node) is never cut short; only a genuinely
// dead bridge trips them. Shared by the injected provider and txRunner.
export const WALLET_SIGN_TIMEOUT_MS = 120000 // interactive: the user approves in the popup
export const WALLET_NODE_TIMEOUT_MS = 90000 // non-interactive node calls (balance, build, broadcast)

export function withWalletTimeout (operation: Promise<any>, timeoutMs: number, timeoutCode: WalletErrorCode): Promise<any> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<any>((resolve, reject) => {
    timer = setTimeout(() => reject(createWalletError(timeoutCode)), timeoutMs)
  })
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer))
}

export function normalizeWalletError (errorLike: any): NormalizedWalletError {
  if (errorLike && errorLike.code && WALLET_ERROR_MESSAGES[errorLike.code]) {
    return { code: errorLike.code, message: WALLET_ERROR_MESSAGES[errorLike.code], originalError: errorLike }
  }

  const rawMessage = extractWalletMessage(errorLike)
  const knownMessageCode = (Object.keys(WALLET_ERROR_MESSAGES) as WalletErrorCode[]).find((code) => WALLET_ERROR_MESSAGES[code] === rawMessage)
  if (knownMessageCode) {
    return { code: knownMessageCode, message: WALLET_ERROR_MESSAGES[knownMessageCode], originalError: errorLike }
  }
  const message = rawMessage.toLowerCase()
  const providerCode = typeof errorLike?.code === 'number' || typeof errorLike?.code === 'string' ? String(errorLike.code) : ''

  if (
    message.includes('sign') &&
    (providerCode === '4001' || message.includes('user rejected') || message.includes('rejected') || message.includes('declined') || message.includes('cancel'))
  ) {
    return toNormalizedError(WALLET_ERROR_CODES.WALLET_SIGN_REJECTED, errorLike)
  }

  if (message.includes('sign') && (message.includes('timeout') || message.includes('timed out'))) {
    return toNormalizedError(WALLET_ERROR_CODES.WALLET_SIGN_TIMEOUT, errorLike)
  }

  if (
    message.includes('broadcast') ||
    message.includes('sendrawtransaction') ||
    message.includes('send raw transaction') ||
    message.includes('transaction broadcast')
  ) {
    return toNormalizedError(WALLET_ERROR_CODES.WALLET_BROADCAST_FAILED, errorLike)
  }

  if (providerCode === '4001' || message.includes('user rejected') || message.includes('connection request was rejected') || message.includes('cancel')) {
    return toNormalizedError(WALLET_ERROR_CODES.WALLET_CONNECTION_REJECTED, errorLike)
  }

  if (message.includes('confirmation declined') || message.includes('declined by user') || message.includes('signature declined')) {
    return toNormalizedError(WALLET_ERROR_CODES.USER_REJECTED, errorLike)
  }

  if (message.includes('unlock') || message.includes('locked')) {
    return toNormalizedError(WALLET_ERROR_CODES.WALLET_LOCKED, errorLike)
  }

  if (message.includes('unauthorized') || message.includes('not authorized') || message.includes('connect tronlink')) {
    return toNormalizedError(WALLET_ERROR_CODES.WALLET_UNAUTHORIZED, errorLike)
  }

  if (message.includes('timeout') || message.includes('timed out')) {
    return toNormalizedError(WALLET_ERROR_CODES.WALLET_REQUEST_TIMEOUT, errorLike)
  }

  if (message.includes('disconnected') || message.includes('wallet_disconnected') || message === 'wallet disconnected') {
    return toNormalizedError(WALLET_ERROR_CODES.WALLET_DISCONNECTED, errorLike)
  }

  if (message.includes('account changed') || message.includes('accounts changed') || message.includes('selected account') || message.includes('active account')) {
    return toNormalizedError(WALLET_ERROR_CODES.WALLET_ACCOUNT_CHANGED, errorLike)
  }

  if (message.includes('wrong network') || message.includes('network mismatch') || message.includes('mismatched network') || message.includes('invalid network')) {
    return toNormalizedError(WALLET_ERROR_CODES.WALLET_WRONG_NETWORK, errorLike)
  }

  if (message.includes('network changed') || message.includes('chain changed') || message.includes('chainchanged') || message.includes('chainid changed') || message.includes('chain id changed')) {
    return toNormalizedError(WALLET_ERROR_CODES.WALLET_NETWORK_CHANGED, errorLike)
  }

  if (message.includes('unsupported') || message.includes('not supported') || message.includes('method not found') || providerCode === '4200') {
    return toNormalizedError(WALLET_ERROR_CODES.WALLET_CAPABILITY_MISSING, errorLike)
  }

  if (message.includes('invalid address') || message.includes('address format') || message.includes('base58')) {
    return toNormalizedError(WALLET_ERROR_CODES.WALLET_ADDRESS_INVALID, errorLike)
  }

  if (message.includes('no injected provider') || message.includes('tronlink is not available') || message.includes('provider not found')) {
    return toNormalizedError(WALLET_ERROR_CODES.WALLET_UNAVAILABLE, errorLike)
  }

  return {
    code: WALLET_ERROR_CODES.WALLET_UNKNOWN_ERROR,
    message: rawMessage && rawMessage !== '[object Object]' ? rawMessage : WALLET_ERROR_MESSAGES.WALLET_UNKNOWN_ERROR,
    originalError: errorLike
  }
}

function toNormalizedError (code: WalletErrorCode, originalError?: unknown): NormalizedWalletError {
  return { code, message: WALLET_ERROR_MESSAGES[code], originalError }
}

function extractWalletMessage (errorLike: any): string {
  if (errorLike === undefined || errorLike === null) return ''
  if (typeof errorLike === 'string') return errorLike
  if (errorLike.message) return String(errorLike.message)
  if (errorLike.error && errorLike.error.message) return String(errorLike.error.message)
  if (errorLike.result && errorLike.result.message) return String(errorLike.result.message)
  try {
    return JSON.stringify(errorLike)
  } catch (e) {
    return String(errorLike)
  }
}
