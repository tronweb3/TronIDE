import category from './categories'
import algorithm from './algorithmCategories'
import { AnalyzerModule, CompilationResult, ModuleAlgorithm, ModuleCategory, ReportObj, SupportedVersion } from './../../types'

type TronTransactionConfigLike = {
  feeLimit?: string | number
  callValue?: string | number
  tokenId?: string | number
  tokenValue?: string | number
  address?: string
}

const CONFIG_KEYS: Array<keyof TronTransactionConfigLike> = ['feeLimit', 'callValue', 'tokenId', 'tokenValue', 'address']
const MAX_SAFE_INTEGER = 9007199254740991
const MIN_TRC10_ID = 1000000
const BASE58_TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/
const HEX_TRON_ADDRESS = /^41[0-9a-fA-F]{40}$/

export default class tronTransactionConfig implements AnalyzerModule {
  name = 'TRON transaction config: '
  description = 'Detects unsafe TRON deployment and transaction configuration values in source hints.'
  category: ModuleCategory = category.TRON
  algorithm: ModuleAlgorithm = algorithm.HEURISTIC
  version: SupportedVersion = {
    start: '0.4.12'
  }

  private readonly candidates: TronTransactionConfigLike[] = []

  visit (node: any): void {
    if (!node || node.nodeType !== 'ObjectExpression' || !Array.isArray(node.properties)) return

    const config: TronTransactionConfigLike = {}
    node.properties.forEach((property: any) => {
      const key = getPropertyName(property)
      if (!key || CONFIG_KEYS.indexOf(key as keyof TronTransactionConfigLike) < 0) return
      const value = getLiteralValue(property.value)
      if (value !== undefined) config[key] = value
    })

    if (Object.keys(config).length > 0) {
      this.candidates.push(config)
    }
  }

  report (_compilationResults: CompilationResult): ReportObj[] {
    return this.candidates.reduce((reports: ReportObj[], config) => {
      analyzeTronTransactionConfig(config).forEach((finding) => {
        reports.push({
          warning: finding.message,
          more: `TRON rule: ${finding.ruleId}`,
          location: finding.location || '0:0:0'
        })
      })
      return reports
    }, [])
  }
}

function getPropertyName (property: any): string | null {
  const key = property && property.key
  if (!key) return null
  return key.name || key.value || null
}

function getLiteralValue (node: any): string | number | undefined {
  if (!node) return undefined
  if (node.nodeType === 'Literal') return node.value
  if (node.nodeType === 'UnaryOperation' && node.operator === '-' && node.subExpression && node.subExpression.nodeType === 'Literal') {
    return -Number(node.subExpression.value)
  }
  return undefined
}

function analyzeTronTransactionConfig (config: TronTransactionConfigLike): Array<{ ruleId: string, message: string, location?: string }> {
  const findings: Array<{ ruleId: string, message: string, location?: string }> = []

  ;(['feeLimit', 'callValue', 'tokenId', 'tokenValue'] as Array<keyof TronTransactionConfigLike>).forEach((field) => {
    const value = config[field]
    if (value === undefined || value === null || value === '') return
    if (!isSafeIntegerLike(value)) {
      findings.push({ ruleId: `tron-${formatRuleField(field)}-safe-integer`, message: `${String(field)} must be an integer within JavaScript safe integer range.` })
    }
  })

  const tokenId = Number(config.tokenId || 0)
  const tokenValue = Number(config.tokenValue || 0)
  if (isSafeIntegerLike(tokenId) && isSafeIntegerLike(tokenValue)) {
    if (tokenValue > 0 && tokenId < MIN_TRC10_ID) {
      findings.push({ ruleId: 'tron-trc10-argument-combination', message: 'tokenId must be a valid TRC10 id when tokenValue is greater than 0.' })
    } else if (tokenId >= MIN_TRC10_ID && tokenValue <= 0) {
      findings.push({ ruleId: 'tron-trc10-argument-combination', message: 'tokenValue must be greater than 0 when tokenId is provided.' })
    }
  }

  const callValue = Number(config.callValue || 0)
  if (isSafeIntegerLike(callValue) && isSafeIntegerLike(tokenValue) && callValue > 0 && tokenValue > 0) {
    findings.push({
      ruleId: 'tron-value-transfer-mode',
      message: 'callValue and tokenValue should not both be greater than 0; choose TRX or TRC10 transfer mode explicitly.'
    })
  }

  if (config.address && !BASE58_TRON_ADDRESS.test(config.address) && !HEX_TRON_ADDRESS.test(config.address)) {
    findings.push({ ruleId: 'tron-address-format', message: 'Address is not a recognized TRON base58 or hex address.' })
  }

  return findings
}

function isSafeIntegerLike (value: string | number): boolean {
  if (value === '' || value === null || value === undefined) return false
  if (!/^-?\d+$/.test(String(value))) return false
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && Math.floor(numberValue) === numberValue && Math.abs(numberValue) <= MAX_SAFE_INTEGER
}

function formatRuleField (field: keyof TronTransactionConfigLike): string {
  return String(field).replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}
