import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// R-IX-2 batch from 交互回归测试计划.md: perturbation tests for the shared-state
// matrix — order swaps (M5), rapid/repeated operations (M6) and re-render /
// reload fidelity (M8). The oracle is always the same: after the perturbation
// every read surface must agree with the real state (B1), state-derived
// controls must keep acting per their label (B2), and nothing may leak or
// wedge (B5). TC-IX-PLG-008 (M7 mid-pending race) stays manual per the plan.

async function bootstrap (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
}

// The Home view is a main-panel tab; after opening a file (or reloading with a
// file tab restored) it may be hidden behind the editor. Bring it back.
async function showHomeTab (page: Page) {
  const status = page.locator('[data-id="landingWorkspaceStatus"]')
  if (await status.isVisible()) return
  await page.locator('remix-tabs').getByText('Home', { exact: true }).first().click()
  await status.waitFor({ state: 'visible', timeout: 10_000 })
}

// Compile 1_Storage.sol and deploy it on the VM. Leaves the Deploy & Run panel
// active with one instance deployed (= 1 recorded transaction).
async function compileAndDeployStorage (page: Page) {
  const storageFile = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
  if (!await storageFile.isVisible()) {
    await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
  }
  await storageFile.click()
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
  await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Storage', { timeout: 30_000 })

  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.locator('select[id="selectExEnvOptions"]').selectOption({ label: 'JavaScript VM (Tron)' })
  await expect(page.locator('*[data-id="settingsNetworkEnv"]')).toContainText('JavaScript VM (Tron)', { timeout: 5_000 })
  await page.locator('#runTabView select[class^="contractNames"]').selectOption('Storage')
  await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
  await expect(page.locator('.instance').first()).toBeVisible({ timeout: 30_000 })
}

test.describe('Interaction perturbation (R-IX-2)', () => {
  test('TC-IX-PLG-006: double-clicking the card toggle leaves a consistent, operable state', async ({ page }) => {
    await bootstrap(page)
    const card = page.locator('[data-id="landingPluginContractVerification"]')
    const onTag = page.locator('[data-id="landingPluginToggleContractVerification"]')
    const icon = page.locator('#icon-panel div[plugin="contractVerification"]')

    // Fire two clicks in the same JS task so both run against the
    // pre-activation state (the M6 worst case: the second click lands before
    // the first activation resolves and before the card re-renders).
    await card.getByText('Activate', { exact: true }).evaluate((el: HTMLElement) => { el.click(); el.click() })

    // The state must settle active with every read surface in agreement.
    await expect(onTag).toBeVisible({ timeout: 15_000 })
    await expect(card).toContainText('Deactivate')
    await expect(icon).toHaveCount(1, { timeout: 10_000 })

    // The control is still operable and acts per its label afterwards (B2).
    await card.getByText('Deactivate', { exact: true }).click()
    await expect(onTag).toHaveCount(0, { timeout: 15_000 })
    await expect(card).toContainText('Activate')
    await expect(icon).toHaveCount(0, { timeout: 10_000 })
  })

  test('TC-IX-PLG-007: Activate-then-Open and Open-then-toggle both behave, no reversed action', async ({ page }) => {
    await bootstrap(page)
    const card = page.locator('[data-id="landingPluginContractVerification"]')
    const onTag = page.locator('[data-id="landingPluginToggleContractVerification"]')

    // Order A (M5): Activate via the toggle first, then click Open. The Open
    // path also activates+selects — it must NOT flip the already-active state.
    await card.getByText('Activate', { exact: true }).click()
    await expect(onTag).toBeVisible({ timeout: 15_000 })
    await card.getByText('Open Verification').click()
    await expect(onTag).toBeVisible({ timeout: 15_000 })
    await expect(card).toContainText('Deactivate')
    await expect(page.locator('[data-id="sidePanelSwapitTitle"]')).toContainText(/contract verification/i, { timeout: 15_000 })

    // Reset to inactive for order B.
    await card.getByText('Deactivate', { exact: true }).click()
    await expect(onTag).toHaveCount(0, { timeout: 15_000 })

    // Order B: Open first (activates), then the toggle — which must read
    // Deactivate and genuinely deactivate (the original HOME-PLUGIN-TOGGLE bug).
    await card.getByText('Open Verification').click()
    await expect(onTag).toBeVisible({ timeout: 15_000 })
    await card.getByText('Deactivate', { exact: true }).click()
    await expect(onTag).toHaveCount(0, { timeout: 15_000 })
    await expect(page.locator('#icon-panel div[plugin="contractVerification"]')).toHaveCount(0, { timeout: 10_000 })
  })

  test('TC-IX-PLG-009: card state survives a tab switch away/back and a reload', async ({ page }) => {
    await bootstrap(page)
    const card = page.locator('[data-id="landingPluginContractVerification"]')
    const onTag = page.locator('[data-id="landingPluginToggleContractVerification"]')

    await card.getByText('Activate', { exact: true }).click()
    await expect(onTag).toBeVisible({ timeout: 15_000 })

    // Switch the main panel away from Home by opening a file, then come back —
    // the card must not have fallen back to a cached inactive rendering (M8).
    const storageFile = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await storageFile.isVisible()) {
      await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    }
    await storageFile.click()
    await expect(page.locator('[data-id="landingWorkspaceStatus"]')).toBeHidden({ timeout: 10_000 })
    await showHomeTab(page)
    await expect(onTag).toBeVisible({ timeout: 10_000 })
    await expect(card).toContainText('Deactivate')

    // Reload: activation persists (localStorage `workspace` loader), so both
    // read surfaces must come back active — card AND icon panel.
    await page.reload()
    await dismissWelcomeModal(page)
    await page.locator('remix-tabs').waitFor({ timeout: 30_000 })
    await showHomeTab(page)
    await expect(onTag).toBeVisible({ timeout: 20_000 })
    await expect(card).toContainText('Deactivate')
    await expect(page.locator('#icon-panel div[plugin="contractVerification"]')).toHaveCount(1, { timeout: 10_000 })
  })

  test('TC-IX-PNL-003: rapid-clicking each header layout toggle never loses a panel for good', async ({ page }) => {
    await bootstrap(page)

    // Side panel: 10 synchronous clicks (even) must land back on visible, and
    // the toggle must still respond one click at a time afterwards.
    const sidePanel = page.locator('#side-panel')
    await expect(sidePanel).toBeVisible({ timeout: 10_000 })
    await page.locator('[data-id="headerToggleSidePanel"]').evaluate((el: HTMLElement) => {
      for (let i = 0; i < 10; i++) el.click()
    })
    await expect(sidePanel).toBeVisible()
    await page.locator('[data-id="headerToggleSidePanel"]').click()
    await expect(sidePanel).toBeHidden({ timeout: 5_000 })
    await page.locator('[data-id="headerToggleSidePanel"]').click()
    await expect(sidePanel).toBeVisible({ timeout: 5_000 })

    // Bottom panel (terminal): height must return to its initial value after an
    // even burst, and a single toggle pair must still minimize and restore it.
    const terminalHeight = () => page.evaluate(() => {
      const term = document.querySelector('[data-id="terminalContainer"]')
      return term && term.parentElement ? Math.round(term.parentElement.getBoundingClientRect().height) : -1
    })
    const initialTerminal = await terminalHeight()
    expect(initialTerminal).toBeGreaterThan(0)
    await page.locator('[data-id="headerToggleBottomPanel"]').evaluate((el: HTMLElement) => {
      for (let i = 0; i < 10; i++) el.click()
    })
    await expect.poll(terminalHeight).toBe(initialTerminal)
    // Minimized leaves only the ~36px terminal menu bar visible, not 0.
    await page.locator('[data-id="headerToggleBottomPanel"]').click()
    await expect.poll(terminalHeight).toBeLessThan(initialTerminal)
    await page.locator('[data-id="headerToggleBottomPanel"]').click()
    await expect.poll(terminalHeight).toBe(initialTerminal)

    // AI panel: same contract on its display state. The toggle goes through an
    // async plugin call, so click sequentially and poll for the settled state.
    const aiVisible = () => page.evaluate(() => {
      const el = document.getElementById('ai-panel')
      return !!el && el.style.display !== 'none'
    })
    const initialAi = await aiVisible()
    for (let i = 0; i < 10; i++) await page.locator('[data-id="headerToggleAiPanel"]').click()
    await expect.poll(aiVisible).toBe(initialAi)
    await page.locator('[data-id="headerToggleAiPanel"]').click()
    await expect.poll(aiVisible).toBe(!initialAi)
    await page.locator('[data-id="headerToggleAiPanel"]').click()
    await expect.poll(aiVisible).toBe(initialAi)
  })

  test('TC-IX-ENV-003: rapid VM/Injected env switching settles with a clean account list', async ({ page }) => {
    await bootstrap(page)
    await page.locator('#icon-panel div[plugin="udapp"]').click()
    const envSelect = page.locator('select[id="selectExEnvOptions"]')
    await envSelect.selectOption('vm-tron')
    await expect(page.locator('*[data-id="settingsNetworkEnv"]')).toContainText('JavaScript VM (Tron)', { timeout: 10_000 })
    const accountOptions = page.locator('select[data-id="runTabSelectAccount"] option')
    await expect.poll(() => accountOptions.count(), { timeout: 20_000 }).toBeGreaterThan(0)

    // 5 fast round-trips. Without TronLink the injected attempt fails with a
    // toast and snaps back to VM — the point is that the flapping never wedges
    // the dropdown nor corrupts the account list (M6).
    for (let i = 0; i < 5; i++) {
      await envSelect.selectOption('injected')
      await envSelect.selectOption('vm-tron')
    }

    await expect(envSelect).toHaveValue('vm-tron', { timeout: 10_000 })
    await expect(page.locator('*[data-id="settingsNetworkEnv"]')).toContainText('JavaScript VM (Tron)', { timeout: 10_000 })
    // The VM account list refills (1s polling) with no duplicate leftovers.
    await expect.poll(() => accountOptions.count(), { timeout: 20_000 }).toBeGreaterThan(0)
    const values = await accountOptions.evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value))
    expect(new Set(values).size).toBe(values.length)
  })

  test('TC-IX-REC-001/002: collapsed recorder badge counts live and clear resets it', async ({ page }) => {
    await bootstrap(page)
    await compileAndDeployStorage(page)
    const badge = page.locator('[title="The number of recorded transactions"]')

    // The recorder card stays COLLAPSED throughout — the badge must still track
    // every VM transaction (deploy + 2 store calls = 3).
    await expect(badge).toHaveText('1', { timeout: 10_000 })

    const instance = page.locator('.instance').first()
    await instance.locator('[data-id="universalDappUiTitleExpander"]').click()
    const numInput = page.locator('#runTabView input[title="uint256 num"]')
    await numInput.fill('1')
    await instance.locator('button[title="store - transact (not payable)"]', { hasText: 'store' }).click()
    await expect(badge).toHaveText('2', { timeout: 15_000 })
    await numInput.fill('2')
    await instance.locator('button[title="store - transact (not payable)"]', { hasText: 'store' }).click()
    await expect(badge).toHaveText('3', { timeout: 15_000 })

    // TC-IX-REC-002: clear instances resets the recorder — badge back to 0.
    await page.locator('*[data-id="deployAndRunClearInstances"]').click()
    await expect(page.locator('.instance')).toHaveCount(0, { timeout: 10_000 })
    await expect(badge).toHaveText('0', { timeout: 10_000 })
  })

  test('TC-IX-REC-003: expand/collapse churn does not duplicate the save flow', async ({ page }) => {
    await bootstrap(page)
    await compileAndDeployStorage(page)

    // 5 expand/collapse round-trips, then end expanded (B5: listeners must not
    // stack across re-mounts of the card body).
    const recorderCard = page.locator('div[class*="cardContainer"]').filter({ hasText: 'Transactions recorded' })
    const arrow = recorderCard.locator('i[class*="arrow"]').first()
    for (let i = 0; i < 11; i++) {
      await arrow.click()
      await page.waitForTimeout(100)
    }
    const saveIcon = page.locator('i.savetransaction')
    await expect(saveIcon).toBeVisible({ timeout: 5_000 })

    // One save click → exactly one confirmation modal, and after confirming,
    // exactly one scenario.json and no trailing second modal.
    await saveIcon.click()
    const okBtn = page.locator('#modal-footer-ok')
    await expect(okBtn).toHaveCount(1, { timeout: 10_000 })
    await okBtn.click()
    await expect(okBtn).toBeHidden({ timeout: 10_000 })
    await page.waitForTimeout(1_500)
    await expect(okBtn).toBeHidden()

    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await expect(page.locator('span[data-path$="scenario.json"]')).toHaveCount(1, { timeout: 20_000 })
  })
})
