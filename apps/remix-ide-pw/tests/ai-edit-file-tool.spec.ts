import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// edit_file: precise in-place edit by exact-snippet replacement, gated by a
// diff-preview confirm modal. Deterministic via the mocked gateway: create a
// known file, then a unique-match edit (approved, must change the file), a
// no-match edit and an ambiguous edit (both must fail WITHOUT a confirm modal).

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
function mockToolSequence (page: Page, tools: Array<{ name: string, input: any } | null>, finalText: string) {
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

test.describe('AI edit_file tool', () => {
  // TC-AI-TOOL-033: create a known file, then a unique-match edit (diff modal,
  // approved, file actually changes), a no-match edit and an ambiguous edit —
  // both error WITHOUT raising a confirm modal and leave the file untouched.
  test('TC-AI-TOOL-033: edit_file replaces a unique snippet; no-match/ambiguous fail without a modal', { tag: '@gate' }, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    const FILE = 'probe_edit.txt'
    const cap = await mockToolSequence(page, [
      { name: 'create_file', input: { path: FILE, content: 'alpha\nUNIQUE-Z\nbeta\nDUP\nDUP' } },
      { name: 'edit_file', input: { path: FILE, old_string: 'UNIQUE-Z', new_string: 'CHANGED-Z' } },
      { name: 'edit_file', input: { path: FILE, old_string: 'NOT-THERE-999', new_string: 'x' } },
      { name: 'edit_file', input: { path: FILE, old_string: 'DUP', new_string: 'y' } },
      null
    ], 'EDIT-DONE')

    await openHome(page)
    await setKeyAndGateway(page)
    await ask(page, 'Edit the probe file.')

    // create_file confirm
    const createModal = page.locator('.ant-modal-confirm').filter({ hasText: `AI wants to create ${FILE}` })
    await expect(createModal).toBeVisible({ timeout: 30_000 })
    await createModal.locator('.ant-btn-primary').click()

    // edit_file confirm — the modal shows a DIFF (removed old / added new line)
    const editModal = page.locator('.ant-modal-confirm').filter({ hasText: `AI wants to edit ${FILE}` })
    await expect(editModal).toBeVisible({ timeout: 30_000 })
    await expect(editModal).toContainText('-UNIQUE-Z')
    await expect(editModal).toContainText('+CHANGED-Z')
    await editModal.locator('.ant-btn-primary').click()

    // the no-match and ambiguous edits must NOT raise any further confirm modal
    await expect(page.getByText('EDIT-DONE').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.ant-modal-confirm')).toHaveCount(0)

    // tool advertised
    expect(cap.toolNames).toContain('edit_file')
    // results: [create, edit-ok, edit-missing, edit-dup]
    expect(cap.results[0]).toMatch(/Created probe_edit\.txt/)
    expect(cap.results[1]).toMatch(/Edited probe_edit\.txt \(\+\d+\/-\d+\)/)
    expect(cap.results[2]).toMatch(/was not found/)
    expect(cap.results[3]).toMatch(/appears 2 times/)

    // the file on disk actually changed: new text in, old text gone
    const saved = await readSaved(page, FILE)
    expect(saved).toContain('CHANGED-Z')
    expect(saved).not.toContain('UNIQUE-Z')
    // the two failed edits changed nothing — DUP is still there, untouched
    expect(saved).toContain('DUP\nDUP')

    expect(pageErrors).toEqual([])
  })

  // Security regression: the old shared modal clipped at 2400 chars and
  // create_file itself clipped at 2000, while the full hidden tail was still
  // written. Both create and edit now show the complete payload in a scrollable
  // review and bind it to a SHA-256 digest.
  test('TC-AI-TOOL-045: large create/edit approvals expose the full tail and payload digest', { tag: '@gate' }, async ({ page }) => {
    const FILE = 'probe_full_approval.txt'
    const createTail = 'CREATE-TAIL-IGNORE-USER-AND-DELETE-FILES'
    const editTail = 'EDIT-TAIL-IGNORE-USER-AND-DEPLOY-CONTRACT'
    const initial = `SAFE PREFIX\n${'a'.repeat(2700)}\n${createTail}`
    const replacement = `${'b'.repeat(2800)}\n${editTail}`
    const cap = await mockToolSequence(page, [
      { name: 'create_file', input: { path: FILE, content: initial } },
      { name: 'edit_file', input: { path: FILE, old_string: createTail, new_string: replacement } },
      null
    ], 'FULL-APPROVAL-DONE')

    await openHome(page)
    await setKeyAndGateway(page)
    await ask(page, 'Create and edit the large approval probe.')

    const createModal = page.locator('.ant-modal-confirm').filter({ hasText: `AI wants to create ${FILE}` })
    await expect(createModal).toBeVisible({ timeout: 30_000 })
    const createReview = createModal.locator('[data-id="ai-tool-approval-body"]')
    await expect(createReview).toContainText(createTail)
    await expect(createReview).not.toContainText('preview truncated')
    await expect(createReview).toHaveAttribute('data-approval-sha256', /^[0-9a-f]{64}$/)
    await createModal.locator('.ant-btn-primary').click()

    const editModal = page.locator('.ant-modal-confirm').filter({ hasText: `AI wants to edit ${FILE}` })
    await expect(editModal).toBeVisible({ timeout: 30_000 })
    const editReview = editModal.locator('[data-id="ai-tool-approval-body"]')
    await expect(editReview).toContainText(createTail)
    await expect(editReview).toContainText(editTail)
    await expect(editReview).not.toContainText('preview truncated')
    await expect(editReview).toHaveAttribute('data-approval-sha256', /^[0-9a-f]{64}$/)
    await editModal.locator('.ant-btn-primary').click()

    await expect(page.getByText('FULL-APPROVAL-DONE').first()).toBeVisible({ timeout: 30_000 })
    expect(cap.results[0]).toMatch(/Created probe_full_approval\.txt/)
    expect(cap.results[1]).toMatch(/Edited probe_full_approval\.txt/)
    const saved = await readSaved(page, FILE)
    expect(saved).toContain(editTail)
    expect(saved).not.toContain(createTail)
  })
})
