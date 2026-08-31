/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var childProcess = require('child_process')
var test = require('tape')
var root = path.resolve(__dirname, '../../..')
var configPromise = import('../../../libs/remix-code-reader/src/services/aiProviderConfig.js')
var adaptersPromise = import('../../../libs/remix-code-reader/src/services/aiToolProtocolAdapters.js')
var toolsPromise = import('../../../libs/remix-code-reader/src/services/toolsApi.js')

test('Bank of AI is the default provider with a build-time kill switch', async function (t) {
  var config = await configPromise
  var adapters = await adaptersPromise
  var settings = fs.readFileSync(path.join(root, 'libs/remix-code-reader/src/components/Chat/ChatSet/index.js'), 'utf8')
  var chat = fs.readFileSync(path.join(root, 'libs/remix-code-reader/src/components/Chat/index.js'), 'utf8')
  var webpack = fs.readFileSync(path.join(root, 'apps/remix-ide/webpack.config.js'), 'utf8')

  t.equal(config.DEFAULT_AI_VENDOR, 'Bank of AI', 'Bank of AI defaults on when the kill switch is unset')
  t.equal(config.DEFAULT_AI_ENDPOINT_TYPE, 'anthropic', 'the compatibility-first API format is the default')
  t.ok(adapters.OPENAI_COMPATIBLE_VENDORS.includes('Bank of AI'), 'the OpenAI-compatible route remains available')
  t.ok(adapters.WORKSPACE_ACTION_VENDORS.includes('Bank of AI'), 'Bank of AI supports the canonical workspace tool runtime')
  t.ok(settings.includes('Select an AI provider'), 'the UI calls gateways providers rather than model vendors')
  t.ok(settings.includes("data-id='bankOfAIEndpointTypeSelect'"), 'users can select either supported API format')
  t.ok(chat.includes('DEFAULT_AI_VENDOR') && chat.includes('DEFAULT_AI_MODEL'), 'Chat state shares the same default source of truth')
  t.ok(webpack.includes("'process.env.TRON_BANK_OF_AI_ENABLED'"), 'production builds expose an operational kill switch')
  var disabledDefault = childProcess.execFileSync(process.execPath, ['--input-type=module', '-e', 'import(\'./libs/remix-code-reader/src/services/aiProviderConfig.js\').then((m) => process.stdout.write(m.DEFAULT_AI_VENDOR))'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, TRON_BANK_OF_AI_ENABLED: 'false' }
  })
  t.equal(disabledDefault, 'Anthropic', 'the kill switch falls back to Anthropic instead of leaving an invalid default')
  t.end()
})

test('Bank of AI model loading is explicit, authenticated, bounded and endpoint-aware', async function (t) {
  var config = await configPromise
  var settings = fs.readFileSync(path.join(root, 'libs/remix-code-reader/src/components/Chat/ChatSet/index.js'), 'utf8')
  var chat = fs.readFileSync(path.join(root, 'libs/remix-code-reader/src/components/Chat/index.js'), 'utf8')
  var captured
  var models = await config.fetchBankOfAIModels({
    apiKey: 'bank-secret-key',
    endpointType: 'anthropic',
    fetchImpl: async function (url, options) {
      captured = { url, options }
      return {
        ok: true,
        json: async function () {
          return {
            data: [
              { id: 'claude-sonnet', name: 'Claude Sonnet', supported_endpoint_types: ['anthropic'] },
              { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', supported_endpoint_types: ['anthropic', 'openai'] },
              { id: 'openai-only', supported_endpoint_types: ['openai'] },
              { id: 'missing-capability-metadata' },
              { id: 'claude-sonnet', supported_endpoint_types: ['anthropic'] }
            ]
          }
        }
      }
    }
  })

  t.equal(captured.url, 'https://api.bankofai.io/v1/models', 'models use the documented endpoint')
  t.equal(captured.options.headers.Authorization, 'Bearer bank-secret-key', 'the BYOK key is sent only in the request header')
  t.deepEqual(models, [{ value: 'claude-sonnet', label: 'Claude Sonnet · via Bank of AI' }], 'unsupported, retired, incomplete and duplicate models are excluded')
  t.notOk(models.some(function (model) { return model.value === 'claude-sonnet-4-5' }), 'retired Claude Sonnet 4.5 is excluded from live Bank discovery')
  t.ok(config.BANK_OF_AI_KEY_URL.includes('source=tronide'), 'key creation carries the TronIDE acquisition source')
  t.equal(config.bankOfAIBaseUrl('anthropic'), 'https://api.bankofai.io', 'Anthropic-compatible requests use the API origin')
  t.equal(config.bankOfAIBaseUrl('openai'), 'https://api.bankofai.io/v1', 'OpenAI-compatible requests use the versioned base URL')
  t.equal(config.isSafeAIBaseUrl(''), true, 'an empty URL selects the official provider endpoint')
  t.equal(config.isSafeAIBaseUrl('https://gateway.example/v1'), true, 'remote gateways require HTTPS')
  t.equal(config.isSafeAIBaseUrl('http://localhost:8787/v1'), true, 'loopback HTTP remains available for local relays')
  t.equal(config.isSafeAIBaseUrl('http://gateway.example/v1'), false, 'non-loopback HTTP is rejected before a key can be sent')
  var anthropicOfficialOrigin = config.providerEndpointOrigin({ vendor: 'Anthropic', baseUrl: '' })
  var bankOfficialOrigin = config.providerEndpointOrigin({ vendor: 'Bank of AI', baseUrl: '' })
  var relayOrigin = config.providerEndpointOrigin({ vendor: 'Anthropic', baseUrl: 'https://gateway.example/v1' })
  t.equal(config.resolveProviderApiKey({
    currentVendor: 'Anthropic',
    nextVendor: 'Bank of AI',
    currentKey: 'legacy-claude-key',
    currentEndpointOrigin: anthropicOfficialOrigin,
    nextEndpointOrigin: bankOfficialOrigin
  }), '', 'an Anthropic key is never copied to the Bank of AI origin')
  t.equal(config.resolveProviderApiKey({
    currentVendor: 'Anthropic',
    nextVendor: 'Bank of AI',
    currentKey: 'legacy-claude-key',
    currentEndpointOrigin: relayOrigin,
    nextEndpointOrigin: relayOrigin
  }), 'legacy-claude-key', 'a legacy Anthropic key follows an explicit switch only on the same custom gateway origin')
  var bankBinding = config.providerApiKeyBinding({ vendor: 'Bank of AI', endpointOrigin: bankOfficialOrigin })
  t.equal(config.resolveProviderApiKey({
    currentVendor: 'Anthropic',
    nextVendor: 'Bank of AI',
    currentKey: 'legacy-claude-key',
    currentEndpointOrigin: anthropicOfficialOrigin,
    nextEndpointOrigin: bankOfficialOrigin,
    rememberedKeys: { [bankBinding]: 'bank-key' }
  }), 'bank-key', 'an explicitly entered key is recalled only for its exact provider and origin')
  t.equal(config.resolveProviderApiKey({
    currentVendor: 'Bank of AI',
    nextVendor: 'OpenAI',
    currentKey: 'bank-key',
    currentEndpointOrigin: bankOfficialOrigin,
    nextEndpointOrigin: config.providerEndpointOrigin({ vendor: 'OpenAI', baseUrl: '' })
  }), '', 'keys are not copied to unrelated providers')
  t.ok(settings.includes('resolveProviderApiKey'), 'provider switching uses the legacy-key compatibility resolver')
  t.notOk(chat.includes('apiKey={apiKey}'), 'a remounted settings panel cannot adopt an unbound parent key')
  t.ok(settings.includes("const [apiKey, setApiKey] = useState('')"), 'a fresh settings panel always starts without a key')
  t.end()
})

test('Bank model discovery never forwards custom-gateway credentials to the official origin', async function (t) {
  var config = await configPromise
  var requested = false
  try {
    await config.fetchBankOfAIModels({
      apiKey: 'custom-gateway-key',
      baseUrl: 'https://gateway.example/v1',
      fetchImpl: async function () {
        requested = true
        throw new Error('must not run')
      }
    })
    t.fail('custom-gateway model discovery should fail closed')
  } catch (error) {
    t.match(error.message, /custom gateway/, 'the UI receives a safe custom-gateway explanation')
  }
  t.equal(requested, false, 'no request reaches the Bank of AI model endpoint')
  t.end()
})

test('Bank model loading accepts only the latest matching request context', async function (t) {
  var config = await configPromise
  var request = {
    generation: 4,
    vendor: 'Bank of AI',
    endpointType: 'anthropic',
    endpointOrigin: 'https://api.bankofai.io',
    model: 'claude-sonnet-4-6',
    keyBinding: 'Bank of AI\nhttps://api.bankofai.io'
  }
  var current = { ...request, mounted: true }
  t.equal(config.isBankModelLoadContextCurrent(request, current), true, 'an unchanged live context accepts its response')
  var contextFields = ['generation', 'vendor', 'endpointType', 'endpointOrigin', 'model', 'keyBinding']
  contextFields.forEach(function (field) {
    t.equal(config.isBankModelLoadContextCurrent(request, { ...current, [field]: `${current[field]}-changed` }), false, `${field} drift rejects the late response`)
  })
  t.equal(config.isBankModelLoadContextCurrent(request, { ...current, mounted: false }), false, 'an unmounted panel rejects the late response')

  var settings = fs.readFileSync(path.join(root, 'libs/remix-code-reader/src/components/Chat/ChatSet/index.js'), 'utf8')
  t.ok(settings.includes('bankModelLoadControllerRef.current.abort()'), 'provider, endpoint and key changes abort an in-flight model request')
  t.ok(settings.includes('disabled={bankModelLoad.loading || !bankHasBoundOfficialKey}'), 'custom gateways cannot trigger the official model endpoint')
  t.end()
})

test('Bank provider errors are bounded and credential-free at every boundary', async function (t) {
  var config = await configPromise
  var tools = await toolsPromise
  var unsafe = new Error('request failed: Authorization=Bearer sk-ant-super-secret-key')
  unsafe.name = 'APIError'
  unsafe.status = 401
  unsafe.cause = { headers: { Authorization: 'Bearer sk-ant-super-secret-key' } }
  var safe = config.sanitizeAIError(unsafe)
  t.notOk(safe.message.includes('super-secret-key'), 'sanitized messages do not retain API key material')
  t.equal(safe.status, 401, 'safe errors retain only the bounded HTTP status')
  t.notOk('cause' in safe, 'safe errors do not retain SDK request/response causes')
  t.ok(safe.message.length <= 500, 'safe messages are bounded')

  var events = []
  try {
    await tools.anthropicChatWithTools({
      apiKey: 'test',
      model: 'claude-sonnet',
      aiModelVendor: 'Bank of AI',
      userContent: 'status',
      anthropicClient: {
        messages: {
          create: async function () {
            var error = new Error('Authorization: Bearer sk-ant-upstream-secret')
            error.status = 401
            throw error
          }
        }
      },
      executeTool: async function () { t.fail('no tool should execute') },
      onProviderRequest: function (event) { events.push(event) }
    })
    t.fail('the provider error should reject the tool loop')
  } catch (error) {
    t.notOk(error.cause, 'wrapped provider errors do not expose the raw SDK cause')
    t.notOk(error.message.includes('upstream-secret'), 'wrapped provider errors redact credential material')
  }
  t.equal(events.length, 1, 'provider metrics receive one failure event')
  t.notOk(events[0].error.message.includes('upstream-secret'), 'metrics receive the sanitized error only')
  t.end()
})

test('Chat snapshots and invalidates provider settings around async file reads', function (t) {
  var chat = fs.readFileSync(path.join(root, 'libs/remix-code-reader/src/components/Chat/index.js'), 'utf8')
  var stream = fs.readFileSync(path.join(root, 'libs/remix-code-reader/src/components/Chat/useStream/index.js'), 'utf8')
  t.ok(chat.includes('_aiRequestConfigRevision'), 'Chat tracks provider configuration revisions')
  t.ok(chat.includes('AI settings changed. Submit the request again.'), 'a settings race fails closed before network dispatch')
  t.ok(chat.includes('runWorkspaceToolChat(_userContent, taskEntry, requestConfig)'), 'workspace actions receive the same request snapshot')
  t.ok(chat.includes('apiKey: requestConfig.apiKey'), 'workspace requests use the snapshotted API key')
  t.ok(stream.includes('console.error("fetchStreamData error:", safeError)'), 'plain chat logs only sanitized provider errors')
  t.end()
})

test('Bank of AI reuses the canonical tool loop and emits aggregate-only request evidence', async function (t) {
  var tools = await toolsPromise
  var events = []
  var text = await tools.anthropicChatWithTools({
    apiKey: 'test',
    model: 'claude-sonnet',
    aiModelVendor: 'Bank of AI',
    userContent: 'status',
    anthropicClient: {
      messages: {
        create: async function () {
          return { content: [{ type: 'text', text: 'BANK-OK' }], stop_reason: 'end_turn' }
        }
      }
    },
    executeTool: async function () { t.fail('no tool should execute') },
    onProviderRequest: function (event) { events.push(event) }
  })

  t.equal(text, 'BANK-OK', 'the Bank response uses the existing Anthropic-compatible runtime')
  t.equal(events.length, 1, 'one upstream model turn emits one request metric')
  t.equal(events[0].status, 'succeeded', 'only normalized request status is required downstream')
  t.ok(Number.isFinite(events[0].durationMs), 'request latency is reduced to a numeric duration')
  t.end()
})
