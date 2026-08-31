import { test, expect, Page } from '@playwright/test'
import { gotoHome, toolResultSummary, useBuiltinCompiler } from './helpers'

// Phase-B AI workspace tools (v2.3.2): deploy / interact / verification.
// Deploy + read are exercised end-to-end on the JavaScript VM (Tron) — free,
// no wallet — so the whole pipeline (compile artifact → deploy → read state)
// runs deterministically. The Anthropic gateway is mocked (multi-tool).

const GW = 'https://tron-pw-gateway.mock'
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const VERIFY_ADDR = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const VERIFY_PATH = `.verification/Storage-${VERIFY_ADDR}.json`

async function openHome (page: Page) {
  await gotoHome(page)
}
async function setKeyAndGateway (page: Page) {
  await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
  await page.locator('[data-id="aiApiKeyInput"]').fill('sk-gw-shortkey-123')
}
async function ask (page: Page, q: string) {
  await page.locator('.textarea-wrapper textarea').fill(q)
  await page.locator('.textarea-wrapper textarea').press('Enter')
}

// Serve a fixed sequence of tool calls, capturing each tool_result in order.
async function mockToolSequence (
  page: Page,
  tools: Array<{ name: string, input: any }>,
  finalText: string,
  onToolResult?: (result: string, index: number) => Promise<void> | void
) {
  const cap: { results: string[] } = { results: [] }
  let calls = 0
  await page.route(GW + '/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    let toolResult: string | null = null
    try {
      const sent = JSON.parse(req.postData() || '{}')
      const msg = [...(sent.messages || [])].reverse().find((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'))
      const block = msg && msg.content.find((c: any) => c.type === 'tool_result')
      if (block) toolResult = toolResultSummary(block.content)
    } catch (e) { /* first turn */ }
    if (toolResult !== null) {
      cap.results.push(toolResult)
      if (onToolResult) await onToolResult(toolResult, cap.results.length - 1)
    }
    const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
    const tool = tools[calls]
    calls++
    if (tool) {
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu' + calls, name: tool.name, input: tool.input }], stop_reason: 'tool_use' })
      })
    }
    return route.fulfill({
      status: 200,
      headers: cors,
      contentType: 'application/json',
      body: JSON.stringify({ ...common, content: [{ type: 'text', text: finalText }], stop_reason: 'end_turn' })
    })
  })
  return cap
}

async function readWorkspaceFile (page: Page, path: string) {
  return page.evaluate((p) => {
    try {
      const ws = (document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement)?.value || 'default_workspace'
      return (window as any).remixFileSystem.readFileSync(`.workspaces/${ws}/${p}`, 'utf8')
    } catch (e) { return null }
  }, path)
}

async function writeWorkspaceFile (page: Page, path: string, content: string) {
  await page.evaluate(({ p, value }) => {
    const ws = (document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement)?.value || 'default_workspace'
    const fs = (window as any).remixFileSystem
    const full = `.workspaces/${ws}/${p}`
    const dir = full.slice(0, full.lastIndexOf('/'))
    try { fs.mkdirSync(dir) } catch (e) { /* already exists */ }
    fs.writeFileSync(full, value)
  }, { p: path, value: content })
}

// prepare_verification opens the generated file. Simulate a later user save in
// both the active Ace buffer and the provider so fileManager sees the same
// content the user sees when undo_last_change performs its safety comparison.
async function editOpenWorkspaceFile (page: Page, path: string, content: string) {
  await page.evaluate(({ p, value }) => {
    const ws = (document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement)?.value || 'default_workspace'
    const editor = (document.getElementById('input') as any)?.editor
    if (editor) editor.session.setValue(value)
    const fs = (window as any).remixFileSystem
    fs.writeFileSync(`.workspaces/${ws}/${p}`, value)
  }, { p: path, value: content })
}

async function failAsyncWorkspaceReads (page: Page, path: string) {
  await page.evaluate((p) => {
    const ws = (document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement)?.value || 'default_workspace'
    const fs = (window as any).remixFileSystem
    const full = `.workspaces/${ws}/${p}`
    const originalReadFile = fs.readFile
    fs.readFile = function (target: string, ...args: any[]) {
      if (String(target) === full) {
        const callback = args[args.length - 1]
        if (typeof callback === 'function') {
          queueMicrotask(() => callback(new Error('injected read failure')))
          return
        }
        throw new Error('injected read failure')
      }
      return originalReadFile.call(this, target, ...args)
    }
  }, path)
}

async function failWorkspaceExistsChecks (page: Page, path: string) {
  await page.evaluate((p) => {
    const ws = (document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement)?.value || 'default_workspace'
    const fs = (window as any).remixFileSystem
    const full = `.workspaces/${ws}/${p}`
    const originalExistsSync = fs.existsSync
    fs.existsSync = function (target: string) {
      if (String(target) === full) throw new Error('injected exists failure')
      return originalExistsSync.call(this, target)
    }
  }, path)
}

async function setChatWorkspaceLookupResult (page: Page, workspace: string) {
  await page.evaluate((workspaceName) => {
    const input = document.querySelector('.textarea-wrapper textarea') as any
    const reactKey = input && Object.keys(input).find((key) =>
      key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'))
    let fiber = reactKey ? input[reactKey] : null
    for (let depth = 0; fiber && depth < 100; depth++, fiber = fiber.return) {
      if (fiber.stateNode && typeof fiber.stateNode.executeAiTool === 'function') {
        fiber.stateNode._wsName = async () => workspaceName
        return
      }
    }
    throw new Error('Unable to locate the Chat component instance')
  }, workspace)
}

// Compile the default Storage contract and make sure the udapp is on the VM.
async function compileStorageOnVM (page: Page) {
  const f = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
  if (!await f.isVisible().catch(() => false)) {
    const folder = page.locator('[data-id="treeViewLitreeViewItemcontracts"]')
    await folder.waitFor({ state: 'visible', timeout: 15_000 })
    await folder.click()
  }
  await f.click()
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  await useBuiltinCompiler(page)
  await page.locator('[data-id="compilerContainerCompileBtn"]').click()
  await expect(page.locator('[data-id="compiledContracts"]')).toContainText('Storage', { timeout: 60_000 })
  // ensure the Deploy & Run env is the JavaScript VM (default), not injected
  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.locator('#selectExEnvOptions').waitFor({ timeout: 15_000 })
  const vmVal = await page.evaluate(() => {
    const sel = document.querySelector('#selectExEnvOptions') as HTMLSelectElement
    const opt = Array.from(sel.options).find((o) => /javascript vm/i.test(o.textContent || ''))
    return opt ? opt.value : null
  })
  if (vmVal) await page.selectOption('#selectExEnvOptions', vmVal)
}

test.describe('AI workspace tools — phase B (deploy / interact / verify)', () => {
  // TC-AI-TOOL-010: list_deployable_contracts names the compiled contract and
  // the environment.
  test('TC-AI-TOOL-010: list_deployable_contracts reports contract + environment', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockToolSequence(page, [{ name: 'list_deployable_contracts', input: {} }], 'LIST-DONE')
    await openHome(page)
    await compileStorageOnVM(page)
    await setKeyAndGateway(page)
    await ask(page, 'What can I deploy?')
    await expect(page.getByText('LIST-DONE').first()).toBeVisible({ timeout: 20_000 })
    expect(cap.results[0]).toMatch(/Storage/)
    expect(cap.results[0]).toMatch(/VM|Injected/i)
  })

  // TC-AI-TOOL-011: the compile→deploy→read pipeline on the VM. An address-aware
  // mock threads the deployed address (from the deploy tool_result) into the
  // retrieve() read — proving the deploy returns a usable address and a view
  // call decodes the contract's state (initial retrieve() == 0).
  test('TC-AI-TOOL-011: deploy_contract on the VM then read_contract state', { tag: '@gate' }, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    const cap: { results: string[] } = { results: [] }
    let deployedAddr = ''
    let calls = 0
    const plan = [
      { name: 'deploy_contract', input: { contract_name: 'Storage', args: [] } },
      { name: 'read_contract', input: { address: '__ADDR__', contract_name: 'Storage', method: 'retrieve', args: [] } }
    ]
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      try {
        const sent = JSON.parse(req.postData() || '{}')
        const msg = [...(sent.messages || [])].reverse().find((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'))
        const block = msg && msg.content.find((c: any) => c.type === 'tool_result')
        if (block) {
          const s = toolResultSummary(block.content)
          cap.results.push(s)
          const m = s.match(/at (0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})/)
          if (m) deployedAddr = m[1]
        }
      } catch (e) { /* first turn */ }
      const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      const step = plan[calls]
      calls++
      if (step) {
        const input = JSON.parse(JSON.stringify(step.input).replace(/__ADDR__/g, deployedAddr))
        return route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu' + calls, name: step.name, input }], stop_reason: 'tool_use' })
        })
      }
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'PIPELINE-DONE' }], stop_reason: 'end_turn' })
      })
    })

    await openHome(page)
    await compileStorageOnVM(page)
    await setKeyAndGateway(page)
    await ask(page, 'Deploy Storage, then read its stored value.')

    // deploy raises one confirm modal
    const modal = page.locator('.ant-modal-confirm')
    await expect(modal).toBeVisible({ timeout: 30_000 })
    await expect(modal).toContainText('DEPLOY Storage')
    await modal.locator('.ant-btn-primary').click()

    await expect(page.getByText('PIPELINE-DONE').first()).toBeVisible({ timeout: 60_000 })
    expect(cap.results[0]).toMatch(/Deployed Storage at (0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})/)
    // the view call decoded the initial stored value (0)
    expect(cap.results[1]).toMatch(/Storage\.retrieve\(\).*\b0\b/)
    expect(cap.results[1]).not.toMatch(/failed|charAt|encoding arguments/i)
    // J-015: the AI-deployed contract must surface as an instance card in the
    // Deploy & Run panel (aiDeploy registers it via the same events as a manual
    // deploy) — not just live on-chain. Before the fix it deployed but left the
    // panel empty, so the user couldn't interact with it through the UI.
    await expect(page.locator('.instance').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.instance').first()).toContainText(/Storage/i)
    expect(pageErrors).toEqual([])
  })

  // TC-AI-TOOL-014: deploy → write_contract → read_contract in ONE round.
  // The write is gated by a confirm modal, returns a tx hash, and the read
  // issued immediately after MUST observe the committed value (42) — pins the
  // same-round write→read state visibility fix (isolated-snapshot eth_call in
  // txRunnerVM); before it, the read could surface the stale pre-write state.
  test('TC-AI-TOOL-014: write_contract commits state a same-round read_contract observes', { tag: '@gate' }, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    const cap: { results: string[] } = { results: [] }
    let deployedAddr = ''
    let calls = 0
    const plan = [
      { name: 'deploy_contract', input: { contract_name: 'Storage', args: [] } },
      { name: 'write_contract', input: { address: '__ADDR__', contract_name: 'Storage', method: 'store', args: [42] } },
      { name: 'read_contract', input: { address: '__ADDR__', contract_name: 'Storage', method: 'retrieve', args: [] } }
    ]
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      try {
        const sent = JSON.parse(req.postData() || '{}')
        const msg = [...(sent.messages || [])].reverse().find((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'))
        const block = msg && msg.content.find((c: any) => c.type === 'tool_result')
        if (block) {
          const s = toolResultSummary(block.content)
          cap.results.push(s)
          const m = s.match(/at (0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})/)
          if (m) deployedAddr = m[1]
        }
      } catch (e) { /* first turn */ }
      const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      const step = plan[calls]
      calls++
      if (step) {
        const input = JSON.parse(JSON.stringify(step.input).replace(/__ADDR__/g, deployedAddr))
        return route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu' + calls, name: step.name, input }], stop_reason: 'tool_use' })
        })
      }
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'WRITE-READ-DONE' }], stop_reason: 'end_turn' })
      })
    })

    await openHome(page)
    await compileStorageOnVM(page)
    await setKeyAndGateway(page)
    await ask(page, 'Deploy Storage, store 42, then read it back.')

    // two confirm modals: the deploy, then the state-changing write. Filter by
    // text — the deploy modal's leave-animation overlaps the store modal's
    // entry, so a bare .ant-modal-confirm matches both.
    const deployModal = page.locator('.ant-modal-confirm').filter({ hasText: 'DEPLOY Storage' })
    await expect(deployModal).toBeVisible({ timeout: 30_000 })
    await deployModal.locator('.ant-btn-primary').click()
    const storeModal = page.locator('.ant-modal-confirm').filter({ hasText: /send Storage\.store/ })
    await expect(storeModal).toBeVisible({ timeout: 30_000 })
    await storeModal.locator('.ant-btn-primary').click()

    await expect(page.getByText('WRITE-READ-DONE').first()).toBeVisible({ timeout: 60_000 })
    expect(cap.results[0]).toMatch(/Deployed Storage at (0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})/)
    expect(cap.results[1]).toMatch(/Sent Storage\.store\(\) — transaction 0x[0-9a-fA-F]{64}/)
    // the same-round read must see the committed 42, not the stale 0
    // (result shape is `Storage.retrieve() → {"0":"42"}` — "0" is the output
    // index key, so pin the VALUE)
    expect(cap.results[2]).toMatch(/Storage\.retrieve\(\).*\b42\b/)
    expect(cap.results[2]).not.toMatch(/failed/i)
    expect(cap.results[2]).not.toMatch(/:\s*"?0"?\s*}/)
    expect(pageErrors).toEqual([])
  })

  // TC-AI-TOOL-015: money flows end-to-end — a payable constructor funded via
  // deploy_contract{value}, a payable method funded via write_contract{value},
  // and the read back sums BOTH amounts (so each leg is proven, not just one).
  // The confirm modals must show the amount in SUN and TRX before approval.
  test('TC-AI-TOOL-015: deploy/write with value fund a payable contract, read sums it', { tag: '@gate' }, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    const cap: { results: string[] } = { results: [] }
    let deployedAddr = ''
    let calls = 0
    const plan = [
      { name: 'deploy_contract', input: { contract_name: 'Vault', args: [], value: '1000000' } },
      { name: 'write_contract', input: { address: '__ADDR__', contract_name: 'Vault', method: 'deposit', args: [], value: '2500000' } },
      { name: 'read_contract', input: { address: '__ADDR__', contract_name: 'Vault', method: 'got', args: [] } }
    ]
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      try {
        const sent = JSON.parse(req.postData() || '{}')
        const msg = [...(sent.messages || [])].reverse().find((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'))
        const block = msg && msg.content.find((c: any) => c.type === 'tool_result')
        if (block) {
          const s = toolResultSummary(block.content)
          cap.results.push(s)
          const m = s.match(/at (0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})/)
          if (m) deployedAddr = m[1]
        }
      } catch (e) { /* first turn */ }
      const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      const step = plan[calls]
      calls++
      if (step) {
        const input = JSON.parse(JSON.stringify(step.input).replace(/__ADDR__/g, deployedAddr))
        return route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu' + calls, name: step.name, input }], stop_reason: 'tool_use' })
        })
      }
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'MONEY-DONE' }], stop_reason: 'end_turn' })
      })
    })

    await openHome(page)
    await compileStorageOnVM(page)
    // Swap the buffer for a payable contract and recompile.
    const source = [
      '// SPDX-License-Identifier: GPL-3.0',
      'pragma solidity >=0.8.2 <0.9.0;',
      'contract Vault {',
      '  constructor() payable {}',
      '  function deposit() public payable {}',
      '  function got() public view returns (uint256) { return address(this).balance; }',
      '}'
    ].join('\n')
    await page.locator('#input').waitFor({ timeout: 10_000 })
    await page.evaluate((src) => {
      const el = document.getElementById('input') as any
      el.editor.session.setValue(src)
    }, source)
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('[data-id="compiledContracts"]')).toContainText('Vault', { timeout: 60_000 })
    await page.locator('#icon-panel div[plugin="udapp"]').click()

    await setKeyAndGateway(page)
    await ask(page, 'Deploy Vault with 1 TRX, deposit 2.5 TRX, then read the balance.')

    // deploy modal shows the deployment value
    const deployModal = page.locator('.ant-modal-confirm').filter({ hasText: 'DEPLOY Vault' })
    await expect(deployModal).toBeVisible({ timeout: 30_000 })
    await expect(deployModal).toContainText('Value: 1000000 SUN (1 TRX)')
    await deployModal.locator('.ant-btn-primary').click()
    // write modal shows the call value
    const depositModal = page.locator('.ant-modal-confirm').filter({ hasText: /send Vault\.deposit/ })
    await expect(depositModal).toBeVisible({ timeout: 30_000 })
    await expect(depositModal).toContainText('Value: 2500000 SUN (2.5 TRX)')
    await depositModal.locator('.ant-btn-primary').click()

    await expect(page.getByText('MONEY-DONE').first()).toBeVisible({ timeout: 60_000 })
    expect(cap.results[0]).toMatch(/Deployed Vault at (0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})/)
    expect(cap.results[1]).toMatch(/Sent Vault\.deposit\(\) — transaction 0x[0-9a-fA-F]{64}/)
    // 1,000,000 (deploy) + 2,500,000 (deposit) SUN — both legs landed
    expect(cap.results[2]).toMatch(/Vault\.got\(\).*\b3500000\b/)
    expect(pageErrors).toEqual([])
  })

  // TC-AI-TOOL-016: the ABI survives later compilations, and an explicit abi
  // parameter works without any matching workspace artifact. Before the fix
  // read/write_contract resolved ONLY against the LAST compilation, so
  // compiling file B broke every follow-up call on contract A.
  test('TC-AI-TOOL-016: read_contract works after another compile, and via an explicit abi', { tag: '@gate' }, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    const storageAbi = [{ type: 'function', name: 'retrieve', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] }]
    const cap: { results: string[] } = { results: [] }
    let deployedAddr = ''
    let calls = 0
    // one stateful plan across TWO asks; nulls mark each ask's final text turn
    const plan = [
      { name: 'deploy_contract', input: { contract_name: 'Storage', args: [] } },
      { name: 'write_contract', input: { address: '__ADDR__', contract_name: 'Storage', method: 'store', args: [42] } },
      null, // -> PHASE-DONE-1
      { name: 'read_contract', input: { address: '__ADDR__', contract_name: 'Storage', method: 'retrieve', args: [] } },
      null, // -> PHASE-DONE-2
      { name: 'read_contract', input: { address: '__ADDR__', contract_name: 'External', method: 'retrieve', args: [], abi: storageAbi } },
      null // -> PHASE-DONE-3
    ]
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      try {
        const sent = JSON.parse(req.postData() || '{}')
        const msg = [...(sent.messages || [])].reverse().find((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'))
        const block = msg && msg.content.find((c: any) => c.type === 'tool_result')
        if (block) {
          const s = toolResultSummary(block.content)
          cap.results.push(s)
          const m = s.match(/at (0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})/)
          if (m) deployedAddr = m[1]
        }
      } catch (e) { /* first turn */ }
      const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      const step = plan[calls]
      const phase = plan.slice(0, calls + 1).filter((p) => p === null).length + 1
      calls++
      if (step) {
        const input = JSON.parse(JSON.stringify(step.input).replace(/__ADDR__/g, deployedAddr))
        return route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu' + calls, name: step.name, input }], stop_reason: 'tool_use' })
        })
      }
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: `PHASE-DONE-${phase - 1}` }], stop_reason: 'end_turn' })
      })
    })

    await openHome(page)
    await compileStorageOnVM(page)
    await setKeyAndGateway(page)

    // phase 1: deploy Storage + store(42)
    await ask(page, 'Deploy Storage and store 42.')
    const deployModal = page.locator('.ant-modal-confirm').filter({ hasText: 'DEPLOY Storage' })
    await expect(deployModal).toBeVisible({ timeout: 30_000 })
    await deployModal.locator('.ant-btn-primary').click()
    const storeModal = page.locator('.ant-modal-confirm').filter({ hasText: /send Storage\.store/ })
    await expect(storeModal).toBeVisible({ timeout: 30_000 })
    await storeModal.locator('.ant-btn-primary').click()
    await expect(page.getByText('PHASE-DONE-1').first()).toBeVisible({ timeout: 60_000 })

    // clobber __last: compile a DIFFERENT contract
    const source = [
      '// SPDX-License-Identifier: GPL-3.0',
      'pragma solidity >=0.8.2 <0.9.0;',
      'contract Other { function ping() public pure returns (uint256) { return 1; } }'
    ].join('\n')
    await page.locator('#input').waitFor({ timeout: 10_000 })
    await page.evaluate((src) => {
      const el = document.getElementById('input') as any
      el.editor.session.setValue(src)
    }, source)
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('[data-id="compiledContracts"]')).toContainText('Other', { timeout: 60_000 })

    // phase 2: read Storage by NAME — the per-file artifact must still resolve
    await ask(page, 'Read the stored value back.')
    await expect(page.getByText('PHASE-DONE-2').first()).toBeVisible({ timeout: 60_000 })
    expect(cap.results[2], 'name lookup must survive a later compilation').toMatch(/Storage\.retrieve\(\).*\b42\b/)

    // phase 3: wrong name + explicit abi — must work with no matching artifact
    await ask(page, 'Read it again using the ABI I gave you.')
    await expect(page.getByText('PHASE-DONE-3').first()).toBeVisible({ timeout: 60_000 })
    expect(cap.results[3], 'explicit abi must bypass artifact lookup').toMatch(/External\.retrieve\(\).*\b42\b/)
    expect(pageErrors).toEqual([])
  })

  // TC-AI-TOOL-017: a write that reverts with a CUSTOM ERROR comes back to the
  // model with the error name and its decoded args — not a bare "reverted".
  // Before J-012 the AI write path settled on the transactionExecuted event
  // with a generic message, dropping the reason the decoder already had.
  test('TC-AI-TOOL-017: write_contract surfaces the custom error name + args on revert', { tag: '@gate' }, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    const cap: { results: string[] } = { results: [] }
    let deployedAddr = ''
    let calls = 0
    const plan = [
      { name: 'deploy_contract', input: { contract_name: 'Guard', args: [] } },
      { name: 'write_contract', input: { address: '__ADDR__', contract_name: 'Guard', method: 'withdraw', args: [500] } }
    ]
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      try {
        const sent = JSON.parse(req.postData() || '{}')
        const msg = [...(sent.messages || [])].reverse().find((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'))
        const block = msg && msg.content.find((c: any) => c.type === 'tool_result')
        if (block) {
          const s = toolResultSummary(block.content)
          cap.results.push(s)
          const m = s.match(/at (0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})/)
          if (m) deployedAddr = m[1]
        }
      } catch (e) { /* first turn */ }
      const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      const step = plan[calls]
      calls++
      if (step) {
        const input = JSON.parse(JSON.stringify(step.input).replace(/__ADDR__/g, deployedAddr))
        return route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu' + calls, name: step.name, input }], stop_reason: 'tool_use' })
        })
      }
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'REVERT-DONE' }], stop_reason: 'end_turn' })
      })
    })

    await openHome(page)
    await compileStorageOnVM(page)
    // a contract that reverts with a custom error carrying args
    const source = [
      '// SPDX-License-Identifier: GPL-3.0',
      'pragma solidity >=0.8.2 <0.9.0;',
      'contract Guard {',
      '  error InsufficientBalance(uint256 requested, uint256 available);',
      '  uint256 public total;',
      '  function withdraw(uint256 amount) public {',
      '    if (amount > 100) revert InsufficientBalance(amount, 100);',
      '    total += amount;',
      '  }',
      '}'
    ].join('\n')
    await page.locator('#input').waitFor({ timeout: 10_000 })
    await page.evaluate((src) => {
      const el = document.getElementById('input') as any
      el.editor.session.setValue(src)
    }, source)
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('[data-id="compiledContracts"]')).toContainText('Guard', { timeout: 60_000 })
    await page.locator('#icon-panel div[plugin="udapp"]').click()

    await setKeyAndGateway(page)
    await ask(page, 'Deploy Guard and withdraw 500.')

    const deployModal = page.locator('.ant-modal-confirm').filter({ hasText: 'DEPLOY Guard' })
    await expect(deployModal).toBeVisible({ timeout: 30_000 })
    await deployModal.locator('.ant-btn-primary').click()
    const wModal = page.locator('.ant-modal-confirm').filter({ hasText: /send Guard\.withdraw/ })
    await expect(wModal).toBeVisible({ timeout: 30_000 })
    await wModal.locator('.ant-btn-primary').click()

    await expect(page.getByText('REVERT-DONE').first()).toBeVisible({ timeout: 60_000 })
    // the failed write result names the custom error and carries both args,
    // pinned together so incidental hex in the tx hash can't satisfy /500//100/
    expect(cap.results[1]).toMatch(/Transaction failed/i)
    expect(cap.results[1]).toMatch(/InsufficientBalance\([^)]*\b500\b[^)]*\b100\b[^)]*\)/)
    expect(pageErrors).toEqual([])
  })

  // TC-AI-TOOL-018: debug_transaction summarizes a REAL trace — the store(42)
  // write's storage write shows up as slot=value, proving the trace summary
  // (not just a step count) reaches the model.
  test('TC-AI-TOOL-018: debug_transaction reports the storage write from a real trace', { tag: '@gate' }, async ({ page }) => {
    const cap: { results: string[] } = { results: [] }
    let deployedAddr = ''
    let txHash = ''
    let calls = 0
    // deploy → store(42) → debug the write tx (hash captured from its result)
    const plan: Array<{ name: string, input: any } | null> = [
      { name: 'deploy_contract', input: { contract_name: 'Storage', args: [] } },
      { name: 'write_contract', input: { address: '__ADDR__', contract_name: 'Storage', method: 'store', args: [42] } },
      { name: 'debug_transaction', input: { tx_hash: '__HASH__' } }
    ]
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      try {
        const sent = JSON.parse(req.postData() || '{}')
        const msg = [...(sent.messages || [])].reverse().find((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'))
        const block = msg && msg.content.find((c: any) => c.type === 'tool_result')
        if (block) {
          const s = toolResultSummary(block.content)
          cap.results.push(s)
          const a = s.match(/at (0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})/)
          if (a) deployedAddr = a[1]
          const h = s.match(/transaction (0x[0-9a-fA-F]{64})/)
          if (h) txHash = h[1]
        }
      } catch (e) { /* first turn */ }
      const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      const step = plan[calls]
      calls++
      if (step) {
        const input = JSON.parse(JSON.stringify(step.input).replace(/__ADDR__/g, deployedAddr).replace(/__HASH__/g, txHash))
        return route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu' + calls, name: step.name, input }], stop_reason: 'tool_use' })
        })
      }
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'DEBUG-DONE' }], stop_reason: 'end_turn' })
      })
    })

    await openHome(page)
    await compileStorageOnVM(page)
    await setKeyAndGateway(page)
    await ask(page, 'Deploy Storage, store 42, then debug that transaction.')

    const deployModal = page.locator('.ant-modal-confirm').filter({ hasText: 'DEPLOY Storage' })
    await expect(deployModal).toBeVisible({ timeout: 30_000 })
    await deployModal.locator('.ant-btn-primary').click()
    const storeModal = page.locator('.ant-modal-confirm').filter({ hasText: /send Storage\.store/ })
    await expect(storeModal).toBeVisible({ timeout: 30_000 })
    await storeModal.locator('.ant-btn-primary').click()

    await expect(page.getByText('DEBUG-DONE').first()).toBeVisible({ timeout: 60_000 })
    // results: [deploy, store, debug]
    expect(cap.results[2]).toMatch(/Opened the Debugger/)
    expect(cap.results[2]).toMatch(/trace step/)
    // the store(42) wrote slot 0 = 0x2a — the summary must surface it
    expect(cap.results[2]).toMatch(/storage writes \(1\)/)
    expect(cap.results[2]).toMatch(/0x0=0x2a/)
  })

  // TC-AI-TOOL-019: list_accounts returns the VM accounts with balances, and a
  // write sent with an explicit `from` actually executes as that account —
  // proving multi-account flows (deploy/write as a chosen sender).
  test('TC-AI-TOOL-019: list_accounts + from-scoped write records the chosen sender', { tag: '@gate' }, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    const cap: { results: string[] } = { results: [] }
    let deployedAddr = ''
    let acct1 = ''
    let calls = 0
    // list_accounts → deploy Recorder → poke from acct1, read → poke default
    // (acct0), read. The two lastCaller reads must differ: proof that `from`
    // changed msg.sender (getAccounts is hex, the read decodes to base58, so we
    // compare the two reads to each other, not to the raw account string).
    const plan: Array<{ name: string, input: any } | null> = [
      { name: 'list_accounts', input: {} },
      { name: 'deploy_contract', input: { contract_name: 'Recorder', args: [] } },
      { name: 'write_contract', input: { address: '__ADDR__', contract_name: 'Recorder', method: 'poke', args: [], from: '__ACCT1__' } },
      { name: 'read_contract', input: { address: '__ADDR__', contract_name: 'Recorder', method: 'lastCaller', args: [] } },
      { name: 'write_contract', input: { address: '__ADDR__', contract_name: 'Recorder', method: 'poke', args: [] } },
      { name: 'read_contract', input: { address: '__ADDR__', contract_name: 'Recorder', method: 'lastCaller', args: [] } }
    ]
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      try {
        const sent = JSON.parse(req.postData() || '{}')
        const msg = [...(sent.messages || [])].reverse().find((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'))
        const block = msg && msg.content.find((c: any) => c.type === 'tool_result')
        if (block) {
          const s = toolResultSummary(block.content)
          cap.results.push(s)
          const a = s.match(/at (0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})/)
          if (a) deployedAddr = a[1]
          // capture account index 1 from the list_accounts output ("1: <addr>")
          const m1 = s.match(/\n1:\s*(T[1-9A-HJ-NP-Za-km-z]{33}|0x[0-9a-fA-F]{40})/)
          if (m1) acct1 = m1[1]
        }
      } catch (e) { /* first turn */ }
      const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      const step = plan[calls]
      calls++
      if (step) {
        const input = JSON.parse(JSON.stringify(step.input).replace(/__ADDR__/g, deployedAddr).replace(/__ACCT1__/g, acct1))
        return route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu' + calls, name: step.name, input }], stop_reason: 'tool_use' })
        })
      }
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'ACCT-DONE' }], stop_reason: 'end_turn' })
      })
    })

    await openHome(page)
    await compileStorageOnVM(page)
    // Recorder stores whoever last called poke().
    const source = [
      '// SPDX-License-Identifier: GPL-3.0',
      'pragma solidity >=0.8.2 <0.9.0;',
      'contract Recorder {',
      '  address public lastCaller;',
      '  function poke() public { lastCaller = msg.sender; }',
      '}'
    ].join('\n')
    await page.locator('#input').waitFor({ timeout: 10_000 })
    await page.evaluate((src) => {
      const el = document.getElementById('input') as any
      el.editor.session.setValue(src)
    }, source)
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('[data-id="compiledContracts"]')).toContainText('Recorder', { timeout: 60_000 })
    await page.locator('#icon-panel div[plugin="udapp"]').click()

    await setKeyAndGateway(page)
    await ask(page, 'List accounts, deploy Recorder, poke it from account 1, then read lastCaller.')

    const deployModal = page.locator('.ant-modal-confirm').filter({ hasText: 'DEPLOY Recorder' })
    await expect(deployModal).toBeVisible({ timeout: 30_000 })
    await deployModal.locator('.ant-btn-primary').click()
    // first poke: from account 1 — confirm modal shows the chosen sender
    const pokeFrom = page.locator('.ant-modal-confirm:visible').filter({ hasText: acct1 })
    await expect(pokeFrom).toBeVisible({ timeout: 30_000 })
    await pokeFrom.locator('.ant-btn-primary').click()
    await expect(page.locator('.ant-modal-confirm:visible').filter({ hasText: acct1 })).toHaveCount(0, { timeout: 20_000 })
    // second poke: default account (no From line)
    const pokeDefault = page.locator('.ant-modal-confirm').filter({ hasText: /send Recorder\.poke/ })
    await expect(pokeDefault).toBeVisible({ timeout: 30_000 })
    await pokeDefault.locator('.ant-btn-primary').click({ force: true })

    await expect(page.getByText('ACCT-DONE').first()).toBeVisible({ timeout: 60_000 })
    // list_accounts listed accounts with TRX balances
    expect(cap.results[0]).toMatch(/Accounts \(env:/)
    expect(cap.results[0]).toMatch(/TRX/)
    expect(acct1).toBeTruthy()
    // results: [list, deploy, poke1, read1(acct1), poke2, read2(acct0)].
    // The two reads decode a real address each and must DIFFER — the `from`
    // account 1 write and the default account 0 write recorded different senders.
    const read1 = cap.results[3].replace(/\s+/g, '')
    const read2 = cap.results[5].replace(/\s+/g, '')
    expect(read1).toMatch(/address:/i)
    expect(read2).toMatch(/address:/i)
    expect(read1).not.toBe(read2)
    expect(pageErrors).toEqual([])
  })

  // TC-AI-TOOL-012: check_verification on a bogus address reports not-found
  // (reaches TronScan) or a clear reachability error — never crashes.
  test('TC-AI-TOOL-012: check_verification returns a clear status', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockToolSequence(page, [{ name: 'check_verification', input: { address: 'TXYZabc0000000000000000000000000000', network: 'mainnet' } }], 'VERIFY-DONE')
    await openHome(page)
    await setKeyAndGateway(page)
    await ask(page, 'Is my contract verified?')
    await expect(page.getByText('VERIFY-DONE').first()).toBeVisible({ timeout: 25_000 })
    expect(cap.results[0]).toMatch(/verified|not found|Invalid TRON address|Could not (reach|check)/i)
  })

  test('TC-AI-TOOL-012B: check_verification never guesses a missing network', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockToolSequence(page, [{ name: 'check_verification', input: { address: VERIFY_ADDR } }], 'VERIFY-NETWORK-DONE')
    await openHome(page)
    await setKeyAndGateway(page)
    await ask(page, 'Check this contract without a network.')
    await expect(page.getByText('VERIFY-NETWORK-DONE').first()).toBeVisible({ timeout: 25_000 })
    expect(cap.results[0]).toMatch(/provide the TRON network.*mainnet.*nile.*shasta/i)
  })

  // TC-AI-TOOL-026: prepare_verification builds the TronScan metadata from the
  // last compilation, asks before writing it, saves only after approval, and
  // returns the verify URL. (Submission itself is a manual external step.)
  test('TC-AI-TOOL-026: prepare_verification confirms, writes metadata and returns the TronScan URL', { tag: '@gate' }, async ({ page }) => {
    // A real, valid TRON address — prepare_verification only
    // needs a well-formed address; it does not query the chain.
    const cap = await mockToolSequence(page, [{ name: 'prepare_verification', input: { address: VERIFY_ADDR, network: 'nile' } }], 'PREP-DONE')
    await openHome(page)
    await compileStorageOnVM(page)
    await setKeyAndGateway(page)
    await ask(page, 'Prepare the TronScan verification metadata for my Storage contract.')

    const modal = page.locator('.ant-modal-confirm').filter({ hasText: VERIFY_PATH })
    await expect(modal).toBeVisible({ timeout: 25_000 })
    await expect(modal).toContainText('AI wants to save verification metadata')
    await expect(modal).toContainText('undo_last_change can remove it')
    await expect(page.locator('[data-id="contractVerificationNetworkSelect"]')).toHaveValue('nile')
    await expect(page.locator('[data-id="contractVerificationAddressInput"]')).toHaveValue(VERIFY_ADDR)
    await expect(page.locator('[data-id="contractVerificationOpenTronScan"]')).toHaveAttribute('href', 'https://nile.tronscan.org/#/contracts/verify')
    // Reaching the modal must not have written anything yet.
    expect(await readWorkspaceFile(page, VERIFY_PATH)).toBeNull()
    await modal.locator('.ant-btn-primary').click()

    await expect(page.getByText('PREP-DONE').first()).toBeVisible({ timeout: 25_000 })
    // the result names the contract, saves a file, and links TronScan
    expect(cap.results[0]).toMatch(/Verification metadata ready for Storage/)
    expect(cap.results[0]).toMatch(/\.verification\/Storage-[A-Za-z0-9]+\.json/)
    expect(cap.results[0]).toMatch(/TronScan does not accept this JSON/i)
    expect(cap.results[0]).toContain('https://nile.tronscan.org/#/contracts/verify')
    // the package file was actually written and is valid standard-JSON input
    const saved = await readWorkspaceFile(page, VERIFY_PATH)
    expect(saved).toMatch(/standardJsonInput/)
    expect(saved).toContain(VERIFY_ADDR)
    expect(saved).toContain('"network": "Nile"')
  })

  // TC-AI-TOOL-040: rejection is a hard stop. Package generation itself is
  // read-only; the target must remain absent when the write modal is rejected.
  test('TC-AI-TOOL-040: rejecting prepare_verification leaves the workspace untouched', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockToolSequence(page, [{ name: 'prepare_verification', input: { address: VERIFY_ADDR, network: 'mainnet' } }], 'PREP-REJECT-DONE')
    await openHome(page)
    await compileStorageOnVM(page)
    await setKeyAndGateway(page)
    await ask(page, 'Prepare it, but let me decide whether the package is saved.')

    const modal = page.locator('.ant-modal-confirm').filter({ hasText: VERIFY_PATH })
    await expect(modal).toBeVisible({ timeout: 25_000 })
    expect(await readWorkspaceFile(page, VERIFY_PATH)).toBeNull()
    await modal.locator('.ant-btn').filter({ hasText: 'Reject' }).click()

    await expect(page.getByText('PREP-REJECT-DONE').first()).toBeVisible({ timeout: 25_000 })
    expect(cap.results[0]).toMatch(/User rejected prepare_verification/i)
    expect(await readWorkspaceFile(page, VERIFY_PATH)).toBeNull()
  })

  // TC-AI-TOOL-041: an approved overwrite records the exact prior package in
  // the session undo stack; undo restores it instead of deleting the path.
  test('TC-AI-TOOL-041: undo restores the package that prepare_verification overwrote', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockToolSequence(page, [
      { name: 'prepare_verification', input: { address: VERIFY_ADDR, network: 'mainnet' } },
      { name: 'undo_last_change', input: {} }
    ], 'PREP-UNDO-DONE')
    await openHome(page)
    await compileStorageOnVM(page)
    await writeWorkspaceFile(page, VERIFY_PATH, 'USER-PREVIOUS-PACKAGE')
    await setKeyAndGateway(page)
    await ask(page, 'Replace the old package, then undo that replacement.')

    const overwrite = page.locator('.ant-modal-confirm').filter({ hasText: `OVERWRITE ${VERIFY_PATH}` })
    await expect(overwrite).toBeVisible({ timeout: 25_000 })
    await expect(overwrite).toContainText('existing file content is replaced')
    await overwrite.locator('.ant-btn-primary').click()

    const undo = page.locator('.ant-modal-confirm').filter({ hasText: 'AI wants to UNDO its last change' })
    await expect(undo).toBeVisible({ timeout: 25_000 })
    await expect(undo).toContainText(`restore the previous content of ${VERIFY_PATH}`)
    await undo.locator('.ant-btn-primary').click()

    await expect(page.getByText('PREP-UNDO-DONE').first()).toBeVisible({ timeout: 25_000 })
    expect(cap.results[1]).toMatch(/Undone.*restore the previous content/)
    expect(await readWorkspaceFile(page, VERIFY_PATH)).toBe('USER-PREVIOUS-PACKAGE')
  })

  // TC-AI-TOOL-042: undo uses the generated package as a compare-and-swap
  // guard. A later user save must survive; the assistant refuses to undo it.
  test('TC-AI-TOOL-042: undo never overwrites a later user edit to verification metadata', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockToolSequence(page, [
      { name: 'prepare_verification', input: { address: VERIFY_ADDR, network: 'mainnet' } },
      { name: 'undo_last_change', input: {} }
    ], 'PREP-EDIT-GUARD-DONE', async (_result, index) => {
      if (index === 0) await editOpenWorkspaceFile(page, VERIFY_PATH, 'USER-EDIT-AFTER-AI')
    })
    await openHome(page)
    await compileStorageOnVM(page)
    await setKeyAndGateway(page)
    await ask(page, 'Prepare the package, then undo it.')

    const modal = page.locator('.ant-modal-confirm').filter({ hasText: VERIFY_PATH })
    await expect(modal).toBeVisible({ timeout: 25_000 })
    await modal.locator('.ant-btn-primary').click()

    // No undo confirmation is shown: the pre-confirm guard detects the later
    // edit and refuses before offering a destructive action.
    await expect(page.getByText('PREP-EDIT-GUARD-DONE').first()).toBeVisible({ timeout: 25_000 })
    expect(cap.results[1]).toMatch(/changed since I created it.*not undoing/i)
    expect(await readWorkspaceFile(page, VERIFY_PATH)).toBe('USER-EDIT-AFTER-AI')
  })

  // TC-AI-TOOL-043: approval applies to the exact pre-modal state. If another
  // actor creates the target while the user reviews the modal, do not overwrite.
  test('TC-AI-TOOL-043: prepare_verification refuses a file that appears while confirmation is open', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockToolSequence(page, [{ name: 'prepare_verification', input: { address: VERIFY_ADDR, network: 'mainnet' } }], 'PREP-CAS-DONE')
    await openHome(page)
    await compileStorageOnVM(page)
    await setKeyAndGateway(page)
    await ask(page, 'Prepare the package and save it if the target is still free.')

    const modal = page.locator('.ant-modal-confirm').filter({ hasText: VERIFY_PATH })
    await expect(modal).toBeVisible({ timeout: 25_000 })
    await writeWorkspaceFile(page, VERIFY_PATH, 'USER-CREATED-WHILE-REVIEWING')
    await modal.locator('.ant-btn-primary').click()

    await expect(page.getByText('PREP-CAS-DONE').first()).toBeVisible({ timeout: 25_000 })
    expect(cap.results[0]).toMatch(/appeared while the confirmation was open.*nothing was written/i)
    expect(await readWorkspaceFile(page, VERIFY_PATH)).toBe('USER-CREATED-WHILE-REVIEWING')
  })

  // TC-AI-TOOL-044: undo must fail closed when it cannot read the current file.
  // Existence alone is insufficient evidence that deleting an AI-created path
  // is safe because the user may have changed its unreadable contents.
  test('TC-AI-TOOL-044: undo keeps AI-created verification metadata when its current content cannot be read', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockToolSequence(page, [
      { name: 'prepare_verification', input: { address: VERIFY_ADDR, network: 'mainnet' } },
      { name: 'undo_last_change', input: {} }
    ], 'PREP-READ-GUARD-DONE', async (_result, index) => {
      if (index === 0) {
        // prepare_verification opens the generated file. fileManager serves an
        // open file from the editor buffer, bypassing the provider read that
        // this case needs to fail. Close only that tab first so the injected
        // provider error exercises the real unreadable-file guard.
        const fileName = VERIFY_PATH.split('/').pop()
        await page.locator(`remix-tab[id$="${fileName}"] .close`).click()
        await failAsyncWorkspaceReads(page, VERIFY_PATH)
      }
    })
    await openHome(page)
    await compileStorageOnVM(page)
    await setKeyAndGateway(page)
    await ask(page, 'Prepare the package, then undo it.')

    const modal = page.locator('.ant-modal-confirm').filter({ hasText: VERIFY_PATH })
    await expect(modal).toBeVisible({ timeout: 25_000 })
    await modal.locator('.ant-btn-primary').click()

    await expect(page.getByText('PREP-READ-GUARD-DONE').first()).toBeVisible({ timeout: 25_000 })
    expect(cap.results[1]).toMatch(/current content.*could not be read.*nothing was deleted/i)
    expect(await readWorkspaceFile(page, VERIFY_PATH)).toMatch(/standardJsonInput/)
  })

  // TC-AI-TOOL-045: a provider failure is not proof that a deleted path is
  // absent. Undo must not write the old content over an unknown current state.
  test('TC-AI-TOOL-045: undo of a deletion fails closed when target existence cannot be checked', { tag: '@gate' }, async ({ page }) => {
    const path = '.verification/deleted-exists-guard.txt'
    const cap = await mockToolSequence(page, [
      { name: 'delete_file', input: { path } },
      { name: 'undo_last_change', input: {} }
    ], 'DELETE-EXISTS-GUARD-DONE', async (_result, index) => {
      if (index === 0) await failWorkspaceExistsChecks(page, path)
    })
    await openHome(page)
    await writeWorkspaceFile(page, path, 'ORIGINAL-BEFORE-AI-DELETE')
    await setKeyAndGateway(page)
    await ask(page, 'Delete the fixture, then undo that deletion.')

    const deleteModal = page.locator('.ant-modal-confirm').filter({ hasText: `DELETE ${path}` })
    await expect(deleteModal).toBeVisible({ timeout: 25_000 })
    await deleteModal.locator('.ant-btn-primary').click()

    await expect(page.getByText('DELETE-EXISTS-GUARD-DONE').first()).toBeVisible({ timeout: 25_000 })
    expect(cap.results[1]).toMatch(/could not inspect whether .* was recreated.*nothing was written/i)
    expect(await readWorkspaceFile(page, path)).toBeNull()
  })

  // TC-AI-TOOL-046: relative undo paths are safe only when both the recorded
  // and current workspace names are known. An IPC lookup failure must not let
  // undo act on whichever workspace happens to be selected.
  test('TC-AI-TOOL-046: undo keeps the file when the current workspace cannot be determined', { tag: '@gate' }, async ({ page }) => {
    const path = '.verification/workspace-lookup-guard.txt'
    const cap = await mockToolSequence(page, [
      { name: 'create_file', input: { path, content: 'AI-CREATED-IN-KNOWN-WORKSPACE' } },
      { name: 'undo_last_change', input: {} }
    ], 'UNDO-WORKSPACE-GUARD-DONE', async (_result, index) => {
      if (index === 0) await setChatWorkspaceLookupResult(page, '')
    })
    await openHome(page)
    await setKeyAndGateway(page)
    await ask(page, 'Create the fixture, then undo it.')

    const createModal = page.locator('.ant-modal-confirm').filter({ hasText: `create ${path}` })
    await expect(createModal).toBeVisible({ timeout: 25_000 })
    await createModal.locator('.ant-btn-primary').click()

    await expect(page.getByText('UNDO-WORKSPACE-GUARD-DONE').first()).toBeVisible({ timeout: 25_000 })
    expect(cap.results[1]).toMatch(/current workspace could not be identified.*side effect was blocked/i)
    expect(await readWorkspaceFile(page, path)).toBe('AI-CREATED-IN-KNOWN-WORKSPACE')
  })

  // TC-AI-TOOL-047: the workspace is part of the confirmation snapshot. A
  // switch while the modal is open invalidates approval even if the same
  // relative target path happens to be free in the newly selected workspace.
  test('TC-AI-TOOL-047: prepare_verification stops when the workspace changes during confirmation', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockToolSequence(page, [{ name: 'prepare_verification', input: { address: VERIFY_ADDR, network: 'mainnet' } }], 'PREP-WORKSPACE-CAS-DONE')
    await openHome(page)
    await compileStorageOnVM(page)
    await setKeyAndGateway(page)
    await ask(page, 'Prepare the package, but only in the workspace I approved.')

    const modal = page.locator('.ant-modal-confirm').filter({ hasText: VERIFY_PATH })
    await expect(modal).toBeVisible({ timeout: 25_000 })
    await setChatWorkspaceLookupResult(page, 'workspace-switched-during-confirmation')
    await modal.locator('.ant-btn-primary').click()

    await expect(page.getByText('PREP-WORKSPACE-CAS-DONE').first()).toBeVisible({ timeout: 25_000 })
    expect(cap.results[0]).toMatch(/workspace changed from .* to "workspace-switched-during-confirmation".*nothing was changed/i)
    expect(await readWorkspaceFile(page, VERIFY_PATH)).toBeNull()
  })

  // TC-AI-TOOL-048: an existence-check error is not evidence that a target is
  // free. Treating it as absent would overwrite an existing file and record the
  // undo as "created", allowing a later undo to delete the user's original.
  test('TC-AI-TOOL-048: create_file does not overwrite an existing target when its existence check fails', { tag: '@gate' }, async ({ page }) => {
    const path = '.verification/create-exists-guard.txt'
    const cap = await mockToolSequence(page, [
      { name: 'create_file', input: { path, content: 'AI-REPLACEMENT' } }
    ], 'CREATE-EXISTS-GUARD-DONE')
    await openHome(page)
    await writeWorkspaceFile(page, path, 'USER-ORIGINAL')
    await failWorkspaceExistsChecks(page, path)
    await setKeyAndGateway(page)
    await ask(page, 'Create the target only if it is safe.')

    await expect(page.getByText('CREATE-EXISTS-GUARD-DONE').first()).toBeVisible({ timeout: 25_000 })
    expect(cap.results[0]).toMatch(/could not inspect whether .* already exists.*nothing was written/i)
    expect(await readWorkspaceFile(page, path)).toBe('USER-ORIGINAL')
  })

  // TC-AI-TOOL-013: the phase-B toolset is advertised to the model.
  test('TC-AI-TOOL-013: deploy/interact/verify tools are offered to the model', { tag: '@gate' }, async ({ page }) => {
    let toolNames: string[] = []
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      try { toolNames = (JSON.parse(req.postData() || '{}').tools || []).map((t: any) => t.name) } catch (e) { toolNames = ['ERR'] }
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-4-8', content: [{ type: 'text', text: 'READY' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
      })
    })
    await openHome(page)
    await setKeyAndGateway(page)
    await ask(page, 'hi')
    await expect(page.getByText('READY').first()).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => toolNames.length, { timeout: 20_000 }).toBeGreaterThan(0)
    for (const t of ['list_accounts', 'get_balance', 'list_deployable_contracts', 'deploy_contract', 'read_contract', 'write_contract', 'check_verification', 'prepare_verification']) {
      expect(toolNames, `tool ${t} must be advertised`).toContain(t)
    }
  })
})
