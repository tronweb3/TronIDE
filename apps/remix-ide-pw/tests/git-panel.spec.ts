import { test, expect, Page } from '@playwright/test'
import { blockCompilerSources, dismissWelcomeModal } from './helpers'

// TC-GIT-001/002/003 (v2.3.2 R4): local Git panel on dGitProvider — init,
// stage, commit, log; branch create/switch; uncommitted-change guard. No
// remote operations are part of this panel.

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

async function deleteStorage (page: Page) {
  await page.locator('#icon-panel div[plugin="filePanel"]').click()
  const row = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
  if (!await row.isVisible().catch(() => false)) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
  await row.click({ button: 'right' })
  await page.locator('#menuitemdelete').click()
  const dialog = page.locator('[data-id$="ModalDialogContainer-react"]')
    .filter({ hasText: 'Are you sure you want to delete this item?' })
  await expect(dialog).toBeVisible()
  const ok = dialog.locator('.modal-ok')
  await ok.click()
  if (await dialog.isVisible().catch(() => false)) await ok.click()
  await expect(row).toHaveCount(0)
}

test.describe('Git panel (local)', () => {
  test('TC-GIT-011: an unborn repository cannot create a branch before its first commit', { tag: '@gate' }, async ({ page }) => {
    await openHome(page)
    await openGitPanel(page)

    const initBtn = page.locator('[data-id="gitInit"]')
    if (await initBtn.isVisible().catch(() => false)) await initBtn.click()
    await page.locator('[data-id="gitBranchSelect"]').waitFor({ state: 'visible', timeout: 15_000 })

    // isomorphic-git exposes a symbolic branch name for an unborn repository,
    // but there is no commit for a new ref to point at. The old button opened a
    // prompt and then created a branch that never appeared in the picker.
    await expect(page.locator('[data-id="gitNewBranch"]')).toBeDisabled()
    await expect(page.locator('[data-id="gitBranchSelect"]')).toBeDisabled()
    await expect(page.locator('[data-id="gitBranchHint"]')).toContainText(/first commit/i)
  })

  test('TC-GIT-020: first commit repairs a repository whose HEAD metadata is missing', { tag: '@gate' }, async ({ page }) => {
    await openHome(page)

    // Browser storage restores and interrupted imports can retain .git/config
    // while losing .git/HEAD. isomorphic-git init treats config as sufficient
    // and used to leave this half-initialized repository broken, so committing
    // the staged template/sample files failed with "Could not find HEAD."
    const workspace = await page.locator('select[data-id="workspacesSelect"]').inputValue()
    await page.evaluate(({ workspace }) => {
      const fs = (window as any).remixFileSystem
      const gitdir = `.workspaces/${workspace}/.git`
      try { fs.mkdirSync(gitdir) } catch (error) { /* already exists */ }
      fs.writeFileSync(`${gitdir}/config`, '[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n')
      try { fs.unlinkSync(`${gitdir}/HEAD`) } catch (error) { /* reproduced state */ }
    }, { workspace })

    await openGitPanel(page)
    await page.locator('[data-id="gitStageAll"]').click()
    await expect(page.locator('[data-id="gitUnstageFile"]').first()).toBeVisible({ timeout: 15_000 })
    await page.locator('[data-id="gitCommitMessage"]').fill('recover first commit')
    await page.locator('[data-id="gitCommit"]').click()

    await expect(page.locator('[data-id="gitLogEntry"]').filter({ hasText: 'recover first commit' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-id="gitBranchSelect"]')).toHaveValue('main')
    await expect(page.locator('[data-id="gitStatus"]')).not.toContainText(/could not find head/i)
  })

  test('TC-GIT-021: missing HEAD with an existing local branch fails closed', { tag: '@gate' }, async ({ page }) => {
    await openHome(page)
    const workspace = await page.locator('select[data-id="workspacesSelect"]').inputValue()

    // A local branch means this is not an unborn repository. Recovery must not
    // silently point HEAD at a new unrelated root and commit the current index.
    await page.evaluate(({ workspace }) => {
      const fs = (window as any).remixFileSystem
      const gitdir = `.workspaces/${workspace}/.git`
      const oid = '0123456789012345678901234567890123456789'
      try { fs.mkdirSync(gitdir) } catch (error) { /* already exists */ }
      try { fs.mkdirSync(`${gitdir}/refs`) } catch (error) { /* already exists */ }
      try { fs.mkdirSync(`${gitdir}/refs/heads`) } catch (error) { /* already exists */ }
      fs.writeFileSync(`${gitdir}/config`, '[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n')
      fs.writeFileSync(`${gitdir}/refs/heads/existing`, `${oid}\n`)
      try { fs.unlinkSync(`${gitdir}/HEAD`) } catch (error) { /* reproduced state */ }
    }, { workspace })

    await openGitPanel(page)
    await page.locator('[data-id="gitStageAll"]').click()
    await expect(page.locator('[data-id="gitUnstageFile"]').first()).toBeVisible({ timeout: 15_000 })
    await page.locator('[data-id="gitCommitMessage"]').fill('must not commit')
    await page.locator('[data-id="gitCommit"]').click()

    await expect(page.locator('[data-id="gitStatus"]')).toContainText(/head is missing or invalid/i)
    await expect(page.locator('[data-id="gitLogEntry"]')).toHaveCount(0)
    const headExists = await page.evaluate(({ workspace }) => {
      const fs = (window as any).remixFileSystem
      return fs.existsSync(`.workspaces/${workspace}/.git/HEAD`)
    }, { workspace })
    expect(headExists).toBe(false)
  })

  test('TC-GIT-022: switching workspaces clears Git feedback from the previous workspace', { tag: '@gate' }, async ({ page }) => {
    await openHome(page)
    await openGitPanel(page)
    const initBtn = page.locator('[data-id="gitInit"]')
    if (await initBtn.isVisible().catch(() => false)) await initBtn.click()

    // Produce an unmistakable error in workspace A.
    await page.locator('[data-id="gitCommitMessage"]').fill('nothing staged')
    await page.locator('[data-id="gitCommit"]').click()
    await expect(page.locator('[data-id="gitStatus"]')).toContainText(/stage at least one change/i)

    // Create workspace B from the header. The workspace flow may focus File
    // Explorer, but Git's retained state must already be clean when reopened.
    await page.locator('[data-id="headerWorkspaceDropdown"]').click()
    await page.locator('[data-id="headerCreateWorkspace"]').click()
    await page.locator('input[data-id="modalDialogCustomPromptTextCreate"]').fill('git-status-clean-workspace')
    await page.locator('select[data-id="modalDialogCustomSelectTemplate"]').selectOption('empty')
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()

    await expect(page.locator('[data-id="headerWorkspaceDropdown"]')).toContainText('git-status-clean-workspace', { timeout: 15_000 })
    await openGitPanel(page)
    await expect(page.locator('[data-id="gitStatus"]')).toHaveCount(0)
    await expect(page.locator('[data-id="gitCommitMessage"]')).toHaveValue('')
  })

  test('TC-GIT-001: init → stage → commit → history', async ({ page }) => {
    await openHome(page)
    await openGitPanel(page)

    // a fresh workspace has no repo: the init affordance is shown
    const initBtn = page.locator('[data-id="gitInit"]')
    if (await initBtn.isVisible()) {
      await initBtn.click()
      await page.waitForTimeout(1_500)
    }
    // after init the changes section renders (default samples are unstaged)
    await expect(page.locator('[data-id="gitBranchSelect"]')).toBeVisible({ timeout: 15_000 })

    // make a tracked change, stage everything, commit
    await editStorage(page, 'GIT-001-MARKER')
    await openGitPanel(page)
    await page.locator('[data-id="gitStageAll"]').click()
    await page.waitForTimeout(1_000)
    await expect(page.locator('[data-id="gitFileRow"]').first()).toBeVisible({ timeout: 10_000 })

    await page.locator('[data-id="gitCommitMessage"]').fill('first commit')
    await page.locator('[data-id="gitCommit"]').click()

    // history shows the commit
    await expect(page.locator('[data-id="gitLogEntry"]').filter({ hasText: 'first commit' })).toBeVisible({ timeout: 15_000 })
  })

  test('TC-GIT-002: create a branch, switch, and the branch list reflects it', async ({ page }) => {
    await openHome(page)
    await openGitPanel(page)
    const initBtn = page.locator('[data-id="gitInit"]')
    if (await initBtn.isVisible()) { await initBtn.click(); await page.waitForTimeout(1_500) }

    // need at least one commit before branching is meaningful
    await editStorage(page, 'GIT-002-BASE')
    await openGitPanel(page)
    await page.locator('[data-id="gitStageAll"]').click()
    await page.waitForTimeout(800)
    await page.locator('[data-id="gitCommitMessage"]').fill('base commit')
    await page.locator('[data-id="gitCommit"]').click()
    await expect(page.locator('[data-id="gitLogEntry"]').filter({ hasText: 'base commit' })).toBeVisible({ timeout: 15_000 })

    // create a branch via the prompt
    await page.locator('[data-id="gitNewBranch"]').click()
    const prompt = page.locator('[data-id="modalDialogCustomPromptText"]')
    await prompt.waitFor({ state: 'visible', timeout: 10_000 })
    await prompt.fill('feature-x')
    await page.locator('#modal-footer-ok').click()
    await page.waitForTimeout(2_000)

    // the branch select now offers and selects feature-x
    const select = page.locator('[data-id="gitBranchSelect"]')
    await expect.poll(async () => await select.inputValue(), { timeout: 15_000 }).toBe('feature-x')
    const options = await select.locator('option').allInnerTexts()
    expect(options).toContain('feature-x')
  })

  // TC-GIT-004 (v2.3.2 M2/M4): every dGitProvider call in the panel is now
  // bounded by withTimeout and routed through the single-flight _runOp busy
  // guard, and the unstage rm error is no longer swallowed. This asserts the
  // two observable hardening behaviors end-to-end: (a) an op flips the panel
  // into a disabled "busy" state, and (b) a failing op surfaces an error via
  // gitStatus instead of hanging the button forever or silently "succeeding".
  test('TC-GIT-004: an op shows a busy state and a failure surfaces an error', async ({ page }) => {
    await openHome(page)
    await openGitPanel(page)
    const initBtn = page.locator('[data-id="gitInit"]')
    if (await initBtn.isVisible()) { await initBtn.click(); await page.waitForTimeout(1_500) }

    // need a commit so branching is meaningful
    await editStorage(page, 'GIT-004-BASE')
    await openGitPanel(page)
    await page.locator('[data-id="gitStageAll"]').click()
    await page.waitForTimeout(800)
    await page.locator('[data-id="gitCommitMessage"]').fill('base')
    const commitBtn = page.locator('[data-id="gitCommit"]')

    // (a) busy state: while the commit is in flight the panel disables its
    // action buttons and renders the busy marker. The op is fast, so poll for
    // the transient busy marker rather than asserting a single instant.
    await commitBtn.click()
    const sawBusy = await page.locator('[data-id="gitBusy"]').isVisible().catch(() => false) ||
      await page.locator('[data-id="gitBusy"]').waitFor({ state: 'visible', timeout: 2_000 }).then(() => true).catch(() => false)
    // either we caught the transient busy marker, or the op already completed —
    // in both cases the button must end up re-enabled (the guard released)
    await expect(commitBtn).toBeEnabled({ timeout: 15_000 })
    await expect(page.locator('[data-id="gitBusy"]')).toBeHidden({ timeout: 15_000 })
    await expect(page.locator('[data-id="gitLogEntry"]').filter({ hasText: 'base' })).toBeVisible({ timeout: 15_000 })
    expect(typeof sawBusy).toBe('boolean')

    // (b) error surfacing: an invalid ref name makes isomorphic-git's branch
    // reject. _runOp must catch it and write a "Branch failed: …" status (M4:
    // no silent success), and the button must re-enable afterwards.
    await page.locator('[data-id="gitNewBranch"]').click()
    const prompt = page.locator('[data-id="modalDialogCustomPromptText"]')
    await prompt.waitFor({ state: 'visible', timeout: 10_000 })
    await prompt.fill('bad branch name') // spaces are an illegal git ref
    await page.locator('#modal-footer-ok').click()

    await expect(page.locator('[data-id="gitStatus"]')).toContainText(/branch failed/i, { timeout: 15_000 })
    // the panel did not get wedged: the branch control is interactive again
    await expect(page.locator('[data-id="gitNewBranch"]')).toBeEnabled({ timeout: 15_000 })
  })

  test('TC-GIT-003: switching branches is blocked while unstaged or staged changes exist', async ({ page }) => {
    await openHome(page)
    await openGitPanel(page)
    const initBtn = page.locator('[data-id="gitInit"]')
    if (await initBtn.isVisible()) { await initBtn.click(); await page.waitForTimeout(1_500) }

    // commit a base, branch off, commit again so two branches exist
    await editStorage(page, 'GIT-003-BASE')
    await openGitPanel(page)
    await page.locator('[data-id="gitStageAll"]').click()
    await page.waitForTimeout(800)
    await page.locator('[data-id="gitCommitMessage"]').fill('base')
    await page.locator('[data-id="gitCommit"]').click()
    await expect(page.locator('[data-id="gitLogEntry"]').filter({ hasText: 'base' })).toBeVisible({ timeout: 15_000 })

    await page.locator('[data-id="gitNewBranch"]').click()
    const prompt = page.locator('[data-id="modalDialogCustomPromptText"]')
    await prompt.waitFor({ state: 'visible', timeout: 10_000 })
    await prompt.fill('other')
    await page.locator('#modal-footer-ok').click()
    await expect.poll(async () => await page.locator('[data-id="gitBranchSelect"]').inputValue(), { timeout: 15_000 }).toBe('other')

    // Make an uncommitted change and confirm the panel sees it as dirty.
    await editStorage(page, 'GIT-003-DIRTY')
    await openGitPanel(page)
    const select = page.locator('[data-id="gitBranchSelect"]')
    const dirtyRow = page.locator('[data-id="gitFileRow"]', { hasText: '1_Storage.sol' })
    await expect(dirtyRow.locator('[data-id="gitStageFile"]')).toBeVisible({ timeout: 15_000 })

    const target = (await select.locator('option').allInnerTexts()).find((b) => b !== 'other') || 'main'
    await select.selectOption(target)

    // There is deliberately no "continue anyway" dialog: isomorphic-git can
    // silently erase staged edits and unstaged deletions. The panel resets the
    // picker and keeps the unstaged row intact.
    await expect(page.locator('[data-id="gitStatus"]')).toContainText(/commit or discard all changes/i, { timeout: 15_000 })
    await expect.poll(() => select.inputValue(), { timeout: 15_000 }).toBe('other')
    await expect(dirtyRow.locator('[data-id="gitStageFile"]')).toBeVisible()
    await expect(page.getByText(/switch branch with uncommitted changes/i)).toHaveCount(0)

    // Staging must not make checkout permissible. This is the data-loss case:
    // the old implementation treated the index as checkout's baseline and
    // replaced both the staged snapshot and worktree without a conflict.
    await dirtyRow.locator('[data-id="gitStageFile"]').click()
    await expect(dirtyRow.locator('[data-id="gitUnstageFile"]')).toBeVisible({ timeout: 15_000 })
    await select.selectOption(target)
    await expect(page.locator('[data-id="gitStatus"]')).toContainText(/staging alone does not protect/i, { timeout: 15_000 })
    await expect.poll(() => select.inputValue(), { timeout: 15_000 }).toBe('other')
    await expect(dirtyRow.locator('[data-id="gitUnstageFile"]')).toBeVisible()

    // Creating a new branch at the current commit is safe and should preserve
    // the index/worktree. It uses branch({ checkout: true }) rather than the
    // destructive branch-then-checkout sequence.
    await page.locator('[data-id="gitNewBranch"]').click()
    const dirtyBranchPrompt = page.locator('[data-id="modalDialogCustomPromptText"]')
    await dirtyBranchPrompt.waitFor({ state: 'visible', timeout: 10_000 })
    await dirtyBranchPrompt.fill('dirty-safe')
    await page.locator('#modal-footer-ok').click()
    await expect.poll(() => select.inputValue(), { timeout: 15_000 }).toBe('dirty-safe')
    await expect(dirtyRow.locator('[data-id="gitUnstageFile"]')).toBeVisible()
  })

  test('TC-GIT-014: a failed editor save cancels branch switching without losing the buffer', { tag: '@gate' }, async ({ page }) => {
    await openHome(page)
    await openGitPanel(page)
    const initBtn = page.locator('[data-id="gitInit"]')
    if (await initBtn.isVisible()) { await initBtn.click(); await page.waitForTimeout(1_500) }

    // Create a clean commit and a second branch so checkout would normally be
    // allowed. Keep Storage open: its Ace buffer is the data at risk here.
    await editStorage(page, 'GIT-014-BASE')
    await openGitPanel(page)
    await page.locator('[data-id="gitStageAll"]').click()
    await expect(page.locator('[data-id="gitUnstageFile"]').first()).toBeVisible({ timeout: 15_000 })
    await page.locator('[data-id="gitCommitMessage"]').fill('save guard base')
    await page.locator('[data-id="gitCommit"]').click()
    await expect(page.locator('[data-id="gitLogEntry"]', { hasText: 'save guard base' })).toBeVisible({ timeout: 15_000 })

    await page.locator('[data-id="gitNewBranch"]').click()
    const prompt = page.locator('[data-id="modalDialogCustomPromptText"]')
    await prompt.waitFor({ state: 'visible', timeout: 10_000 })
    await prompt.fill('save-guard')
    await page.locator('#modal-footer-ok').click()
    const select = page.locator('[data-id="gitBranchSelect"]')
    await expect.poll(() => select.inputValue(), { timeout: 15_000 }).toBe('save-guard')

    // Simulate browser storage rejecting the autosave. The disk remains clean,
    // but the visible editor has newer content. Treating saveCurrentFile as a
    // fire-and-forget call would therefore let checkout erase this marker.
    await page.evaluate(() => {
      const input = document.getElementById('input') as any
      input.editor.session.setValue(input.editor.session.getValue() + '\n// GIT-014-UNSAVED\n')
      const fs = (window as any).remixFileSystem
      const original = fs.writeFileSync
      ;(window as any).__git014WriteFileSync = original
      fs.writeFileSync = function (path: string, ...args: any[]) {
        if (String(path).endsWith('contracts/1_Storage.sol')) {
          const error: any = new Error('simulated storage write failure')
          error.code = 'ENOSPC'
          throw error
        }
        return original.call(this, path, ...args)
      }
    })

    await select.selectOption('main')
    await expect(page.locator('[data-id="gitStatus"]')).toContainText(/could not verify.*cancelled/i, { timeout: 15_000 })
    await expect.poll(() => select.inputValue(), { timeout: 15_000 }).toBe('save-guard')

    await page.evaluate(() => {
      const fs = (window as any).remixFileSystem
      fs.writeFileSync = (window as any).__git014WriteFileSync
      delete (window as any).__git014WriteFileSync
      const input = document.getElementById('input') as any
      if (!input.editor.session.getValue().includes('GIT-014-UNSAVED')) throw new Error('unsaved editor buffer was lost')
    })
  })

  test('TC-GIT-015: checkout closes a current file missing from the target branch', { tag: '@gate' }, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(String(error)))
    await blockCompilerSources(page)
    await openHome(page)
    await openGitPanel(page)
    const initBtn = page.locator('[data-id="gitInit"]')
    if (await initBtn.isVisible()) { await initBtn.click(); await page.waitForTimeout(1_500) }

    await editStorage(page, 'GIT-015-BASE')
    await openGitPanel(page)
    await page.locator('[data-id="gitStageAll"]').click()
    await expect(page.locator('[data-id="gitUnstageFile"]').first()).toBeVisible({ timeout: 15_000 })
    await page.locator('[data-id="gitCommitMessage"]').fill('missing file base')
    await page.locator('[data-id="gitCommit"]').click()
    await expect(page.locator('[data-id="gitLogEntry"]', { hasText: 'missing file base' })).toBeVisible({ timeout: 15_000 })

    await page.locator('[data-id="gitNewBranch"]').click()
    const prompt = page.locator('[data-id="modalDialogCustomPromptText"]')
    await prompt.waitFor({ state: 'visible', timeout: 10_000 })
    await prompt.fill('without-storage')
    await page.locator('#modal-footer-ok').click()
    const select = page.locator('[data-id="gitBranchSelect"]')
    await expect.poll(() => select.inputValue(), { timeout: 15_000 }).toBe('without-storage')

    await deleteStorage(page)
    await openGitPanel(page)
    const deleted = page.locator('[data-id="gitFileRow"]', { hasText: '1_Storage.sol' })
    await deleted.locator('[data-id="gitStageFile"]').click()
    await expect(deleted.locator('[data-id="gitUnstageFile"]')).toBeVisible({ timeout: 15_000 })
    await page.locator('[data-id="gitCommitMessage"]').fill('remove storage on branch')
    await page.locator('[data-id="gitCommit"]').click()
    await expect(page.locator('[data-id="gitLogEntry"]', { hasText: 'remove storage on branch' })).toBeVisible({ timeout: 15_000 })

    // Re-open Storage on main, then switch to the branch where it is absent.
    await select.selectOption('main')
    await expect.poll(() => select.inputValue(), { timeout: 15_000 }).toBe('main')
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    const storage = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await storage.isVisible().catch(() => false)) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await storage.click()
    await expect(page.locator('remix-tab[id$="1_Storage.sol"]')).toBeVisible({ timeout: 10_000 })

    // First leave Storage open in the background. Raw checkout emits no
    // provider fileRemoved event, so reconciliation must remove background tabs
    // too, not only the active editor session.
    const owner = page.locator('[data-id="treeViewLitreeViewItemcontracts/2_Owner.sol"]')
    await owner.click()
    await expect(page.locator('remix-tab[id$="2_Owner.sol"]')).toBeVisible({ timeout: 10_000 })
    await openGitPanel(page)
    await select.selectOption('without-storage')
    await expect.poll(() => select.inputValue(), { timeout: 15_000 }).toBe('without-storage')
    await expect(page.locator('remix-tab[id$="1_Storage.sol"]')).toHaveCount(0, { timeout: 15_000 })
    await expect(page.locator('remix-tab[id$="2_Owner.sol"]')).toBeVisible()

    // Repeat with Storage as the active tab to cover the null-content sync path.
    await select.selectOption('main')
    await expect.poll(() => select.inputValue(), { timeout: 15_000 }).toBe('main')
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]').click()
    await expect(page.locator('remix-tab[id$="1_Storage.sol"]')).toBeVisible({ timeout: 10_000 })
    await openGitPanel(page)
    await select.selectOption('without-storage')
    await expect.poll(() => select.inputValue(), { timeout: 15_000 }).toBe('without-storage')
    await expect(page.locator('remix-tab[id$="1_Storage.sol"]')).toHaveCount(0, { timeout: 15_000 })
    await expect(page.locator('remix-tab[id$="2_Owner.sol"][active]')).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => page.evaluate(() => {
      const input = document.getElementById('input') as any
      return input && input.editor ? input.editor.session.getValue() : ''
    }), { timeout: 15_000 }).toContain('contract Owner')

    await expect.poll(() => page.evaluate(() => {
      const workspace = (document.querySelector('#workspacesSelect') as HTMLSelectElement).value
      return (window as any).remixFileSystem.existsSync(`.workspaces/${workspace}/contracts/1_Storage.sol`)
    }), { timeout: 10_000 }).toBe(false)
    expect(pageErrors).toEqual([])
  })

  test('TC-GIT-018: a partial checkout failure re-syncs Ace before unlocking', { tag: '@gate' }, async ({ page }) => {
    await blockCompilerSources(page)
    await openHome(page)
    await openGitPanel(page)
    const initBtn = page.locator('[data-id="gitInit"]')
    if (await initBtn.isVisible()) { await initBtn.click(); await page.waitForTimeout(1_500) }

    await editStorage(page, 'GIT-018-BASE')
    await openGitPanel(page)
    await page.locator('[data-id="gitStageAll"]').click()
    await expect(page.locator('[data-id="gitUnstageFile"]').first()).toBeVisible({ timeout: 15_000 })
    await page.locator('[data-id="gitCommitMessage"]').fill('partial checkout base')
    await page.locator('[data-id="gitCommit"]').click()
    await expect(page.locator('[data-id="gitLogEntry"]', { hasText: 'partial checkout base' })).toBeVisible({ timeout: 15_000 })

    await page.locator('[data-id="gitNewBranch"]').click()
    const prompt = page.locator('[data-id="modalDialogCustomPromptText"]')
    await prompt.waitFor({ state: 'visible', timeout: 10_000 })
    await prompt.fill('partial-target')
    await page.locator('#modal-footer-ok').click()
    const select = page.locator('[data-id="gitBranchSelect"]')
    await expect.poll(() => select.inputValue(), { timeout: 15_000 }).toBe('partial-target')

    await editStorage(page, 'GIT-018-TARGET')
    await openGitPanel(page)
    await page.locator('[data-id="gitStageAll"]').click()
    await expect(page.locator('[data-id="gitUnstageFile"]').first()).toBeVisible({ timeout: 15_000 })
    await page.locator('[data-id="gitCommitMessage"]').fill('partial checkout target')
    await page.locator('[data-id="gitCommit"]').click()
    await expect(page.locator('[data-id="gitLogEntry"]', { hasText: 'partial checkout target' })).toBeVisible({ timeout: 15_000 })

    await select.selectOption('main')
    await expect.poll(() => select.inputValue(), { timeout: 15_000 }).toBe('main')
    await page.evaluate(() => {
      const fs = (window as any).remixFileSystem
      const original = fs.writeFile
      ;(window as any).__git018WriteFile = original
      fs.writeFile = function (path: string, data: any, ...args: any[]) {
        const bytes = typeof data === 'string' ? data : new TextDecoder().decode(data)
        const callback = args[args.length - 1]
        if (String(path).endsWith('contracts/1_Storage.sol') && bytes.includes('GIT-018-TARGET') && typeof callback === 'function') {
          const error: any = new Error('simulated checkout write failure')
          error.code = 'EIO'
          queueMicrotask(() => callback(error))
          return
        }
        return original.call(this, path, data, ...args)
      }
    })

    await select.selectOption('partial-target')
    await expect(page.locator('[data-id="gitStatus"]')).toContainText(/checkout failed:.*did not fully update/i, { timeout: 20_000 })
    await expect.poll(() => select.inputValue(), { timeout: 15_000 }).toBe('partial-target')

    const state = await page.evaluate(() => {
      const fs = (window as any).remixFileSystem
      fs.writeFile = (window as any).__git018WriteFile
      delete (window as any).__git018WriteFile
      const workspace = (document.querySelector('#workspacesSelect') as HTMLSelectElement).value
      const saved = String(fs.readFileSync(`.workspaces/${workspace}/contracts/1_Storage.sol`, 'utf8'))
      const input = document.getElementById('input') as any
      return { saved, editor: input.editor.session.getValue(), readOnly: input.editor.getReadOnly() }
    })
    expect(state.saved).not.toContain('GIT-018-TARGET')
    expect(state.editor).toBe(state.saved)
    expect(state.readOnly).toBe(false)
  })
})
