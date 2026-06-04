import { BN } from 'ethereumjs-util'
import { parseSafeInteger, validateBigIntegerField, validateTrc10Inputs } from './txIntegerUtils'
import { normalizeWalletError, WALLET_ERROR_CODES, WALLET_ERROR_MESSAGES } from './walletProviderAdapter'

export type RuntimeKind = 'evm' | 'tvm' | 'unknown'
export type RuntimeEnvironment = 'vm' | 'injected' | 'http' | 'custom' | 'unknown'

export interface RuntimeContext {
  kind: RuntimeKind
  environment: RuntimeEnvironment
  network?: string
  account?: string
  provider?: unknown
}

type RuntimeIntegerInput = BN | string | number

export interface RuntimeTransactionInput {
  tokenId?: RuntimeIntegerInput
  tokenValue?: RuntimeIntegerInput
  feeLimit?: unknown
  callValue?: unknown
  from?: string
  to?: string
  data?: string
  network?: string
}

export interface RuntimeTransactionSnapshot {
  account?: string
  network?: string
}

export interface RuntimeTransactionSummary {
  from?: string
  to: string
  network?: string
  feeLimit?: unknown
  callValue?: unknown
  tokenId?: unknown
  tokenValue?: unknown
  dataPreview?: string
}

export interface RuntimeTransactionValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

export interface RuntimeReceiptLike {
  transactionHash?: string
  tx?: string
  txID?: string
  status?: string | boolean
  result?: string
  receipt?: {
    result?: string
  }
  error?: unknown
  [key: string]: unknown
}

export interface NormalizedRuntimeReceipt {
  transactionHash: string
  status: 'success' | 'failure' | 'unknown'
  raw: RuntimeReceiptLike
  error?: ReturnType<typeof normalizeWalletError>
}

export interface RuntimeTraceStrategy {
  supportsTrace: boolean
  fallback: 'debug-rpc' | 'unsupported'
  reason?: string
  source: 'primary' | 'fallback' | 'unsupported'
  label: string
}

export interface RuntimeFacade {
  readonly context: RuntimeContext
  validateTransaction(input: RuntimeTransactionInput): RuntimeTransactionValidationResult
  createTransactionSummary(input: RuntimeTransactionInput): RuntimeTransactionSummary
  createTransactionSnapshot(input?: RuntimeTransactionInput): RuntimeTransactionSnapshot
  validatePendingTransaction(snapshot: RuntimeTransactionSnapshot, current?: RuntimeTransactionSnapshot): RuntimeTransactionValidationResult
  normalizeReceipt(receipt: RuntimeReceiptLike): NormalizedRuntimeReceipt
  normalizeError(error: unknown): ReturnType<typeof normalizeWalletError>
  getTraceStrategy(): RuntimeTraceStrategy
}

export class DefaultRuntimeFacade implements RuntimeFacade {
  readonly context: RuntimeContext

  constructor (context: Partial<RuntimeContext> = {}) {
    this.context = {
      kind: context.kind || 'unknown',
      environment: context.environment || 'unknown',
      network: context.network,
      account: context.account,
      provider: context.provider
    }
  }

  validateTransaction (input: RuntimeTransactionInput): RuntimeTransactionValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    try {
      const trc10Error = validateTrc10Inputs(input.tokenId || 0, input.tokenValue || 0)
      if (trc10Error) errors.push(trc10Error)
    } catch (error) {
      errors.push(error && error.message ? error.message : String(error))
    }

    // feeLimit stays within the safe-integer range (a TRON sun fee cap). callValue
    // is a 256-bit wei/sun amount (e.g. 1e18 wei on the JS VM) and must NOT be
    // capped at 2^53-1 — only its non-negative integer format is validated.
    if (input.feeLimit !== undefined && input.feeLimit !== null && (input.feeLimit as unknown) !== '') {
      try {
        parseSafeInteger(input.feeLimit as string | number, 10, 'feeLimit')
      } catch (error) {
        errors.push(error && error.message ? error.message : String(error))
      }
    }
    if (input.callValue !== undefined && input.callValue !== null && (input.callValue as unknown) !== '') {
      const callValueError = validateBigIntegerField(input.callValue as string | number, 'callValue')
      if (callValueError) errors.push(callValueError)
    }

    if (this.context.environment === 'injected' && !this.context.account && !input.from) {
      warnings.push('No active injected account is available for this transaction.')
    }

    return { ok: errors.length === 0, errors, warnings }
  }

  createTransactionSummary (input: RuntimeTransactionInput): RuntimeTransactionSummary {
    const data = typeof input.data === 'string' ? input.data : ''
    return {
      from: input.from || this.context.account,
      to: input.to || '(Contract Creation)',
      network: input.network || this.context.network,
      feeLimit: input.feeLimit,
      callValue: input.callValue,
      tokenId: input.tokenId,
      tokenValue: input.tokenValue,
      dataPreview: data.length > 66 ? `${data.slice(0, 66)}...` : data
    }
  }

  createTransactionSnapshot (input: RuntimeTransactionInput = {}): RuntimeTransactionSnapshot {
    return {
      account: input.from || this.context.account,
      network: input.network || this.context.network
    }
  }

  validatePendingTransaction (snapshot: RuntimeTransactionSnapshot, current: RuntimeTransactionSnapshot = {}): RuntimeTransactionValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    // Account is read synchronously from the injected provider, so a snapshot account that no
    // longer matches the current one — whether it changed OR vanished (disconnect/lock during the
    // pending signature) — must abort the broadcast. Fail closed on the fund-critical signal.
    if (snapshot.account && snapshot.account !== current.account) {
      errors.push(WALLET_ERROR_MESSAGES[WALLET_ERROR_CODES.WALLET_ACCOUNT_CHANGED])
    }

    // Network can be detected asynchronously and may be transiently unavailable; only flag a
    // genuine mismatch when both sides are known to avoid false aborts on flaky detection.
    if (snapshot.network && current.network && snapshot.network !== current.network) {
      errors.push(WALLET_ERROR_MESSAGES[WALLET_ERROR_CODES.WALLET_NETWORK_CHANGED])
    }

    return { ok: errors.length === 0, errors, warnings }
  }

  normalizeReceipt (receipt: RuntimeReceiptLike): NormalizedRuntimeReceipt {
    const transactionHash = String(receipt.transactionHash || receipt.txID || receipt.tx || '')
    const result = String(receipt.receipt?.result || receipt.result || receipt.status || '').toUpperCase()
    const status = result === 'SUCCESS' || receipt.status === true
      ? 'success'
      : result === 'FAILED' || result === 'REVERT' || receipt.status === false
        ? 'failure'
        : 'unknown'

    return {
      transactionHash,
      status,
      raw: receipt,
      error: receipt.error ? normalizeWalletError(receipt.error) : undefined
    }
  }

  normalizeError (error: unknown) {
    return normalizeWalletError(error)
  }

  getTraceStrategy (): RuntimeTraceStrategy {
    const provider = this.context.provider as { supportsDebugTrace?: boolean } | undefined
    if (this.context.kind === 'tvm' && provider && provider.supportsDebugTrace === true) {
      return {
        supportsTrace: true,
        fallback: 'debug-rpc',
        source: 'fallback',
        label: 'TRON Debug RPC trace fallback'
      }
    }
    if (this.context.kind === 'tvm') {
      return {
        supportsTrace: false,
        fallback: 'unsupported',
        source: 'unsupported',
        label: 'TRON trace unavailable',
        reason: 'TRON trace unsupported by this RPC. Configure a TRON debug RPC endpoint to enable step debugging.'
      }
    }
    return {
      supportsTrace: false,
      fallback: 'unsupported',
      source: 'unsupported',
      label: 'Runtime trace unavailable',
      reason: 'Runtime trace capability is unknown for this execution environment.'
    }
  }
}

export function createRuntimeFacade (context: Partial<RuntimeContext> = {}): RuntimeFacade {
  return new DefaultRuntimeFacade(context)
}
