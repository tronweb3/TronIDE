import { test, expect, Page } from '@playwright/test'
import { blockCompilerSources, dismissWelcomeModal, getEditorText, readSavedFile, saveCurrentFile, setEditorText, toolResultSummary, useBuiltinCompiler } from './helpers'

// Phase-A AI workspace tools (v2.3.2): static analysis, local git, debugger.
// The Anthropic gateway is fully mocked (two-turn tool_use → tool_result →
// text), so these assert the REAL tool executor + plugin wiring with no
// network and no model. Each test drives one tool and inspects the
// tool_result the panel fed back to the "model".

const GW = 'https://tron-pw-gateway.mock'
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }

async function openHome (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
}

// Mock a single-tool conversation: turn 1 asks for `tool`, turn 2 (after the
// tool_result comes back) replies `finalText`. Captures the tool_result string.
async function mockOneTool (page: Page, tool: string, toolInput: any, finalText: string) {
  const cap: { toolResult: string } = { toolResult: '' }
  let calls = 0
  await page.route(GW + '/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    calls++
    const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
    if (calls === 1) {
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu', name: tool, input: toolInput }], stop_reason: 'tool_use' }) })
    }
    try {
      const sent = JSON.parse(req.postData() || '{}')
      const msg = (sent.messages || []).find((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'))
      const block = msg && msg.content.find((c: any) => c.type === 'tool_result')
      cap.toolResult = block ? toolResultSummary(block.content) : ''
    } catch (e) { cap.toolResult = 'PARSE_ERROR' }
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
      body: JSON.stringify({ ...common, content: [{ type: 'text', text: finalText }], stop_reason: 'end_turn' }) })
  })
  return cap
}

// Mock a sequence of tools: the model calls tools[0], tools[1], … (each on its
// own turn, after the previous tool_result), then replies `finalText`. Captures
// every tool_result string in order.
async function mockToolSequence (page: Page, tools: Array<{ name: string, input: any }>, finalText: string) {
  const cap: { results: string[] } = { results: [] }
  let calls = 0
  await page.route(GW + '/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (req.method() !== 'OPTIONS') {
      try {
        const sent = JSON.parse(req.postData() || '{}')
        const msg = [...(sent.messages || [])].reverse().find((m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'tool_result'))
        const block = msg && msg.content.find((c: any) => c.type === 'tool_result')
        if (block) cap.results.push(toolResultSummary(block.content))
      } catch (e) { /* first turn has no tool_result */ }
    }
    const common = { id: 'm' + calls, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
    const tool = tools[calls]
    calls++
    if (tool) {
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ ...common, content: [{ type: 'tool_use', id: 'tu' + calls, name: tool.name, input: tool.input }], stop_reason: 'tool_use' }) })
    }
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
      body: JSON.stringify({ ...common, content: [{ type: 'text', text: finalText }], stop_reason: 'end_turn' }) })
  })
  return cap
}

async function setKeyAndGateway (page: Page) {
  await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
  await page.locator('[data-id="aiApiKeyInput"]').fill('sk-gw-shortkey-123')
}
async function ask (page: Page, q: string) {
  await page.locator('.textarea-wrapper textarea').fill(q)
  await page.locator('.textarea-wrapper textarea').press('Enter')
}

test.describe('AI workspace tools — phase A (analysis / git / debug)', () => {
  // TC-AI-TOOL-001: run_static_analysis returns findings for a contract with a
  // known issue after it is compiled.
  test('TC-AI-TOOL-001: run_static_analysis reports findings on the compiled contract', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockOneTool(page, 'run_static_analysis', {}, 'ANALYSIS-DONE')
    await openHome(page)

    // author a contract with an obvious analyzer trigger (tx.origin) and compile
    // it. The File Explorer is the default panel — don't click its icon (that
    // TOGGLES the panel closed); just open the folder/file from the tree.
    const f = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await f.isVisible().catch(() => false)) {
      const folder = page.locator('[data-id="treeViewLitreeViewItemcontracts"]')
      await folder.waitFor({ state: 'visible', timeout: 15_000 })
      await folder.click()
    }
    await f.click()
    await page.locator('#input').waitFor({ timeout: 10_000 })
    await page.evaluate(() => {
      const el = document.getElementById('input') as any
      el.editor.session.setValue('// SPDX-License-Identifier: GPL-3.0\npragma solidity >=0.7.0 <0.9.0;\ncontract Auth {\n  function isOwner(address a) public view returns (bool) {\n    return tx.origin == a;\n  }\n}\n')
    })
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await useBuiltinCompiler(page)
    await page.locator('[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('[data-id="compiledContracts"]')).toContainText('Auth', { timeout: 60_000 })

    await setKeyAndGateway(page)
    await ask(page, 'Run static analysis on the compiled contract.')
    await expect(page.getByText('ANALYSIS-DONE').first()).toBeVisible({ timeout: 20_000 })
    // the tool_result names the analysis and includes the tx.origin finding
    expect(cap.toolResult).toMatch(/static analysis/i)
    expect(cap.toolResult).toMatch(/tx\.origin|origin/i)
  })

  // TC-AI-TOOL-020: run_tests executes the workspace's Solidity unit tests and
  // reports the pass/fail summary. The default workspace ships
  // tests/4_Ballot_test.sol with two passing assertions — proving the tool
  // compiles, deploys on the VM, and runs the remix_tests assertions for real.
  test('TC-AI-TOOL-020: run_tests runs the workspace unit tests and reports passing', { tag: '@gate' }, async ({ page }) => {
    // A real VM test run can include first-use compiler/worker startup. Keep
    // the test budget aligned with the run_tests policy instead of letting the
    // Playwright suite's 60s default turn a valid result into a retry-only
    // flake when the suite is run from a cold browser context.
    test.setTimeout(130_000)
    const cap = await mockOneTool(page, 'run_tests', {}, 'TESTS-DONE')
    await openHome(page)
    // The tool exercises the real unit-test pipeline, but the gate must not
    // depend on fetching the legacy default compiler from the public CDN.
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    const version = page.locator('#versionSelector')
    await expect(version).toBeEnabled({ timeout: 30_000 })
    await version.selectOption('builtin')
    await expect(version).toHaveValue('builtin')
    await setKeyAndGateway(page)
    await ask(page, 'Run the unit tests.')
    await expect(page.getByText('TESTS-DONE').first()).toBeVisible({ timeout: 90_000 })
    // the summary names the counts; the shipped Ballot test contributes 2
    // passing assertions — require at least 2 so a regression to 1 is caught.
    expect(cap.toolResult).toMatch(/test file\(s\):/i)
    const passing = Number((cap.toolResult.match(/(\d+) passing/) || [])[1])
    expect(passing).toBeGreaterThanOrEqual(2)
    expect(cap.toolResult).toMatch(/0 failing/)
  })

  // TC-AI-TOOL-021: run_tests surfaces a failing assertion (not just a count) so
  // the model can act on it. A one-file test with a deliberately false Assert
  // must come back as "1 failing" with the assertion message.
  test('TC-AI-TOOL-021: run_tests reports the failing assertion message', { tag: '@gate' }, async ({ page }) => {
    test.setTimeout(130_000)
    const cap = await mockOneTool(page, 'run_tests', { path: 'tests/Fail_test.sol' }, 'TESTS-DONE')
    await openHome(page)

    // seed a deliberately failing test directly in the workspace FS (same
    // pattern as the delete/rename tests). tests/ already exists in the
    // default workspace.
    await page.evaluate(() => {
      const failSrc = [
        '// SPDX-License-Identifier: GPL-3.0',
        'pragma solidity >=0.7.0 <0.9.0;',
        'import "remix_tests.sol";',
        'contract FailTest {',
        '  function checkFails () public {',
        '    Assert.equal(uint(1), uint(2), "one is not two");',
        '  }',
        '}'
      ].join('\n')
      const ws = (document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement)?.value || 'default_workspace'
      try { (window as any).remixFileSystem.writeFileSync(`.workspaces/${ws}/tests/Fail_test.sol`, failSrc) } catch (e) {}
    })

    await setKeyAndGateway(page)
    await ask(page, 'Run tests/Fail_test.sol.')
    await expect(page.getByText('TESTS-DONE').first()).toBeVisible({ timeout: 90_000 })
    expect(cap.toolResult).toMatch(/1 failing/)
    // pin the actual assertion MESSAGE (the point of the test) — not the
    // structural "FAIL" prefix, which is present for every failing test
    // regardless of whether the message surfaced.
    expect(cap.toolResult).toMatch(/one is not two/)
  })

  // TC-AI-TOOL-002: git_status reports the branch and the modified/untracked
  // files of the auto-initialized workspace repo.
  test('TC-AI-TOOL-002: git_status returns branch and changed files', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockOneTool(page, 'git_status', {}, 'STATUS-DONE')
    await openHome(page)
    await setKeyAndGateway(page)
    await ask(page, 'What is my git status?')
    await expect(page.getByText('STATUS-DONE').first()).toBeVisible({ timeout: 20_000 })
    const parsed = JSON.parse(cap.toolResult)
    expect(parsed).toHaveProperty('branch')
    expect(Array.isArray(parsed.staged) && Array.isArray(parsed.unstaged) && Array.isArray(parsed.untracked)).toBeTruthy()
  })

  test('TC-AI-TOOL-042: git_status reports staged and unstaged changes for the same file', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockOneTool(page, 'git_status', {}, 'STATUS-DONE')
    await blockCompilerSources(page)
    await openHome(page)
    await page.locator('#icon-panel div[plugin="gitPanel"]').click()
    await page.locator('[data-id="gitPanel"]').waitFor({ state: 'visible', timeout: 15_000 })
    const initBtn = page.locator('[data-id="gitInit"]')
    if (await initBtn.isVisible().catch(() => false)) { await initBtn.click(); await page.waitForTimeout(1_500) }

    // Track the sample tree, then stage one edit and leave a second edit only
    // in the working tree. isomorphic-git represents this as [1, 2, 3].
    await page.locator('[data-id="gitStageAll"]').click()
    await expect(page.locator('[data-id="gitUnstageFile"]').first()).toBeVisible({ timeout: 15_000 })
    await page.locator('[data-id="gitCommitMessage"]').fill('base commit')
    await page.locator('[data-id="gitCommit"]').click()
    await expect(page.locator('[data-id="gitLogEntry"]').filter({ hasText: 'base commit' })).toBeVisible({ timeout: 15_000 })

    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    const storage = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await storage.isVisible().catch(() => false)) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await storage.click()
    await page.locator('#input').waitFor({ timeout: 10_000 })
    await setEditorText(page, (await getEditorText(page)) + '\n// STATUS-STAGED\n')
    await saveCurrentFile(page, 'contracts/1_Storage.sol', 'STATUS-STAGED')

    await page.locator('#icon-panel div[plugin="gitPanel"]').click()
    const storageRows = page.locator('[data-id="gitFileRow"]', { hasText: '1_Storage.sol' })
    await storageRows.locator('[data-id="gitStageFile"]').click()
    await expect(storageRows.locator('[data-id="gitUnstageFile"]')).toBeVisible({ timeout: 15_000 })
    await setEditorText(page, (await getEditorText(page)) + '\n// STATUS-UNSTAGED\n')
    await saveCurrentFile(page, 'contracts/1_Storage.sol', 'STATUS-UNSTAGED')
    await expect(storageRows).toHaveCount(2, { timeout: 15_000 })

    await setKeyAndGateway(page)
    await ask(page, 'What is my git status?')
    await expect(page.getByText('STATUS-DONE').first()).toBeVisible({ timeout: 20_000 })
    const parsed = JSON.parse(cap.toolResult)
    expect(parsed.staged).toContain('contracts/1_Storage.sol')
    expect(parsed.unstaged).toContain('contracts/1_Storage.sol')
  })

  test('TC-AI-TOOL-043: git_stage_all rechecks status after confirmation', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockOneTool(page, 'git_stage_all', {}, 'LIVE-STAGE-DONE')
    await blockCompilerSources(page)
    await openHome(page)
    await page.locator('#icon-panel div[plugin="gitPanel"]').click()
    await page.locator('[data-id="gitPanel"]').waitFor({ state: 'visible', timeout: 15_000 })
    const initBtn = page.locator('[data-id="gitInit"]')
    if (await initBtn.isVisible().catch(() => false)) { await initBtn.click(); await page.waitForTimeout(1_500) }
    await page.locator('[data-id="gitStageAll"]').click()
    await expect(page.locator('[data-id="gitUnstageFile"]').first()).toBeVisible({ timeout: 15_000 })
    await page.locator('[data-id="gitCommitMessage"]').fill('stage recheck base')
    await page.locator('[data-id="gitCommit"]').click()
    await expect(page.locator('[data-id="gitLogEntry"]', { hasText: 'stage recheck base' })).toBeVisible({ timeout: 15_000 })

    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    const storage = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await storage.isVisible().catch(() => false)) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await storage.click()
    await page.locator('#input').waitFor({ timeout: 10_000 })
    const baseline = await getEditorText(page)
    await setEditorText(page, baseline + '\n// STALE-STAGE-SNAPSHOT\n')
    await saveCurrentFile(page, 'contracts/1_Storage.sol', 'STALE-STAGE-SNAPSHOT')

    await setKeyAndGateway(page)
    await ask(page, 'Stage all current changes.')
    const modal = page.locator('.ant-modal-confirm').filter({ hasText: 'stage all workspace changes' })
    await expect(modal).toBeVisible({ timeout: 20_000 })

    // Revert while the confirmation is open. The pre-fix tool still executed
    // the old row and claimed it staged a file; deletion/restoration races could
    // even choose the wrong add-vs-rm operation.
    await setEditorText(page, baseline)
    await expect.poll(() => readSavedFile(page, 'contracts/1_Storage.sol'), { timeout: 15_000 }).toBe(baseline)
    await modal.locator('.ant-btn-primary').click()

    await expect(page.getByText('LIVE-STAGE-DONE').first()).toBeVisible({ timeout: 20_000 })
    expect(cap.toolResult).toMatch(/Nothing left to stage after confirmation/i)
    await page.locator('#icon-panel div[plugin="gitPanel"]').click()
    await expect(page.locator('[data-id="gitFileRow"]', { hasText: '1_Storage.sol' })).toHaveCount(0)
  })

  // TC-AI-TOOL-003: the AI stages then commits — git_stage_all followed by a
  // git_commit gated behind a confirm modal — and the commit really lands
  // (HEAD moves, so the tool reports a real commit id, not a false success).
  test('TC-AI-TOOL-003: git_stage_all + git_commit lands a real local commit', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockToolSequence(page, [
      { name: 'git_stage_all', input: {} },
      { name: 'git_commit', input: { message: 'ai: checkpoint' } }
    ], 'COMMIT-DONE')
    await openHome(page)
    // make sure the repo exists (a fresh workspace auto-inits, but be explicit)
    await page.locator('#icon-panel div[plugin="gitPanel"]').click()
    await page.locator('[data-id="gitPanel"]').waitFor({ state: 'visible', timeout: 15_000 })
    const initBtn = page.locator('[data-id="gitInit"]')
    if (await initBtn.isVisible().catch(() => false)) { await initBtn.click(); await page.waitForTimeout(1_500) }

    await setKeyAndGateway(page)
    await ask(page, 'Stage all my changes and commit them with message "ai: checkpoint".')
    // Both index mutation and commit require separate confirmation.
    const stageModal = page.locator('.ant-modal-confirm').filter({ hasText: 'stage all workspace changes' })
    await expect(stageModal).toBeVisible({ timeout: 20_000 })
    await stageModal.locator('.ant-btn-primary').click()
    const commitModal = page.locator('.ant-modal-confirm').filter({ hasText: 'commit the staged changes' })
    await expect(commitModal).toBeVisible({ timeout: 20_000 })
    await commitModal.locator('.ant-btn-primary').click()

    await expect(page.getByText('COMMIT-DONE').first()).toBeVisible({ timeout: 20_000 })
    // the stage tool staged files, and the commit tool reports a real commit id
    expect(cap.results[0]).toMatch(/Staged \d+ file/i)
    expect(cap.results[1]).toMatch(/Committed \(/i)
    // The Git panel stays open while AI tools run. Index/ref-only provider
    // mutations must publish a reactive refresh rather than leaving its staged
    // rows/history stale until the user closes and reopens the panel.
    await expect(page.locator('[data-id="gitLogEntry"]').filter({ hasText: 'ai: checkpoint' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-id="gitFileRow"]')).toHaveCount(0, { timeout: 15_000 })
  })

  // TC-AI-TOOL-004: rejecting the git_commit confirm does NOT commit and tells
  // the model not to retry.
  test('TC-AI-TOOL-004: rejecting the git_commit confirm aborts the commit', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockOneTool(page, 'git_commit', { message: 'ai: nope' }, 'REJECT-SEEN')
    await openHome(page)

    // A clean, auto-initialized workspace has nothing to commit. Seed a real
    // working-tree change and stage it first; otherwise the product correctly
    // rejects git_commit before it can show the commit confirmation modal.
    await page.locator('#icon-panel div[plugin="gitPanel"]').click()
    await page.locator('[data-id="gitPanel"]').waitFor({ state: 'visible', timeout: 15_000 })
    const initBtn = page.locator('[data-id="gitInit"]')
    if (await initBtn.isVisible().catch(() => false)) { await initBtn.click(); await page.waitForTimeout(1_500) }

    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    const storage = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await storage.isVisible().catch(() => false)) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await storage.click()
    await page.locator('#input').waitFor({ timeout: 10_000 })
    await setEditorText(page, (await getEditorText(page)) + '\n// AI-COMMIT-REJECT\n')
    await saveCurrentFile(page, 'contracts/1_Storage.sol', 'AI-COMMIT-REJECT')

    await page.locator('#icon-panel div[plugin="gitPanel"]').click()
    await page.locator('[data-id="gitStageAll"]').click()
    await expect(page.locator('[data-id="gitUnstageFile"]').first()).toBeVisible({ timeout: 15_000 })

    await setKeyAndGateway(page)
    await ask(page, 'Commit now with message "ai: nope".')
    const modal = page.locator('.ant-modal-confirm')
    await expect(modal).toBeVisible({ timeout: 20_000 })
    await modal.locator('button:has-text("Reject")').click()
    await expect(page.getByText('REJECT-SEEN').first()).toBeVisible({ timeout: 20_000 })
    expect(cap.toolResult).toMatch(/User rejected git_commit/i)
  })

  // TC-AI-TOOL-022: git_checkout switches to an EXISTING branch (confirmed),
  // and refuses a non-existent one by listing the branches that do exist.
  test('TC-AI-TOOL-022: git_checkout switches an existing branch, rejects an unknown one', { tag: '@gate' }, async ({ page }) => {
    // create TWO branches (leaving us on branch-b), reject a bogus checkout,
    // then switch back to branch-a — a real switch that raises the confirm.
    const cap = await mockToolSequence(page, [
      { name: 'git_create_branch', input: { name: 'branch-a' } },
      { name: 'git_create_branch', input: { name: 'branch-b' } },
      { name: 'git_checkout', input: { branch: 'does-not-exist' } },
      { name: 'git_checkout', input: { branch: 'branch-a' } }
    ], 'CHECKOUT-DONE')
    await openHome(page)
    await page.locator('#icon-panel div[plugin="gitPanel"]').click()
    await page.locator('[data-id="gitPanel"]').waitFor({ state: 'visible', timeout: 15_000 })
    const initBtn = page.locator('[data-id="gitInit"]')
    if (await initBtn.isVisible().catch(() => false)) { await initBtn.click(); await page.waitForTimeout(1_500) }
    // branching needs at least one commit (isomorphic-git can't list/checkout a
    // branch on an unborn HEAD) — make a base commit through the panel first.
    await page.locator('[data-id="gitStageAll"]').click()
    await page.waitForTimeout(800)
    await page.locator('[data-id="gitCommitMessage"]').fill('base commit')
    await page.locator('[data-id="gitCommit"]').click()
    await expect(page.locator('[data-id="gitLogEntry"]').filter({ hasText: 'base commit' })).toBeVisible({ timeout: 15_000 })

    await setKeyAndGateway(page)
    await ask(page, 'Create branch-a and branch-b, try to check out does-not-exist, then check out branch-a.')

    // two create_branch confirms
    const createA = page.locator('.ant-modal-confirm').filter({ hasText: /branch "branch-a"/ })
    await expect(createA).toBeVisible({ timeout: 20_000 })
    await createA.locator('.ant-btn-primary').click()
    const createB = page.locator('.ant-modal-confirm').filter({ hasText: /branch "branch-b"/ })
    await expect(createB).toBeVisible({ timeout: 20_000 })
    await createB.locator('.ant-btn-primary').click()
    await expect(createB).toBeHidden({ timeout: 20_000 })
    // the bogus checkout returns without a modal (rejected before confirm); the
    // real checkout back to branch-a raises the switch confirm. Wait for its
    // enter animation to settle before clicking (the prior modal's leave
    // animation overlaps otherwise).
    const switchModal = page.locator('.ant-modal-confirm').filter({ hasText: /switch to branch "branch-a"/i })
    await expect(switchModal).toBeVisible({ timeout: 20_000 })
    const switchOk = switchModal.locator('.ant-btn-primary')
    await expect(switchOk).toBeVisible()
    await switchOk.click({ timeout: 20_000, force: true })

    await expect(page.getByText('CHECKOUT-DONE').first()).toBeVisible({ timeout: 20_000 })
    expect(cap.results[0]).toMatch(/Created and switched to branch "branch-a"/)
    expect(cap.results[1]).toMatch(/Created and switched to branch "branch-b"/)
    // the unknown branch is refused AND the existing ones are listed
    expect(cap.results[2]).toMatch(/No local branch "does-not-exist"/)
    expect(cap.results[2]).toMatch(/branch-a/)
    expect(cap.results[3]).toMatch(/Switched to branch "branch-a"/)
    await expect(page.locator('[data-id="gitBranchSelect"]')).toHaveValue('branch-a', { timeout: 15_000 })
  })

  test('TC-AI-TOOL-041: AI checkout and pull refuse staged changes without a dangerous confirm', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockToolSequence(page, [
      { name: 'git_checkout', input: { branch: 'branch-a' } },
      { name: 'git_pull', input: {} }
    ], 'DIRTY-GIT-BLOCKED')
    await blockCompilerSources(page)
    await openHome(page)
    await page.locator('#icon-panel div[plugin="gitPanel"]').click()
    await page.locator('[data-id="gitPanel"]').waitFor({ state: 'visible', timeout: 15_000 })
    const initBtn = page.locator('[data-id="gitInit"]')
    if (await initBtn.isVisible().catch(() => false)) { await initBtn.click(); await page.waitForTimeout(1_500) }

    // Commit the sample tree, then create two clean branches and stay on B.
    await page.locator('[data-id="gitStageAll"]').click()
    await expect(page.locator('[data-id="gitUnstageFile"]').first()).toBeVisible({ timeout: 15_000 })
    await page.locator('[data-id="gitCommitMessage"]').fill('base commit')
    await page.locator('[data-id="gitCommit"]').click()
    await expect(page.locator('[data-id="gitLogEntry"]').filter({ hasText: 'base commit' })).toBeVisible({ timeout: 15_000 })
    for (const branch of ['branch-a', 'branch-b']) {
      await page.locator('[data-id="gitNewBranch"]').click()
      const prompt = page.locator('[data-id="modalDialogCustomPromptText"]')
      await prompt.waitFor({ state: 'visible', timeout: 10_000 })
      await prompt.fill(branch)
      await page.locator('#modal-footer-ok').click()
      await expect.poll(() => page.locator('[data-id="gitBranchSelect"]').inputValue(), { timeout: 15_000 }).toBe(branch)
    }

    // Make and stage a real change. The old AI copy said "stage them first",
    // even though staging is precisely what made isomorphic-git erase it.
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    const storage = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await storage.isVisible().catch(() => false)) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await storage.click()
    await page.locator('#input').waitFor({ timeout: 10_000 })
    await setEditorText(page, (await getEditorText(page)) + '\n// AI-DIRTY-GUARD\n')
    await saveCurrentFile(page, 'contracts/1_Storage.sol', 'AI-DIRTY-GUARD')
    await page.locator('#icon-panel div[plugin="gitPanel"]').click()
    const stagedRow = page.locator('[data-id="gitFileRow"]', { hasText: '1_Storage.sol' })
    await expect(stagedRow.locator('[data-id="gitStageFile"]')).toBeVisible({ timeout: 15_000 })
    await stagedRow.locator('[data-id="gitStageFile"]').click()
    await expect(stagedRow.locator('[data-id="gitUnstageFile"]')).toBeVisible({ timeout: 15_000 })

    await setKeyAndGateway(page)
    await ask(page, 'Switch to branch-a, then pull.')
    await expect(page.getByText('DIRTY-GIT-BLOCKED').first()).toBeVisible({ timeout: 20_000 })
    expect(cap.results[0]).toMatch(/Refusing to switch branches.*staging alone/i)
    expect(cap.results[1]).toMatch(/Refusing to pull.*staging alone/i)
    await expect(page.locator('.ant-modal-confirm')).toHaveCount(0)
    await expect(page.locator('[data-id="gitBranchSelect"]')).toHaveValue('branch-b')
    await expect(stagedRow.locator('[data-id="gitUnstageFile"]')).toBeVisible()
  })

  // TC-AI-TOOL-023: git_stage stages only the named file, not the whole tree.
  test('TC-AI-TOOL-023: git_stage stages specific files by path', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockOneTool(page, 'git_stage', { paths: ['contracts/1_Storage.sol'] }, 'STAGE-DONE')
    await openHome(page)
    await page.locator('#icon-panel div[plugin="gitPanel"]').click()
    await page.locator('[data-id="gitPanel"]').waitFor({ state: 'visible', timeout: 15_000 })
    const initBtn = page.locator('[data-id="gitInit"]')
    if (await initBtn.isVisible().catch(() => false)) { await initBtn.click(); await page.waitForTimeout(1_500) }
    // make a change so there is something to stage
    await page.evaluate(() => {
      const ws = (document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement)?.value || 'default_workspace'
      try { (window as any).remixFileSystem.writeFileSync(`.workspaces/${ws}/contracts/1_Storage.sol`, '// edited by TC-AI-TOOL-023\n') } catch (e) {}
    })

    await setKeyAndGateway(page)
    await ask(page, 'Stage contracts/1_Storage.sol.')
    const modal = page.locator('.ant-modal-confirm')
    await expect(modal).toBeVisible({ timeout: 20_000 })
    await expect(modal).toContainText('stage workspace files')
    await expect(modal).toContainText('contracts/1_Storage.sol')
    await modal.locator('.ant-btn-primary').click()
    await expect(page.getByText('STAGE-DONE').first()).toBeVisible({ timeout: 20_000 })
    expect(cap.toolResult).toMatch(/Staged 1 file/)
    expect(cap.toolResult).toMatch(/contracts\/1_Storage\.sol/)
  })

  test('TC-AI-TOOL-040: rejecting git_stage prevents the index mutation', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockOneTool(page, 'git_stage', { paths: ['contracts/1_Storage.sol'] }, 'STAGE-REJECTED')
    await openHome(page)
    await setKeyAndGateway(page)
    await ask(page, 'Stage contracts/1_Storage.sol.')
    const modal = page.locator('.ant-modal-confirm')
    await expect(modal).toBeVisible({ timeout: 20_000 })
    await modal.locator('button:has-text("Reject")').click()
    await expect(page.getByText('STAGE-REJECTED').first()).toBeVisible({ timeout: 20_000 })
    expect(cap.toolResult).toMatch(/User rejected git_stage/i)
  })

  // TC-AI-TOOL-024: git_clone rejects a non-https URL up front — no confirm
  // modal, no workspace churn — so a bad target can't strand the user.
  test('TC-AI-TOOL-024: git_clone rejects a non-https URL without side effects', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockOneTool(page, 'git_clone', { url: 'git@github.com:owner/repo.git' }, 'CLONE-DONE')
    await openHome(page)
    const wsBefore = await page.locator('select[data-id="workspacesSelect"] option').allInnerTexts()
    await setKeyAndGateway(page)
    await ask(page, 'Clone git@github.com:owner/repo.git')
    // no confirm modal should appear for an invalid URL
    await expect(page.getByText('CLONE-DONE').first()).toBeVisible({ timeout: 20_000 })
    expect(cap.toolResult).toMatch(/https:\/\//)
    // the workspace list is unchanged (nothing was created)
    const wsAfter = await page.locator('select[data-id="workspacesSelect"] option').allInnerTexts()
    expect(wsAfter).toEqual(wsBefore)
  })

  // TC-AI-TOOL-025: rejecting the git_clone confirm aborts — no workspace is
  // created and the model is told not to retry.
  test('TC-AI-TOOL-025: rejecting the git_clone confirm aborts the clone', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockOneTool(page, 'git_clone', { url: 'https://github.com/owner/repo.git' }, 'CLONE-REJECTED')
    await openHome(page)
    const wsBefore = await page.locator('select[data-id="workspacesSelect"] option').allInnerTexts()
    await setKeyAndGateway(page)
    await ask(page, 'Clone https://github.com/owner/repo.git')
    const modal = page.locator('.ant-modal-confirm')
    await expect(modal).toBeVisible({ timeout: 20_000 })
    await expect(modal).toContainText('clone a repository')
    await modal.locator('button:has-text("Reject")').click()
    await expect(page.getByText('CLONE-REJECTED').first()).toBeVisible({ timeout: 20_000 })
    expect(cap.toolResult).toMatch(/User rejected git_clone/i)
    const wsAfter = await page.locator('select[data-id="workspacesSelect"] option').allInnerTexts()
    expect(wsAfter).toEqual(wsBefore)
  })

  // TC-AI-TOOL-027: list_workspaces → create_workspace (from a template,
  // confirmed) → switch_workspace back. Exercises the whole workspace toolset
  // and proves the new workspace really appears and the switch takes.
  test('TC-AI-TOOL-027: list/create(from template)/switch workspaces', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockToolSequence(page, [
      { name: 'list_workspaces', input: {} },
      { name: 'create_workspace', input: { name: 'ai-ws', template: 'simple-storage' } },
      { name: 'switch_workspace', input: { name: 'default_workspace' } }
    ], 'WS-DONE')
    await openHome(page)
    await setKeyAndGateway(page)
    await ask(page, 'List workspaces, create ai-ws from simple-storage, then switch back to default_workspace.')

    // create_workspace confirms
    const modal = page.locator('.ant-modal-confirm').filter({ hasText: /create workspace "ai-ws"/i })
    await expect(modal).toBeVisible({ timeout: 20_000 })
    await expect(modal).toContainText('simple-storage')
    await modal.locator('.ant-btn-primary').click()

    // switch_workspace is a separate side-effecting step and must receive its
    // own approval rather than inheriting create_workspace's decision.
    const switchModal = page.locator('.ant-modal-confirm:visible').filter({ hasText: /switch to workspace "default_workspace"/i })
    await expect(switchModal).toBeVisible({ timeout: 20_000 })
    await switchModal.locator('.ant-btn-primary').click()

    await expect(page.getByText('WS-DONE').first()).toBeVisible({ timeout: 30_000 })
    // list names the current workspace and at least one template id
    expect(cap.results[0]).toMatch(/default_workspace \(current\)/)
    expect(cap.results[0]).toMatch(/simple-storage|trc20-full|trc721-minimal/)
    expect(cap.results[1]).toMatch(/Created workspace "ai-ws" from template "simple-storage"/)
    expect(cap.results[2]).toMatch(/Switched to workspace "default_workspace"/)
    // the new workspace really exists in the selector, and we ended on default
    const options = await page.locator('select[data-id="workspacesSelect"] option').allInnerTexts()
    expect(options).toContain('ai-ws')
    await expect.poll(async () => await page.locator('select[data-id="workspacesSelect"]').inputValue(), { timeout: 15_000 }).toBe('default_workspace')
    // the template CONTENT actually landed — file-panel silently falls back to
    // the default sample seed for an unresolved template id, so assert a
    // simple-storage-specific file exists in ai-ws (not just that it exists).
    const seeded = await page.evaluate(() => {
      const fs = (window as any).remixFileSystem
      try {
        const files = fs.readdirSync('.workspaces/ai-ws/contracts')
        for (const n of files) {
          const c = fs.readFileSync(`.workspaces/ai-ws/contracts/${n}`, 'utf8')
          if (/SimpleStorage/.test(c)) return true
        }
        return false
      } catch (e) { return 'ERR:' + ((e as Error).message) }
    })
    expect(seeded, 'ai-ws should hold the simple-storage template, not the default seed').toBe(true)
  })

  // TC-AI-TOOL-028: rejecting the create_workspace confirm makes no workspace.
  test('TC-AI-TOOL-028: rejecting create_workspace makes no workspace', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockOneTool(page, 'create_workspace', { name: 'ai-nope' }, 'WS-REJECTED')
    await openHome(page)
    const before = await page.locator('select[data-id="workspacesSelect"] option').allInnerTexts()
    await setKeyAndGateway(page)
    await ask(page, 'Create a workspace called ai-nope.')
    const modal = page.locator('.ant-modal-confirm')
    await expect(modal).toBeVisible({ timeout: 20_000 })
    await modal.locator('button:has-text("Reject")').click()
    await expect(page.getByText('WS-REJECTED').first()).toBeVisible({ timeout: 20_000 })
    expect(cap.toolResult).toMatch(/User rejected create_workspace/i)
    const after = await page.locator('select[data-id="workspacesSelect"] option').allInnerTexts()
    expect(after).toEqual(before)
    expect(after).not.toContain('ai-nope')
  })

  // TC-AI-TOOL-005: debug_transaction reveals the Debugger and returns a
  // summary line (trace unavailable on a bogus hash is reported, not crashed).
  test('TC-AI-TOOL-005: debug_transaction opens the Debugger and summarizes', { tag: '@gate' }, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    const cap = await mockOneTool(page, 'debug_transaction', { tx_hash: '0xabc123def456' }, 'DEBUG-DONE')
    await openHome(page)
    await setKeyAndGateway(page)
    await ask(page, 'Debug transaction 0xabc123def456.')
    await expect(page.getByText('DEBUG-DONE').first()).toBeVisible({ timeout: 20_000 })
    expect(cap.toolResult).toMatch(/Debugger/i)
    // the debugger side panel was revealed
    await expect(page.locator('#icon-panel div[plugin="debugger"]')).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  // TC-AI-TOOL-006: the full phase-A toolset is advertised to the model.
  test('TC-AI-TOOL-006: analysis/git/debug tools are offered to the model', { tag: '@gate' }, async ({ page }) => {
    let toolNames: string[] = []
    await page.route(GW + '/**', async (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      try {
        const payload = JSON.parse(req.postData() || '{}')
        const names = (payload.tools || []).map((t: any) => t.name)
        // The panel can issue a follow-up request without tool metadata (for
        // example while a stale response is settling). Keep the first real
        // advertisement instead of letting that unrelated request erase the
        // evidence this test is checking.
        if (names.length) toolNames = names
      } catch (e) { toolNames = ['ERR'] }
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-4-8', content: [{ type: 'text', text: 'READY' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }) })
    })
    await openHome(page)
    await setKeyAndGateway(page)
    await ask(page, 'hi')
    await expect(page.getByText('READY').first()).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => toolNames.length, { timeout: 20_000 }).toBeGreaterThan(0)
    for (const t of ['run_static_analysis', 'run_tests', 'git_status', 'git_log', 'git_stage_all', 'git_stage', 'git_commit', 'git_create_branch', 'git_checkout', 'git_push', 'git_pull', 'git_clone', 'list_workspaces', 'create_workspace', 'switch_workspace', 'debug_transaction', 'delete_file', 'rename_file']) {
      expect(toolNames, `tool ${t} must be advertised`).toContain(t)
    }
  })

  // TC-AI-TOOL-007: delete_file removes a workspace file after the user confirms.
  test('TC-AI-TOOL-007: delete_file removes a file after confirm', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockOneTool(page, 'delete_file', { path: 'contracts/AiDeleteMe.sol' }, 'DELETE-DONE')
    await openHome(page)
    // seed the file directly in the workspace FS
    await page.evaluate(() => {
      const ws = (document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement)?.value || 'default_workspace'
      try { (window as any).remixFileSystem.writeFileSync(`.workspaces/${ws}/contracts/AiDeleteMe.sol`, '// delete me') } catch (e) {}
    })
    await setKeyAndGateway(page)
    await ask(page, 'Delete contracts/AiDeleteMe.sol')
    const modal = page.locator('.ant-modal-confirm')
    await expect(modal).toBeVisible({ timeout: 30_000 })
    await expect(modal).toContainText('DELETE')
    await modal.locator('.ant-btn-primary').click()
    await expect(page.getByText('DELETE-DONE').first()).toBeVisible({ timeout: 30_000 })
    expect(cap.toolResult).toMatch(/Deleted contracts\/AiDeleteMe\.sol/)
    const stillThere = await page.evaluate(() => {
      const ws = (document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement)?.value || 'default_workspace'
      try { (window as any).remixFileSystem.readFileSync(`.workspaces/${ws}/contracts/AiDeleteMe.sol`, 'utf8'); return true } catch (e) { return false }
    })
    expect(stillThere).toBe(false)
  })

  // TC-AI-TOOL-008: rejecting the delete confirm leaves the file in place.
  test('TC-AI-TOOL-008: rejecting the delete_file confirm keeps the file', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockOneTool(page, 'delete_file', { path: 'contracts/AiKeepMe.sol' }, 'KEPT')
    await openHome(page)
    await page.evaluate(() => {
      const ws = (document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement)?.value || 'default_workspace'
      try { (window as any).remixFileSystem.writeFileSync(`.workspaces/${ws}/contracts/AiKeepMe.sol`, '// keep me') } catch (e) {}
    })
    await setKeyAndGateway(page)
    await ask(page, 'Delete contracts/AiKeepMe.sol')
    const modal = page.locator('.ant-modal-confirm')
    await expect(modal).toBeVisible({ timeout: 30_000 })
    await modal.locator('button:has-text("Reject")').click()
    // the rejection returns to the model as the tool_result (the ground truth
    // that delete_file honored the Reject), and the file must remain
    await expect.poll(() => cap.toolResult, { timeout: 30_000 }).toMatch(/User rejected delete_file/i)
    const stillThere = await page.evaluate(() => {
      const ws = (document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement)?.value || 'default_workspace'
      try { (window as any).remixFileSystem.readFileSync(`.workspaces/${ws}/contracts/AiKeepMe.sol`, 'utf8'); return true } catch (e) { return false }
    })
    expect(stillThere).toBe(true)
  })

  // TC-AI-TOOL-009: rename_file moves a workspace file after the user confirms.
  test('TC-AI-TOOL-009: rename_file moves a file after confirm', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockOneTool(page, 'rename_file', { from: 'contracts/AiOld.sol', to: 'contracts/AiNew.sol' }, 'RENAME-DONE')
    await openHome(page)
    await page.evaluate(() => {
      const ws = (document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement)?.value || 'default_workspace'
      const fsx = (window as any).remixFileSystem
      try { fsx.writeFileSync(`.workspaces/${ws}/contracts/AiOld.sol`, '// rename me') } catch (e) {}
      try { fsx.unlinkSync(`.workspaces/${ws}/contracts/AiNew.sol`) } catch (e) {}
    })
    await setKeyAndGateway(page)
    await ask(page, 'Rename contracts/AiOld.sol to contracts/AiNew.sol')
    const modal = page.locator('.ant-modal-confirm')
    await expect(modal).toBeVisible({ timeout: 30_000 })
    await expect(modal).toContainText('rename')
    await modal.locator('.ant-btn-primary').click()
    await expect(page.getByText('RENAME-DONE').first()).toBeVisible({ timeout: 30_000 })
    expect(cap.toolResult).toMatch(/Renamed contracts\/AiOld\.sol/)
    const state = await page.evaluate(() => {
      const ws = (document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement)?.value || 'default_workspace'
      const fsx = (window as any).remixFileSystem
      const read = (p) => { try { return fsx.readFileSync(`.workspaces/${ws}/${p}`, 'utf8') } catch (e) { return null } }
      return { oldGone: read('contracts/AiOld.sol') === null, newHas: read('contracts/AiNew.sol') }
    })
    expect(state.oldGone).toBe(true)
    expect(state.newHas).toMatch(/rename me/)
  })

  test('TC-AI-TOOL-044: a file confirmation cannot mutate a branch checked out while it was open', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockOneTool(page, 'delete_file', { path: 'contracts/BranchBound.sol' }, 'BRANCH-WRITE-BLOCKED')
    await blockCompilerSources(page)
    await openHome(page)
    await page.locator('#icon-panel div[plugin="gitPanel"]').click()
    await page.locator('[data-id="gitPanel"]').waitFor({ state: 'visible', timeout: 15_000 })
    const initBtn = page.locator('[data-id="gitInit"]')
    if (await initBtn.isVisible().catch(() => false)) { await initBtn.click(); await page.waitForTimeout(1_500) }

    // Track the protected file on main and create an identical clean target
    // branch. Switching is allowed while the destructive AI confirmation is
    // open, but that confirmation remains bound to main's write generation.
    await page.evaluate(() => {
      const ws = (document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement)?.value || 'default_workspace'
      ;(window as any).remixFileSystem.writeFileSync(`.workspaces/${ws}/contracts/BranchBound.sol`, '// must survive\n')
    })
    await page.locator('[data-id="gitStageAll"]').click()
    await expect(page.locator('[data-id="gitUnstageFile"]').first()).toBeVisible({ timeout: 15_000 })
    await page.locator('[data-id="gitCommitMessage"]').fill('branch-bound base')
    await page.locator('[data-id="gitCommit"]').click()
    await expect(page.locator('[data-id="gitLogEntry"]', { hasText: 'branch-bound base' })).toBeVisible({ timeout: 15_000 })

    await page.locator('[data-id="gitNewBranch"]').click()
    const prompt = page.locator('[data-id="modalDialogCustomPromptText"]')
    await prompt.waitFor({ state: 'visible', timeout: 10_000 })
    await prompt.fill('confirmation-target')
    await page.locator('#modal-footer-ok').click()
    const branchSelect = page.locator('[data-id="gitBranchSelect"]')
    await expect.poll(() => branchSelect.inputValue(), { timeout: 15_000 }).toBe('confirmation-target')
    await branchSelect.selectOption('main')
    await expect.poll(() => branchSelect.inputValue(), { timeout: 15_000 }).toBe('main')

    await setKeyAndGateway(page)
    await ask(page, 'Delete contracts/BranchBound.sol')
    const deleteModal = page.locator('.ant-modal-confirm').filter({ hasText: 'BranchBound.sol' })
    await expect(deleteModal).toBeVisible({ timeout: 20_000 })

    // Dispatch behind the modal to reproduce the race deterministically: the
    // provider completes checkout and unlocks before the old confirmation is
    // accepted. A late mutation must still reject after that unlock.
    await page.evaluate(() => {
      const select = document.querySelector('[data-id="gitBranchSelect"]') as HTMLSelectElement
      select.value = 'confirmation-target'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect.poll(() => branchSelect.inputValue(), { timeout: 20_000 }).toBe('confirmation-target')
    await deleteModal.locator('.ant-btn-primary').click()
    await expect(page.getByText('BRANCH-WRITE-BLOCKED').first()).toBeVisible({ timeout: 20_000 })
    expect(cap.toolResult).toMatch(/changed|expired|cancelled|no longer active/i)

    const targetContent = await page.evaluate(() => {
      const ws = (document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement)?.value || 'default_workspace'
      return String((window as any).remixFileSystem.readFileSync(`.workspaces/${ws}/contracts/BranchBound.sol`, 'utf8'))
    })
    expect(targetContent).toContain('must survive')
  })

  // TC-AI-TOOL-010: git_push reaches execution behind a confirm and surfaces a
  // clear "add a remote" error when no remote is configured (never a silent hang).
  test('TC-AI-TOOL-010: git_push confirms then reports a clear error without a remote', { tag: '@gate' }, async ({ page }) => {
    const cap = await mockOneTool(page, 'git_push', {}, 'PUSH-TRIED')
    await openHome(page)
    await setKeyAndGateway(page)
    await ask(page, 'Push my commits to the remote')
    const modal = page.locator('.ant-modal-confirm')
    await expect(modal).toBeVisible({ timeout: 30_000 })
    await expect(modal).toContainText('PUSH')
    await modal.locator('.ant-btn-primary').click()
    await expect(page.getByText('PUSH-TRIED').first()).toBeVisible({ timeout: 40_000 })
    // default_workspace has no remote → a clear failure, not a success or a hang
    expect(cap.toolResult).toMatch(/Push failed|add a remote|rejected|remote/i)
  })
})
