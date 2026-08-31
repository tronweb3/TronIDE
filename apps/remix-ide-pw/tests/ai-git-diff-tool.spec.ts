import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// git_diff: line-level working-tree-vs-HEAD diff through dGitProvider
// (statusMatrix + readBlob) rendered by the assistant's self-contained LCS
// unified-diff. Deterministic: a local repo is init'd + committed in the
// browser, a tracked file is edited but NOT committed, and the mocked gateway
// asks git_diff — the tool_result must carry the added line as a `+` hunk.

const GW = 'https://tron-pw-gateway.mock'
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }

async function openHome (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
}
async function openGitPanel (page: Page) {
  await page.locator('#icon-panel div[plugin="gitPanel"]').click()
  await page.locator('[data-id="gitPanel"]').waitFor({ state: 'visible', timeout: 15_000 })
}
async function editStorage (page: Page, marker: string) {
  await page.locator('#icon-panel div[plugin="filePanel"]').click()
  const f = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
  if (!await f.isVisible()) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
  await f.click()
  await page.locator('#input').waitFor({ timeout: 10_000 })
  await page.evaluate((m) => {
    const el = document.getElementById('input') as any
    el.editor.session.setValue(el.editor.session.getValue() + `\n// ${m}\n`)
  }, marker)
  await page.waitForTimeout(600)
  await page.keyboard.press('Control+S')
  await page.waitForTimeout(1_000)
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

test.describe('AI git_diff tool', () => {
  // TC-AI-TOOL-032: init a repo, commit a baseline, edit a tracked file without
  // committing, then git_diff — the result shows the added line as a `+` hunk
  // for that file; a second git_diff scoped to a non-changed path reports clean.
  test('TC-AI-TOOL-032: git_diff shows the working-tree change as a unified diff', { tag: '@gate' }, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    const cap = await mockToolSequence(page, [
      { name: 'git_diff', input: {} },
      { name: 'git_diff', input: { path: 'contracts/2_Owner.sol' } }
    ], 'DIFF-DONE')

    await openHome(page)
    await openGitPanel(page)
    // fresh workspace: init the repo if the affordance is shown
    const initBtn = page.locator('[data-id="gitInit"]')
    if (await initBtn.isVisible()) { await initBtn.click(); await page.waitForTimeout(1_500) }
    await expect(page.locator('[data-id="gitBranchSelect"]')).toBeVisible({ timeout: 15_000 })

    // baseline commit (stage the default samples + a marker)
    await editStorage(page, 'DIFF-BASE')
    await openGitPanel(page)
    await page.locator('[data-id="gitStageAll"]').click()
    await page.waitForTimeout(1_000)
    await page.locator('[data-id="gitCommitMessage"]').fill('base commit')
    await page.locator('[data-id="gitCommit"]').click()
    await expect(page.locator('[data-id="gitLogEntry"]').filter({ hasText: 'base commit' })).toBeVisible({ timeout: 15_000 })

    // working-tree change that is NOT committed
    await editStorage(page, 'DIFF-WORKING-abc123')

    await setKeyAndGateway(page)
    await ask(page, 'Show me what changed.')
    await expect(page.getByText('DIFF-DONE').first()).toBeVisible({ timeout: 30_000 })

    // tool advertised
    expect(cap.toolNames).toContain('git_diff')
    // 1: all-files diff names the changed file and shows the added line as `+`
    expect(cap.results[0]).toMatch(/diff contracts\/1_Storage\.sol/)
    expect(cap.results[0]).toMatch(/\+\/\/ DIFF-WORKING-abc123/)
    // it must NOT surface the committed baseline marker as a change
    expect(cap.results[0]).not.toMatch(/\+\/\/ DIFF-BASE/)
    // 2: path scoped to an unchanged file reports a clean result, not an error
    expect(cap.results[1]).toMatch(/No working-tree changes in contracts\/2_Owner\.sol|Working tree clean/)

    expect(pageErrors).toEqual([])
  })
})
