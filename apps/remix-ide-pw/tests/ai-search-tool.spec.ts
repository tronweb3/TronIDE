import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal, toolResultSummary } from './helpers'

// search_workspace: content search across the current workspace through the
// Search panel's pure engine (filePanel.aiSearchWorkspace) — read-only, no
// confirm modal. The Anthropic gateway is mocked with a fixed tool_use
// sequence, so the whole pipeline is deterministic: no compile, no network
// beyond the dev server, and the default workspace's template contracts are
// the search corpus.

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

// Serve a fixed sequence of tool calls, capturing each tool_result in order
// plus the advertised tool list from the first request.
function mockToolSequence (page: Page, tools: Array<{ name: string, input: any }>, finalText: string) {
  const cap: { results: string[], toolNames: string[] } = { results: [], toolNames: [] }
  let calls = 0
  const route = async (route) => {
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
    const tool = tools[calls]
    calls++
    if (tool) {
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu' + calls, name: tool.name, input: tool.input }], stop_reason: 'tool_use' }) })
    }
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
      body: JSON.stringify({ ...common, content: [{ type: 'text', text: finalText }], stop_reason: 'end_turn' }) })
  }
  return page.route(GW + '/**', route).then(() => cap)
}

test.describe('AI search_workspace tool', () => {
  // TC-AI-TOOL-029: one conversation, three searches against the default
  // workspace templates — a hit (grouped path + line + preview), a clean
  // no-match, and a case-flipped query that MUST miss when match_case is set
  // (pins that the flag actually reaches the engine).
  test('TC-AI-TOOL-029: search_workspace finds template code, honors match_case, reports no-match', { tag: '@gate' }, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    const cap = await mockToolSequence(page, [
      { name: 'search_workspace', input: { query: 'function retrieve', include: '**/*.sol' } },
      { name: 'search_workspace', input: { query: 'zzz_no_such_string_31415' } },
      { name: 'search_workspace', input: { query: 'FUNCTION RETRIEVE', match_case: true } }
    ], 'SEARCH-DONE')

    await openHome(page)
    await setKeyAndGateway(page)
    await ask(page, 'Where is retrieve defined?')
    await expect(page.getByText('SEARCH-DONE').first()).toBeVisible({ timeout: 30_000 })

    // the tool is advertised to the model
    expect(cap.toolNames).toContain('search_workspace')

    // 1: hit — grouped path, then an indented `line: preview` row
    expect(cap.results[0]).toMatch(/match\(es\) in \d+ file\(s\), scanned \d+ files:/)
    expect(cap.results[0]).toMatch(/contracts\/1_Storage\.sol/)
    expect(cap.results[0]).toMatch(/\n {2}\d+: .*function retrieve/)

    // 2: clean no-match wording (a result, not an error)
    expect(cap.results[1]).toMatch(/^No matches for "zzz_no_such_string_31415" \(scanned \d+ files\)\./)

    // 3: match_case reached the engine — the case-flipped query misses, while
    // the same query without the flag would have matched case-insensitively
    expect(cap.results[2]).toMatch(/^No matches/)

    expect(pageErrors).toEqual([])
  })
})
