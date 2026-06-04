import { test, expect } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

test.describe('Contract Verification MVP plugin tests', () => {
  test('compile contract, check Nile status, generate verification package and save history', async ({ page }) => {
    // Mock Nile API to make the test fully independent of network and rate-limiting
    await page.route('**/nileapi.tronscan.org/api/contract*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'SUCCESS',
          data: [
            {
              address: 'TJX4fiwXdm5q8cryFYm4njVoCXaTLQFT18',
              balance: '0',
              balanceInUsd: '0',
              trxCount: '1',
              creator: 'TCrDi83pUoK17GbwxN1SckM3YNXzahWvoN'
            }
          ]
        })
      })
    })

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
      await page.locator('#icon-panel div[plugin="pluginManager"]').click()
      await page.locator('[data-id="pluginManagerComponentActivateButtonsolidity"]').click()
      await page.waitForTimeout(1000)
    }
    await compilerIcon.click()

    // Step 3: Trigger compilation and wait for Trc10 contract to compile
    const compileBtn = page.locator('*[data-id="compilerContainerCompileBtn"]')
    await compileBtn.click()
    
    const selectContract = page.locator('*[data-id="compiledContracts"]')
    await expect(selectContract).toContainText('Trc10', { timeout: 30_000 })

    // Step 4: Open/Activate Contract Verification plugin
    const cvIcon = page.locator('#icon-panel div[plugin="contractVerification"]')
    if (await cvIcon.count() === 0) {
      await page.locator('#icon-panel div[plugin="pluginManager"]').click()
      await page.locator('[data-id="pluginManagerComponentActivateButtoncontractVerification"]').click()
      await page.waitForTimeout(1000)
    }
    await cvIcon.click()

    // Step 5: Select network nile
    const networkSelect = page.locator('select[data-id="contractVerificationNetworkSelect"]')
    await networkSelect.selectOption({ value: 'nile' })

    // Step 6: Input contract address
    const addressInput = page.locator('input[data-id="contractVerificationAddressInput"]')
    await addressInput.fill('TJX4fiwXdm5q8cryFYm4njVoCXaTLQFT18')

    // Step 7: Click check status button and verify response status message
    const checkStatusBtn = page.locator('button[data-id="contractVerificationCheckStatus"]')
    await checkStatusBtn.click()
    
    const statusResult = page.locator('*[data-id="contractVerificationStatusResult"]')
    await expect(statusResult).toContainText('TronScan found the contract, but source verification is not detected yet.', { timeout: 10_000 })

    // Step 8: Click generate package button and verify package generated successfully
    const generatePackageBtn = page.locator('button[data-id="contractVerificationGeneratePackage"]')
    await generatePackageBtn.click()
    
    await expect(statusResult).toContainText('Verification package generated from the latest compilation.', { timeout: 10_000 })

    // Step 9: Verify localStorage history was updated
    const historyData = await page.evaluate(() => window.localStorage.getItem('tronide.contractVerification.history'))
    expect(historyData).not.toBeNull()
    
    const parsedHistory = JSON.parse(historyData!)
    expect(parsedHistory.length).toBeGreaterThan(0)
    expect(parsedHistory[0].contractName).toBe('Trc10')
    expect(parsedHistory[0].contractAddress).toBe('TJX4fiwXdm5q8cryFYm4njVoCXaTLQFT18')
    expect(parsedHistory[0].network).toBe('Nile')

    // Step 10: Verify the history section renders in the UI
    const historyView = page.locator('*[data-id="contractVerificationPackageHistory"]')
    await expect(historyView).toBeVisible()
    await expect(historyView).toContainText('Trc10')
    await expect(historyView).toContainText('Nile')
  })
})
