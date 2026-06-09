import { test, expect } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

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
  })
})
