/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

export const BANK_OF_AI_VENDOR = 'Bank of AI'
export const BANK_OF_AI_SOURCE = 'tronide'
export const BANK_OF_AI_API_ORIGIN = 'https://api.bankofai.io'
export const BANK_OF_AI_MODELS_URL = `${BANK_OF_AI_API_ORIGIN}/v1/models`
export const BANK_OF_AI_KEY_URL = `https://chat.bankofai.io/key?source=${BANK_OF_AI_SOURCE}&utm_source=${BANK_OF_AI_SOURCE}`
export const BANK_OF_AI_ACCOUNT_URL = `https://chat.bankofai.io/?source=${BANK_OF_AI_SOURCE}&utm_source=${BANK_OF_AI_SOURCE}`

// API keys are credentials for one provider at one network destination, not
// just reusable strings associated with a select option. Keeping the official
// origins here lets the settings panel bind an in-memory key even when the
// request URL field is empty (which means "use the provider default").
export const AI_PROVIDER_OFFICIAL_ORIGINS = Object.freeze({
  [BANK_OF_AI_VENDOR]: BANK_OF_AI_API_ORIGIN,
  Anthropic: 'https://api.anthropic.com',
  OpenAI: 'https://api.openai.com',
  Google: 'https://generativelanguage.googleapis.com',
  xAI: 'https://api.x.ai',
  DeepSeek: 'https://api.deepseek.com',
  Qwen: 'https://dashscope-intl.aliyuncs.com'
})

export const AI_ENDPOINT_TYPE = Object.freeze({
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai'
})

// Enabled by default for v2.3.3, with a build-time kill switch so a provider
// incident can remove the entry without reverting the release branch.
export const BANK_OF_AI_ENABLED = process.env.TRON_BANK_OF_AI_ENABLED !== 'false'

export const DEFAULT_AI_VENDOR = BANK_OF_AI_ENABLED ? BANK_OF_AI_VENDOR : 'Anthropic'
export const DEFAULT_AI_ENDPOINT_TYPE = AI_ENDPOINT_TYPE.ANTHROPIC
export const DEFAULT_AI_MODEL = BANK_OF_AI_ENABLED ? 'claude-sonnet-4-6' : 'claude-opus-4-8'

export const bankOfAIModelFallbacks = Object.freeze({
  [AI_ENDPOINT_TYPE.ANTHROPIC]: Object.freeze([
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 · via Bank of AI' }
  ]),
  [AI_ENDPOINT_TYPE.OPENAI]: Object.freeze([
    { value: 'gpt-5.4', label: 'GPT-5.4 · via Bank of AI' }
  ])
})

// Sonnet 4.5 was retired from the TronIDE model catalog. Bank of AI model
// discovery is live, so keep the retirement policy at the discovery boundary
// instead of relying only on the static Anthropic provider list. IDs are
// compared case-insensitively because upstream model metadata is external.
const BANK_OF_AI_RETIRED_MODEL_IDS = Object.freeze(['claude-sonnet-4-5'])

const AI_ERROR_MESSAGE_LIMIT = 500
const AI_ERROR_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,80}$/
const AI_ERROR_REDACTIONS = Object.freeze([
  { pattern: /\bBearer\s+[^\s,;]+/gi, replacement: 'Bearer [REDACTED]' },
  { pattern: /((?:authorization|x-api-key|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|secret|password)\s*[:=]\s*)[^\s,;]+/gi, replacement: '$1[REDACTED]' },
  { pattern: /([?&](?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|secret|password)=)[^&#\s]+/gi, replacement: '$1[REDACTED]' },
  { pattern: /\bsk-(?:ant-)?[A-Za-z0-9._~-]{8,}\b/gi, replacement: '[REDACTED_KEY]' }
])

const rawAIErrorMessage = (error) => {
  if (!error) return 'Unknown error'
  if (typeof error === 'string') return error
  if (typeof error?.error?.message === 'string') return error.error.message
  if (typeof error?.message === 'string') return error.message
  return 'Unknown error'
}

export const redactAIErrorText = (value) => {
  let message = String(value || '')
  for (const { pattern, replacement } of AI_ERROR_REDACTIONS) message = message.replace(pattern, replacement)
  return message.slice(0, AI_ERROR_MESSAGE_LIMIT)
}

/**
 * Convert an SDK/network error into a bounded, credential-free value. Error
 * objects from browser SDKs may carry request/config/response fields, so the
 * raw object must never cross the UI, metrics, task-history or console boundary.
 */
export const sanitizeAIError = (error) => {
  const safe = new Error(redactAIErrorText(rawAIErrorMessage(error)) || 'Unknown error')
  const name = typeof error?.name === 'string' && AI_ERROR_NAME_PATTERN.test(error.name) ? error.name : 'Error'
  safe.name = name
  const status = Number(error?.status ?? error?.cause?.status ?? error?.error?.status)
  if (Number.isFinite(status) && status >= 0 && status <= 999) safe.status = status
  if (typeof error?.code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(error.code)) safe.code = error.code
  return safe
}

export const bankOfAIBaseUrl = (endpointType = DEFAULT_AI_ENDPOINT_TYPE) =>
  endpointType === AI_ENDPOINT_TYPE.OPENAI
    ? `${BANK_OF_AI_API_ORIGIN}/v1`
    : BANK_OF_AI_API_ORIGIN

export const providerEndpointOrigin = ({ vendor, baseUrl } = {}) => {
  const raw = String(baseUrl || '').trim()
  if (raw) {
    try { return new URL(raw).origin } catch (_) { return '' }
  }
  return AI_PROVIDER_OFFICIAL_ORIGINS[vendor] || ''
}

export const providerApiKeyBinding = ({ vendor, endpointOrigin } = {}) => {
  const normalizedVendor = String(vendor || '').trim()
  const normalizedOrigin = String(endpointOrigin || '').trim().toLowerCase()
  return normalizedVendor && normalizedOrigin ? `${normalizedVendor}\n${normalizedOrigin}` : ''
}

// AI gateway URLs may receive both the in-memory API key and user/workspace
// context. Keep the transport rule in the provider layer so every adapter,
// completion path, and UI boundary enforces the same fail-closed policy:
// HTTPS for remote gateways, or plain HTTP only on loopback for local relays.
// An empty value means "use the provider's official endpoint" and is valid.
export const isSafeAIBaseUrl = (baseUrl) => {
  const raw = String(baseUrl || '').trim()
  if (!raw) return true
  try {
    const parsed = new URL(raw)
    if (parsed.protocol === 'https:') return true
    return parsed.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(parsed.host)
  } catch (_) {
    return false
  }
}

/**
 * Resolve a key only for the provider + endpoint origin it was entered for.
 * The sole compatibility migration is Anthropic -> Bank of AI on the same
 * custom gateway origin. It intentionally excludes Bank's official origin:
 * an Anthropic key must never become a Bank credential merely because the UI
 * default changed.
 */
export const resolveProviderApiKey = ({ currentVendor, nextVendor, currentKey, currentEndpointOrigin, nextEndpointOrigin, rememberedKeys = {} } = {}) => {
  const nextBinding = providerApiKeyBinding({ vendor: nextVendor, endpointOrigin: nextEndpointOrigin })
  const remembered = String((nextBinding ? rememberedKeys?.[nextBinding] : '') || '').trim()
  if (remembered) return remembered
  const sameCustomGateway = currentVendor === 'Anthropic' &&
    nextVendor === BANK_OF_AI_VENDOR &&
    Boolean(currentEndpointOrigin) &&
    currentEndpointOrigin === nextEndpointOrigin &&
    nextEndpointOrigin !== BANK_OF_AI_API_ORIGIN
  if (sameCustomGateway) {
    return String(currentKey || '').trim()
  }
  return ''
}

export const isOfficialBankOfAIBaseUrl = (baseUrl) => {
  const raw = String(baseUrl || '').trim()
  if (!raw) return true
  try { return new URL(raw).origin === BANK_OF_AI_API_ORIGIN } catch (_) { return false }
}

// Kept pure so the async UI boundary has executable regression coverage. A
// response may update model state only if every part of the request identity
// still matches; generation changes also cover key edits and explicit aborts.
export const isBankModelLoadContextCurrent = (request, current) => {
  if (!request || !current || current.mounted !== true) return false
  return request.generation === current.generation &&
    request.vendor === current.vendor &&
    request.endpointType === current.endpointType &&
    request.endpointOrigin === current.endpointOrigin &&
    request.model === current.model &&
    request.keyBinding === current.keyBinding
}

const modelSupportsEndpoint = (model, endpointType) => {
  const endpoints = model?.supported_endpoint_types
  // A missing capability declaration is not proof that the model speaks the
  // requested protocol. Keep live discovery fail-closed and leave the bounded
  // fallback list available when a provider response is incomplete.
  if (!Array.isArray(endpoints) || !endpoints.length) return false
  const normalized = endpoints.map((value) => String(value || '').toLowerCase())
  return normalized.some((value) => value === endpointType || value.includes(endpointType))
}

/**
 * Loads Bank of AI models only after the user explicitly requests it. The key,
 * response and upstream metadata stay in memory; only bounded id/label pairs
 * reach React state.
 */
export const fetchBankOfAIModels = async ({ apiKey, endpointType = DEFAULT_AI_ENDPOINT_TYPE, baseUrl = '', fetchImpl = globalThis.fetch, signal } = {}) => {
  const key = String(apiKey || '').trim()
  if (!key) throw new Error('Enter a Bank of AI API key before loading models.')
  // This endpoint is operated by Bank of AI. Never forward a custom-gateway
  // credential to it: custom gateways keep using the bundled fallback list.
  if (!isOfficialBankOfAIBaseUrl(baseUrl)) {
    throw new Error('Live Bank of AI models are unavailable for a custom gateway.')
  }
  if (typeof fetchImpl !== 'function') throw new Error('Model loading is unavailable in this browser.')
  const response = await fetchImpl(BANK_OF_AI_MODELS_URL, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    ...(signal ? { signal } : {})
  })
  if (!response?.ok) throw new Error(`Unable to load Bank of AI models (HTTP ${response?.status || 0}).`)
  const body = await response.json().catch(() => null)
  const rows = Array.isArray(body?.data) ? body.data : (Array.isArray(body) ? body : [])
  const seen = new Set()
  const models = []
  for (const row of rows) {
    const id = String(row?.id || '').trim()
    const normalizedId = id.toLowerCase()
    if (!id || id.length > 120 || BANK_OF_AI_RETIRED_MODEL_IDS.includes(normalizedId) || seen.has(id) || !modelSupportsEndpoint(row, endpointType)) continue
    seen.add(id)
    const displayName = String(row?.name || row?.display_name || id).trim().slice(0, 160)
    models.push({ value: id, label: `${displayName} · via Bank of AI` })
    if (models.length >= 100) break
  }
  if (!models.length) throw new Error(`Bank of AI returned no ${endpointType}-compatible models.`)
  return models
}

export const classifyBankOfAIErrorCode = (error) => {
  if (error?.name === 'AbortError' || /abort/i.test(String(error?.name || ''))) return 'CANCELLED'
  const status = Number(error?.status || error?.cause?.status || error?.error?.status)
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 429) return 'RATE_LIMIT'
  if (status >= 500) return 'UPSTREAM'
  const message = String(error?.message || '').toLowerCase()
  if (/timeout|timed out/.test(message)) return 'TIMEOUT'
  if (/network|fetch|offline|connection/.test(message)) return 'NETWORK'
  return 'OTHER'
}
