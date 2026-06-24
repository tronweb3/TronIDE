import { test, expect } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

test.describe('Contract Verification MVP plugin tests', () => {
  test('compile contract, check Nile status, generate verification package and save history', async ({ page }) => {
    // Mock Nile API to make the test fully independent of network and rate-limiting.
    // Return a genuine (unverified) contract record: it carries contract-identifying
    // fields (verify_status / date_created), unlike the bare account skeleton that
    // TronScan echoes for a non-contract address.
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
              verify_status: 0,
              date_created: 1700000000000,
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

  // CV-VERIFY-1 (P3): "Check status" must validate the address and must not
  // report a contract as "found" when TronScan has no contract record for it.
  // Regression: any non-empty TronScan response (incl. the bare account skeleton
  // returned for a non-contract address) was wrongly shown as "found", and
  // garbage like "abc" was queried at all.
  test('CV-VERIFY-1 rejects invalid addresses and reports not-found instead of found', async ({ page }) => {
    let contractApiCalls = 0
    // For a valid-format address that is not a deployed contract, TronScan still
    // echoes a one-element data array with only the bare account skeleton.
    await page.route('**/nileapi.tronscan.org/api/contract*', async (route) => {
      contractApiCalls++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'SUCCESS',
          data: [
            {
              address: 'TJX4fiwXdm5q8cryFYm4njVoCXaTLQFT18',
              balance: '',
              balanceInUsd: '0',
              trxCount: '0',
              creator: ''
            }
          ]
        })
      })
    })

    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    // Activate + open the Contract Verification plugin
    const cvIcon = page.locator('#icon-panel div[plugin="contractVerification"]')
    if (await cvIcon.count() === 0) {
      await page.locator('#icon-panel div[plugin="pluginManager"]').click()
      await page.locator('[data-id="pluginManagerComponentActivateButtoncontractVerification"]').click()
      await page.waitForTimeout(1000)
    }
    await cvIcon.click()

    const networkSelect = page.locator('select[data-id="contractVerificationNetworkSelect"]')
    await networkSelect.selectOption({ value: 'nile' })

    const addressInput = page.locator('input[data-id="contractVerificationAddressInput"]')
    const checkStatusBtn = page.locator('button[data-id="contractVerificationCheckStatus"]')
    const statusResult = page.locator('*[data-id="contractVerificationStatusResult"]')

    // Case 1: garbage address -> rejected on format, no network call, not "found".
    await addressInput.fill('abc')
    await checkStatusBtn.click()
    await expect(statusResult).toContainText('Invalid TRON address', { timeout: 10_000 })
    await expect(statusResult).not.toContainText('TronScan found the contract')
    expect(contractApiCalls).toBe(0)

    // Case 2: valid-format address but TronScan has no contract there -> not found.
    await addressInput.fill('TJX4fiwXdm5q8cryFYm4njVoCXaTLQFT18')
    await checkStatusBtn.click()
    await expect(statusResult).toContainText('no contract at this address', { timeout: 10_000 })
    await expect(statusResult).not.toContainText('TronScan found the contract')
    expect(contractApiCalls).toBeGreaterThan(0)
  })

  // CV-VERIFY-2: a 41... hex address must be normalized to base58 before querying
  // TronScan. TronScan's /api/contract only matches the base58 form, so a real
  // contract entered as hex was reported "not found". The mock returns the
  // verified contract ONLY when queried with the base58 address, proving the hex
  // was converted.
  test('CV-VERIFY-2 normalizes a 41... hex address to base58 before querying', async ({ page }) => {
    const BASE58 = 'TJX4fiwXdm5q8cryFYm4njVoCXaTLQFT18'
    const HEX41 = '415dc75c573b0fdb0a3074bb466cc660d16c728cdd'
    await page.route('**/nileapi.tronscan.org/api/contract*', async (route) => {
      const matchedBase58 = route.request().url().includes(BASE58)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'SUCCESS',
          data: [matchedBase58
            ? { address: BASE58, name: 'HexNormalized', verify_status: 2, date_created: 1 }
            : { address: BASE58, balance: '', balanceInUsd: '0', trxCount: '0', creator: '' }]
        })
      })
    })

    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    const cvIcon = page.locator('#icon-panel div[plugin="contractVerification"]')
    if (await cvIcon.count() === 0) {
      await page.locator('#icon-panel div[plugin="pluginManager"]').click()
      await page.locator('[data-id="pluginManagerComponentActivateButtoncontractVerification"]').click()
      await page.waitForTimeout(1000)
    }
    await cvIcon.click()
    await page.locator('select[data-id="contractVerificationNetworkSelect"]').selectOption({ value: 'nile' })

    // Enter the HEX form; the contract is only matched when the query uses base58.
    await page.locator('input[data-id="contractVerificationAddressInput"]').fill(HEX41)
    await page.locator('button[data-id="contractVerificationCheckStatus"]').click()
    const statusResult = page.locator('*[data-id="contractVerificationStatusResult"]')
    await expect(statusResult).toContainText('verified', { timeout: 10_000 })
    await expect(statusResult).not.toContainText('no contract at this address')
  })

  // CV-011 (P0): open -> deactivate -> re-activate from the Home plugin cards.
  // Regression: deactivating the plugin currently shown in the side panel used
  // to leave a stale "Contract Verification" header over an empty body, and the
  // panel stayed broken after re-activating. The side panel must fall back to
  // the file explorer on deactivate and re-render cleanly when re-opened.
  test('CV-011 deactivate/re-activate from Home keeps the side panel consistent', async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)

    // Wait for the Home landing "Most used plugins" cards
    const cvCard = page.locator('[data-id="landingPluginContractVerification"]')
    await cvCard.waitFor({ timeout: 30_000 })

    const sidePanelTitle = page.locator('[data-id="sidePanelSwapitTitle"]')
    const onTag = page.locator('[data-id="landingPluginToggleContractVerification"]')
    const cvVerticalIcon = page.locator('#icon-panel div[plugin="contractVerification"]')
    const networkSelect = page.locator('select[data-id="contractVerificationNetworkSelect"]')
    const deactivateChip = cvCard.getByText('Deactivate', { exact: true })
    const activateChip = cvCard.getByText('Activate', { exact: true })

    // Precondition: make sure the plugin is active and the card reflects it
    // (it is not guaranteed active in a fresh browser context).
    if (await deactivateChip.count() === 0) {
      await activateChip.click()
    }
    await expect(deactivateChip).toBeVisible()
    await expect(onTag).toHaveCount(1)

    // Step 1 - Open Verification: side panel shows the plugin with its form
    await cvCard.getByText('Open Verification', { exact: true }).click()
    await expect(sidePanelTitle).toHaveText('Contract Verification')
    await expect(networkSelect).toBeVisible()

    // Step 2 - Deactivate: panel must NOT keep a stale empty "Contract
    // Verification" header; it falls back to the file explorer.
    await deactivateChip.click()
    await expect(onTag).toHaveCount(0)
    await expect(activateChip).toBeVisible()
    await expect(sidePanelTitle).toHaveText('File explorers')
    await expect(cvVerticalIcon).toHaveCount(0)

    // Step 3 - Re-activate: state restored, no stale verification panel
    await activateChip.click()
    await expect(onTag).toHaveCount(1)
    await expect(deactivateChip).toBeVisible()
    await expect(sidePanelTitle).toHaveText('File explorers')
    await expect(cvVerticalIcon).toHaveCount(1)

    // Step 4 - Open Verification again: content re-renders (panel is not empty)
    await cvCard.getByText('Open Verification', { exact: true }).click()
    await expect(sidePanelTitle).toHaveText('Contract Verification')
    await expect(networkSelect).toBeVisible()
  })
})
