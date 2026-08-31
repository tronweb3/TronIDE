import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal, toolResultSummary, useBuiltinCompiler } from './helpers'

// export_tronbox: turn the recorded deploy flow into a runnable TronBox project
// written INTO the workspace. Deterministic on the JS VM: compile + deploy
// Storage (auto-recorded), then export — the migration, config and the copied
// contract source must land as real workspace files. Gateway mocked.

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

function existsSaved (page: Page, path: string) {
  return page.evaluate((p) => {
    const sel = document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement | null
    const ws = (sel && sel.value) || 'default_workspace'
    return (window as any).remixFileSystem.existsSync(`.workspaces/${ws}/${p}`)
  }, path)
}

test.describe('AI export_tronbox tool', () => {
  // TC-AI-TOOL-034: deploy Storage (auto-recorded), then export_tronbox writes a
  // runnable project into the workspace — migration names the contract, config
  // pins a compiler, and the contract source is copied in.
  test('TC-AI-TOOL-034: export_tronbox writes a runnable TronBox project to the workspace', { tag: '@gate' }, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    const cap: { results: string[], toolNames: string[] } = { results: [], toolNames: [] }
    let deployedAddr = ''
    let calls = 0
    let followUp: { name: string, id: string, done: string, input?: Record<string, unknown> } | null = null
    const plan = [
      { name: 'deploy_contract', input: { contract_name: 'Storage', args: [] } },
      { name: 'export_tronbox', input: {} }
    ]
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      try {
        const sent = JSON.parse(req.postData() || '{}')
        if (Array.isArray(sent.tools)) cap.toolNames = sent.tools.map((t: any) => t.name)
        const msg = (sent.messages || [])[sent.messages.length - 1]
        const block = msg && Array.isArray(msg.content) && msg.content.find((c: any) => c.type === 'tool_result')
        if (block) { const s = toolResultSummary(block.content); cap.results.push(s); const m = s.match(/at (0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})/); if (m) deployedAddr = m[1] }
        const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
        if (followUp) {
          if (block && block.tool_use_id === followUp.id) {
            const done = followUp.done
            followUp = null
            return route.fulfill({
              status: 200,
              headers: cors,
              contentType: 'application/json',
              body: JSON.stringify({ ...common, content: [{ type: 'text', text: done }], stop_reason: 'end_turn' })
            })
          }
          return route.fulfill({
            status: 200,
            headers: cors,
            contentType: 'application/json',
            body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: followUp.id, name: followUp.name, input: followUp.input || {} }], stop_reason: 'tool_use' })
          })
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
        body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'EXPORT-DONE' }], stop_reason: 'end_turn' })
      })
    })

    await openHome(page)
    await compileStorageOnVM(page)
    await setKeyAndGateway(page)
    await ask(page, 'Deploy Storage, then export a TronBox project.')

    const deployModal = page.locator('.ant-modal-confirm:visible').filter({ hasText: 'DEPLOY Storage' })
    await expect(deployModal).toBeVisible({ timeout: 30_000 })
    await deployModal.locator('.ant-btn-primary').click()

    // export confirm — recorder-family writes are gated like every AI write
    const exportModal = page.locator('.ant-modal-confirm:visible').filter({ hasText: 'export a TronBox project to tronbox-project/' })
    await expect(exportModal).toBeVisible({ timeout: 30_000 })
    await exportModal.locator('.ant-btn-primary').click()

    await expect(page.getByText('EXPORT-DONE').first()).toBeVisible({ timeout: 60_000 })

    // tool advertised + deploy recorded
    expect(cap.toolNames).toContain('export_tronbox')
    expect(cap.results[0]).toMatch(/Deployed Storage at (0x[0-9a-fA-F]{40}|T[1-9A-HJ-NP-Za-km-z]{33})/)
    // export result: names the folder, the tx count, and how to run it
    expect(cap.results[1]).toMatch(/Exported a runnable TronBox project to tronbox-project\//)
    expect(cap.results[1]).toMatch(/metadata: tronbox-project\/tronide-export\.json/)
    expect(cap.results[1]).toMatch(/tronbox migrate/)

    // the project actually landed as workspace files
    const migration = await readSaved(page, 'tronbox-project/migrations/2_deploy_contracts.js')
    expect(migration).toContain('Storage')
    expect(migration).toContain('deployer')
    const config = await readSaved(page, 'tronbox-project/tronbox-config.js')
    expect(config).toMatch(/compilers|version/)
    const contract = await readSaved(page, 'tronbox-project/contracts/1_Storage.sol')
    expect(contract).toContain('contract Storage')
    const metadata = JSON.parse(await readSaved(page, 'tronbox-project/tronide-export.json'))
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      kind: 'tronide-tronbox-export',
      generator: { name: 'TronIDE', version: '2.3.3' },
      solc: { source: 'last-compilation' },
      network: { source: 'current-environment', provider: 'vm' },
      scenarioSource: { type: 'current-recording', path: null, schemaVersion: null, transactionCount: 1 },
      compatibility: { testedTronbox: { package: 'tronbox', version: '4.8.0' }, apiBoundary: 'generated-project-files' }
    })
    expect(metadata.solc.version).toMatch(/^\d+\.\d+\.\d+$/)

    // Successful batch undo removes every unchanged newly exported file. This
    // exercises the multi-file happy path before the fail-closed edit cases.
    followUp = { name: 'undo_last_change', id: 'tu-undo-export-safe', done: 'UNDO-EXPORT-DONE' }
    await ask(page, 'Undo the unchanged TronBox export.')
    const safeUndoModal = page.locator('.ant-modal-confirm:visible').filter({ hasText: 'UNDO its last change' })
    await expect(safeUndoModal).toBeVisible({ timeout: 30_000 })
    await safeUndoModal.locator('.ant-btn-primary').click()
    await expect(page.getByText('UNDO-EXPORT-DONE').first()).toBeVisible({ timeout: 30_000 })
    expect(cap.results[cap.results.length - 1]).toMatch(/Undone.*remove the \d+ unchanged exported file/i)
    expect(await existsSaved(page, 'tronbox-project/tronbox-config.js')).toBe(false)
    expect(await existsSaved(page, 'tronbox-project/migrations/2_deploy_contracts.js')).toBe(false)
    expect(await existsSaved(page, 'tronbox-project/contracts/1_Storage.sol')).toBe(false)

    // Export once more to create a fresh undo entry for the user-edit guard.
    followUp = { name: 'export_tronbox', id: 'tu-export-again', done: 'EXPORT-AGAIN-DONE' }
    await ask(page, 'Export the same TronBox project again.')
    const exportAgainModal = page.locator('.ant-modal-confirm:visible').filter({ hasText: 'export a TronBox project to tronbox-project/' })
    await expect(exportAgainModal).toBeVisible({ timeout: 30_000 })
    await exportAgainModal.locator('.ant-btn-primary').click()
    await expect(page.getByText('EXPORT-AGAIN-DONE').first()).toBeVisible({ timeout: 30_000 })
    expect(cap.results[cap.results.length - 1]).toMatch(/Exported a runnable TronBox project to tronbox-project\//)

    // Regression: an exported file edited afterwards belongs to the user. A
    // multi-file undo must fail closed before showing a confirmation or deleting
    // any other generated file.
    const userMigration = '// USER EDIT AFTER EXPORT\n'
    // export_tronbox opens the migration. Close that tab so fileManager reads
    // the provider state changed below instead of an older Ace editor buffer.
    await page.locator('remix-tab[id$="2_deploy_contracts.js"] .close').click()
    await page.evaluate(({ path, content }) => {
      const sel = document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement | null
      const ws = (sel && sel.value) || 'default_workspace'
      ;(window as any).remixFileSystem.writeFileSync(`.workspaces/${ws}/${path}`, content, 'utf8')
    }, { path: 'tronbox-project/migrations/2_deploy_contracts.js', content: userMigration })
    followUp = { name: 'undo_last_change', id: 'tu-undo-export', done: 'UNDO-SAFE' }
    await ask(page, 'Undo the TronBox export.')
    await expect(page.getByText('UNDO-SAFE').first()).toBeVisible({ timeout: 30_000 })
    expect(cap.results[cap.results.length - 1]).toMatch(/changed since the export.*Nothing was changed/i)
    await expect(page.locator('.ant-modal-confirm:visible').filter({ hasText: 'UNDO its last change' })).toHaveCount(0)
    expect(await readSaved(page, 'tronbox-project/migrations/2_deploy_contracts.js')).toBe(userMigration)
    expect(await readSaved(page, 'tronbox-project/contracts/1_Storage.sol')).toContain('contract Storage')

    // Regression: the confirmation authorizes the exact directory snapshot the
    // user reviewed, not merely "a directory still exists". Editing a file while
    // the modal is open must abort the whole re-export.
    followUp = { name: 'export_tronbox', id: 'tu-reexport', done: 'REEXPORT-SAFE' }
    await ask(page, 'Export the TronBox project again.')
    const reExportModal = page.locator('.ant-modal-confirm:visible').filter({ hasText: 'export a TronBox project to tronbox-project/' })
    await expect(reExportModal).toBeVisible({ timeout: 30_000 })
    const userConfig = '// USER EDIT DURING CONFIRMATION\n'
    await page.evaluate(({ path, content }) => {
      const sel = document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement | null
      const ws = (sel && sel.value) || 'default_workspace'
      ;(window as any).remixFileSystem.writeFileSync(`.workspaces/${ws}/${path}`, content, 'utf8')
    }, { path: 'tronbox-project/tronbox-config.js', content: userConfig })
    await reExportModal.locator('.ant-btn-primary').click()
    await expect(page.getByText('REEXPORT-SAFE').first()).toBeVisible({ timeout: 30_000 })
    expect(cap.results[cap.results.length - 1]).toMatch(/changed while the confirmation was open.*nothing was exported/i)
    expect(await readSaved(page, 'tronbox-project/tronbox-config.js')).toBe(userConfig)
    expect(await readSaved(page, 'tronbox-project/migrations/2_deploy_contracts.js')).toBe(userMigration)

    expect(pageErrors).toEqual([])
  })
})
