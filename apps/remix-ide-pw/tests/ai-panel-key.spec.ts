import { test, expect, Page } from '@playwright/test'
import { gotoHome, treeItem, ensureFilePanel, getEditorText, toolResultSummary, dismissWelcomeModal } from './helpers'

// TC-AI-002 (v2.3.2): the AI key field's format hint is advisory and must not
// misfire. A valid-shaped key pasted WITH surrounding whitespace (the classic
// provider-console copy artifact) is trimmed before storage and validation, and
// an emptied field means "no key yet", not a format error. The old code stored
// the RAW value while validating the TRIMMED one, so a key with a trailing
// linebreak could look accepted here and still 401 at the vendor.

const FAKE_VALID_SHAPE = 'sk-ant-api03-' + 'a'.repeat(77) // 90 chars, charset-safe, obviously fake

async function setChatState (page: Page, state: unknown) {
  await page.evaluate(async (nextState) => {
    const input = document.querySelector('.textarea-wrapper textarea') as any
    const reactKey = input && Object.keys(input).find((key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'))
    let fiber = reactKey ? input[reactKey] : null
    for (let depth = 0; fiber && depth < 100; depth++, fiber = fiber.return) {
      if (fiber.stateNode && typeof fiber.stateNode.executeAiTool === 'function') {
        await new Promise<void>((resolve) => fiber.stateNode.setState(nextState, resolve))
        return
      }
    }
    throw new Error('Unable to locate the Chat component instance')
  }, state)
}

test.describe('AI panel API key input', () => {
  test('TC-AI-BOA-001: Bank of AI is default and loads its compatible models only on demand', { tag: '@gate' }, async ({ page }) => {
    let authorization = ''
    let chatKey = ''
    await page.route('https://api.bankofai.io/v1/models', async (route) => {
      authorization = route.request().headers().authorization || ''
      return route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*' },
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'claude-sonnet-bank', name: 'Claude Sonnet Bank', supported_endpoint_types: ['anthropic'] },
            { id: 'openai-only-bank', name: 'OpenAI Only', supported_endpoint_types: ['openai'] }
          ]
        })
      })
    })
    await page.route('https://api.bankofai.io/v1/messages', async (route) => {
      chatKey = route.request().headers()['x-api-key'] || ''
      return route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*' },
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'bank-chat', type: 'message', role: 'assistant', model: 'claude-sonnet-bank',
          content: [{ type: 'text', text: 'BANK-CHAT-OK' }], stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 }
        })
      })
    })

    await gotoHome(page)
    await expect(page.locator('[data-id="aiModelVendorSelect"]')).toContainText('Bank of AI')
    await expect(page.locator('[data-id="bankOfAIEndpointTypeSelect"]')).toContainText('Anthropic-compatible')
    await expect(page.locator('[data-id="aiBaseUrlInput"]')).toHaveValue('')
    await expect(page.locator('[data-id="bankOfAIProviderNotice"]')).toContainText('multi-model gateway')
    await expect(page.getByRole('link', { name: 'Get a Bank of AI API Key' })).toHaveAttribute('href', /source=tronide/)
    await expect(page.locator('[data-id="bankOfAILoadModels"]')).toBeDisabled()

    await page.locator('[data-id="aiApiKeyInput"]').fill('bank-test-key')
    await expect(page.locator('[data-id="bankOfAILoadModels"]')).toBeEnabled()
    await page.locator('[data-id="bankOfAILoadModels"]').click()
    await expect(page.locator('[data-id="bankOfAILoadModels"]')).toContainText('Load available models')
    await expect(page.getByText('1 models loaded in memory.')).toBeVisible()
    await expect(page.locator('[data-id="aiModelSelect"]')).toContainText('Claude Sonnet Bank')
    expect(authorization).toBe('Bearer bank-test-key')

    await page.locator('.textarea-wrapper textarea').fill('reply through Bank of AI')
    await page.locator('.textarea-wrapper textarea').press('Enter')
    await expect(page.getByText('BANK-CHAT-OK').first()).toBeVisible({ timeout: 15_000 })
    expect(chatKey).toBe('bank-test-key')
    await page.locator('.ai-topset-wrapper .ant-collapse-header').click()
    await page.locator('[data-id="aiLocalMetricsDetails"] summary').click()
    await expect(page.locator('[data-id="bankOfAILocalMetrics"]')).toContainText('requests 1 · succeeded 1 · failed 0')
  })

  test('TC-AI-BOA-003: a legacy custom-gateway key never reaches Bank model discovery', { tag: '@gate' }, async ({ page }) => {
    let officialModelRequests = 0
    await page.route('https://api.bankofai.io/v1/models', async (route) => {
      officialModelRequests++
      return route.fulfill({ status: 500, body: 'must not be requested' })
    })

    await gotoHome(page)
    await page.locator('[data-id="aiModelVendorSelect"]').click()
    await page.locator('.ant-select-item-option').filter({ hasText: /^Anthropic$/ }).click()
    await page.locator('[data-id="aiBaseUrlInput"]').fill('https://gateway.example/v1')
    await page.locator('[data-id="aiApiKeyInput"]').fill('legacy-custom-gateway-key')

    await page.locator('[data-id="aiModelVendorSelect"]').click()
    await page.locator('.ant-select-item-option').filter({ hasText: /^Bank of AI$/ }).click()
    await expect(page.locator('[data-id="aiBaseUrlInput"]')).toHaveValue('https://gateway.example/v1')
    await expect(page.locator('[data-id="aiApiKeyInput"]')).toHaveValue('legacy-custom-gateway-key')
    await expect(page.locator('[data-id="bankOfAILoadModels"]')).toBeDisabled()
    await expect(page.locator('[data-id="bankOfAIModelLoadHelp"]')).toContainText('disabled for custom gateways')
    expect(officialModelRequests).toBe(0)
  })

  test('TC-AI-BOA-004: API keys never follow request URL edits to a different origin', { tag: '@gate' }, async ({ page }) => {
    await gotoHome(page)
    const keyInput = page.locator('[data-id="aiApiKeyInput"]')
    const urlInput = page.locator('[data-id="aiBaseUrlInput"]')

    await keyInput.fill('bank-official-key')
    await urlInput.click()
    await urlInput.pressSequentially('https://gateway.example/v1')
    await expect(keyInput).toHaveValue('')

    await keyInput.fill('gateway-only-key')
    await urlInput.fill('https://other-gateway.example/v1')
    await expect(keyInput).toHaveValue('')

    // Returning to an exact provider + origin recalls only the key that the
    // user entered there; it never resurrects the official key on an
    // intermediate origin created while typing the URL.
    await urlInput.fill('https://gateway.example/another-path')
    await expect(keyInput).toHaveValue('gateway-only-key')
    await urlInput.fill('')
    await expect(keyInput).toHaveValue('bank-official-key')
  })

  test('TC-AI-BOA-002: Anthropic-compatible plain chat decodes streamed and non-streamed Bank replies', { tag: '@gate' }, async ({ page }) => {
    let requests = 0
    await page.route('https://api.bankofai.io/v1/messages', async (route) => {
      requests++
      const request = route.request().postDataJSON()
      const headers = { 'access-control-allow-origin': '*' }
      if (request.stream) {
        const events = [
          ['message_start', { type: 'message_start', message: { id: 'bank-stream', type: 'message', role: 'assistant', content: [], model: request.model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
          ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
          ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'BANK-STREAM-OK' } }],
          ['content_block_stop', { type: 'content_block_stop', index: 0 }],
          ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }],
          ['message_stop', { type: 'message_stop' }]
        ]
        return route.fulfill({
          status: 200,
          headers: { ...headers, 'content-type': 'text/event-stream' },
          body: events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')
        })
      }
      return route.fulfill({
        status: 200,
        headers,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'bank-json', type: 'message', role: 'assistant', model: request.model,
          content: [{ type: 'text', text: 'BANK-NONSTREAM-OK' }], stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 }
        })
      })
    })

    await gotoHome(page)
    await page.locator('[data-id="aiWorkspaceActionsToggle"]').click({ force: true })
    await page.locator('[data-id="aiApiKeyInput"]').fill('bank-test-key')

    await page.locator('.textarea-wrapper textarea').fill('stream through Bank of AI')
    await page.locator('.textarea-wrapper textarea').press('Enter')
    await expect(page.getByText('BANK-STREAM-OK').first()).toBeVisible({ timeout: 15_000 })

    // Sending a message collapses the settings panel. Re-open it and click the
    // visible Ant checkbox label rather than its hidden native input.
    const streamingLabel = page.locator('label.ant-checkbox-wrapper').filter({ hasText: 'Stream responses' })
    if (!await streamingLabel.isVisible()) await page.locator('.ai-topset-wrapper .ant-collapse-header').click()
    await expect(streamingLabel).toBeVisible()
    await streamingLabel.click()
    await expect(page.locator('[data-id="aiStreamingToggle"]')).not.toBeChecked()
    await page.locator('.textarea-wrapper textarea').fill('reply without streaming')
    await page.locator('.textarea-wrapper textarea').press('Enter')
    await expect(page.getByText('BANK-NONSTREAM-OK').first()).toBeVisible({ timeout: 15_000 })
    expect(requests).toBe(2)
  })

  test('TC-AI-TASK-RESUME-001: Continue after refresh keeps the task id and bounded entry context', { tag: '@gate' }, async ({ page }) => {
    const GW = 'https://tron-resume.mock'
    const address = 'TResumeExampleAddress123'
    let requestBody = ''
    await page.route(GW + '/**', async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
      requestBody = route.request().postData() || ''
      return route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*' },
        contentType: 'application/json',
        body: JSON.stringify({ id: 'resume', type: 'message', role: 'assistant', model: 'claude-opus-4-8', content: [{ type: 'text', text: 'RESTORED-TASK-OK' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
      })
    })

    await gotoHome(page)
    await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
    await page.locator('[data-id="aiApiKeyInput"]').fill('resume-test-key')
    const now = Date.now()
    const task = {
      schemaVersion: 1,
      taskId: 'task-persisted-resume',
      goal: 'Continue preparing verification material',
      source: 'deploy:deploy-next-verification',
      workspace: 'default_workspace',
      branch: null,
      entry: { schemaVersion: 1, entryId: 'deploy-next-verification', source: 'deploy', context: { contractAddress: address, contractName: 'Storage', network: 'Nile' } },
      status: 'waiting_for_user',
      createdAt: now - 1000,
      updatedAt: now
    }
    const record = {
      schemaVersion: 1,
      task,
      steps: [{ stepId: 'persisted-step', taskId: task.taskId, toolName: 'check_verification', status: 'waiting_for_user', result: { ok: false, code: 'NOT_READY', summary: 'Waiting for the deployment context.', retryable: false, artifacts: [] } }],
      artifacts: [],
      workflowResult: null,
      events: [{ type: 'step.finished', taskId: task.taskId, stepId: 'persisted-step', toolName: 'check_verification', status: 'waiting_for_user', at: now, result: { ok: false, code: 'NOT_READY', summary: 'Waiting for the deployment context.', retryable: false, artifacts: [] } }],
      updatedAt: now
    }
    await setChatState(page, { aiTaskHistory: [record], activeKey: [] })

    await page.locator('[data-id="aiTaskContinue"]').click()
    await expect(page.locator('.textarea-wrapper textarea')).toHaveValue(task.goal)
    await page.locator('.textarea-wrapper textarea').press('Enter')
    await expect(page.getByText('RESTORED-TASK-OK').first()).toBeVisible({ timeout: 15_000 })

    expect(requestBody).toContain(address)
    expect(requestBody).toContain('Deployment context')
    const activeTaskId = await page.evaluate(() => {
      const input = document.querySelector('.textarea-wrapper textarea') as any
      const reactKey = input && Object.keys(input).find((key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'))
      let fiber = reactKey ? input[reactKey] : null
      for (let depth = 0; fiber && depth < 100; depth++, fiber = fiber.return) {
        if (fiber.stateNode && typeof fiber.stateNode.executeAiTool === 'function') return fiber.stateNode._activeAiTask?.taskId || null
      }
      return null
    })
    expect(activeTaskId).toBe(task.taskId)
  })

  test('TC-AI-002: padded key passes, short key hints, empty field is not an error', { tag: '@gate' }, async ({ page }) => {
    await gotoHome(page)
    const input = page.locator('[data-id="aiApiKeyInput"]')
    await input.waitFor({ state: 'visible', timeout: 15_000 })
    // An untouched key field is an empty state, not a format error.
    await expect(page.locator('[data-id="aiApiKeyHint"]')).toHaveCount(0)

    // An obviously-short paste raises the advisory hint.
    await input.fill('sk-short')
    await expect(page.locator('[data-id="aiApiKeyHint"]')).toBeVisible()

    // A valid-shaped key with paste artifacts (surrounding spaces) must NOT
    // hint: the trimmed value is what gets validated and stored.
    await input.fill('  ' + FAKE_VALID_SHAPE + '  ')
    await expect(page.locator('[data-id="aiApiKeyHint"]')).toHaveCount(0)

    // Clearing the field goes back to "no key yet" — no error state.
    await input.fill('')
    await expect(page.locator('[data-id="aiApiKeyHint"]')).toHaveCount(0)
  })

  // TC-AI-003 (v2.3.2): AI gateways/relays. A custom "Request URL" routes the
  // chat request to that base URL (instead of the official vendor endpoint) and
  // relaxes the key-format hint — gateway keys have arbitrary shapes. The
  // gateway origin is fully mocked via page.route: real UI, zero network.
  test('TC-AI-003: a custom request URL routes chat through the gateway and relaxes the key hint', { tag: '@gate' }, async ({ page }) => {
    const GW = 'https://tron-pw-gateway.mock'
    let apiKeyHeader = ''
    let hitUrl = ''
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': '*'
      }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      apiKeyHeader = req.headers()['x-api-key'] || ''
      hitUrl = req.url()
      // Anthropic-shaped non-stream response (Bank of AI defaults to this API format).
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'msg_mock', type: 'message', role: 'assistant', model: 'claude-opus-4-8',
          content: [{ type: 'text', text: 'GATEWAY-OK' }],
          stop_reason: 'end_turn', stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 }
        })
      })
    })

    await gotoHome(page)

    // Default Bank of AI provider with Anthropic-compatible workspace actions runs the
    // non-streaming tool loop, so the mock can answer with a single JSON body.

    // A short gateway key alone raises the format hint…
    const keyInput = page.locator('[data-id="aiApiKeyInput"]')
    await keyInput.fill('sk-gw-shortkey-123')
    await expect(page.locator('[data-id="aiApiKeyHint"]')).toBeVisible()

    // …and setting a request URL clears the origin-bound key. Re-entering the
    // same short key for the custom gateway suppresses the official-format hint.
    await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
    await expect(keyInput).toHaveValue('')
    await keyInput.fill('sk-gw-shortkey-123')
    await expect(page.locator('[data-id="aiApiKeyHint"]')).toHaveCount(0)
    await expect(page.locator('[data-id="aiBaseUrlHint"]')).toHaveCount(0)

    // Ask something — the request must hit the gateway, not the official API.
    await page.locator('.textarea-wrapper textarea').fill('ping')
    await page.locator('.textarea-wrapper textarea').press('Enter')
    await expect(page.getByText('GATEWAY-OK').first()).toBeVisible({ timeout: 15_000 })
    expect(hitUrl).toContain(GW + '/v1/messages')
    expect(apiKeyHeader).toBe('sk-gw-shortkey-123')
  })

  // TC-AI-004 (v2.3.2): workspace actions. When the model answers with a
  // create_file tool call, the panel asks the user to confirm and then really
  // writes the file into the workspace, feeding a tool_result back to the model.
  // Two-step mocked conversation, real UI end to end, zero network.
  test('TC-AI-004: an AI create_file tool call asks for confirmation and lands in the workspace', { tag: '@gate' }, async ({ page }) => {
    const GW = 'https://tron-pw-gateway.mock'
    const FILE = 'contracts/AiDemo.sol'
    const SOURCE = '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract AiDemo {}\n'
    let calls = 0
    let secondBody = ''
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': '*'
      }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      calls++
      const common = { id: 'msg_' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      if (calls === 1) {
        return route.fulfill({
          status: 200, headers: cors, contentType: 'application/json',
          body: JSON.stringify({
            ...common,
            content: [
              { type: 'text', text: 'Creating the contract now.' },
              { type: 'tool_use', id: 'tu_1', name: 'create_file', input: { path: FILE, content: SOURCE } }
            ],
            stop_reason: 'tool_use'
          })
        })
      }
      secondBody = req.postData() || ''
      return route.fulfill({
        status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'DONE-CREATED' }], stop_reason: 'end_turn' })
      })
    })

    await gotoHome(page)
    await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
    await page.locator('[data-id="aiApiKeyInput"]').fill('sk-gw-shortkey-123')

    // Ask for the file; the mocked model responds with a create_file tool call.
    await page.locator('.textarea-wrapper textarea').fill('please create the AiDemo contract')
    await page.locator('.textarea-wrapper textarea').press('Enter')

    // The write is gated behind an explicit confirmation showing the path.
    const confirmModal = page.locator('.ant-modal-confirm')
    await expect(confirmModal).toBeVisible({ timeout: 15_000 })
    await expect(confirmModal).toContainText(FILE)
    await expect(confirmModal).toContainText('Workspace/branch write lock: held by this task')
    const heldLock = await page.evaluate(() => {
      const raw = localStorage.getItem('tronide.ai.write-lock.v1')
      return raw ? JSON.parse(raw) : null
    })
    expect(heldLock?.taskId).toMatch(/^task-/)
    expect(heldLock?.toolName).toBe('create_file')
    expect(heldLock?.context?.workspace).toBeTruthy()
    expect(calls).toBe(1)
    await confirmModal.locator('.ant-btn-primary').click()

    // The loop finishes with the model's follow-up text…
    await expect(page.getByText('DONE-CREATED').first()).toBeVisible({ timeout: 15_000 })
    // …the tool_result went back to the model…
    expect(secondBody).toContain('tool_result')
    expect(secondBody).toContain('Created ' + FILE)
    // …and the file really exists in the workspace tree.
    await expect(page.locator(`[data-id="treeViewLitreeViewItem${FILE}"]`)).toBeAttached({ timeout: 15_000 })
    await expect.poll(() => page.evaluate(() => localStorage.getItem('tronide.ai.write-lock.v1'))).toBeNull()
  })

  // TC-AI-004b (v2.3.2): "open X" opens the file in the editor via open_file —
  // not read_file. Two-step mocked conversation; the real editor opens the tab.
  test('TC-AI-004b: an open_file tool call opens the file in the editor', { tag: '@gate' }, async ({ page }) => {
    const GW = 'https://tron-pw-gateway.mock'
    const FILE = 'contracts/3_Ballot.sol'
    let secondBody = ''
    let calls = 0
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      calls++
      const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      if (calls === 1) {
        return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
          body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu_o', name: 'open_file', input: { path: FILE } }], stop_reason: 'tool_use' }) })
      }
      secondBody = req.postData() || ''
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'OPENED-OK' }], stop_reason: 'end_turn' }) })
    })

    await gotoHome(page)
    await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
    await page.locator('[data-id="aiApiKeyInput"]').fill('sk-gw-shortkey-123')
    await page.locator('.textarea-wrapper textarea').fill('open the ballot contract')
    await page.locator('.textarea-wrapper textarea').press('Enter')

    await expect(page.getByText('OPENED-OK').first()).toBeVisible({ timeout: 15_000 })
    expect(secondBody).toContain('Opened ' + FILE)
    // The editor actually opened the file — its content is now Ballot's.
    await page.locator('#input').waitFor({ timeout: 15_000 })
    await expect.poll(() => getEditorText(page), { timeout: 15_000 }).toContain('contract Ballot')
  })

  // TC-AI-005 (v2.3.2): list_files must handle the workspace ROOT. Models pass
  // path "." or "" for "list the workspace"; that used to be rejected / return
  // empty, so the assistant wrongly concluded the workspace was empty. The tool
  // now lists the real root entries (directories flagged with a trailing slash).
  test('TC-AI-005: list_files "." lists the real workspace root, not empty', { tag: '@gate' }, async ({ page }) => {
    const GW = 'https://tron-pw-gateway.mock'
    let toolResult = ''
    let calls = 0
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      calls++
      const common = { id: 'msg_' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      if (calls === 1) {
        return route.fulfill({
          status: 200, headers: cors, contentType: 'application/json',
          body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu_ls', name: 'list_files', input: { path: '.' } }], stop_reason: 'tool_use' })
        })
      }
      // Capture the tool_result the model was fed for the list_files call.
      try {
        const sent = JSON.parse(req.postData() || '{}')
        const toolMsg = (sent.messages || []).find((m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'tool_result'))
        const block = toolMsg && toolMsg.content.find((c) => c.type === 'tool_result')
        toolResult = block ? toolResultSummary(block.content) : ''
      } catch (e) { toolResult = 'PARSE_ERROR' }
      return route.fulfill({
        status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'LISTED-OK' }], stop_reason: 'end_turn' })
      })
    })

    await gotoHome(page)
    await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
    await page.locator('[data-id="aiApiKeyInput"]').fill('sk-gw-shortkey-123')
    await page.locator('.textarea-wrapper textarea').fill('what is in this workspace?')
    await page.locator('.textarea-wrapper textarea').press('Enter')

    await expect(page.getByText('LISTED-OK').first()).toBeVisible({ timeout: 15_000 })
    // The default workspace seeds a contracts/ folder — the root listing must
    // contain it (flagged as a directory), and must not be the empty sentinel.
    expect(toolResult).not.toBe('(empty directory)')
    expect(toolResult).toContain('contracts/')
  })

  // TC-AI-006 (v2.3.2): the AI can read what the user has OPEN in the editor.
  // "read the code on the left" gave the model no handle before — it only knew
  // paths. read_current_file returns the active file's path + content, and
  // list_open_files reports the open tabs.
  test('TC-AI-006: read_current_file returns the active editor file', { tag: '@gate' }, async ({ page }) => {
    const GW = 'https://tron-pw-gateway.mock'
    let toolResult = ''
    let calls = 0
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      calls++
      const common = { id: 'msg_' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      if (calls === 1) {
        return route.fulfill({
          status: 200, headers: cors, contentType: 'application/json',
          body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu_rc', name: 'read_current_file', input: {} }], stop_reason: 'tool_use' })
        })
      }
      try {
        const sent = JSON.parse(req.postData() || '{}')
        const toolMsg = (sent.messages || []).find((m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'tool_result'))
        const block = toolMsg && toolMsg.content.find((c) => c.type === 'tool_result')
        toolResult = block ? toolResultSummary(block.content) : ''
      } catch (e) { toolResult = 'PARSE_ERROR' }
      return route.fulfill({
        status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'READ-OK' }], stop_reason: 'end_turn' })
      })
    })

    await gotoHome(page)
    // Open a specific file in the editor so it becomes the active file.
    await ensureFilePanel(page)
    const f = page.locator(treeItem('contracts/1_Storage.sol'))
    if (!await f.isVisible().catch(() => false)) await page.locator(treeItem('contracts')).click()
    await f.click()
    await page.locator('#input').waitFor({ timeout: 10_000 })

    await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
    await page.locator('[data-id="aiApiKeyInput"]').fill('sk-gw-shortkey-123')
    await page.locator('.textarea-wrapper textarea').fill('explain the code I have open')
    await page.locator('.textarea-wrapper textarea').press('Enter')

    await expect(page.getByText('READ-OK').first()).toBeVisible({ timeout: 15_000 })
    // The tool_result must carry the active file's path and its real content.
    expect(toolResult).toContain('1_Storage.sol')
    expect(toolResult).toContain('contract Storage')
  })

  // TC-AI-007 (v2.3.2): the workspace toolset offered to the model must include
  // every capability — notably compile_contract, so "compile this contract"
  // reaches the compiler. Asserting the advertised tools is deterministic; the
  // compile round-trip itself runs real solc and is exercised in the live env.
  test('TC-AI-007: the model is offered the full workspace toolset incl. compile_contract', { tag: '@gate' }, async ({ page }) => {
    const GW = 'https://tron-pw-gateway.mock'
    let toolNames: string[] = []
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      try {
        const sent = JSON.parse(req.postData() || '{}')
        toolNames = (sent.tools || []).map((t: any) => t.name)
      } catch (e) { toolNames = ['PARSE_ERROR'] }
      return route.fulfill({
        status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-4-8', content: [{ type: 'text', text: 'TOOLSET-READY' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
      })
    })

    await gotoHome(page)
    await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
    await page.locator('[data-id="aiApiKeyInput"]').fill('sk-gw-shortkey-123')
    await page.locator('.textarea-wrapper textarea').fill('what tools do you have')
    await page.locator('.textarea-wrapper textarea').press('Enter')

    await expect(page.getByText('TOOLSET-READY').first()).toBeVisible({ timeout: 15_000 })
    for (const t of ['read_current_file', 'list_open_files', 'open_file', 'create_file', 'read_file', 'list_files', 'compile_contract', 'set_compiler_version']) {
      expect(toolNames, `tool ${t} must be advertised to the model`).toContain(t)
    }
  })

  // TC-AI-008 (v2.3.2): an AI action reveals its tool panel. compile_contract
  // switches the left side panel to the Solidity Compiler (activating it if
  // needed) so the run and its result are visible — the "联动" the user asked
  // for. We assert the panel appears; the compile round-trip itself needs real
  // solc (env-bound) so we don't wait for it to finish.
  test('TC-AI-008: compile_contract reveals the Solidity Compiler panel', { tag: '@gate' }, async ({ page }) => {
    const GW = 'https://tron-pw-gateway.mock'
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      // Always answer with the compile tool call (the second turn won't be
      // reached: the real compile blocks, which is fine — we only assert the
      // panel reveal that happens before it).
      return route.fulfill({
        status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-4-8', content: [{ type: 'tool_use', id: 'tu_c', name: 'compile_contract', input: { path: 'contracts/1_Storage.sol' } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } })
      })
    })

    await gotoHome(page)
    // The file explorer is the default left panel; the compiler is not shown.
    await expect(page.locator('[data-id="compilerContainerCompileBtn"]')).toBeHidden()

    await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
    await page.locator('[data-id="aiApiKeyInput"]').fill('sk-gw-shortkey-123')
    await page.locator('.textarea-wrapper textarea').fill('compile the storage contract')
    await page.locator('.textarea-wrapper textarea').press('Enter')

    // The tool run switches the left panel to the Solidity Compiler.
    await expect(page.locator('[data-id="compilerContainerCompileBtn"]')).toBeVisible({ timeout: 20_000 })
  })

  // TC-AI-021 (v2.3.2): compiling a wrong path returns the real .sol file list
  // instead of the compiler's opaque "Invalid input source specified", so the
  // model can fix the path without a separate list_files round-trip.
  test('TC-AI-021: compile_contract on a missing path lists the workspace contracts', { tag: '@gate' }, async ({ page }) => {
    const GW = 'https://tron-pw-gateway.mock'
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
    let toolResult = ''
    let calls = 0
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      calls++
      const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', usage: { input_tokens: 1, output_tokens: 1 } }
      if (calls === 1) {
        return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
          body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu_c', name: 'compile_contract', input: { path: 'contracts/Storage.sol' } }], stop_reason: 'tool_use' }) })
      }
      try {
        const sent = JSON.parse(req.postData() || '{}')
        const msg = (sent.messages || []).find((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'))
        const block = msg && msg.content.find((c: any) => c.type === 'tool_result')
        toolResult = block ? toolResultSummary(block.content) : ''
      } catch (e) { toolResult = 'PARSE_ERROR' }
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'COMPILE-DONE' }], stop_reason: 'end_turn' }) })
    })

    await gotoHome(page)
    await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
    await page.locator('[data-id="aiApiKeyInput"]').fill('sk-gw-shortkey-123')
    await page.locator('.textarea-wrapper textarea').fill('compile contracts/Storage.sol')
    await page.locator('.textarea-wrapper textarea').press('Enter')

    await expect(page.getByText('COMPILE-DONE').first()).toBeVisible({ timeout: 20_000 })
    // the wrong path (contracts/Storage.sol) is reported as missing, and the
    // real default-workspace contract (contracts/1_Storage.sol) is listed
    expect(toolResult).toMatch(/No file at "contracts\/Storage\.sol"/)
    expect(toolResult).toMatch(/contracts\/1_Storage\.sol/)
    expect(toolResult).not.toMatch(/Invalid input source/)
  })

  // TC-AI-011 (v2.3.2): Esc interrupts a running compile immediately. The
  // compile wait now listens to the abort signal, so pressing Esc mid-compile
  // stops the whole tool loop right away instead of waiting out the 60s budget.
  test('TC-AI-011: Esc interrupts a compile tool call promptly', { tag: '@gate' }, async ({ page }) => {
    const GW = 'https://tron-pw-gateway.mock'
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      return route.fulfill({
        status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-4-8', content: [{ type: 'tool_use', id: 'tu_c', name: 'compile_contract', input: { path: 'contracts/1_Storage.sol' } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } })
      })
    })

    await gotoHome(page)
    await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
    await page.locator('[data-id="aiApiKeyInput"]').fill('sk-gw-shortkey-123')
    await page.locator('.textarea-wrapper textarea').fill('compile the storage contract')
    await page.locator('.textarea-wrapper textarea').press('Enter')

    // The compile is now running (panel revealed, Stop shown).
    await expect(page.locator('[data-id="aiStopButton"]')).toBeVisible({ timeout: 15_000 })

    // Esc aborts the in-progress compile immediately — Stopped shows well within
    // the 60s compile budget, proving the wait honors the abort signal.
    await page.keyboard.press('Escape')
    await expect(page.getByText('⏹ Stopped.').first()).toBeVisible({ timeout: 12_000 })
    await expect(page.locator('[data-id="aiStopButton"]')).toHaveCount(0)
  })

  // TC-AI-009 (v2.3.2): pressing Esc (or the Stop button) aborts an in-flight AI
  // request. The gateway is mocked to HANG so the request stays pending until the
  // client aborts it; the panel then shows "Stopped" and leaves loading.
  test('TC-AI-009: Esc stops an in-flight AI request', { tag: '@gate' }, async ({ page }) => {
    const GW = 'https://tron-pw-gateway.mock'
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      // Hang forever — never fulfill. The client-side abort is what ends it.
      await new Promise(() => {})
    })

    await gotoHome(page)
    await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
    await page.locator('[data-id="aiApiKeyInput"]').fill('sk-gw-shortkey-123')
    await page.locator('.textarea-wrapper textarea').fill('think hard about something')
    await page.locator('.textarea-wrapper textarea').press('Enter')

    // The request is now in flight — the Stop affordance shows.
    await expect(page.locator('[data-id="aiStopButton"]')).toBeVisible({ timeout: 10_000 })

    // Press Esc → the request aborts and the panel reports it stopped.
    await page.keyboard.press('Escape')
    await expect(page.getByText('⏹ Stopped.').first()).toBeVisible({ timeout: 10_000 })
    // Loading is over — the Stop affordance is gone.
    await expect(page.locator('[data-id="aiStopButton"]')).toHaveCount(0)
  })

  // TC-AI-010 (v2.3.2): ArrowUp/ArrowDown recall previously-sent questions in the
  // AI input (shell-style history). No key/network needed — history is built
  // from the user's own submitted messages.
  test('TC-AI-010: ArrowUp/Down recall previously-sent questions', { tag: '@gate' }, async ({ page }) => {
    const GW = 'https://tron-pw-gateway.mock'
    let replies = 0
    // Answer instantly so each submit completes and becomes history.
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      replies++
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({
          id: `m-${replies}`,
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-4-8',
          content: [{ type: 'text', text: `HISTORY-OK-${replies}` }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 }
        })
      })
    })

    await gotoHome(page)
    await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
    await page.locator('[data-id="aiApiKeyInput"]').fill('sk-gw-shortkey-123')

    const box = page.locator('.textarea-wrapper textarea')
    // Send two questions so there is a history to recall.
    await box.fill('first question')
    await box.press('Enter')
    await expect(page.getByText('HISTORY-OK-1').first()).toBeVisible({ timeout: 15_000 })
    await box.fill('second question')
    await box.press('Enter')
    await expect(page.getByText('HISTORY-OK-2').first()).toBeVisible({ timeout: 15_000 })

    // Type a draft, then ArrowUp recalls the newest, then the older.
    await box.fill('draft in progress')
    await box.focus()
    await box.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0)) // caret at start
    await box.press('ArrowUp')
    await expect(box).toHaveValue('second question')
    await box.press('ArrowUp')
    await expect(box).toHaveValue('first question')

    // ArrowDown steps back toward the newest, then restores the draft.
    await box.press('ArrowDown')
    await expect(box).toHaveValue('second question')
    await box.press('ArrowDown')
    await expect(box).toHaveValue('draft in progress')
  })

  // TC-AI-012 (v2.3.2): a failing request must be VISIBLE. A rejected key /
  // gateway 4xx-5xx used to vanish — the error handler only understood object
  // errors while every catch path passes a string — so the spinner stopped and
  // NOTHING appeared. The 401 must surface as an error bubble in the chat.
  test('TC-AI-012: a 401 from the vendor/gateway renders a visible error in the chat', { tag: '@gate' }, async ({ page }) => {
    const GW = 'https://tron-pw-gateway.mock'
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      return route.fulfill({
        status: 401, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })
      })
    })

    await gotoHome(page)
    await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
    await page.locator('[data-id="aiApiKeyInput"]').fill('sk-gw-shortkey-123')
    await page.locator('.textarea-wrapper textarea').fill('hello?')
    await page.locator('.textarea-wrapper textarea').press('Enter')

    // The failure surfaces as a visible chat item naming the auth error…
    await expect(
      page.locator('#chat-wrapper-id').getByText(/invalid x-api-key|authentication[_ ]error|401/i).first()
    ).toBeVisible({ timeout: 15_000 })
    // …and the panel left the busy state (the user can ask again).
    await expect(page.locator('[data-id="aiStopButton"]')).toHaveCount(0)
    await expect(page.locator('[data-id="aiSendButton"]')).toBeVisible()
  })

  // TC-AI-013 (v2.3.2): IME safety. While a CJK input method is composing,
  // ArrowUp/Down move through the candidate list and Enter confirms a
  // candidate — the chat input must leave those keys to the IME: no history
  // recall, no submit. Composition is simulated by dispatching keydown events
  // with isComposing=true (what a real IME produces mid-composition).
  test('TC-AI-013: composing IME keys are left to the IME (no history recall, no submit)', { tag: '@gate' }, async ({ page }) => {
    const GW = 'https://tron-pw-gateway.mock'
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      return route.fulfill({
        status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-4-8', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
      })
    })

    await gotoHome(page)
    await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
    await page.locator('[data-id="aiApiKeyInput"]').fill('sk-gw-shortkey-123')

    const box = page.locator('.textarea-wrapper textarea')
    // Build one history entry so ArrowUp WOULD recall if unguarded.
    await box.fill('first question')
    await box.press('Enter')
    await expect(box).toHaveValue('', { timeout: 10_000 })

    // Composing ArrowUp at caret 0 must NOT recall history.
    await box.fill('拼音草稿')
    await box.evaluate((el: HTMLTextAreaElement) => {
      el.focus()
      el.setSelectionRange(0, 0)
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true, isComposing: true }))
    })
    await page.waitForTimeout(300)
    await expect(box).toHaveValue('拼音草稿')

    // Composing Enter must NOT submit: the draft stays in the box and no user
    // bubble with the draft text appears in the chat.
    await box.evaluate((el: HTMLTextAreaElement) => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }))
    })
    await page.waitForTimeout(300)
    await expect(box).toHaveValue('拼音草稿')
    await expect(page.locator('#chat-wrapper-id .chat-content-wrapper').getByText('拼音草稿')).toHaveCount(0)

    // A real (non-composing) ArrowUp still recalls history.
    await box.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0))
    await box.press('ArrowUp')
    await expect(box).toHaveValue('first question')
  })

  // TC-AI-014 (v2.3.2): with NO key and the "current file" context selected but
  // nothing open, the panel must ask for the KEY — the current-file read used
  // to run first and surfaced "Read current file error" instead. Also pins the
  // reminder's label casing ('TRON IDE AI Assistant', not ALL-CAPS).
  test('TC-AI-014: missing key is reported before the current-file read', { tag: '@gate' }, async ({ page }) => {
    await gotoHome(page)
    // switch Context to currentFile (antd select renders options in a portal)
    await page.locator('.context-wrap .ant-select-selector').click()
    await page.locator('.ant-select-item-option').filter({ hasText: 'Current file' }).first().click()

    const box = page.locator('.textarea-wrapper textarea')
    await box.fill('what does my code do?')
    await box.press('Enter')

    await expect(page.locator('#chat-wrapper-id').getByText(/TRON IDE AI Assistant.*(?:set|add).*API key/i).first())
      .toBeVisible({ timeout: 10_000 })
    await expect(page.locator('#chat-wrapper-id').getByText(/Read current file error/i)).toHaveCount(0)
  })

  // TC-AI-015 (v2.3.2): the key revealed via the eye toggle re-masks when focus
  // leaves the field (it used to stay plain-text indefinitely).
  test('TC-AI-015: revealed API key re-masks on blur', { tag: '@gate' }, async ({ page }) => {
    await gotoHome(page)
    const input = page.locator('[data-id="aiApiKeyInput"]')
    await expect(page.locator('[data-id="aiKeySecurityNotice"]')).toContainText('API key stays in memory only and clears on panel close or reload')
    await expect(page.locator('[data-id="aiKeySecurityNotice"]')).toContainText('low-limit, non-production key')
    await input.fill('sk-some-secret-key-123')
    await expect(input).toHaveAttribute('type', 'password')

    await page.locator('[data-id="aiApiKeyInput"] ~ span .eye, .eye').first().click()
    await expect(input).toHaveAttribute('type', 'text')

    // focus leaves the field — the key must not stay revealed
    await input.evaluate((el: HTMLInputElement) => el.blur())
    await expect(input).toHaveAttribute('type', 'password')
  })

  test('TC-AI-015b: API key clears on reload and when the AI panel closes', { tag: '@gate' }, async ({ page }) => {
    await gotoHome(page)
    const input = page.locator('[data-id="aiApiKeyInput"]')
    await input.fill('release-test-key-placeholder')

    await page.reload()
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
    await expect(input).toHaveValue('')

    await input.fill('release-test-key-placeholder')
    const toggle = page.getByRole('button', { name: 'Toggle AI Panel' })
    await toggle.click()
    await expect(page.locator('[data-id="remixIdeAiPanel"]')).toBeHidden()
    await toggle.click()
    await expect(page.locator('[data-id="remixIdeAiPanel"]')).toBeVisible()
    await expect(input).toHaveValue('')
  })

  // TC-AI-016 (v2.3.2): with the default tool-capable provider + workspace actions the
  // reply is the non-streaming tool loop, so the streaming checkbox is inert —
  // it must LOOK inert (disabled + note) instead of silently ignored, and come
  // back alive when workspace actions are turned off.
  test('TC-AI-016: streaming checkbox is disabled while workspace actions are on', { tag: '@gate' }, async ({ page }) => {
    await gotoHome(page)
    const streaming = page.locator('[data-id="aiStreamingToggle"]')
    await expect(streaming).toBeDisabled()
    await expect(page.getByText(/unavailable with workspace actions/i)).toBeVisible()

    await page.locator('[data-id="aiWorkspaceActionsToggle"]').click({ force: true })
    await expect(streaming).toBeEnabled()
    await expect(page.getByText(/unavailable with workspace actions/i)).toHaveCount(0)
  })

  // TC-AI-017 (v2.3.2): Esc while the create_file confirmation is open belongs
  // to the MODAL: it rejects that write and the tool loop continues (the model
  // gets the rejection and replies) — it must NOT also abort the whole request
  // (the old behavior: one keypress, two effects).
  test('TC-AI-017: Esc on the write-confirm modal rejects the write without killing the request', { tag: '@gate' }, async ({ page }) => {
    const GW = 'https://tron-pw-gateway.mock'
    let secondBody = ''
    let calls = 0
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      calls++
      const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      if (calls === 1) {
        return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
          body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu_1', name: 'create_file', input: { path: 'contracts/EscTest.sol', content: 'contract EscTest {}' } }], stop_reason: 'tool_use' }) })
      }
      secondBody = req.postData() || ''
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'REJECTION-UNDERSTOOD' }], stop_reason: 'end_turn' }) })
    })

    await gotoHome(page)
    await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
    await page.locator('[data-id="aiApiKeyInput"]').fill('sk-gw-shortkey-123')
    await page.locator('.textarea-wrapper textarea').fill('create the esc test contract')
    await page.locator('.textarea-wrapper textarea').press('Enter')

    const confirmModal = page.locator('.ant-modal-confirm')
    await expect(confirmModal).toBeVisible({ timeout: 15_000 })
    // let the modal's enter animation/focus settle so antd's own keydown
    // handler is guaranteed to receive the Escape
    await expect(confirmModal.locator('.ant-btn-primary')).toBeVisible()
    await page.waitForTimeout(300)
    await page.keyboard.press('Escape')

    // the write was rejected and fed back, the LOOP survived to the next turn…
    await expect(page.getByText('REJECTION-UNDERSTOOD').first()).toBeVisible({ timeout: 15_000 })
    expect(secondBody).toContain('User rejected create_file')
    // …and nothing was aborted
    await expect(page.locator('#chat-wrapper-id').getByText('⏹ Stopped.')).toHaveCount(0)
    await expect(page.locator(`[data-id="treeViewLitreeViewItemcontracts/EscTest.sol"]`)).toHaveCount(0)
  })

  // TC-AI-018 (v2.3.2): Esc on the plain STREAMING path also reports "Stopped"
  // (only the tool loop used to; a streamed answer just went silent).
  test('TC-AI-018: Esc on the streaming path shows the Stopped marker', { tag: '@gate' }, async ({ page }) => {
    const GW = 'https://tron-pw-gateway.mock'
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      await new Promise(() => {}) // hang — only the client abort ends it
    })

    await gotoHome(page)
    // turn OFF workspace actions → Anthropic goes through the streaming path
    await page.locator('[data-id="aiWorkspaceActionsToggle"]').click({ force: true })
    await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
    await page.locator('[data-id="aiApiKeyInput"]').fill('sk-gw-shortkey-123')
    await page.locator('.textarea-wrapper textarea').fill('stream something long')
    await page.locator('.textarea-wrapper textarea').press('Enter')

    await expect(page.locator('[data-id="aiStopButton"]')).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press('Escape')
    await expect(page.locator('#chat-wrapper-id').getByText('⏹ Stopped.').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-id="aiStopButton"]')).toHaveCount(0)
  })

  // TC-AI-019 (v2.3.2): set_compiler_version with a nonexistent version fails
  // FAST against the live version list (it used to poll the full 130s budget
  // before admitting timeout).
  test('TC-AI-019: set_compiler_version rejects an unknown version immediately', { tag: '@gate' }, async ({ page }) => {
    const GW = 'https://tron-pw-gateway.mock'
    let secondBody = ''
    let calls = 0
    await page.route('**/list.json*', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ builds: [
        { path: 'soljson-v0.8.6+commit.0e36fba0.js', version: '0.8.6', build: 'commit.0e36fba0', longVersion: '0.8.6+commit.0e36fba0' },
        { path: 'soljson-v0.8.27+commit.40a35a09.js', version: '0.8.27', build: 'commit.40a35a09', longVersion: '0.8.27+commit.40a35a09' }
      ] })
    }))
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      calls++
      const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      if (calls === 1) {
        return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
          body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu_v', name: 'set_compiler_version', input: { version: '9.9.9' } }], stop_reason: 'tool_use' }) })
      }
      secondBody = req.postData() || ''
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'VERSION-REJECTED' }], stop_reason: 'end_turn' }) })
    })

    await gotoHome(page)
    await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
    await page.locator('[data-id="aiApiKeyInput"]').fill('sk-gw-shortkey-123')
    await page.locator('.textarea-wrapper textarea').fill('switch the compiler to 9.9.9')
    await page.locator('.textarea-wrapper textarea').press('Enter')

    // well under the old 130s poll budget
    await expect(page.getByText('VERSION-REJECTED').first()).toBeVisible({ timeout: 30_000 })
    expect(secondBody).toContain('does not exist in the Tron solc list')
  })

  // TC-AI-020 (v2.3.2): the busy-state Stop button's styling CONTRACT. The JS
  // only swaps class names (ai-busy-stop / ai-stop-glyph); their look lives in
  // index.css — so a stylesheet-only regression (orphaned class) degrades the
  // affordance to an invisible glyph while every behavior test stays green.
  // Pin the computed styles to the CSS the classes are supposed to resolve to.
  test('TC-AI-020: while busy, the Stop button is visibly styled (red fill, visible glyph)', { tag: '@gate' }, async ({ page }) => {
    const GW = 'https://tron-pw-gateway.mock'
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      await gate // hold the response open so the busy state is observable
      try {
        return await route.fulfill({
          status: 200, headers: cors, contentType: 'application/json',
          body: JSON.stringify({
            id: 'msg_mock', type: 'message', role: 'assistant', model: 'claude-opus-4-8',
            content: [{ type: 'text', text: 'DONE' }], stop_reason: 'end_turn', stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 }
          })
        })
      } catch (e) { /* the client aborted after Stop — nothing to fulfill */ }
    })

    await gotoHome(page)
    await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
    await page.locator('[data-id="aiApiKeyInput"]').fill('sk-gw-stopbtn-123')
    await page.locator('.textarea-wrapper textarea').fill('ping')
    await page.locator('.textarea-wrapper textarea').press('Enter')

    const stopBtn = page.locator('[data-id="aiStopButton"]')
    await expect(stopBtn).toBeVisible({ timeout: 15_000 })
    const styles = await stopBtn.evaluate((el) => {
      const btn = getComputedStyle(el)
      const glyph = el.querySelector('.ai-stop-glyph') as HTMLElement | null
      const g = glyph ? getComputedStyle(glyph) : null
      const r = glyph ? glyph.getBoundingClientRect() : { width: 0, height: 0 }
      return { btnBg: btn.backgroundColor, cursor: btn.cursor, glyphBg: g && g.backgroundColor, w: r.width, h: r.height }
    })
    expect(styles.btnBg).toBe('rgb(192, 57, 43)') // .ai-busy-stop red (#c0392b)
    expect(styles.cursor).toBe('pointer')
    expect(styles.glyphBg).toBe('rgb(255, 255, 255)') // white stop square
    expect(styles.w).toBeGreaterThan(6)
    expect(styles.h).toBeGreaterThan(6)

    // Stop works and restores the send affordance
    await stopBtn.click()
    await expect(page.locator('[data-id="aiSendButton"]')).toBeVisible({ timeout: 10_000 })
    release()
  })
})
