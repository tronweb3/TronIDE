/*
 * Copyright 2022 [TronIDE]
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

import React, { useState ,useRef, useEffect, useLayoutEffect} from 'react'
import './index.css'
import IconComponent from '../../common/IconComponent'
import Input from 'antd/lib/input'
import Select from 'antd/lib/select'
import Checkbox from 'antd/lib/checkbox'
import { WORKSPACE_ACTION_VENDORS as WORKSPACE_ACTION_VENDOR_LIST } from '../../../services/aiToolProtocolAdapters'
import { AI_ENDPOINT_TYPE, BANK_OF_AI_ACCOUNT_URL, BANK_OF_AI_ENABLED, BANK_OF_AI_KEY_URL, BANK_OF_AI_VENDOR, DEFAULT_AI_ENDPOINT_TYPE, DEFAULT_AI_MODEL, DEFAULT_AI_VENDOR, bankOfAIModelFallbacks, fetchBankOfAIModels, isBankModelLoadContextCurrent, isOfficialBankOfAIBaseUrl, isSafeAIBaseUrl, providerApiKeyBinding, providerEndpointOrigin, resolveProviderApiKey } from '../../../services/aiProviderConfig'

const contextOptionsData = [
  {
    value: 'none',
    title: 'None',
    description: 'Uses no context'
  },
  {
    value: 'currentFile',
    title: 'Current file',
    description: 'Uses the current file in the editor as context'
  },
  // {
  //   value: 'allOpenedFiles',
  //   title: 'All opened files',
  //   description: 'Uses all files opened in the editor as context'
  // },
  // {
  //   value: 'workspace',
  //   title: 'Workspace',
  //   description: 'Uses the current workspace as context'
  // }
]

const aiModelVendor={
  ...(BANK_OF_AI_ENABLED ? {
    [BANK_OF_AI_VENDOR]: {
      defaultValue: DEFAULT_AI_MODEL,
      findMyAPIKeyUrl: BANK_OF_AI_KEY_URL,
      models: bankOfAIModelFallbacks[DEFAULT_AI_ENDPOINT_TYPE]
    }
  } : {}),
  'Anthropic':{
    defaultValue:'claude-opus-4-8',
    findMyAPIKeyUrl:'https://console.anthropic.com/settings/keys',
    models:[{
      value:'claude-opus-5',
      label:'Claude Opus 5',
    },{
      value:'claude-opus-4-8',
      label:'Claude Opus 4.8',
    },{
      value:'claude-opus-4-7',
      label:'Claude Opus 4.7',
    },{
      value:'claude-sonnet-5',
      label:'Claude Sonnet 5',
    },{
      value:'claude-sonnet-4-6',
      label:'Claude Sonnet 4.6',
    },{
      value:'claude-haiku-4-5-20251001',
      label:'Claude Haiku 4.5',
    }]
  },
  'OpenAI':{
    defaultValue:'gpt-5.5',
    findMyAPIKeyUrl:'https://help.openai.com/en/articles/4936850-where-do-i-find-my-secret-api-key',
    models:[{
      value:'gpt-5.5',
      label:'GPT-5.5',
    },{
      value:'gpt-5.4',
      label:'GPT-5.4',
    },{
      value:'gpt-5',
      label:'GPT-5',
    },{
      value:'gpt-5-mini',
      label:'GPT-5 mini',
    },{
      value:'gpt-4.1',
      label:'GPT-4.1',
    },{
      value:'o4-mini',
      label:'o4-mini',
    },{
      value:'gpt-4o',
      label:'GPT-4o',
    },{
      value:'gpt-4',
      label:'GPT-4',
    },{
      value:'gpt-3.5-turbo',
      label:'GPT-3.5',
    }]
  },
  'Google':{
    defaultValue:'',
    findMyAPIKeyUrl:'https://aistudio.google.com/app/api-keys',
    models:[{
      // TODO: confirm the real Gemini 3.0 Pro model id against Google GenAI docs once published
      value:'gemini-3.0-pro',
      label:'Gemini 3.0 Pro',
    },{
      value:'gemini-2.5-pro',
      label:'Gemini 2.5 Pro',
    },{
      value:'gemini-2.5-flash',
      label:'Gemini 2.5 Flash',
    },{
      value:'gemini-2.5-flash-lite',
      label:'Gemini 2.5 Flash Lite',
    },
    // {
    //   value:'gemini-2.0-flash',
    //   label:'Gemini 2.0 Flash',
    // }
  ]
  },
  'xAI':{
    defaultValue:'',
    findMyAPIKeyUrl:'https://console.x.ai',
    models:[{
      value:'grok-4',
      label:'Grok 4',
    },{
      value:'grok-4-fast-reasoning',
      label:'Grok 4 Fast',
    },{
      value:'grok-code-fast-1',
      label:'Grok Code Fast 1',
    }]
  },
  'DeepSeek':{
    defaultValue:'deepseek-chat',
    findMyAPIKeyUrl:'https://platform.deepseek.com/api_keys',
    models:[{
      value:'deepseek-reasoner',
      label:'DeepSeek Reasoner',
    },{
      value:'deepseek-chat',
      label:'DeepSeek Chat',
    }]
  },
  'Qwen':{
    defaultValue:'',
    findMyAPIKeyUrl:'https://www.alibabacloud.com/help/zh/model-studio/first-api-call-to-qwen#5058e161041ps',
    models:[{
      // TODO: confirm the real Qwen 3.7 model id against DashScope docs once published
      value:'qwen3.7',
      label:'Qwen 3.7',
    },{
      value:'qwen3-max',
      label:'Qwen3 Max',
    },{
      value:'qwen3-coder-plus',
      label:'Qwen3 Coder Plus',
    },{
      value:'qwen3-coder-flash',
      label:'Qwen3 Coder Flash',
    }]
  },
  'OpenAI-compatible':{
    defaultValue:'gpt-4o-mini',
    findMyAPIKeyUrl:'',
    models:[{
      value:'gpt-4o-mini',
      label:'Gateway default (gpt-4o-mini)',
    }]
  },
}

export const aiModelName={
  'gpt-5.5':'GPT-5.5',
  'gpt-5.4':'GPT-5.4',
  'gpt-5':'GPT-5',
  'gpt-5-mini':'GPT-5 mini',
  'gpt-4.1':'GPT-4.1',
  'o4-mini':'o4-mini',
  'gpt-4o':'GPT-4o',
  'gpt-4':'GPT-4',
  'gpt-3.5-turbo':'GPT-3.5',
  'claude-opus-5':'Claude Opus 5',
  'claude-opus-4-8':'Claude Opus 4.8',
  'claude-opus-4-7':'Claude Opus 4.7',
  'claude-sonnet-5':'Claude Sonnet 5',
  'claude-sonnet-4-6':'Claude Sonnet 4.6',
  'claude-haiku-4-5-20251001':'Claude Haiku 4.5',
  'gemini-3.0-pro':'Gemini 3.0 Pro',
  'gemini-2.5-pro':'Gemini 2.5 Pro',
  'gemini-2.5-flash':'Gemini 2.5 Flash',
  'gemini-2.5-flash-lite':'Gemini 2.5 Flash Lite',
  // 'gemini-2.0-flash':'Gemini 2.0 Flash',
  'grok-4':'Grok 4',
  'grok-4-fast-reasoning':'Grok 4 Fast',
  'grok-code-fast-1':'Grok Code Fast 1',
  'deepseek-reasoner':'DeepSeek Reasoner',
  'deepseek-chat':'DeepSeek Chat',
  'qwen3.7':'Qwen 3.7',
  'qwen3-max':'Qwen3 Max',
  'qwen3-coder-plus':'Qwen3 Coder Plus',
  'qwen3-coder-flash':'Qwen3 Coder Flash',
  'gpt-4o-mini':'GPT-4o mini',
}

const WORKSPACE_ACTION_VENDORS = new Set(WORKSPACE_ACTION_VENDOR_LIST)

export const apikeyRe= /^[a-zA-Z0-9-_]{35,164}$/;

// Optional per-vendor request URL ("请求地址") for AI gateways/relays. Unlike
// the key (memory-only by policy), the URL is plain config and safe to persist,
// so the user doesn't retype it every reload — the key is still required again.
const BASE_URL_STORE_PREFIX = 'tronide.ai.baseUrl.'
const loadBaseUrl = (vendor) => {
  try { return window.localStorage.getItem(BASE_URL_STORE_PREFIX + vendor) || '' } catch (e) { return '' }
}
const saveBaseUrl = (vendor, url) => {
  try {
    if (url) window.localStorage.setItem(BASE_URL_STORE_PREFIX + vendor, url)
    else window.localStorage.removeItem(BASE_URL_STORE_PREFIX + vendor)
  } catch (e) { /* storage unavailable — the URL just won't persist */ }
}
// https only, except plain-http loopback for local relays (one-api/ollama etc.).
// This is a SECURITY gate, not just a hint: onBaseUrlChange, the vendor switch
// and the mount effect all refuse to persist or use a URL this rejects, so the
// memory-only apiKey + prompt can never leave over cleartext http to a
// non-loopback relay. Allowed: https (any host), or http on
// localhost / 127.0.0.1 / [::1].
export const baseUrlLooksValid = (u) => {
  const raw = String(u || '').trim()
  return !!raw && isSafeAIBaseUrl(raw)
}

const contextOptions = contextOptionsData.map((o) => ({
  value: o.value,
  title: o.title,
  label: (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontWeight: 600 }}>{o.title}</div>
      <div style={{ fontSize: 12, color: '#888' }}>{o.description}</div>
    </div>
  )
}))

const ChatSet = ({ gptvHandle, apiKeyHandle,contextHandle,collapseHandle,enableStreamingHandle,enableStreaming ,getAiModelVendor, endpointTypeHandle, baseUrlHandle, enableWorkspaceActions, workspaceActionsHandle, enableLocalMetrics, localMetrics, localMetricsHandle, clearLocalMetricsHandle, panelVisible}) => {
  const [openEye, setOpenEye] = useState(false)
  const [context, setContext] = useState('none')
  const [modelVendor, setModelVendor] = useState(DEFAULT_AI_VENDOR)
  const [endpointType, setEndpointType] = useState(DEFAULT_AI_ENDPOINT_TYPE)
  const [modelVersion, setModelVersion] = useState(DEFAULT_AI_MODEL)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(() => loadBaseUrl(DEFAULT_AI_VENDOR))
  const [urlTip, setUrlTip] = useState(false)
  const [bankModels, setBankModels] = useState(() => ({
    [AI_ENDPOINT_TYPE.ANTHROPIC]: bankOfAIModelFallbacks[AI_ENDPOINT_TYPE.ANTHROPIC],
    [AI_ENDPOINT_TYPE.OPENAI]: bankOfAIModelFallbacks[AI_ENDPOINT_TYPE.OPENAI]
  }))
  const [bankModelLoad, setBankModelLoad] = useState({ loading: false, error: '', loaded: false })
  const timerRef = useRef();
  const [keyTip, setKeyTip] = useState(false);
  const apiKeyInputRef = useRef(null);
  // Provider + endpoint-origin scoped keys live only for this mounted panel.
  // This lets a legacy custom-gateway key survive a compatible provider switch
  // without ever writing credentials to storage or forwarding it cross-origin.
  const apiKeysRef = useRef({})
  const modelVendorRef = useRef(DEFAULT_AI_VENDOR)
  const endpointTypeRef = useRef(DEFAULT_AI_ENDPOINT_TYPE)
  const modelVersionRef = useRef(DEFAULT_AI_MODEL)
  const apiKeyRef = useRef('')
  // The text field may temporarily contain an invalid URL while it is being
  // edited. This ref mirrors the last validated URL actually passed to Chat,
  // so key bindings follow the real request destination rather than raw text.
  const activeBaseUrlRef = useRef(baseUrl.trim() && baseUrlLooksValid(baseUrl.trim()) ? baseUrl.trim() : '')
  const bankModelLoadControllerRef = useRef(null)
  const bankModelLoadGenerationRef = useRef(0)
  const mountedRef = useRef(true)
  const apiKeyInputNameRef = useRef(`tronide-ai-api-key-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const apiKeyEditingRef = useRef(false);
  // live mirror of the workspace-actions toggle — the streaming checkbox is
  // meaningless while the (non-streaming) tool loop is active
  const [waOn, setWaOn] = useState(!!enableWorkspaceActions);
  const [metricsOn, setMetricsOn] = useState(enableLocalMetrics !== false);
  // auto-re-mask backstop for the revealed API key
  const revealTimerRef = useRef(null);
  useEffect(() => () => { if (revealTimerRef.current) clearTimeout(revealTimerRef.current) }, []);
  useEffect(() => setMetricsOn(enableLocalMetrics !== false), [enableLocalMetrics]);

  const endpointOriginFor = (vendor = modelVendorRef.current, requestUrl = activeBaseUrlRef.current) =>
    providerEndpointOrigin({ vendor, baseUrl: requestUrl })

  const bindingFor = (vendor = modelVendorRef.current, requestUrl = activeBaseUrlRef.current) =>
    providerApiKeyBinding({ vendor, endpointOrigin: endpointOriginFor(vendor, requestUrl) })

  const rememberApiKey = (vendor, requestUrl, value) => {
    const binding = bindingFor(vendor, requestUrl)
    const key = String(value || '').trim()
    if (!binding) return
    if (key) apiKeysRef.current[binding] = key
    else delete apiKeysRef.current[binding]
  }

  const cancelBankModelLoad = (resetState = true) => {
    bankModelLoadGenerationRef.current += 1
    if (bankModelLoadControllerRef.current) bankModelLoadControllerRef.current.abort()
    bankModelLoadControllerRef.current = null
    if (resetState && mountedRef.current) setBankModelLoad({ loading: false, error: '', loaded: false })
  }

  useEffect(() => () => {
    mountedRef.current = false
    bankModelLoadGenerationRef.current += 1
    if (bankModelLoadControllerRef.current) bankModelLoadControllerRef.current.abort()
    bankModelLoadControllerRef.current = null
  }, [])

  const clearApiKey = () => {
    cancelBankModelLoad()
    // Assign the DOM property too: browsers can restore a password value after
    // React has rendered an empty controlled input without updating React state.
    const input = apiKeyInputRef.current && apiKeyInputRef.current.input
    if (input) input.value = ''
    setApiKey('')
    apiKeyRef.current = ''
    const binding = bindingFor()
    if (binding) delete apiKeysRef.current[binding]
    // Clearing a browser-restored or replaced value must also clear the
    // advisory format hint. An empty field means no key has been entered,
    // never an invalid key.
    setKeyTip(false)
    apiKeyHandle && apiKeyHandle('')
  }

  // A freshly mounted settings panel has no trustworthy provider+origin
  // provenance for a key retained by a parent component or browser restore.
  // Fail closed before paint instead of adopting it as a Bank credential. A
  // normal accordion collapse does not destroy this panel, so an active
  // in-memory session is unaffected; a true remount intentionally clears it.
  useLayoutEffect(() => {
    apiKeyEditingRef.current = false
    clearApiKey()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  modelVendorRef.current = modelVendor
  endpointTypeRef.current = endpointType
  modelVersionRef.current = modelVersion
  useEffect(() => {
    // Some browsers/password managers restore the field seconds after load.
    // Keep removing native restoration until the user intentionally focuses
    // the field; a real pasted/typed key is then left alone.
    const clearRestoredKey = () => {
      const input = apiKeyInputRef.current && apiKeyInputRef.current.input
      if (!apiKeyEditingRef.current && input?.value) clearApiKey()
    }
    const interval = window.setInterval(clearRestoredKey, 250)
    return () => window.clearInterval(interval)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const clearBeforeRestore = () => {
      apiKeysRef.current = {}
      clearApiKey()
    }
    window.addEventListener('pagehide', clearBeforeRestore)
    window.addEventListener('beforeunload', clearBeforeRestore)
    return () => {
      window.removeEventListener('pagehide', clearBeforeRestore)
      window.removeEventListener('beforeunload', clearBeforeRestore)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Hiding the whole AI panel keeps this React tree mounted for fast reopen.
  // Explicitly clear both copies of the key when that happens; collapsing only
  // the settings accordion must keep it for the active chat session.
  useEffect(() => {
    if (panelVisible !== false) return
    apiKeyEditingRef.current = false
    setOpenEye(false)
    setKeyTip(false)
    apiKeysRef.current = {}
    clearApiKey()
  }, [panelVisible]) // eslint-disable-line react-hooks/exhaustive-deps

  // Push the persisted request URL for the initial vendor up on mount, so a
  // saved gateway is used even if the user never touches the field again.
  // Gate on baseUrlLooksValid: a plain-http non-loopback URL persisted by an
  // older build must not be used — fall back to the official endpoint.
  useEffect(() => {
    const saved = loadBaseUrl(DEFAULT_AI_VENDOR).trim()
    if (saved && baseUrlLooksValid(saved)) baseUrlHandle && baseUrlHandle(saved)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onOpenAPIkeyChange = (e) => {
    const raw = e.target.value
    // Keys are pasted, and paste artifacts (a trailing linebreak / surrounding
    // spaces from the provider console or a password manager) are invisible in
    // a password field. The format hint below tests the TRIMMED value, so the
    // stored key must be trimmed too — otherwise a key can look accepted here
    // while the request goes out with the whitespace and 401s at the vendor.
    const v = raw.trim()
    cancelBankModelLoad()
    rememberApiKey(modelVendor, activeBaseUrlRef.current, v)
    apiKeyRef.current = v
    apiKeyHandle && apiKeyHandle(v)
    setApiKey(raw)
    // Advisory only — never blocks; requests use the key either way. An empty
    // field is "no key yet", not a format error.
    setKeyTip(!!v && !(apikeyRe?.test(v)));
    if(v){
       if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
        timerRef.current = window.setTimeout(() => {
          gtag("event", "set_key", {event_category: "ai_user_action",event_label: "set_key"})
        }, 800);
    }
  }

  const onSelectChange = (e, { cancelModelLoad = true } = {}) => {
    if (cancelModelLoad) cancelBankModelLoad()
    gptvHandle && gptvHandle(e)
    modelVersionRef.current = e
    setModelVersion(e)
    gtag("event", "click", {event_category: "ai_user_action",event_label: `select_model_${e}`})
  }

  const onSelectVendorChange = (e) => {
    cancelBankModelLoad()
    const previousVendor = modelVendorRef.current
    const previousUrl = activeBaseUrlRef.current
    const previousOrigin = endpointOriginFor(previousVendor, previousUrl)
    const previousKey = String(apiKeyRef.current || '').trim()
    rememberApiKey(previousVendor, previousUrl, previousKey)

    // Each vendor keeps its own saved request URL — load the new vendor's one.
    const savedNextUrl = loadBaseUrl(e)
    // A legacy Anthropic key is commonly paired with a custom relay. Carry
    // that URL across the Anthropic -> Bank of AI migration. The resolver
    // below copies the key only when this keeps the exact same non-Bank origin.
    const nextUrl = !savedNextUrl.trim() && e === BANK_OF_AI_VENDOR && previousVendor === 'Anthropic' && previousUrl && baseUrlLooksValid(previousUrl)
      ? previousUrl
      : savedNextUrl
    const nextTrimmed = nextUrl.trim()
    const nextInvalid = !!nextTrimmed && !baseUrlLooksValid(nextTrimmed)
    const nextActiveUrl = nextInvalid ? '' : nextTrimmed
    const nextOrigin = endpointOriginFor(e, nextActiveUrl)
    const nextKey = resolveProviderApiKey({
      currentVendor: previousVendor,
      nextVendor: e,
      currentKey: previousKey,
      currentEndpointOrigin: previousOrigin,
      nextEndpointOrigin: nextOrigin,
      rememberedKeys: apiKeysRef.current
    })
    rememberApiKey(e, nextActiveUrl, nextKey)

    setModelVendor(e)
    modelVendorRef.current = e
    activeBaseUrlRef.current = nextActiveUrl
    onSelectChange(aiModelVendor[e]?.defaultValue||aiModelVendor[e]?.models[0]?.value, { cancelModelLoad: false })
    getAiModelVendor&&getAiModelVendor(e)
    apiKeyHandle && apiKeyHandle(nextKey)
    apiKeyRef.current = nextKey
    setKeyTip(!!nextKey && !apikeyRe.test(nextKey))
    setApiKey(nextKey)
    apiKeyEditingRef.current = Boolean(nextKey)
    if (e === BANK_OF_AI_VENDOR) {
      endpointTypeRef.current = DEFAULT_AI_ENDPOINT_TYPE
      setEndpointType(DEFAULT_AI_ENDPOINT_TYPE)
      endpointTypeHandle && endpointTypeHandle(DEFAULT_AI_ENDPOINT_TYPE)
    }
    setBaseUrl(nextUrl)
    setUrlTip(nextInvalid)
    // Only push a validated (or empty) URL up; a stale plain-http non-loopback
    // relay is shown + hinted but not used — fall back to the official endpoint.
    baseUrlHandle && baseUrlHandle(nextInvalid ? '' : nextTrimmed)
    if (!nextInvalid && nextTrimmed && nextTrimmed !== savedNextUrl.trim()) saveBaseUrl(e, nextTrimmed)
    if (!WORKSPACE_ACTION_VENDORS.has(e)) {
      setWaOn(false)
      workspaceActionsHandle && workspaceActionsHandle(false)
    }
    gtag("event", "ai_vendor", {event_category: "ai_user_action",event_label: `select_vendor_${e}`})
  }

  const onEndpointTypeChange = (nextType) => {
    cancelBankModelLoad()
    endpointTypeRef.current = nextType
    setEndpointType(nextType)
    endpointTypeHandle && endpointTypeHandle(nextType)
    const nextModel = bankModels[nextType]?.[0]?.value || bankOfAIModelFallbacks[nextType][0].value
    onSelectChange(nextModel, { cancelModelLoad: false })
  }

  const loadBankModels = async () => {
    const requestUrl = activeBaseUrlRef.current
    const endpointOrigin = endpointOriginFor(BANK_OF_AI_VENDOR, requestUrl)
    const keyBinding = providerApiKeyBinding({ vendor: BANK_OF_AI_VENDOR, endpointOrigin })
    const requestKey = String(apiKeyRef.current || '').trim()
    if (modelVendorRef.current !== BANK_OF_AI_VENDOR || !isOfficialBankOfAIBaseUrl(requestUrl) || !keyBinding || apiKeysRef.current[keyBinding] !== requestKey) {
      setBankModelLoad({ loading: false, error: 'Use a Bank of AI key entered for the official endpoint to load live models.', loaded: false })
      return
    }

    cancelBankModelLoad(false)
    const generation = bankModelLoadGenerationRef.current
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    bankModelLoadControllerRef.current = controller
    const requestEndpointType = endpointTypeRef.current
    const requestModel = modelVersionRef.current
    const requestContext = {
      generation,
      vendor: BANK_OF_AI_VENDOR,
      endpointType: requestEndpointType,
      endpointOrigin,
      model: requestModel,
      keyBinding
    }
    const requestIsCurrent = () => isBankModelLoadContextCurrent(requestContext, {
      mounted: mountedRef.current,
      generation: bankModelLoadGenerationRef.current,
      vendor: modelVendorRef.current,
      endpointType: endpointTypeRef.current,
      endpointOrigin: endpointOriginFor(BANK_OF_AI_VENDOR, activeBaseUrlRef.current),
      model: modelVersionRef.current,
      keyBinding: apiKeyRef.current === requestKey && apiKeysRef.current[keyBinding] === requestKey ? keyBinding : ''
    })

    setBankModelLoad({ loading: true, error: '', loaded: false })
    try {
      const models = await fetchBankOfAIModels({ apiKey: requestKey, endpointType: requestEndpointType, baseUrl: requestUrl, signal: controller?.signal })
      if (!requestIsCurrent()) return
      bankModelLoadControllerRef.current = null
      setBankModels((current) => ({ ...current, [requestEndpointType]: models }))
      if (!models.some((model) => model.value === requestModel)) onSelectChange(models[0].value, { cancelModelLoad: false })
      setBankModelLoad({ loading: false, error: '', loaded: true })
    } catch (error) {
      if (!requestIsCurrent() || error?.name === 'AbortError') return
      bankModelLoadControllerRef.current = null
      setBankModelLoad({ loading: false, error: error?.message || 'Unable to load Bank of AI models.', loaded: false })
    }
  }

  const onBaseUrlChange = (e) => {
    const raw = e.target.value
    const v = raw.trim()
    cancelBankModelLoad()
    setBaseUrl(raw)
    // Advisory hint on a non-empty value that doesn't validate (wording below).
    const invalid = !!v && !baseUrlLooksValid(v)
    setUrlTip(invalid)
    // Security gate (not advisory): only persist/use an empty value (→ official
    // endpoint) or an https / loopback-http URL. A plain-http non-loopback relay
    // is refused so the memory-only apiKey + prompt never go out over cleartext
    // http; the previously saved/used gateway stays in effect until replaced.
    if (invalid) return

    const previousUrl = activeBaseUrlRef.current
    const previousOrigin = endpointOriginFor(modelVendorRef.current, previousUrl)
    const currentKey = String(apiKeyRef.current || '').trim()
    rememberApiKey(modelVendorRef.current, previousUrl, currentKey)
    activeBaseUrlRef.current = v
    const nextOrigin = endpointOriginFor(modelVendorRef.current, v)
    if (nextOrigin !== previousOrigin) {
      const nextBinding = providerApiKeyBinding({ vendor: modelVendorRef.current, endpointOrigin: nextOrigin })
      // A URL edit chooses a destination, but it does not authorize forwarding
      // the credential entered for the previous origin. Recall only a key that
      // was explicitly entered for this exact provider + origin; otherwise
      // clear the field and require re-entry. This also prevents character-by-
      // character URL edits from leaving copied keys on intermediate origins.
      const nextKey = String((nextBinding ? apiKeysRef.current[nextBinding] : '') || '').trim()
      apiKeyRef.current = nextKey
      setApiKey(nextKey)
      apiKeyHandle && apiKeyHandle(nextKey)
      setKeyTip(!!nextKey && !apikeyRe.test(nextKey))
      apiKeyEditingRef.current = Boolean(nextKey)
    }
    saveBaseUrl(modelVendor, v)
    baseUrlHandle && baseUrlHandle(v)
  }

  const onContextChange = (e) => {
    setContext(e)
    contextHandle&& contextHandle(e)
  }

  const onCollapseHandle=()=>{
    collapseHandle&& collapseHandle()
    gtag("event", "click", {event_category: "ai_user_action",event_label: "collapse_ai_config"})
  }

  const onChangeGPTCheckbox=(e)=>{
    enableStreamingHandle&& enableStreamingHandle(e.target.checked)
  }

  const bankUsesOfficialEndpoint = modelVendor === BANK_OF_AI_VENDOR && !urlTip && isOfficialBankOfAIBaseUrl(activeBaseUrlRef.current)
  const bankOfficialKeyBinding = providerApiKeyBinding({
    vendor: BANK_OF_AI_VENDOR,
    endpointOrigin: endpointOriginFor(BANK_OF_AI_VENDOR, activeBaseUrlRef.current)
  })
  const bankHasBoundOfficialKey = bankUsesOfficialEndpoint && Boolean(apiKeyRef.current) && apiKeysRef.current[bankOfficialKeyBinding] === apiKeyRef.current
  const bankModelLoadHelp = bankModelLoad.loaded
    ? `${bankModels[endpointType].length} models loaded in memory.`
    : !bankUsesOfficialEndpoint
      ? 'Live model discovery is disabled for custom gateways; fallback models remain available.'
      : !bankHasBoundOfficialKey
        ? 'Enter a Bank of AI key for the official endpoint to load the live list.'
        : 'Uses a safe fallback until you load the live list.'

  return (
    <div className="chat-set-wrapper">
      <div className='chat-set-content'>
        <div className="explanation-list">
          <div className='top-info'>
            <img src="assets/img/aiAssistant.png"/>
            <h4>TRON IDE AI</h4>
            <p>TRON IDE AI supports contextual questioning and provides real-time answers to your contract development issues, helping you quickly build and optimize TRON smart contracts.</p>
          </div>
          <div className="item">
            <IconComponent className="tron-icon" icon={'#icon-icon-v1'} />
            <span>Any open source contract</span>
          </div>
          <div className="item">
            <IconComponent className="tron-icon" icon={'#icon-icon-v1'} />
            <span>Any question</span>
          </div>
          <div className="item">
            <IconComponent className="tron-icon" icon={'#icon-icon-v1'} />
            <span>Wide spectrum of AI models</span>
          </div>
        </div>
        <div className="ai-model-vendor-wrap">
          <div className="open-ai-title">Select an AI provider</div>
          <Select
            value={modelVendor}
            data-id='aiModelVendorSelect'
            placeholder={'Select an AI provider'}
            suffixIcon={<IconComponent className="tron-icon" icon={'#icon-down-arrow'} />}
            onChange={onSelectVendorChange}
            options={Object.keys(aiModelVendor).map((item)=>({
              value: item, label: item
            }))}
          ></Select>
        </div>
        <div>
          <div className="open-ai-title">
            <span className="keySelect-title">Enter your API Key</span>
            {aiModelVendor[modelVendor]?.findMyAPIKeyUrl
              ? <a className="fz12" href={aiModelVendor[modelVendor]?.findMyAPIKeyUrl} target="_blank" rel="noopener noreferrer">
                  {modelVendor === BANK_OF_AI_VENDOR ? 'Get a Bank of AI API Key' : 'Where to find my API Key?'}
                </a>
              : <span className="fz12">Use the key documented by your gateway.</span>}
          </div>
          <Input
            ref={apiKeyInputRef}
            type={openEye ? 'text' : 'password'}
            value={apiKey}
            onFocus={() => {
              if (!apiKeyEditingRef.current) clearApiKey()
              apiKeyEditingRef.current = true
            }}
            onChange={onOpenAPIkeyChange}
            onBlur={() => setOpenEye(false)}
            placeholder={'Paste your API Key here'}
            maxLength={200}
            name={apiKeyInputNameRef.current}
            autoComplete="off"
            spellCheck={false}
            data-id="aiApiKeyInput"
            data-lpignore="true"
            data-1p-ignore="true"
            data-form-type="other"
            // status={keyTip?'error':''}
            suffix={
              // preventDefault on mousedown keeps focus INSIDE the input while
              // toggling — otherwise the eye click itself blurs the field and
              // the blur-driven re-mask below can never see a later real blur.
              <div className="eye flex-center" onMouseDown={(e) => e.preventDefault()}>
                <IconComponent
                  className="tron-icon"
                  icon={openEye ? '#icon-password-see-copy' : '#icon-password-nosee-copy'}
                  onClick={(e) => {
                    e.stopPropagation()
                    const next = !openEye
                    setOpenEye(next)
                    // a revealed key never stays visible indefinitely: re-mask
                    // on real blur (below) and after 30s as a backstop
                    if (revealTimerRef.current) clearTimeout(revealTimerRef.current)
                    if (next) revealTimerRef.current = window.setTimeout(() => setOpenEye(false), 30000)
                  }}
                />
              </div>
            }
          />
          {
            keyTip && Boolean(apiKey.trim()) && !baseUrl.trim() ?<div className='key-tip' data-id='aiApiKeyHint'>This doesn't look like a complete API key — re-copy it in full from the provider console (it will still be tried as entered)</div>:null
          }
          <div className="open-ai-title" style={{ marginTop: 8 }}>Request URL {modelVendor === 'OpenAI-compatible' ? '(required)' : '(optional)'}</div>
          <Input
            type='text'
            value={baseUrl}
            onChange={onBaseUrlChange}
            placeholder={modelVendor === 'OpenAI-compatible' ? 'Gateway base URL, including its required path prefix' : `Gateway/relay base URL — empty uses the official ${modelVendor} endpoint`}
            maxLength={300}
            autoComplete="off"
            spellCheck={false}
            data-id="aiBaseUrlInput"
          />
          {
            urlTip?<div className='key-tip' data-id='aiBaseUrlHint'>Use an https:// URL (plain http only for localhost). Requests keep using the last valid endpoint until this URL is corrected.</div>:null
          }
          {modelVendor === BANK_OF_AI_VENDOR ? (
            <div data-id='bankOfAIProviderNotice' style={{ marginTop: 7, fontSize: 12, color: 'var(--ai-text)' }}>
              Bank of AI is a multi-model gateway. Your prompt and selected context are processed by Bank of AI and its upstream model provider.{' '}
              <a href={BANK_OF_AI_ACCOUNT_URL} target='_blank' rel='noopener noreferrer'>Manage balance in Bank of AI</a>.
            </div>
          ) : null}
          <div className='key-security-notice' data-id='aiKeySecurityNotice'>
            ⚠ API key stays in memory only and clears on panel close or reload. Use a low-limit, non-production key; revoke it after using untrusted plugins.
          </div>
        </div>
        <div className="gpt-model-wrap">
          {modelVendor === BANK_OF_AI_VENDOR ? (
            <div style={{ marginBottom: 8 }}>
              <div className='open-ai-title'>Bank of AI API format</div>
              <Select
                value={endpointType}
                data-id='bankOfAIEndpointTypeSelect'
                onChange={onEndpointTypeChange}
                options={[
                  { value: AI_ENDPOINT_TYPE.ANTHROPIC, label: 'Anthropic-compatible (recommended)' },
                  { value: AI_ENDPOINT_TYPE.OPENAI, label: 'OpenAI-compatible' }
                ]}
              />
            </div>
          ) : null}
          <div className="open-ai-title">Select an AI model</div>
          {modelVendor === 'OpenAI-compatible'
            ? <Input
                value={modelVersion}
                onChange={(e) => onSelectChange(e.target.value.trim())}
                placeholder='Model ID exposed by your gateway'
                maxLength={120}
                data-id='aiCompatibleModelInput'
              />
            : <Select
                value={modelVersion}
                data-id='aiModelSelect'
                placeholder={'Select an AI model'}
                suffixIcon={<IconComponent className="tron-icon" icon={'#icon-down-arrow'} />}
                onChange={onSelectChange}
                options={modelVendor === BANK_OF_AI_VENDOR ? bankModels[endpointType] : aiModelVendor[modelVendor]?.models}
              ></Select>}
          {modelVendor === BANK_OF_AI_VENDOR ? (
            <div style={{ marginTop: 7, fontSize: 12 }}>
              <button type='button' className='btn btn-sm btn-outline-secondary bank-model-load-button' data-id='bankOfAILoadModels' disabled={bankModelLoad.loading || !bankHasBoundOfficialKey} onClick={loadBankModels}>
                {bankModelLoad.loading ? 'Loading models…' : 'Load available models'}
              </button>
              <span className='bank-model-load-help' data-id='bankOfAIModelLoadHelp' style={{ marginLeft: 8 }}>{bankModelLoadHelp}</span>
              {bankModelLoad.error ? <div className='key-tip' data-id='bankOfAIModelLoadError'>{bankModelLoad.error}</div> : null}
            </div>
          ) : null}
          {
            WORKSPACE_ACTION_VENDORS.has(modelVendor)?<p><Checkbox data-id="aiWorkspaceActionsToggle" onChange={(e)=>{setWaOn(e.target.checked);workspaceActionsHandle&&workspaceActionsHandle(e.target.checked)}} checked={waOn}>Allow workspace actions <span className="stream-toggle-note">— confirm before writes</span></Checkbox></p>:<p data-id="aiWorkspaceActionsUnavailable">Workspace actions are unavailable for this provider.</p>
          }
          {
            /* The tool loop is inherently non-streaming; a checked-but-ignored
               streaming checkbox read as a bug, so it is disabled while
               workspace actions are on. */
            <p><Checkbox data-id="aiStreamingToggle" disabled={WORKSPACE_ACTION_VENDORS.has(modelVendor)&&waOn} onChange={onChangeGPTCheckbox} defaultChecked={enableStreaming}>Stream responses{WORKSPACE_ACTION_VENDORS.has(modelVendor)&&waOn?<span className="stream-toggle-note"> — unavailable with workspace actions</span>:null}</Checkbox></p>
          }
          <div className='ai-local-metrics-panel' data-id='aiLocalMetricsPanel' style={{ marginTop: 8, padding: 8, border: '1px solid rgba(127,127,127,0.25)', borderRadius: 4 }}>
            <p style={{ marginBottom: 4 }}>
              <Checkbox
                data-id='aiLocalMetricsToggle'
                checked={metricsOn}
                onChange={(event) => {
                  const enabled = event.target.checked
                  setMetricsOn(enabled)
                  localMetricsHandle && localMetricsHandle(enabled)
                }}
              >Keep local AI task stats</Checkbox>
            </p>
            <p style={{ marginBottom: 6, fontSize: 12, opacity: 0.82 }}>
              On-device counts only; never uploaded.
            </p>
            <div data-id='aiLocalMetricsSummary' style={{ fontSize: 12 }}>
              {metricsOn
                ? <>Tasks {localMetrics?.workflows?.started || 0} · completed {localMetrics?.workflows?.completed || 0} · failed {localMetrics?.workflows?.failed || 0}</>
                : <>Off — no task stats are saved.</>}
            </div>
            {metricsOn ? (
              <details data-id='aiLocalMetricsDetails' style={{ marginTop: 5, fontSize: 12 }}>
                <summary style={{ cursor: 'pointer' }}>Details</summary>
                <div>Tool errors {localMetrics?.tools?.failed || 0} · approved {localMetrics?.decisions?.approved || 0} · rejected {localMetrics?.decisions?.rejected || 0} · stopped {localMetrics?.decisions?.aborted || 0}</div>
                <div>Tool durations: &lt;1s {localMetrics?.tools?.durationBuckets?.under1s || 0} · 1–5s {localMetrics?.tools?.durationBuckets?.['1to5s'] || 0} · 5–30s {localMetrics?.tools?.durationBuckets?.['5to30s'] || 0} · 30s+ {localMetrics?.tools?.durationBuckets?.['30sPlus'] || 0}</div>
                <div>Error codes: {Object.entries(localMetrics?.tools?.errorCodes || {}).map(([code, count]) => `${code} ${count}`).join(' · ') || 'none'}</div>
                <div data-id='bankOfAILocalMetrics'>Bank of AI requests {localMetrics?.integrations?.bankofai?.requests || 0} · succeeded {localMetrics?.integrations?.bankofai?.succeeded || 0} · failed {localMetrics?.integrations?.bankofai?.failed || 0} · cancelled {localMetrics?.integrations?.bankofai?.cancelled || 0} · tool calls {localMetrics?.integrations?.bankofai?.toolCalls || 0}</div>
                <div>No prompts, source code, addresses, transaction arguments, API keys or wallet data.</div>
                <button type='button' className='btn btn-sm btn-outline-secondary' data-id='aiLocalMetricsClear' style={{ marginTop: 6 }} onClick={() => clearLocalMetricsHandle && clearLocalMetricsHandle()}>
                  Clear stats
                </button>
              </details>
            ) : null}
          </div>
          {/* <p>Please ensure this API Key has access to {modelVersion||'GPT-4'} Model.</p> */}
        </div>

        <div className="context-wrap" data-id="aiContextSelect">
          <div className="open-ai-title">Context</div>
          <Select
            value={context}
            optionLabelProp="title"
            placeholder={'Context'}
            suffixIcon={<IconComponent className="tron-icon" icon={'#icon-down-arrow'} />}
            onChange={onContextChange}
            options={contextOptions}
          ></Select>
        </div>

        <div className="collapse-wrap">
          <span onClick={onCollapseHandle}>Collapse <IconComponent className="tron-icon" icon={'#icon-down-arrow'} /></span>
        </div>
      </div>
    </div>
  )
}

export default ChatSet
