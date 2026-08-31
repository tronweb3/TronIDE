import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// undo_last_change: reverse the AI's most recent file write. Deterministic via
// the mocked gateway — create + edit + undo restores the prior content; create
// + undo deletes the newly-created file. Each undo is confirmed.

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
function mockToolSequence (page: Page, tools: Array<{ name: string, input: any }>, finalText: string) {
  const cap: { results: string[], toolNames: string[] } = { results: [], toolNames: [] }
  let calls = 0
  return page.route(GW + '/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    try {
      const sent = JSON.parse(req.postData() || '{}')
      if (Array.isArray(sent.tools)) cap.toolNames = sent.tools.map((t: any) => t.name)
      const msg = [...(sent.messages || [])].reverse().find((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'))
      const block = msg && msg.content.find((c: any) => c.type === 'tool_result')
      if (block) cap.results.push(String(block.content))
    } catch (e) { /* first turn */ }
    const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
    const tool = tools[calls]
    calls++
    if (tool) {
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu' + calls, name: tool.name, input: tool.input }], stop_reason: 'tool_use' }) })
    }
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
      body: JSON.stringify({ ...common, content: [{ type: 'text', text: finalText }], stop_reason: 'end_turn' }) })
  }).then(() => cap)
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
async function approve (page: Page, hasText: string | RegExp) {
  const modal = page.locator('.ant-modal-confirm').filter({ hasText })
  await expect(modal).toBeVisible({ timeout: 30_000 })
  await modal.locator('.ant-btn-primary').click()
}

test.describe('AI undo_last_change tool', () => {
  // TC-AI-TOOL-037: create V1, edit to V2, then undo — the file is restored to
  // V1 (undo of an edit restores the previous content).
  test('TC-AI-TOOL-037: undo restores the previous content of an edited file', { tag: '@gate' }, async ({ page }) => {
    const FILE = 'probe_undo.txt'
    const cap = await mockToolSequence(page, [
      { name: 'create_file', input: { path: FILE, content: 'ALPHA-V1' } },
      { name: 'edit_file', input: { path: FILE, old_string: 'ALPHA-V1', new_string: 'ALPHA-V2' } },
      { name: 'undo_last_change', input: {} }
    ], 'UNDO-DONE')

    await openHome(page)
    await setKeyAndGateway(page)
    await ask(page, 'Create it, edit it, then undo the edit.')

    await approve(page, `AI wants to create ${FILE}`)
    await approve(page, `AI wants to edit ${FILE}`)
    await approve(page, 'AI wants to UNDO its last change')

    await expect(page.getByText('UNDO-DONE').first()).toBeVisible({ timeout: 30_000 })

    expect(cap.toolNames).toContain('undo_last_change')
    expect(cap.results[2]).toMatch(/Undone.*restore the previous content of probe_undo\.txt/)
    // the file is back to V1, not V2
    const saved = await readSaved(page, FILE)
    expect(saved).toBe('ALPHA-V1')
  })

  // TC-AI-TOOL-038: create a new file, then undo — the newly-created file is
  // deleted (undo of a create removes the file).
  test('TC-AI-TOOL-038: undo of a create deletes the new file', { tag: '@gate' }, async ({ page }) => {
    const FILE = 'probe_undo_new.txt'
    const cap = await mockToolSequence(page, [
      { name: 'create_file', input: { path: FILE, content: 'FRESH' } },
      { name: 'undo_last_change', input: {} }
    ], 'UNDO-CREATE-DONE')

    await openHome(page)
    await setKeyAndGateway(page)
    await ask(page, 'Create a file, then undo creating it.')

    await approve(page, `AI wants to create ${FILE}`)
    await approve(page, 'AI wants to UNDO its last change')

    await expect(page.getByText('UNDO-CREATE-DONE').first()).toBeVisible({ timeout: 30_000 })

    expect(cap.results[1]).toMatch(/Undone.*delete probe_undo_new\.txt \(it was newly created\)/)
    // the file is gone
    const saved = await readSaved(page, FILE)
    expect(saved).toMatch(/^ERR:/)
  })
})
