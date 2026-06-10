import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// R-IX-1 batch from 交互回归测试计划.md: cross-path state consistency.
// Each test changes a shared state via one path and verifies OTHER read
// surfaces reflect it (defect modes M1/M2 — stale read surfaces and
// stale state-derived controls). TC-IX-PLG-001 lives in
// home-plugin-toggle.spec.ts.

async function bootstrap (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
}

async function openPluginManager (page: Page) {
  await page.locator('#icon-panel div[plugin="pluginManager"]').click()
  await page.locator('[data-id="pluginManagerComponentSearchInput"]').waitFor({ state: 'visible', timeout: 10_000 })
}

test.describe('Interaction consistency (R-IX-1)', () => {
  test('TC-IX-PLG-002: deactivating via the card toggle really deactivates and resyncs the card', async ({ page }) => {
    await bootstrap(page)
    const card = page.locator('[data-id="landingPluginContractVerification"]')
    const onTag = page.locator('[data-id="landingPluginToggleContractVerification"]')

    // Activate through the Open path, then use the (now correct) toggle.
    await card.getByText('Open Verification').click()
    await expect(onTag).toBeVisible({ timeout: 15_000 })
    await card.getByText('Deactivate', { exact: true }).click()

    // The card resyncs to the inactive state...
    await expect(onTag).toHaveCount(0, { timeout: 15_000 })
    await expect(card).toContainText('Activate')
    // ...and the plugin is genuinely deactivated (icon gone from the icon panel).
    await expect(page.locator('#icon-panel div[plugin="contractVerification"]')).toHaveCount(0, { timeout: 10_000 })
  })

  test('TC-IX-PLG-003: the other two plugin cards also resync after their Open action', async ({ page }) => {
    await bootstrap(page)

    // Open Analyzer activates solidityStaticAnalysis.
    const analyzersCard = page.locator('[data-id="landingPluginSolidityAnalyzers"]')
    await analyzersCard.getByText('Open Analyzer').click()
    await expect(page.locator('[data-id="landingPluginToggleAnalyzers"]')).toBeVisible({ timeout: 15_000 })
    await expect(analyzersCard).toContainText('Deactivate')

    // Search TRON templates activates pluginManager (may already be active —
    // the assertion is only that the card reflects the active state afterwards).
    const cookbookCard = page.locator('[data-id="landingPluginCookbook"]')
    await cookbookCard.getByText('Search TRON templates').click()
    await expect(page.locator('[data-id="landingPluginToggleCookbook"]')).toBeVisible({ timeout: 15_000 })
    await expect(cookbookCard).toContainText('Deactivate')
  })

  test('TC-IX-PLG-004: activating from Plugin Manager updates the Home card live', async ({ page }) => {
    await bootstrap(page)
    const onTag = page.locator('[data-id="landingPluginToggleContractVerification"]')
    await expect(onTag).toHaveCount(0)

    // Activate contractVerification from the Plugin Manager side panel; the Home
    // tab stays visible in the main area, so its card must update live.
    await openPluginManager(page)
    await page.locator('[data-id="pluginManagerComponentSearchInput"]').fill('contract')
    await page.locator('[data-id="pluginManagerComponentActivateButtoncontractVerification"]').click()

    await expect(onTag).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-id="landingPluginContractVerification"]')).toContainText('Deactivate')
  })

  test('TC-IX-PLG-005: activating from the Home card is reflected in Plugin Manager', async ({ page }) => {
    await bootstrap(page)
    const card = page.locator('[data-id="landingPluginContractVerification"]')
    await card.getByText('Activate', { exact: true }).click()
    await expect(page.locator('[data-id="landingPluginToggleContractVerification"]')).toBeVisible({ timeout: 15_000 })

    await openPluginManager(page)
    await page.locator('[data-id="pluginManagerComponentSearchInput"]').fill('contract')
    // Plugin Manager must list it as active (offers Deactivate, not Activate).
    await expect(page.locator('[data-id="pluginManagerComponentDeactivateButtoncontractVerification"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-id="pluginManagerComponentActivateButtoncontractVerification"]')).toHaveCount(0)
  })

  test('TC-IX-WS-001: creating a workspace in FilePanel updates the header and Home status', async ({ page }) => {
    await bootstrap(page)

    await page.locator('[data-id="workspaceCreate"]').click()
    const input = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    await input.waitFor({ state: 'visible', timeout: 5000 })
    await input.fill('ix-ws-sync')
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('ix-ws-sync', { timeout: 15_000 })

    // Other read surfaces must follow without a manual refresh (B1):
    // the header workspace dropdown title and the Home hero status line.
    await expect(page.locator('[data-id="headerWorkspaceDropdown"] .workspace-name')).toContainText('ix-ws-sync', { timeout: 10_000 })
    await expect(page.locator('[data-id="landingWorkspaceStatus"]')).toContainText('ix-ws-sync', { timeout: 10_000 })
  })

  test('TC-IX-HOME-001: opening a plugin implicitly expands Advanced Tools and resyncs its toggle', async ({ page }) => {
    await bootstrap(page)
    const toggle = page.locator('[data-id="landingAdvancedToolsToggle"]')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toContainText('Show tools')

    // Open Verification implicitly calls openAdvancedTools — an indirect write
    // to the collapsed/expanded state. The toggle must reflect it (M1).
    await page.locator('[data-id="landingPluginContractVerification"]').getByText('Open Verification').click()

    await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 10_000 })
    await expect(toggle).toContainText('Hide tools')
    await expect(page.locator('[data-id="landingGitWorkflowPanel"]')).toBeVisible()
  })

  test('TC-IX-PNL-001: header side-panel toggle hides and restores the side panel', async ({ page }) => {
    await bootstrap(page)
    const sidePanel = page.locator('#side-panel')
    await expect(sidePanel).toBeVisible({ timeout: 10_000 })

    // Note: the header layout toggles carry no state-derived highlight, so the
    // M2 stale-label risk does not apply; the consistency contract here is that
    // a toggle round-trip restores the original visibility.
    await page.locator('[data-id="headerToggleSidePanel"]').click()
    await expect(sidePanel).toBeHidden({ timeout: 5000 })
    await page.locator('[data-id="headerToggleSidePanel"]').click()
    await expect(sidePanel).toBeVisible({ timeout: 5000 })
  })

  test('TC-IX-CMP-001: compiler and UDApp contract dropdowns stay consistent after a file switch', async ({ page }) => {
    await bootstrap(page)

    // Compile 1_Storage.sol.
    const storage = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await storage.isVisible()) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await storage.click()
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Storage', { timeout: 30_000 })

    const readCompilerSet = async () => {
      await page.locator('#icon-panel div[plugin="solidity"]').click()
      const opts = await page.locator('*[data-id="compiledContracts"] option').allInnerTexts()
      return opts.map((t) => t.split(' (')[0].trim()).sort()
    }
    const readUdappSet = async () => {
      await page.locator('#icon-panel div[plugin="udapp"]').click()
      const opts = await page.locator('#runTabView select[class^="contractNames"] option').allInnerTexts()
      return opts.map((t) => t.split(' - ')[0].trim()).sort()
    }

    const compilerBefore = await readCompilerSet()
    const udappBefore = await readUdappSet()
    expect(udappBefore).toEqual(compilerBefore)

    // Switch the current file WITHOUT compiling — both dropdowns must stay
    // consistent with each other (both stale or both updated, never split).
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await page.locator('[data-id="treeViewLitreeViewItemcontracts/3_Ballot.sol"]').click()
    await page.waitForTimeout(800)

    const compilerAfter = await readCompilerSet()
    const udappAfter = await readUdappSet()
    expect(udappAfter).toEqual(compilerAfter)
  })
})
