import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// read_file offset/limit paging: a large file (>20k chars) truncates on the
// default read (with a note), but offset/limit reaches the tail the default
// read can't — the fix for edit_file failing to match text past the 20k blind
// spot. Gateway mocked.

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
  const cap: { results: string[] } = { results: [] }
  let calls = 0
  return page.route(GW + '/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    try {
      const sent = JSON.parse(req.postData() || '{}')
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

test.describe('AI read_file paging', () => {
  // TC-AI-TOOL-039: a >20k-char file — default read truncates (with a page hint)
  // and does NOT contain the tail; offset/limit returns the exact tail range.
  test('TC-AI-TOOL-039: offset/limit reads past the default 20k truncation', { tag: '@gate' }, async ({ page }) => {
    const FILE = 'bigfile.txt'
    // 600 lines, each ~44 chars -> ~26k chars > 20k cap. Unique marker per line.
    const lines: string[] = []
    for (let i = 1; i <= 600; i++) lines.push(`LINE-${String(i).padStart(4, '0')} ${'x'.repeat(35)}`)
    const bigContent = lines.join('\n')

    const cap = await mockToolSequence(page, [
      { name: 'create_file', input: { path: FILE, content: bigContent } },
      { name: 'read_file', input: { path: FILE, offset: 595, limit: 5 } },
      { name: 'read_file', input: { path: FILE } }
    ], 'PAGING-DONE')

    await openHome(page)
    await setKeyAndGateway(page)
    await ask(page, 'Make a big file, read its tail, then read it plainly.')

    const createModal = page.locator('.ant-modal-confirm').filter({ hasText: `AI wants to create ${FILE}` })
    await expect(createModal).toBeVisible({ timeout: 30_000 })
    await createModal.locator('.ant-btn-primary').click()

    await expect(page.getByText('PAGING-DONE').first()).toBeVisible({ timeout: 30_000 })

    // results: [create, paged read (595-599), default read]
    // paged read: header + the exact tail lines, and NOT the head
    expect(cap.results[1]).toMatch(/\[bigfile\.txt lines 595-599 of 600\]/)
    expect(cap.results[1]).toContain('LINE-0595')
    expect(cap.results[1]).toContain('LINE-0599')
    expect(cap.results[1]).not.toContain('LINE-0001')
    // default read: truncated with a page hint, shows the head, NOT the tail
    expect(cap.results[2]).toContain('LINE-0001')
    expect(cap.results[2]).toMatch(/truncated at 20000 chars.*600 lines.*offset\/limit/)
    expect(cap.results[2]).not.toContain('LINE-0595')
  })
})
