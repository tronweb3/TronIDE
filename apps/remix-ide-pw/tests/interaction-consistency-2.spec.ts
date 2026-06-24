import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// Remaining R-IX cases from 交互回归测试计划.md: cross-path state consistency for
// workspaces (S2), current file (S3), panel layout (S5), Home collapsibles (S6)
// and compiled artifacts (S8). Each changes a shared state via one path and
// verifies the other read surfaces stay in sync (modes M1/M4/M8).

async function bootstrap (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
}

async function createWorkspace (page: Page, name: string) {
  // The workspace controls live in the File Explorer panel — activate it only
  // when it isn't already showing (clicking an active icon would toggle it off).
  const createBtn = page.locator('[data-id="workspaceCreate"]')
  if (!await createBtn.isVisible().catch(() => false)) {
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
  }
  await createBtn.click()
  const input = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
  await input.waitFor({ state: 'visible', timeout: 5000 })
  await input.fill(name)
  await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()
  await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue(name, { timeout: 15_000 })
}

async function compileStorage (page: Page) {
  const storage = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
  if (!await storage.isVisible()) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
  await storage.click()
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
  await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Storage', { timeout: 30_000 })
}

test.describe('Interaction consistency II (R-IX remainder)', () => {
  test('TC-IX-WS-002: header dropdown workspace switch syncs FilePanel select and Home status', async ({ page }) => {
    await bootstrap(page)
    await createWorkspace(page, 'ix-ws-a')
    await createWorkspace(page, 'ix-ws-b')
    // Now on ix-ws-b. Switch back to ix-ws-a via the HEADER dropdown.
    await page.locator('[data-id="headerWorkspaceDropdown"]').click()
    await page.locator('[data-id="headerWorkspace-ix-ws-a"]').click()

    // All read surfaces follow the header-side write: FilePanel select, Home
    // hero status, and the header dropdown title itself.
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('ix-ws-a', { timeout: 15_000 })
    await expect(page.locator('[data-id="landingWorkspaceStatus"]')).toContainText('ix-ws-a', { timeout: 10_000 })
    await expect(page.locator('[data-id="headerWorkspaceDropdown"] .workspace-name')).toContainText('ix-ws-a')
  })

  test('TC-IX-WS-004: deleting the current workspace falls back to a valid one, no empty state', async ({ page }) => {
    await bootstrap(page)
    await createWorkspace(page, 'ix-ws-del')
    // Delete the current (ix-ws-del) workspace from the FilePanel trash control.
    await page.locator('[data-id="workspaceDelete"]').click()
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()

    // It switches to a valid remaining workspace (not ix-ws-del) and the file
    // tree renders that workspace's contents — never a bare/empty state (B4).
    const select = page.locator('select[data-id="workspacesSelect"]')
    await expect(select).not.toHaveValue('ix-ws-del', { timeout: 15_000 })
    const current = await select.inputValue()
    expect(current.length).toBeGreaterThan(0)
    await expect(page.locator('[data-id="treeViewLitreeViewItemcontracts"]')).toBeVisible({ timeout: 15_000 })
    // Header and Home agree with the fallback workspace (the header self-heals
    // after the post-delete fallback settles — IX-WS-DELETE-1 fix).
    await expect(page.locator('[data-id="headerWorkspaceDropdown"] .workspace-name')).toContainText(current, { timeout: 10_000 })
    await expect(page.locator('[data-id="headerWorkspaceDropdown"]')).not.toContainText('ix-ws-del')
    await expect(page.locator('[data-id="landingWorkspaceStatus"]')).toContainText(current, { timeout: 10_000 })
  })

  test('TC-IX-WS-005: renaming the current workspace updates the header title and select, no stale name', async ({ page }) => {
    await bootstrap(page)
    await createWorkspace(page, 'ix-ws-old')
    await page.locator('[data-id="workspaceRename"]').click()
    const renameInput = page.locator('input[data-id="modalDialogCustomPromptTextRename"]')
    await renameInput.waitFor({ state: 'visible', timeout: 5000 })
    await renameInput.fill('ix-ws-new')
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()

    const select = page.locator('select[data-id="workspacesSelect"]')
    await expect(select).toHaveValue('ix-ws-new', { timeout: 15_000 })
    await expect(page.locator('[data-id="headerWorkspaceDropdown"] .workspace-name')).toContainText('ix-ws-new')
    // The old name must not linger in either surface.
    await expect(select.locator('option', { hasText: 'ix-ws-old' })).toHaveCount(0)
    await expect(page.locator('[data-id="headerWorkspaceDropdown"]')).not.toContainText('ix-ws-old')
  })

  test('TC-IX-FILE-001: switching tabs keeps the active tab and editor content in agreement', async ({ page }) => {
    await bootstrap(page)
    await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]').click()
    await expect(page.locator('remix-tab[id$="1_Storage.sol"]')).toBeVisible({ timeout: 10_000 })
    await page.locator('[data-id="treeViewLitreeViewItemcontracts/3_Ballot.sol"]').click()
    await expect(page.locator('remix-tab[id$="3_Ballot.sol"]')).toBeVisible({ timeout: 10_000 })

    // Switch the active tab back to Storage via the tab bar; the editor content
    // must match the active tab (no stale buffer from Ballot).
    await page.locator('remix-tab[id$="1_Storage.sol"]').click()
    await page.waitForTimeout(800)
    const content = await page.evaluate(() => {
      const el = document.getElementById('input') as any
      return el && el.editor ? el.editor.session.getValue() : ''
    })
    expect(content).toMatch(/contract Storage/)
    expect(content).not.toMatch(/contract Ballot/)
  })

  test('TC-IX-FILE-003: closing the current tab clears currentFile and the dependent compile dropdowns', async ({ page }) => {
    await bootstrap(page)
    await compileStorage(page)
    // Close the compiled file's tab.
    await page.locator('remix-tab[id$="1_Storage.sol"] .close').click()

    // currentFile no longer points at the closed file: the tab is gone and the
    // compiler / udapp dropdowns (the dependents) are emptied (M1, B3).
    await expect(page.locator('remix-tab[id$="1_Storage.sol"]')).toHaveCount(0, { timeout: 10_000 })
    await expect(page.locator('*[data-id="compiledContracts"] option')).toHaveCount(0, { timeout: 10_000 })
    await page.locator('#icon-panel div[plugin="udapp"]').click()
    await expect(page.locator('#runTabView select[class^="contractNames"] option')).toHaveCount(0, { timeout: 10_000 })
  })

  test('TC-IX-CMP-002: closing the compiled file clears both dropdowns (compiler + udapp)', async ({ page }) => {
    await bootstrap(page)
    await compileStorage(page)
    // Cross-check: before closing, udapp lists Storage.
    await page.locator('#icon-panel div[plugin="udapp"]').click()
    await expect(page.locator('#runTabView select[class^="contractNames"] option')).toHaveCount(1, { timeout: 10_000 })

    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await page.locator('remix-tab[id$="1_Storage.sol"] .close').click()

    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await expect(page.locator('*[data-id="compiledContracts"] option')).toHaveCount(0, { timeout: 10_000 })
    await page.locator('#icon-panel div[plugin="udapp"]').click()
    await expect(page.locator('#runTabView select[class^="contractNames"] option')).toHaveCount(0, { timeout: 10_000 })
  })

  test('TC-IX-CMP-003: switching workspace does not retain the old workspace compiled artifacts', async ({ page }) => {
    await bootstrap(page)
    await compileStorage(page)
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Storage')

    // A fresh workspace has no compilation: both dropdowns must be empty, not
    // carrying over the previous workspace's Storage artifact.
    await createWorkspace(page, 'ix-cmp-fresh')
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await expect(page.locator('*[data-id="compiledContracts"] option')).toHaveCount(0, { timeout: 10_000 })
    await page.locator('#icon-panel div[plugin="udapp"]').click()
    await expect(page.locator('#runTabView select[class^="contractNames"] option')).toHaveCount(0, { timeout: 10_000 })
  })

  test('TC-IX-PNL-002: activating a plugin auto-shows the side panel consistently', async ({ page }) => {
    await bootstrap(page)
    const sidePanel = page.locator('#side-panel')
    // Hide the side panel via the header toggle, then activate a plugin from Home.
    await page.locator('[data-id="headerToggleSidePanel"]').click()
    await expect(sidePanel).toBeHidden({ timeout: 5_000 })

    await page.locator('[data-id="landingPluginContractVerification"]').getByText('Open Verification').click()
    // The implicit panel write re-shows the side panel and selects the plugin.
    await expect(sidePanel).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-id="sidePanelSwapitTitle"]')).toContainText(/contract verification/i, { timeout: 15_000 })
  })

  test('TC-IX-PNL-004: Reset layout restores the side, bottom and AI panels', async ({ page }) => {
    await bootstrap(page)
    const sidePanel = page.locator('#side-panel')
    const aiVisible = () => page.evaluate(() => {
      const el = document.getElementById('ai-panel')
      return !!el && el.style.display !== 'none'
    })
    // Collapse side + AI panels.
    await page.locator('[data-id="headerToggleSidePanel"]').click()
    await expect(sidePanel).toBeHidden({ timeout: 5_000 })
    if (await aiVisible()) {
      await page.locator('[data-id="headerToggleAiPanel"]').click()
      await expect.poll(aiVisible).toBe(false)
    }

    // Reset layout from the Home Advanced Tools section.
    const toggle = page.locator('[data-id="landingAdvancedToolsToggle"]')
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
    await page.locator('[data-id="landingLayoutReset"]').click()

    // All panels are restored to their default visible state.
    await expect(sidePanel).toBeVisible({ timeout: 10_000 })
    await expect.poll(aiVisible).toBe(true)
  })

  test('TC-IX-HOME-002: GitHub token Connect/Disconnect text strictly tracks the real state', async ({ page }) => {
    // Validate against a mocked GitHub /user so no real token is needed; the
    // panel state (not the network) is under test.
    await page.route('https://api.github.com/user', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ login: 'tron-tester' }) }))
    await bootstrap(page)

    // Expand Advanced Tools so the GitHub Token panel is visible.
    const advToggle = page.locator('[data-id="landingAdvancedToolsToggle"]')
    if ((await advToggle.getAttribute('aria-expanded')) === 'false') await advToggle.click()
    const panel = page.locator('[data-id="landingGithubTokenPanel"]')
    await expect(panel).toBeVisible({ timeout: 10_000 })

    // Disconnected baseline: Connect reads "Connect token", no Disconnect button.
    const connectBtn = page.locator('[data-id="landingGithubTokenConnect"]')
    await expect(connectBtn).toHaveText('Connect token')
    await expect(page.locator('[data-id="landingGithubTokenDisconnect"]')).toHaveCount(0)

    // Connect: enter a (mock-validated) token.
    await connectBtn.click()
    const tokenInput = page.locator('[data-id="modalDialogCustomPromptText"]')
    await tokenInput.waitFor({ state: 'visible', timeout: 10_000 })
    await tokenInput.fill('ghp_faketoken_for_test')
    await page.locator('#modal-footer-ok').click()

    // Connected: Disconnect appears, Connect flips to "Reconnect token", the
    // login surfaces, and the session token is stored.
    await expect(page.locator('[data-id="landingGithubTokenDisconnect"]')).toBeVisible({ timeout: 10_000 })
    await expect(connectBtn).toHaveText('Reconnect token')
    await expect(panel).toContainText('tron-tester')
    expect(await page.evaluate(() => window.sessionStorage.getItem('tronide.github.token'))).toBe('ghp_faketoken_for_test')

    // Disconnect: state reverts exactly — Disconnect gone, Connect back to
    // "Connect token", token cleared from sessionStorage (M2: text == state).
    await page.locator('[data-id="landingGithubTokenDisconnect"]').click()
    await expect(page.locator('[data-id="landingGithubTokenDisconnect"]')).toHaveCount(0, { timeout: 10_000 })
    await expect(connectBtn).toHaveText('Connect token')
    expect(await page.evaluate(() => window.sessionStorage.getItem('tronide.github.token'))).toBeNull()
  })

  test('TC-IX-FILE-004: opening a search result syncs the active tab and editor content', async ({ page }) => {
    await bootstrap(page)
    // Search a token unique to Ballot (the 'delegate' function), then jump to it.
    await page.locator('[data-id="verticalIconsKindglobalSearch"]').click()
    const input = page.locator('[data-id="globalSearchInput"]')
    await input.waitFor({ state: 'visible', timeout: 10_000 })
    await input.fill('delegate')
    const firstHit = page.locator('[data-id="globalSearchResultItem"]').first()
    await expect(firstHit).toBeVisible({ timeout: 15_000 })
    await firstHit.click()

    // The jump opens 3_Ballot.sol: the active tab and the editor buffer both
    // reflect the jumped-to file (three-way consistency S3).
    await expect(page.locator('remix-tab[id$="3_Ballot.sol"]')).toBeVisible({ timeout: 15_000 })
    const content = await page.evaluate(() => {
      const el = document.getElementById('input') as any
      return el && el.editor ? el.editor.session.getValue() : ''
    })
    expect(content).toMatch(/contract Ballot/)
    expect(content).toMatch(/function delegate/)
  })

  test('TC-IX-HOME-003: Advanced Tools collapsed state persists across reload', async ({ page }) => {
    await bootstrap(page)
    const toggle = page.locator('[data-id="landingAdvancedToolsToggle"]')
    // Expand it (writes the persisted preference), confirm the label/aria.
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 10_000 })
    await expect(toggle).toContainText('Hide tools')

    // Reload: the toggle must come back expanded and labelled consistently
    // (state restored from localStorage, not a default render — M8).
    await page.reload()
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
    await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 15_000 })
    await expect(toggle).toContainText('Hide tools')
    await expect(page.locator('[data-id="landingGitWorkflowPanel"]')).toBeVisible()
  })
})
