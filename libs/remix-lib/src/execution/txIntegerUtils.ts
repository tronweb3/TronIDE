'use strict'

import { BN } from 'ethereumjs-util'

export const TX_FIELD_LABELS = {
  transactionValue: 'Transaction value',
  feeLimit: 'Fee limit',
  tokenId: 'Token ID',
  tokenValue: 'Token value'
} as const

export const SAFE_INTEGER_RANGE_LABEL = 'safe integer range (2^53-1)'
export const TRC10_MIN_TOKEN_ID = 1000001

const SAFE_INTEGER_MAX = new BN(Number.MAX_SAFE_INTEGER.toString(), 10)
const DECIMAL_INTEGER_PATTERN = /^\d+$/
const DECIMAL_SIGNED_PATTERN = /^-?\d+$/
const HEX_INTEGER_PATTERN = /^(?:0[xX])?([0-9a-fA-F]+)$/
const ZERO_BN = new BN('0', 10)

// Whether `value` is something toBN can turn into an integer without surprises.
// Empty/`0x` are treated as 0 (legacy behaviour); anything else non-numeric is rejected.
function isParseableInteger (value: any): boolean {
  if (value == null) return true
  if (BN.isBN && BN.isBN(value)) return true
  if (typeof value === 'number') return Number.isFinite(value) && Number.isInteger(value)
  const str = String(value).trim()
  if (str === '' || str === '0x' || str === '0X') return true
  if (str.startsWith('0x') || str.startsWith('0X')) return HEX_INTEGER_PATTERN.test(str)
  return DECIMAL_SIGNED_PATTERN.test(str)
}

// Never throws: unparseable input degrades to 0 so callers (balance lookup, guards)
// surface a clean validation result instead of an uncaught BN "Invalid character" error.
function toBN (value: any): BN {
  if (value == null) return ZERO_BN
  if (BN.isBN && BN.isBN(value)) return value
  try {
    if (typeof value === 'object' && value.toString) return new BN(value.toString(10), 10)
    const str = String(value).trim()
    if (str === '' || str === '0x' || str === '0X') return ZERO_BN
    if (str.startsWith('0x') || str.startsWith('0X')) {
      return new BN(str.slice(2), 16)
    }
    return new BN(str, 10)
  } catch (e) {
    return ZERO_BN
  }
}

export function formatSafeIntegerRangeError (
  fieldName: string,
  resolution = 'Please use a smaller value.'
): string {
  return resolution
    ? `${fieldName} exceeds ${SAFE_INTEGER_RANGE_LABEL}. ${resolution}`
    : `${fieldName} exceeds ${SAFE_INTEGER_RANGE_LABEL}.`
}

export function validateTrc10Inputs (tokenId: BN | string | number, tokenValue: BN | string | number): string | null {
  if (!isParseableInteger(tokenId) || !isParseableInteger(tokenValue)) {
    return 'invalid argument'
  }

  const tokenIdBN = toBN(tokenId)
  const tokenValueBN = toBN(tokenValue)
  const trc10MinTokenIdBN = new BN(TRC10_MIN_TOKEN_ID.toString(), 10)

  if (tokenIdBN.lten(0) && tokenValueBN.lten(0)) return null

  if (tokenIdBN.gtn(0) && tokenIdBN.lt(trc10MinTokenIdBN)) {
    return 'invalid argument'
  }

  if (tokenValueBN.gtn(0) && tokenIdBN.lt(trc10MinTokenIdBN)) {
    return 'invalid argument'
  }

  if (tokenIdBN.gtn(0) && tokenValueBN.lten(0)) {
    return 'No asset'
  }

  return null
}

export function extractTrc10Balance (account: any, tokenId: string | number): BN {
  if (!account) return ZERO_BN

  const normalizedTokenId = String(tokenId)
  const directValue = account.asset?.[normalizedTokenId] ?? account.assetV2?.[normalizedTokenId]
  if (directValue != null) return toBN(directValue)

  const collections = [account.assetV2, account.asset]
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue

    const entry = collection.find((item) => {
      const key = item?.key ?? item?.tokenId ?? item?.name
      return key != null && String(key) === normalizedTokenId
    })

    if (entry) {
      const amount = entry.value ?? entry.amount ?? entry.balance ?? entry.tokenValue
      return toBN(amount)
    }
  }

  return ZERO_BN
}

export function parseSafeInteger (
  rawValue: string | number | null | undefined,
  radix: number,
  fieldName: string
): number {
  if (typeof rawValue === 'number') {
    if (!Number.isFinite(rawValue) || !Number.isInteger(rawValue) || rawValue < 0) {
      throw new Error(`Invalid ${fieldName}.`)
    }

    if (!Number.isSafeInteger(rawValue)) {
      throw new Error(formatSafeIntegerRangeError(fieldName))
    }

    return rawValue
  }

  const normalizedValue =
    rawValue === undefined || rawValue === null || rawValue === ''
      ? '0'
      : String(rawValue).trim()

  let parsedValue: BN
  if (radix === 10) {
    if (!DECIMAL_INTEGER_PATTERN.test(normalizedValue)) {
      throw new Error(`Invalid ${fieldName}.`)
    }
    parsedValue = new BN(normalizedValue, 10)
  } else if (radix === 16) {
    const match = normalizedValue.match(HEX_INTEGER_PATTERN)
    if (!match) {
      throw new Error(`Invalid ${fieldName}.`)
    }
    parsedValue = new BN(match[1], 16)
  } else {
    throw new Error(`Invalid ${fieldName}.`)
  }

  if (parsedValue.gt(SAFE_INTEGER_MAX)) {
    throw new Error(formatSafeIntegerRangeError(fieldName))
  }

  return parsedValue.toNumber()
}

// Parse a 256-bit integer field (wei/sun transaction value, fee limit) to a
// native BigInt WITHOUT the 2^53-1 cap. These are 256-bit quantities consumed
// as BigInt/BN downstream; capping them at Number.MAX_SAFE_INTEGER wrongly
// rejected legitimate amounts (e.g. 1e18 wei on the JS VM). Format is still
// validated: a non-negative integer in decimal or 0x-hex form.
export function parseBigIntValue (
  rawValue: string | number | BN | null | undefined,
  fieldName: string
): bigint {
  if (rawValue === undefined || rawValue === null || rawValue === '') return BigInt(0)
  if (!isParseableInteger(rawValue)) {
    throw new Error(`Invalid ${fieldName}.`)
  }
  const parsed = toBN(rawValue)
  if (parsed.isNeg()) {
    throw new Error(`Invalid ${fieldName}.`)
  }
  return BigInt(parsed.toString(10))
}

// Non-throwing validation counterpart of parseBigIntValue: returns an error
// message string when the field is malformed/negative, or null when valid.
export function validateBigIntegerField (
  rawValue: string | number | BN | null | undefined,
  fieldName: string
): string | null {
  try {
    parseBigIntValue(rawValue, fieldName)
    return null
  } catch (error) {
    return error && (error as Error).message ? (error as Error).message : `Invalid ${fieldName}.`
  }
}
