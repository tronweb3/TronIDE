import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal, toolResultSummary, useBuiltinCompiler } from './helpers'

// save_recording / replay_recording: snapshot the auto-recorded deploy flow to
// scenario.json, then re-execute it. Deterministic on the JS VM: compile +
// deploy Storage (auto-recorded), save (confirmed file write), replay (one
// confirm for the batch, re-runs the tx). Gateway mocked.

const GW = 'https://tron-pw-gateway.mock'
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }

async function openHome (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
}
async function setKeyAndGateway (page: Page) {
  await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
  await page.locator('[data-id="aiApiKeyInput"]').fill('sk-gw-shortkey-123')
}
async function ask (page: Page, q: string) {
  await page.locator('.textarea-wrapper textarea').fill(q)
  await page.locator('.textarea-wrapper textarea').press('Enter')
}
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
  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.locator('#selectExEnvOptions').waitFor({ timeout: 15_000 })
  const vmVal = await page.evaluate(() => {
    const sel = document.querySelector('#selectExEnvOptions') as HTMLSelectElement
    const opt = Array.from(sel.options).find((o) => /javascript vm/i.test(o.textContent || ''))
    return opt ? opt.value : null
  })
  if (vmVal) await page.selectOption('#selectExEnvOptions', vmVal)
}
function readSaved (page: Page, path: string) {
  return page.evaluate((p) => {
    try {
      const sel = document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement | null
      const ws = (sel && sel.value) || 'default_workspace'
      return (window as any).remixFileSystem.readFileSync(`.workspaces/${ws}/${p}`, 'utf8')
    } catch (e) { return 'ERR:' + ((e as Error).message) }
  }, path)
}

async function writeSaved (page: Page, path: string, content: string) {
  await page.evaluate(({ p, value }) => {
    const sel = document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement | null
    const ws = (sel && sel.value) || 'default_workspace'
    ;(window as any).remixFileSystem.writeFileSync(`.workspaces/${ws}/${p}`, value)
  }, { p: path, value: content })
}

async function writeSavedInWorkspace (page: Page, workspace: string, path: string, content: string) {
  await page.evaluate(({ ws, p, value }) => {
    ;(window as any).remixFileSystem.writeFileSync(`.workspaces/${ws}/${p}`, value)
  }, { ws: workspace, p: path, value: content })
}

async function readSavedInWorkspace (page: Page, workspace: string, path: string) {
  return page.evaluate(({ ws, p }) => {
    try { return (window as any).remixFileSystem.readFileSync(`.workspaces/${ws}/${p}`, 'utf8') } catch (e) { return 'ERR:' + ((e as Error).message) }
  }, { ws: workspace, p: path })
}

async function createWorkspace (page: Page, name: string) {
  const createButton = page.locator('[data-id="workspaceCreate"]')
  if (!await createButton.isVisible().catch(() => false)) {
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
  }
  await createButton.click()
  const input = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
  await input.waitFor({ state: 'visible', timeout: 5000 })
  await input.fill(name)
  await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()
  await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue(name, { timeout: 15_000 })
}

async function failSavedExistsChecks (page: Page, path: string) {
  await page.evaluate((p) => {
    const sel = document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement | null
    const ws = (sel && sel.value) || 'default_workspace'
    const full = `.workspaces/${ws}/${p}`
    const fs = (window as any).remixFileSystem
    const originalExistsSync = fs.existsSync
    fs.existsSync = function (target: string) {
      if (String(target) === full) throw new Error('injected exists failure')
      return originalExistsSync.call(this, target)
    }
  }, path)
}

async function injectOneShotPartialWriteFailure (page: Page, path: string, partialContent: string) {
  await page.evaluate(({ p, partial }) => {
    const sel = document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement | null
    const ws = (sel && sel.value) || 'default_workspace'
    const full = `.workspaces/${ws}/${p}`.replace(/^\/+/, '')
    const fs = (window as any).remixFileSystem
    const originalWriteFileSync = fs.writeFileSync
    let injected = false

    fs.writeFileSync = function (target: string, ...args: any[]) {
      const normalizedTarget = String(target).replace(/^\/+/, '')
      if (!injected && normalizedTarget === full) {
        injected = true
        // Restore the provider before throwing so the subsequent undo is able
        // to write the original bytes back.
        fs.writeFileSync = originalWriteFileSync
        originalWriteFileSync.call(this, target, partial)
        throw new Error('injected failure after partial write')
      }
      return originalWriteFileSync.call(this, target, ...args)
    }
  }, { p: path, partial: partialContent })
}

async function injectRecorderWorkspaceDrift (page: Page, path: string, targetWorkspace: string) {
  await page.evaluate(({ p, target }) => {
    const select = document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement
    const source = select.value
    const full = `.workspaces/${source}/${p}`.replace(/^\/+/, '')
    const fs = (window as any).remixFileSystem
    const originalExistsSync = fs.existsSync
    let matchingCalls = 0

    fs.existsSync = function (candidate: string, ...args: any[]) {
      const result = originalExistsSync.call(this, candidate, ...args)
      if (String(candidate).replace(/^\/+/, '') === full && ++matchingCalls === 3) {
        // Calls 1–2 belong to Chat's post-confirmation read. Call 3 is the
        // recorder's internal CAS. Switch in its await gap to reproduce the
        // exact cross-plugin workspace-drift race deterministically.
        fs.existsSync = originalExistsSync
        queueMicrotask(() => {
          select.value = target
          select.dispatchEvent(new Event('change', { bubbles: true }))
        })
      }
      return result
    }
  }, { p: path, target: targetWorkspace })
}

async function deleteScenarioBetweenExistsAndRead (page: Page, path: string) {
  await page.evaluate((p) => {
    const select = document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement
    const full = `.workspaces/${select.value}/${p}`.replace(/^\/+/, '')
    const fs = (window as any).remixFileSystem
    const originalExistsSync = fs.existsSync
    let matchingCalls = 0

    fs.existsSync = function (candidate: string, ...args: any[]) {
      const result = originalExistsSync.call(this, candidate, ...args)
      if (String(candidate).replace(/^\/+/, '') === full && ++matchingCalls === 3) {
        // Preserve the true result for recorder.exists(), but remove the file
        // before recorder.get(). A missing sentinel must never become "".
        fs.existsSync = originalExistsSync
        fs.unlinkSync(full)
      }
      return result
    }
  }, path)
}

test.describe('AI recorder tools (save / replay)', () => {
  // TC-AI-TOOL-035: deploy Storage (auto-recorded) → save_recording writes
  // scenario.json → replay_recording (one confirm) re-executes it.
  test('TC-AI-TOOL-035: save_recording writes a scenario, replay_recording re-runs it', { tag: '@gate' }, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    const cap: { results: string[], toolNames: string[] } = { results: [], toolNames: [] }
    let calls = 0
    const plan = [
      { name: 'deploy_contract', input: { contract_name: 'Storage', args: [] } },
      { name: 'save_recording', input: {} },
      { name: 'replay_recording', input: {} }
    ]
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      try {
        const sent = JSON.parse(req.postData() || '{}')
        if (Array.isArray(sent.tools)) cap.toolNames = sent.tools.map((t: any) => t.name)
        const msg = [...(sent.messages || [])].reverse().find((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'))
        const block = msg && msg.content.find((c: any) => c.type === 'tool_result')
        if (block) cap.results.push(toolResultSummary(block.content))
      } catch (e) { /* first turn */ }
      const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      const step = plan[calls]
      calls++
      if (step) {
        return route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu' + calls, name: step.name, input: step.input }], stop_reason: 'tool_use' })
        })
      }
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'REC-DONE' }], stop_reason: 'end_turn' })
      })
    })

    await openHome(page)
    await compileStorageOnVM(page)
    await setKeyAndGateway(page)
    await ask(page, 'Deploy Storage, save the recording, then replay it.')

    // deploy confirm
    const deployModal = page.locator('.ant-modal-confirm').filter({ hasText: 'DEPLOY Storage' })
    await expect(deployModal).toBeVisible({ timeout: 30_000 })
    await deployModal.locator('.ant-btn-primary').click()

    // save confirm — recorder writes are gated like every AI write
    const saveModal = page.locator('.ant-modal-confirm').filter({ hasText: 'save the recording to scenario.json' })
    await expect(saveModal).toBeVisible({ timeout: 30_000 })
    await saveModal.locator('.ant-btn-primary').click()

    // replay confirm
    const replayModal = page.locator('.ant-modal-confirm').filter({ hasText: 'REPLAY scenario.json' })
    await expect(replayModal).toBeVisible({ timeout: 30_000 })
    await replayModal.locator('.ant-btn-primary').click()

    await expect(page.getByText('REC-DONE').first()).toBeVisible({ timeout: 60_000 })

    // tools advertised
    expect(cap.toolNames).toContain('save_recording')
    expect(cap.toolNames).toContain('replay_recording')
    // results: [deploy, save, replay]
    expect(cap.results[0]).toMatch(/Deployed Storage at/)
    expect(cap.results[1]).toMatch(/Saved the recording to scenario\.json \(1 transaction/)
    expect(cap.results[2]).toMatch(/Replayed 1 transaction\(s\) from scenario\.json/)

    // the scenario file really landed and holds the recorded tx
    const saved = await readSaved(page, 'scenario.json')
    expect(saved).toContain('"transactions"')
    expect(saved).toContain('Storage')

    expect(pageErrors).toEqual([])
  })

  // TC-AI-TOOL-036: replay completion is keyed on the batch-end (replayEnded),
  // not the per-deploy callback. Record deploy Guard + a withdraw that REVERTS,
  // then replay: the result must surface the FAILURE (the revert is the 2nd tx,
  // after the deploy). A prior bug resolved on the first deploy's callback and
  // reported a false "Replayed 2 transaction(s)", hiding the later revert.
  test('TC-AI-TOOL-036: replay reports a revert on a later tx, not a false success', { tag: '@gate' }, async ({ page }) => {
    const cap: { results: string[] } = { results: [] }
    let deployedAddr = ''
    let calls = 0
    const plan = [
      { name: 'deploy_contract', input: { contract_name: 'Guard', args: [] } },
      { name: 'write_contract', input: { address: '__ADDR__', contract_name: 'Guard', method: 'withdraw', args: [500] } },
      { name: 'save_recording', input: {} },
      { name: 'replay_recording', input: {} }
    ]
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      try {
        const sent = JSON.parse(req.postData() || '{}')
        const msg = [...(sent.messages || [])].reverse().find((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'))
        const block = msg && msg.content.find((c: any) => c.type === 'tool_result')
        if (block) { const s = toolResultSummary(block.content); cap.results.push(s); const m = s.match(/at (0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})/); if (m) deployedAddr = m[1] }
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
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'REPLAY-REVERT-DONE' }], stop_reason: 'end_turn' })
      })
    })

    await openHome(page)
    // open a file first so the Ace editor (#input) exists, then swap its buffer
    const f = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await f.isVisible().catch(() => false)) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await f.click()
    // a contract whose method reverts with a custom error carrying args
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
    await page.evaluate((src) => { const el = document.getElementById('input') as any; el.editor.session.setValue(src) }, source)
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await useBuiltinCompiler(page)
    await page.locator('[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('[data-id="compiledContracts"]')).toContainText('Guard', { timeout: 60_000 })
    await page.locator('#icon-panel div[plugin="udapp"]').click()

    await setKeyAndGateway(page)
    await ask(page, 'Deploy Guard, withdraw 500, save and replay.')

    const deployModal = page.locator('.ant-modal-confirm').filter({ hasText: 'DEPLOY Guard' })
    await expect(deployModal).toBeVisible({ timeout: 30_000 })
    await deployModal.locator('.ant-btn-primary').click()
    const wModal = page.locator('.ant-modal-confirm').filter({ hasText: /send Guard\.withdraw/ })
    await expect(wModal).toBeVisible({ timeout: 30_000 })
    await wModal.locator('.ant-btn-primary').click()
    // save confirm, then replay confirm
    const saveModal = page.locator('.ant-modal-confirm').filter({ hasText: 'save the recording to scenario.json' })
    await expect(saveModal).toBeVisible({ timeout: 30_000 })
    await saveModal.locator('.ant-btn-primary').click()
    const replayModal = page.locator('.ant-modal-confirm').filter({ hasText: 'REPLAY scenario.json' })
    await expect(replayModal).toBeVisible({ timeout: 30_000 })
    await replayModal.locator('.ant-btn-primary').click()

    await expect(page.getByText('REPLAY-REVERT-DONE').first()).toBeVisible({ timeout: 60_000 })

    // results: [deploy, withdraw(revert), save, replay]. The replay must report a
    // FAILURE — not a false "Replayed 2 transaction(s)".
    expect(cap.results[3]).toMatch(/Replay failed|InsufficientBalance|revert/i)
    expect(cap.results[3]).not.toMatch(/Replayed \d+ transaction/)
  })

  // TC-AI-TOOL-049: an existing scenario must not be treated as absent when
  // the provider cannot answer exists(). Otherwise save_recording could
  // overwrite it without a recoverable "overwrote" undo snapshot.
  test('TC-AI-TOOL-049: save_recording preserves an existing scenario when its existence check fails', { tag: '@gate' }, async ({ page }) => {
    const cap: { results: string[] } = { results: [] }
    let calls = 0
    const plan = [
      { name: 'deploy_contract', input: { contract_name: 'Storage', args: [] } },
      { name: 'save_recording', input: {} }
    ]
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      try {
        const sent = JSON.parse(req.postData() || '{}')
        const msg = [...(sent.messages || [])].reverse().find((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'))
        const block = msg && msg.content.find((c: any) => c.type === 'tool_result')
        if (block) {
          cap.results.push(toolResultSummary(block.content))
          if (cap.results.length === 1) await failSavedExistsChecks(page, 'scenario.json')
        }
      } catch (e) { /* first turn */ }
      const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      const step = plan[calls]
      calls++
      if (step) {
        return route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu' + calls, name: step.name, input: step.input }], stop_reason: 'tool_use' })
        })
      }
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'SAVE-EXISTS-GUARD-DONE' }], stop_reason: 'end_turn' })
      })
    })

    await openHome(page)
    await compileStorageOnVM(page)
    await writeSaved(page, 'scenario.json', 'USER-ORIGINAL-SCENARIO')
    await setKeyAndGateway(page)
    await ask(page, 'Deploy Storage, then save the recording only if scenario.json is safe.')

    const deployModal = page.locator('.ant-modal-confirm').filter({ hasText: 'DEPLOY Storage' })
    await expect(deployModal).toBeVisible({ timeout: 30_000 })
    await deployModal.locator('.ant-btn-primary').click()

    await expect(page.getByText('SAVE-EXISTS-GUARD-DONE').first()).toBeVisible({ timeout: 60_000 })
    expect(cap.results[1]).toMatch(/could not inspect whether scenario\.json already exists.*recording was not saved/i)
    expect(await readSaved(page, 'scenario.json')).toBe('USER-ORIGINAL-SCENARIO')
  })

  // A filesystem provider can mutate a file (for example, truncate it) and
  // still reject the write because of a later quota/I/O error. The failed save
  // must report that partial mutation and leave an exact, safe undo entry.
  test('TC-AI-TOOL-050: save_recording restores an existing file after a partial write failure', { tag: '@gate' }, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    const cap: { results: string[] } = { results: [] }
    let calls = 0
    const plan = [
      { name: 'deploy_contract', input: { contract_name: 'Storage', args: [] } },
      { name: 'save_recording', input: {} },
      { name: 'undo_last_change', input: {} }
    ]

    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      try {
        const sent = JSON.parse(req.postData() || '{}')
        const msg = [...(sent.messages || [])].reverse().find((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'))
        const block = msg && msg.content.find((c: any) => c.type === 'tool_result')
        if (block) cap.results.push(toolResultSummary(block.content))
      } catch (e) { /* first turn */ }
      const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      const step = plan[calls]
      calls++
      if (step) {
        return route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu' + calls, name: step.name, input: step.input }], stop_reason: 'tool_use' })
        })
      }
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'PARTIAL-SAVE-UNDO-DONE' }], stop_reason: 'end_turn' })
      })
    })

    await openHome(page)
    await compileStorageOnVM(page)
    await writeSaved(page, 'scenario.json', 'USER-ORIGINAL-SCENARIO')
    await setKeyAndGateway(page)
    await ask(page, 'Deploy Storage, save over scenario.json, and undo the save if its provider reports a partial failure.')

    const deployModal = page.locator('.ant-modal-confirm').filter({ hasText: 'DEPLOY Storage' })
    await expect(deployModal).toBeVisible({ timeout: 30_000 })
    await deployModal.locator('.ant-btn-primary').click()

    const saveModal = page.locator('.ant-modal-confirm').filter({ hasText: 'OVERWRITE scenario.json' })
    await expect(saveModal).toBeVisible({ timeout: 30_000 })
    await injectOneShotPartialWriteFailure(page, 'scenario.json', 'INJECTED-PARTIAL-SCENARIO')
    await saveModal.locator('.ant-btn-primary').click()

    const undoModal = page.locator('.ant-modal-confirm').filter({ hasText: 'UNDO its last change' })
    await expect(undoModal).toBeVisible({ timeout: 30_000 })
    expect(await readSaved(page, 'scenario.json')).toBe('INJECTED-PARTIAL-SCENARIO')
    await undoModal.locator('.ant-btn-primary').click()

    await expect(page.getByText('PARTIAL-SAVE-UNDO-DONE').first()).toBeVisible({ timeout: 60_000 })
    expect(cap.results[1]).toMatch(/Could not write scenario\.json[\s\S]*undo_last_change can restore/i)
    expect(cap.results[2]).toMatch(/Undone.*restore the previous content of scenario\.json/i)
    expect(await readSaved(page, 'scenario.json')).toBe('USER-ORIGINAL-SCENARIO')
    expect(pageErrors).toEqual([])
  })

  test('TC-AI-TOOL-051: save_recording never drifts into another workspace during recorder CAS', { tag: '@gate' }, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    const cap: { results: string[] } = { results: [] }
    let calls = 0
    const plan = [
      { name: 'deploy_contract', input: { contract_name: 'Storage', args: [] } },
      { name: 'save_recording', input: {} },
      { name: 'undo_last_change', input: {} }
    ]

    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      try {
        const sent = JSON.parse(req.postData() || '{}')
        const msg = [...(sent.messages || [])].reverse().find((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'))
        const block = msg && msg.content.find((c: any) => c.type === 'tool_result')
        if (block) cap.results.push(toolResultSummary(block.content))
      } catch (e) { /* first turn */ }
      const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      const step = plan[calls]
      calls++
      if (step) {
        return route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu' + calls, name: step.name, input: step.input }], stop_reason: 'tool_use' })
        })
      }
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'SAVE-WORKSPACE-DRIFT-DONE' }], stop_reason: 'end_turn' })
      })
    })

    await openHome(page)
    const sourceWorkspace = await page.locator('select[data-id="workspacesSelect"]').inputValue()
    const targetWorkspace = 'save-drift-target'
    await createWorkspace(page, targetWorkspace)
    await page.locator('select[data-id="workspacesSelect"]').selectOption(sourceWorkspace)
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue(sourceWorkspace, { timeout: 15_000 })
    await compileStorageOnVM(page)
    await writeSavedInWorkspace(page, sourceWorkspace, 'scenario.json', 'SHARED-ORIGINAL-SCENARIO')
    await writeSavedInWorkspace(page, targetWorkspace, 'scenario.json', 'SHARED-ORIGINAL-SCENARIO')
    await setKeyAndGateway(page)
    await ask(page, 'Deploy Storage, save over scenario.json, then try to undo it.')

    const deployModal = page.locator('.ant-modal-confirm').filter({ hasText: 'DEPLOY Storage' })
    await expect(deployModal).toBeVisible({ timeout: 30_000 })
    await deployModal.locator('.ant-btn-primary').click()

    const saveModal = page.locator('.ant-modal-confirm').filter({ hasText: 'OVERWRITE scenario.json' })
    await expect(saveModal).toBeVisible({ timeout: 30_000 })
    await injectRecorderWorkspaceDrift(page, 'scenario.json', targetWorkspace)
    await saveModal.locator('.ant-btn-primary').click()

    await expect(page.getByText('SAVE-WORKSPACE-DRIFT-DONE').first()).toBeVisible({ timeout: 60_000 })
    expect(cap.results[1]).toMatch(/workspace changed from .*recording was not written/i)
    expect(cap.results[2]).toMatch(/Workspace, branch, network, or account changed while the task write lock was held/i)
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue(targetWorkspace, { timeout: 15_000 })
    expect(await readSavedInWorkspace(page, sourceWorkspace, 'scenario.json')).toBe('SHARED-ORIGINAL-SCENARIO')
    expect(await readSavedInWorkspace(page, targetWorkspace, 'scenario.json')).toBe('SHARED-ORIGINAL-SCENARIO')
    expect(pageErrors).toEqual([])
  })

  test('TC-AI-TOOL-052: save_recording treats deletion between exists and read as missing', { tag: '@gate' }, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    const cap: { results: string[] } = { results: [] }
    let calls = 0
    const plan = [
      { name: 'deploy_contract', input: { contract_name: 'Storage', args: [] } },
      { name: 'save_recording', input: {} },
      { name: 'undo_last_change', input: {} }
    ]

    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      try {
        const sent = JSON.parse(req.postData() || '{}')
        const msg = [...(sent.messages || [])].reverse().find((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'))
        const block = msg && msg.content.find((c: any) => c.type === 'tool_result')
        if (block) cap.results.push(toolResultSummary(block.content))
      } catch (e) { /* first turn */ }
      const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      const step = plan[calls]
      calls++
      if (step) {
        return route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu' + calls, name: step.name, input: step.input }], stop_reason: 'tool_use' })
        })
      }
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'SAVE-MISSING-SENTINEL-DONE' }], stop_reason: 'end_turn' })
      })
    })

    await openHome(page)
    await compileStorageOnVM(page)
    await writeSaved(page, 'scenario.json', '')
    await setKeyAndGateway(page)
    await ask(page, 'Deploy Storage, save over the empty scenario.json, then try to undo it.')

    const deployModal = page.locator('.ant-modal-confirm').filter({ hasText: 'DEPLOY Storage' })
    await expect(deployModal).toBeVisible({ timeout: 30_000 })
    await deployModal.locator('.ant-btn-primary').click()

    const saveModal = page.locator('.ant-modal-confirm').filter({ hasText: 'OVERWRITE scenario.json' })
    await expect(saveModal).toBeVisible({ timeout: 30_000 })
    await deleteScenarioBetweenExistsAndRead(page, 'scenario.json')
    await saveModal.locator('.ant-btn-primary').click()

    await expect(page.getByText('SAVE-MISSING-SENTINEL-DONE').first()).toBeVisible({ timeout: 60_000 })
    expect(cap.results[1]).toMatch(/scenario\.json changed while the save was starting.*not written/i)
    expect(cap.results[2]).toMatch(/Nothing to undo.*no AI file change/i)
    expect(await readSaved(page, 'scenario.json')).toMatch(/^ERR:/)
    expect(pageErrors).toEqual([])
  })
})
