import { parseSafeInteger, validateTrc10Inputs } from '../execution/txIntegerUtils'

export interface TronStaticFinding {
  ruleId: string
  severity: 'info' | 'warning' | 'error'
  message: string
  location?: string
}

export interface TronTransactionConfigLike {
  feeLimit?: string | number
  callValue?: string | number
  tokenId?: string | number
  tokenValue?: string | number
  address?: string
}

const BASE58_TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/
const HEX_TRON_ADDRESS = /^41[0-9a-fA-F]{40}$/

export function analyzeTronTransactionConfig (config: TronTransactionConfigLike): TronStaticFinding[] {
  const findings: TronStaticFinding[] = []

  ;(['feeLimit', 'callValue'] as Array<keyof TronTransactionConfigLike>).forEach((field) => {
    const value = config[field]
    if (value === undefined || value === null || value === '') return
    try {
      parseSafeInteger(value, 10, String(field))
    } catch (error) {
      findings.push({ ruleId: `tron-${formatRuleField(field)}-safe-integer`, severity: 'error', message: error.message || String(error) })
    }
  })

  let tokenId = 0
  let tokenValue = 0
  try {
    tokenId = config.tokenId === undefined || config.tokenId === null || config.tokenId === '' ? 0 : parseSafeInteger(config.tokenId, 10, 'tokenId')
  } catch (error) {
    findings.push({ ruleId: 'tron-token-id-safe-integer', severity: 'error', message: error.message || String(error) })
  }
  try {
    tokenValue = config.tokenValue === undefined || config.tokenValue === null || config.tokenValue === '' ? 0 : parseSafeInteger(config.tokenValue, 10, 'tokenValue')
  } catch (error) {
    findings.push({ ruleId: 'tron-token-value-safe-integer', severity: 'error', message: error.message || String(error) })
  }
  if (findings.every((finding) => finding.ruleId !== 'tron-token-id-safe-integer' && finding.ruleId !== 'tron-token-value-safe-integer')) {
    const trc10Error = validateTrc10Inputs(tokenId, tokenValue)
    if (trc10Error) {
      findings.push({ ruleId: 'tron-trc10-argument-combination', severity: 'error', message: trc10Error })
    }
  }

  if (config.address && !BASE58_TRON_ADDRESS.test(config.address) && !HEX_TRON_ADDRESS.test(config.address)) {
    findings.push({ ruleId: 'tron-address-format', severity: 'warning', message: 'Address is not a recognized TRON base58 or hex address.' })
  }

  return findings
}

function formatRuleField (field: keyof TronTransactionConfigLike): string {
  return String(field).replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}
