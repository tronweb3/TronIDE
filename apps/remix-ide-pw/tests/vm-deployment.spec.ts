import { test, expect } from '@playwright/test'
import { dismissWelcomeModal, ensureFilePanel } from './helpers'

test.describe('JavaScript VM (Tron) deployment and interaction', () => {
  test('compile 4_Trc10.sol, deploy to VM, and verify function UI', async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)

    // Wait for the workspace/File explorer to load
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    // Step 1: Open contracts folder and click 4_Trc10.sol
    const trc10File = page.locator('[data-id="treeViewLitreeViewItemcontracts/4_Trc10.sol"]')
    if (!await trc10File.isVisible()) {
      await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    }
    await trc10File.click()
    
    // Step 2: Open/Activate Solidity Compiler plugin
    const compilerIcon = page.locator('#icon-panel div[plugin="solidity"]')
    if (await compilerIcon.count() === 0) {
      // Activate compiler plugin if not visible
      await page.locator('#icon-panel div[plugin="pluginManager"]').click()
      await page.locator('[data-id="pluginManagerComponentActivateButtonsolidity"]').click()
      await page.waitForTimeout(1000)
    }
    await compilerIcon.click()

    // Step 3: Trigger compilation and wait for Trc10 contract to be available
    const compileBtn = page.locator('*[data-id="compilerContainerCompileBtn"]')
    await compileBtn.click()
    
    const selectContract = page.locator('*[data-id="compiledContracts"]')
    // 30s tolerates compile contention when the full suite runs in parallel locally.
    await expect(selectContract).toContainText('Trc10', { timeout: 30_000 })

    // Step 4: Open UDApp (Deploy & Run) plugin
    const udappIcon = page.locator('#icon-panel div[plugin="udapp"]')
    await udappIcon.click()

    // Step 5: Switch environment to JavaScript VM (Tron)
    const envSelect = page.locator('select[id="selectExEnvOptions"]')
    await envSelect.selectOption({ label: 'JavaScript VM (Tron)' })
    
    // Wait for the UI to update the environment
    await expect(page.locator('*[data-id="settingsNetworkEnv"]')).toContainText('JavaScript VM (Tron)', { timeout: 5_000 })

    // Step 6: Click Deploy button (no constructor parameters)
    const deployBtn = page.locator('#runTabView button:has-text("Deploy")')
    await deployBtn.click()

    // Step 7: Verify deployed contract exists in the instance list
    const instance = page.locator('.instance, *[data-id^="instance"]')
    await expect(instance).toBeVisible({ timeout: 15_000 })
    await expect(instance).toContainText('Trc10')

    // Step 8: Expand contract and check that TransferTokenTo function button is visible
    await instance.locator('[data-id="universalDappUiTitleExpander"]').click()
    
    const transferBtn = instance.locator('button:has-text("TransferTokenTo")')
    await expect(transferBtn).toBeVisible({ timeout: 5_000 })

    // A manual Deploy & Run deployment must feed the same post-deployment
    // action card used by AI deploys. Open the AI panel explicitly because it
    // may be hidden by the responsive layout.
    const aiPanel = page.locator('#chat-wrapper-id')
    if (!await aiPanel.isVisible()) await page.locator('[data-id="headerToggleAiPanel"]').click()
    await expect(aiPanel).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-id="aiDeploymentNextSteps"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-id="aiDeploymentNextSteps"] button')).toHaveCount(6)

    const firstDeployment = await page.evaluate(() => (window as any).__tronideLastDeployment)
    expect(firstDeployment.contractAddress).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/)
    expect(firstDeployment.provider).toBe('vm')
    expect(firstDeployment.networkId).toBe('vm')
    expect(firstDeployment.contextEpoch).toEqual(expect.any(Number))
    expect(firstDeployment.workspace).toBeTruthy()

    // Dismissal is durable for the current page; hiding/showing the panel must
    // not resurrect a global deployment that the user explicitly dismissed.
    await page.locator('[data-id="aiDeployNextDismiss"]').click()
    await expect(page.locator('[data-id="aiDeploymentNextSteps"]')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__tronideLastDeployment))).toBe(false)

    // Publish a second deployment, then switch workspace. Both the card and
    // its global backing value must be invalidated with the contract instances.
    await deployBtn.click()
    await expect(page.locator('[data-id="aiDeploymentNextSteps"]')).toBeVisible({ timeout: 10_000 })
    await ensureFilePanel(page)
    await page.locator('[data-id="workspaceCreate"]').click()
    const nameInput = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    await nameInput.waitFor({ state: 'visible', timeout: 5_000 })
    await nameInput.fill('deployment-context-reset')
    await page.locator('select[data-id="modalDialogCustomSelectTemplate"]').selectOption('empty')
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('deployment-context-reset', { timeout: 15_000 })
    await expect(page.locator('[data-id="aiDeploymentNextSteps"]')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__tronideLastDeployment))).toBe(false)
  })

  test('a reverted deployment does not publish AI deployment next steps', async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    const trc10File = page.locator('[data-id="treeViewLitreeViewItemcontracts/4_Trc10.sol"]')
    if (!await trc10File.isVisible()) {
      await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    }
    await trc10File.click()

    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Trc10', { timeout: 30_000 })

    await page.locator('#icon-panel div[plugin="udapp"]').click()
    await page.locator('select[id="selectExEnvOptions"]').selectOption({ label: 'JavaScript VM (Tron)' })
    await expect(page.locator('*[data-id="settingsNetworkEnv"]')).toContainText('JavaScript VM (Tron)', { timeout: 5_000 })

    // Trc10 has a non-payable constructor. Sending 1 TRX must revert and must
    // not create a success-bound deployment context for the AI panel.
    await page.locator('#runTabView input#value').fill('1')
    await page.locator('#runTabView select#unit').selectOption('trx')
    await page.locator('#runTabView select[class^="contractNames"]').selectOption('Trc10')
    await page.locator('#runTabView button:has-text("Deploy")').click()

    await expect(page.locator('#journal')).toContainText(/creation of Trc10 errored|VM error|revert/i, { timeout: 30_000 })
    await expect(page.locator('[data-id="aiDeploymentNextSteps"]')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__tronideLastDeployment))).toBe(false)
  })
})
