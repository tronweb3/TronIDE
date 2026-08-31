import { test, expect, Page } from '@playwright/test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { dismissWelcomeModal } from './helpers'

const flatTmp = path.join(os.tmpdir(), 'tronide-pw-flat')

async function activateAndOpen (page: Page, plugin: string, activateId: string) {
  const icon = page.locator(`#icon-panel div[plugin="${plugin}"]`)
  if (await icon.count() === 0) {
    await page.locator('#icon-panel div[plugin="pluginManager"]').click()
    await page.locator(`[data-id="pluginManagerComponentActivateButton${activateId}"]`).click()
    await page.waitForTimeout(800)
  }
  await icon.click()
}

test.describe('Contract Verification MVP plugin tests', () => {
  test('CV-COMPILE-1 compiles the current Solidity file and enables the contract picker', async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    const storage = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await storage.isVisible()) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await storage.click()

    // Open verification before ever visiting the compiler. The empty picker is
    // intentionally disabled, but the adjacent action must compile the current
    // file and refresh the picker without making the user switch panels.
    await activateAndOpen(page, 'contractVerification', 'contractVerification')
    const contractSelect = page.locator('select[data-id="contractVerificationContractSelect"]')
    await expect(contractSelect).toBeDisabled()
    await expect(page.locator('[data-id="contractVerificationCompileHint"]')).toContainText('No compiled artifact')
    for (const id of ['contractVerificationFlatten', 'contractVerificationCopyFlatten', 'contractVerificationDownloadFlatten', 'contractVerificationSaveFlatten', 'contractVerificationGeneratePackage', 'contractVerificationCopyPackage', 'contractVerificationDownloadPackage']) {
      await expect(page.locator(`button[data-id="${id}"]`)).toBeDisabled()
    }
    await expect(page.locator('button[data-id="contractVerificationCompileCurrent"]')).toBeEnabled()

    const compileButton = page.locator('button[data-id="contractVerificationCompileCurrent"]')
    await compileButton.click()
    await expect(compileButton).toBeDisabled()
    await expect(page.locator('button[data-id="contractVerificationFlatten"]')).toBeDisabled()
    await expect(contractSelect).toBeEnabled({ timeout: 30_000 })
    await expect(contractSelect.locator('option:checked')).toContainText('Storage')
    await expect(page.locator('[data-id="contractVerificationStatusResult"]')).toContainText('ready to flatten')

    // A recompile must invalidate the old artifact at the start of compiler
    // preparation, not only after the Solidity plugin eventually responds.
    await compileButton.click()
    await expect(compileButton).toBeDisabled()
    await expect(contractSelect).toBeDisabled()
    await expect(page.locator('button[data-id="contractVerificationFlatten"]')).toBeDisabled()
    await expect(contractSelect).toBeEnabled({ timeout: 30_000 })

    // A failed recompile must not resurrect the previous successful __last
    // artifact and let users export source/settings for the wrong build.
    await page.evaluate(() => {
      const el = document.getElementById('input') as any
      el.editor.session.setValue(el.editor.session.getValue() + '\nthis is not valid solidity;')
    })
    await page.keyboard.press('Control+S')
    await page.waitForTimeout(300)
    await compileButton.click()
    await expect(page.locator('[data-id="contractVerificationStatusResult"]')).toContainText('Compilation failed', { timeout: 30_000 })
    await expect(contractSelect).toBeDisabled()
    await expect(page.locator('button[data-id="contractVerificationFlatten"]')).toBeDisabled()
    await expect(page.locator('button[data-id="contractVerificationGeneratePackage"]')).toBeDisabled()
  })

  test('CV-COMPILE-2 keeps the workflow disabled when compilation has no deployable contract', async ({ page }) => {
    fs.mkdirSync(flatTmp, { recursive: true })
    const sourcePath = path.join(flatTmp, 'InterfaceOnly.sol')
    fs.writeFileSync(sourcePath, [
      '// SPDX-License-Identifier: MIT',
      'pragma solidity >=0.8.2 <0.9.0;',
      'interface InterfaceOnly { function value() external view returns (uint256); }'
    ].join('\n'))

    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
    await page.locator('[data-id="workspaceCreate"]').click()
    const wsInput = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    await wsInput.waitFor({ state: 'visible', timeout: 5000 })
    await wsInput.fill('verify-interface-only')
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('verify-interface-only', { timeout: 15_000 })
    await page.locator('[data-id="fileExplorerFileUpload"]').setInputFiles(sourcePath)
    const ok = page.locator('#modal-footer-ok')
    if (await ok.isVisible().catch(() => false)) await ok.click()
    await page.locator('[data-id="treeViewLitreeViewItemInterfaceOnly.sol"]').click()

    await activateAndOpen(page, 'contractVerification', 'contractVerification')
    const contractSelect = page.locator('select[data-id="contractVerificationContractSelect"]')
    await page.locator('button[data-id="contractVerificationCompileCurrent"]').click()
    await expect(page.locator('[data-id="contractVerificationStatusResult"]')).toContainText('only interfaces or abstract contracts', { timeout: 30_000 })
    await expect(contractSelect).toBeDisabled()
    await expect(contractSelect).toContainText('No deployable contract found')
    await expect(page.locator('[data-id="contractVerificationCompileHint"]')).toContainText(/only interfaces or abstract contracts/i)
    await expect(page.locator('button[data-id="contractVerificationDownloadFlatten"]')).toBeDisabled()
    await expect(page.locator('button[data-id="contractVerificationGeneratePackage"]')).toBeDisabled()
  })

  test('compile contract, check Nile status, show settings reference and save history', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
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

    // The contract picker must point at the deployable contract that will be
    // flattened/packaged, not an arbitrary first compiler artifact.
    const contractSelect = page.locator('select[data-id="contractVerificationContractSelect"]')
    await expect(contractSelect.locator('option:checked')).toContainText('Trc10')

    // Step 5: Select network nile
    const networkSelect = page.locator('select[data-id="contractVerificationNetworkSelect"]')
    await networkSelect.selectOption({ value: 'nile' })
    await expect(page.locator('[data-id="contractVerificationOpenTronScan"]')).toHaveAttribute('href', 'https://nile.tronscan.org/#/contracts/verify')

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

    await expect(statusResult).toContainText('Verification settings reference shown below.', { timeout: 10_000 })

    // Generation is visible immediately and stays in memory until the browser
    // tab is refreshed; it is not silently written to the workspace.
    const metadataPreview = page.locator('[data-id="contractVerificationMetadataPreview"]')
    await expect(metadataPreview).toBeVisible()
    const metadataText = page.locator('textarea[data-id="contractVerificationMetadataText"]')
    expect(await metadataText.inputValue()).toContain('"contractName": "Trc10"')
    expect(await metadataText.inputValue()).toContain('Reference metadata only')
    await expect(metadataPreview).toContainText('Nile')
    await expect(metadataPreview).toContainText('Trc10')

    await page.locator('button[data-id="contractVerificationCopyPackage"]').click()
    const copiedSettings = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))
    expect(copiedSettings.network).toBe('Nile')
    expect(copiedSettings.contractAddress).toBe('TJX4fiwXdm5q8cryFYm4njVoCXaTLQFT18')
    await expect(statusResult).toContainText('settings JSON copied')

    // Download must create a real browser file—not just a detached in-memory
    // anchor—and the exported values must match the visible inputs.
    const settingsDownloadPromise = page.waitForEvent('download')
    await page.locator('button[data-id="contractVerificationDownloadPackage"]').click()
    const settingsDownload = await settingsDownloadPromise
    expect(settingsDownload.suggestedFilename()).toBe('tronide-verification-settings-reference.json')
    const settingsPath = await settingsDownload.path()
    expect(settingsPath).not.toBeNull()
    const exportedSettings = JSON.parse(fs.readFileSync(settingsPath!, 'utf8'))
    expect(exportedSettings.network).toBe('Nile')
    expect(exportedSettings.contractAddress).toBe('TJX4fiwXdm5q8cryFYm4njVoCXaTLQFT18')
    expect(exportedSettings.contractName).toBe('Trc10')

    // Step 9: Verify localStorage history was updated
    const historyData = await page.evaluate(() => window.localStorage.getItem('tronide.contractVerification.history'))
    expect(historyData).not.toBeNull()

    const parsedHistory = JSON.parse(historyData!)
    expect(parsedHistory.length).toBeGreaterThan(0)
    expect(parsedHistory[0].contractName).toBe('Trc10')
    expect(parsedHistory[0].contractAddress).toBe('TJX4fiwXdm5q8cryFYm4njVoCXaTLQFT18')
    expect(parsedHistory[0].network).toBe('Nile')
    expect(parsedHistory.length).toBe(1)

    // Step 10: Verify the history section renders in the UI
    const historyView = page.locator('*[data-id="contractVerificationPackageHistory"]')
    await expect(historyView).toBeVisible()
    await expect(historyView).toContainText('Trc10')
    await expect(historyView).toContainText('Nile')

    // Cached JSON and status must never survive an address/network change.
    await addressInput.fill('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')
    await expect(metadataPreview).toHaveCount(0)
    await expect(statusResult).toContainText('Contract address changed')
    await generatePackageBtn.click()
    await expect(metadataPreview).toContainText('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')
    await networkSelect.selectOption({ value: 'mainnet' })
    await expect(metadataPreview).toHaveCount(0)
    await expect(statusResult).toContainText('Network changed')
    await expect(page.locator('[data-id="contractVerificationOpenTronScan"]')).toHaveAttribute('href', 'https://tronscan.org/#/contracts/verify')
  })

  test('TC-FLAT-001: flatten a single-file contract — one SPDX/pragma, no imports, saved to flattened/', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    const storage = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await storage.isVisible()) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await storage.click()
    await activateAndOpen(page, 'solidity', 'solidity')
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Storage', { timeout: 30_000 })

    await activateAndOpen(page, 'contractVerification', 'contractVerification')
    await page.locator('button[data-id="contractVerificationFlatten"]').click()

    const flat = page.locator('textarea[data-id="contractVerificationFlattenText"]')
    await expect(flat).toBeVisible({ timeout: 10_000 })
    const text = await flat.inputValue()
    expect(text).toMatch(/contract Storage/)
    // Exactly one SPDX line and no surviving import statements.
    expect((text.match(/SPDX-License-Identifier:/g) || []).length).toBe(1)
    expect(text).not.toMatch(/^\s*import\b/m)
    expect((text.match(/pragma solidity/g) || []).length).toBe(1)

    await page.locator('button[data-id="contractVerificationCopyFlatten"]').click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text)
    await expect(page.locator('[data-id="contractVerificationStatusResult"]')).toContainText('copied to clipboard')

    // TronScan accepts a Solidity file, not the metadata JSON. The primary
    // download therefore emits the exact flattened source as a .sol file.
    const downloadPromise = page.waitForEvent('download')
    await page.locator('button[data-id="contractVerificationDownloadFlatten"]').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('Storage_flat.sol')
    const downloadedPath = await download.path()
    expect(downloadedPath).not.toBeNull()
    expect(fs.readFileSync(downloadedPath!, 'utf8')).toBe(text)
    await expect(page.locator('*[data-id="contractVerificationStatusResult"]')).toContainText('Upload this .sol', { timeout: 10_000 })

    // Save writes flattened/Storage_flat.sol and opens it.
    await page.locator('button[data-id="contractVerificationSaveFlatten"]').click()
    await expect(page.locator('remix-tab[id$="Storage_flat.sol"]')).toBeVisible({ timeout: 15_000 })
  })

  test('CV-CONTRACT-SELECT-1 keeps the deployable selection aligned across external recompiles', async ({ page }) => {
    fs.mkdirSync(flatTmp, { recursive: true })
    const sourcePath = path.join(flatTmp, 'PickerMain.sol')
    fs.writeFileSync(sourcePath, [
      '// SPDX-License-Identifier: MIT',
      'pragma solidity >=0.8.2 <0.9.0;',
      'interface AErrors { error Failed(); }',
      'contract ZMain is AErrors { function value() external pure returns (uint256) { return 1; } }',
      'contract ZSecond { function value() external pure returns (uint256) { return 2; } }'
    ].join('\n'))

    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
    await page.locator('[data-id="workspaceCreate"]').click()
    const wsInput = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    await wsInput.waitFor({ state: 'visible', timeout: 5000 })
    await wsInput.fill('verify-contract-picker')
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('verify-contract-picker', { timeout: 15_000 })
    await page.locator('[data-id="fileExplorerFileUpload"]').setInputFiles(sourcePath)
    const ok = page.locator('#modal-footer-ok')
    if (await ok.isVisible().catch(() => false)) await ok.click()
    await page.locator('[data-id="treeViewLitreeViewItemPickerMain.sol"]').click()

    await activateAndOpen(page, 'solidity', 'solidity')
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('ZMain', { timeout: 30_000 })

    await activateAndOpen(page, 'contractVerification', 'contractVerification')
    const contractSelect = page.locator('select[data-id="contractVerificationContractSelect"]')
    await expect(contractSelect.locator('option:checked')).toContainText('ZMain')
    const interfaceOption = contractSelect.locator('option').filter({ hasText: 'AErrors' })
    expect(await interfaceOption.getAttribute('disabled')).not.toBeNull()
    const secondOption = contractSelect.locator('option').filter({ hasText: 'ZSecond' })
    await contractSelect.selectOption((await secondOption.getAttribute('value'))!)
    await expect(contractSelect.locator('option:checked')).toContainText('ZSecond')

    await page.locator('button[data-id="contractVerificationFlatten"]').click()
    const flat = page.locator('textarea[data-id="contractVerificationFlattenText"]')
    await expect(flat).toBeVisible({ timeout: 10_000 })
    expect(await flat.inputValue()).toContain('contract ZMain')
    await expect(page.locator('[data-id="contractVerificationFlattenPreview"]')).toContainText('ZSecond_flat.sol')

    await page.locator('input[data-id="contractVerificationAddressInput"]').fill('TJX4fiwXdm5q8cryFYm4njVoCXaTLQFT18')
    await page.locator('button[data-id="contractVerificationGeneratePackage"]').click()
    const historyData = await page.evaluate(() => window.localStorage.getItem('tronide.contractVerification.history'))
    expect(JSON.parse(historyData!)[0].contractName).toBe('ZSecond')

    // Recompiling the unchanged file externally must preserve both the picker
    // selection and the previews generated for that same exact artifact.
    await activateAndOpen(page, 'solidity', 'solidity')
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('ZSecond', { timeout: 30_000 })
    await activateAndOpen(page, 'contractVerification', 'contractVerification')
    await expect(contractSelect.locator('option:checked')).toContainText('ZSecond')
    await expect(page.locator('[data-id="contractVerificationMetadataPreview"]')).toContainText('ZSecond')
    await expect(page.locator('textarea[data-id="contractVerificationFlattenText"]')).toBeVisible()
  })

  test('TC-FLAT-002: flatten a multi-level import chain into a standalone-compilable file', async ({ page }) => {
    fs.mkdirSync(flatTmp, { recursive: true })
    const mk = (name: string, body: string) => {
      const p = path.join(flatTmp, name)
      fs.writeFileSync(p, body)
      return p
    }
    const math = mk('Math.sol', [
      '// SPDX-License-Identifier: MIT',
      'pragma solidity >=0.8.2 <0.9.0;',
      'library Math { function add(uint256 a, uint256 b) internal pure returns (uint256) { return a + b; } }'
    ].join('\n'))
    const token = mk('Token.sol', [
      '// SPDX-License-Identifier: MIT',
      'pragma solidity >=0.8.2 <0.9.0;',
      'import "./Math.sol";',
      'contract Token { using Math for uint256; uint256 public total; function mint(uint256 v) public { total = total.add(v); } }'
    ].join('\n'))
    const main = mk('Main.sol', [
      '// SPDX-License-Identifier: MIT',
      'pragma solidity >=0.8.2 <0.9.0;',
      'import "./Token.sol";',
      'contract Main is Token {}'
    ].join('\n'))

    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
    // Fresh workspace + upload the three files.
    await page.locator('[data-id="workspaceCreate"]').click()
    const wsInput = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    await wsInput.waitFor({ state: 'visible', timeout: 5000 })
    await wsInput.fill('flat-imports')
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('flat-imports', { timeout: 15_000 })
    await page.locator('[data-id="fileExplorerFileUpload"]').setInputFiles([math, token, main])
    const ok = page.locator('#modal-footer-ok')
    if (await ok.isVisible().catch(() => false)) await ok.click()
    await expect(page.locator('[data-id="treeViewLitreeViewItemMain.sol"]')).toBeVisible({ timeout: 15_000 })

    await page.locator('[data-id="treeViewLitreeViewItemMain.sol"]').click()
    await activateAndOpen(page, 'solidity', 'solidity')
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Main', { timeout: 30_000 })

    await activateAndOpen(page, 'contractVerification', 'contractVerification')
    await page.locator('button[data-id="contractVerificationFlatten"]').click()
    const flat = page.locator('textarea[data-id="contractVerificationFlattenText"]')
    await expect(flat).toBeVisible({ timeout: 10_000 })
    const text = await flat.inputValue()
    // All three definitions inlined; deduped SPDX/pragma; no imports remain.
    expect(text).toMatch(/library Math/)
    expect(text).toMatch(/contract Token/)
    expect(text).toMatch(/contract Main/)
    expect((text.match(/SPDX-License-Identifier:/g) || []).length).toBe(1)
    expect(text).not.toMatch(/^\s*import\b/m)
    // Math must precede Token (dependency order).
    expect(text.indexOf('library Math')).toBeLessThan(text.indexOf('contract Token'))

    // The flattened source compiles standalone: save it and compile the new file.
    await page.locator('button[data-id="contractVerificationSaveFlatten"]').click()
    await expect(page.locator('remix-tab[id$="Main_flat.sol"]')).toBeVisible({ timeout: 15_000 })
    await activateAndOpen(page, 'solidity', 'solidity')
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Main', { timeout: 30_000 })
    await expect(page.locator('#compileTabView')).not.toContainText(/not found|ParserError/i)
  })

  // CV-VERIFY-1 (P3): "Check status" must validate the address and must not
  // report a contract as "found" when TronScan has no contract record for it.
  // Regression: any non-empty TronScan response (incl. the bare account skeleton
  // returned for a non-contract address) was wrongly shown as "found", and
  // garbage like "abc" was queried at all.
  test('CV-VERIFY-1 rejects invalid addresses and reports not-found instead of found', async ({ page }) => {
    let contractApiCalls = 0
    let malformedResponse = false
    // For a valid-format address that is not a deployed contract, TronScan still
    // echoes a one-element data array with only the bare account skeleton.
    await page.route('**/nileapi.tronscan.org/api/contract*', async (route) => {
      contractApiCalls++
      if (malformedResponse) {
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<html>proxy error</html>' })
        return
      }
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

    // A reachable HTTP endpoint with an unreadable body is not evidence that
    // the contract is absent; report an API/readability failure instead.
    malformedResponse = true
    await checkStatusBtn.click()
    await expect(statusResult).toContainText('Unable to query TronScan', { timeout: 10_000 })
    await expect(statusResult).not.toContainText('no contract at this address')
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

  test('CV-VERIFY-3 ignores a late status response after the address changes', async ({ page }) => {
    const ADDRESS_A = 'TJX4fiwXdm5q8cryFYm4njVoCXaTLQFT18'
    const ADDRESS_B = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
    // Delay JSON parsing after fetch() has already resolved. This specifically
    // covers the headers/body gap where the old request used to escape both the
    // timeout and the stale-request guard.
    await page.addInitScript((slowAddress) => {
      const originalFetch = window.fetch.bind(window)
      window.fetch = (async (...args: Parameters<typeof fetch>) => {
        const response = await originalFetch(...args)
        if (!String(args[0]).includes(slowAddress)) return response
        return {
          ok: response.ok,
          status: response.status,
          json: async () => {
            await new Promise((resolve) => setTimeout(resolve, 600))
            return response.json()
          }
        } as Response
      }) as typeof window.fetch
    }, ADDRESS_A)
    await page.route('**/nileapi.tronscan.org/api/contract*', async (route) => {
      const firstAddress = route.request().url().includes(ADDRESS_A)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'SUCCESS',
          data: [firstAddress
            ? { address: ADDRESS_A, name: 'LateOldResult', verify_status: 2, date_created: 1 }
            : { address: ADDRESS_B, balance: '', balanceInUsd: '0', trxCount: '0', creator: '' }]
        })
      })
    })

    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
    await activateAndOpen(page, 'contractVerification', 'contractVerification')
    await page.locator('select[data-id="contractVerificationNetworkSelect"]').selectOption({ value: 'nile' })

    const addressInput = page.locator('input[data-id="contractVerificationAddressInput"]')
    const checkButton = page.locator('button[data-id="contractVerificationCheckStatus"]')
    const statusResult = page.locator('[data-id="contractVerificationStatusResult"]')
    await addressInput.fill(ADDRESS_A)
    await checkButton.click()
    await expect(checkButton).toBeDisabled()
    await expect(checkButton).toHaveText('Checking...')

    await addressInput.fill(ADDRESS_B)
    await expect(checkButton).toBeEnabled()
    await checkButton.click()
    await expect(statusResult).toContainText('no contract at this address', { timeout: 10_000 })
    await page.waitForTimeout(800)
    await expect(statusResult).toContainText('no contract at this address')
    await expect(statusResult).not.toContainText('LateOldResult')
  })

  // TC-FLAT-003 (v2.3.2 hardening, problem 2): an `import` written inside a
  // line comment, a block comment, or a string literal must NOT be treated as a
  // real dependency. The fake imports point at files that do not exist; if they
  // were followed, flatten would still succeed but a real same-named decoy would
  // be inlined. Here we assert the decoy content never reaches the output.
  test('TC-FLAT-003: imports inside comments/strings are ignored when flattening', async ({ page }) => {
    fs.mkdirSync(flatTmp, { recursive: true })
    const mk = (name: string, body: string) => {
      const p = path.join(flatTmp, name)
      fs.writeFileSync(p, body)
      return p
    }
    // A real dependency plus a decoy file that must never be inlined.
    const real = mk('RealDep.sol', [
      '// SPDX-License-Identifier: MIT',
      'pragma solidity >=0.8.2 <0.9.0;',
      'contract RealDep { uint256 public realMarker = 1; }'
    ].join('\n'))
    mk('Decoy.sol', [
      '// SPDX-License-Identifier: MIT',
      'pragma solidity >=0.8.2 <0.9.0;',
      'contract Decoy { uint256 public DECOY_MUST_NOT_APPEAR = 99; }'
    ].join('\n'))
    const cmt = mk('Commented.sol', [
      '// SPDX-License-Identifier: MIT',
      'pragma solidity >=0.8.2 <0.9.0;',
      'import "./RealDep.sol";',
      '// import "./Decoy.sol";',
      '/* import "./Decoy.sol"; */',
      'contract Commented is RealDep { string note = "import \\"./Decoy.sol\\";"; }'
    ].join('\n'))

    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
    await page.locator('[data-id="workspaceCreate"]').click()
    const wsInput = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    await wsInput.waitFor({ state: 'visible', timeout: 5000 })
    await wsInput.fill('flat-comments')
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('flat-comments', { timeout: 15_000 })
    await page.locator('[data-id="fileExplorerFileUpload"]').setInputFiles([real, path.join(flatTmp, 'Decoy.sol'), cmt])
    const ok = page.locator('#modal-footer-ok')
    if (await ok.isVisible().catch(() => false)) await ok.click()
    await expect(page.locator('[data-id="treeViewLitreeViewItemCommented.sol"]')).toBeVisible({ timeout: 15_000 })

    await page.locator('[data-id="treeViewLitreeViewItemCommented.sol"]').click()
    await activateAndOpen(page, 'solidity', 'solidity')
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Commented', { timeout: 30_000 })

    await activateAndOpen(page, 'contractVerification', 'contractVerification')
    await page.locator('button[data-id="contractVerificationFlatten"]').click()
    const flat = page.locator('textarea[data-id="contractVerificationFlattenText"]')
    await expect(flat).toBeVisible({ timeout: 10_000 })
    const text = await flat.inputValue()
    // The real dependency is inlined; the decoy (only referenced from comments/
    // a string) is not, and no import statement survives.
    expect(text).toMatch(/contract RealDep/)
    expect(text).toMatch(/contract Commented/)
    expect(text).not.toMatch(/DECOY_MUST_NOT_APPEAR/)
    expect(text).not.toMatch(/^\s*import\b/m)
    expect((text.match(/SPDX-License-Identifier:/g) || []).length).toBe(1)
  })

  // TC-FLAT-004 (v2.3.2 hardening, problem 3): a block-comment SPDX
  // (`/* SPDX-License-Identifier: ... */`) and `pragma abicoder v2;` must be
  // deduped/hoisted, not copied per-file. The pre-fix output duplicated them and
  // TronScan rejected it as non-compiling. The flattened file must compile.
  test('TC-FLAT-004: block-comment SPDX and abicoder pragma are deduped, output compiles', async ({ page }) => {
    fs.mkdirSync(flatTmp, { recursive: true })
    const mk = (name: string, body: string) => {
      const p = path.join(flatTmp, name)
      fs.writeFileSync(p, body)
      return p
    }
    const lib = mk('AbiLib.sol', [
      '/* SPDX-License-Identifier: MIT */',
      'pragma solidity >=0.8.2 <0.9.0;',
      'pragma abicoder v2;',
      'library AbiLib { struct S { uint256 a; } function one() internal pure returns (uint256) { return 1; } }'
    ].join('\n'))
    const main = mk('AbiMain.sol', [
      '/* SPDX-License-Identifier: MIT */',
      'pragma solidity >=0.8.2 <0.9.0;',
      'pragma abicoder v2;',
      'import "./AbiLib.sol";',
      'contract AbiMain { using AbiLib for uint256; function v() public pure returns (uint256) { return AbiLib.one(); } }'
    ].join('\n'))

    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
    await page.locator('[data-id="workspaceCreate"]').click()
    const wsInput = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    await wsInput.waitFor({ state: 'visible', timeout: 5000 })
    await wsInput.fill('flat-abicoder')
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()
    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('flat-abicoder', { timeout: 15_000 })
    await page.locator('[data-id="fileExplorerFileUpload"]').setInputFiles([lib, main])
    const ok = page.locator('#modal-footer-ok')
    if (await ok.isVisible().catch(() => false)) await ok.click()
    await expect(page.locator('[data-id="treeViewLitreeViewItemAbiMain.sol"]')).toBeVisible({ timeout: 15_000 })

    await page.locator('[data-id="treeViewLitreeViewItemAbiMain.sol"]').click()
    await activateAndOpen(page, 'solidity', 'solidity')
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('AbiMain', { timeout: 30_000 })

    await activateAndOpen(page, 'contractVerification', 'contractVerification')
    await page.locator('button[data-id="contractVerificationFlatten"]').click()
    const flat = page.locator('textarea[data-id="contractVerificationFlattenText"]')
    await expect(flat).toBeVisible({ timeout: 10_000 })
    const text = await flat.inputValue()
    // Exactly one SPDX, one version pragma, one abicoder pragma; no imports.
    expect((text.match(/SPDX-License-Identifier:/g) || []).length).toBe(1)
    expect((text.match(/pragma solidity/g) || []).length).toBe(1)
    expect((text.match(/pragma abicoder/g) || []).length).toBe(1)
    expect(text).not.toMatch(/^\s*import\b/m)

    // The deduped flattened source compiles standalone (the exact thing the
    // pre-fix duplicate-SPDX/abicoder output failed at).
    await page.locator('button[data-id="contractVerificationSaveFlatten"]').click()
    await expect(page.locator('remix-tab[id$="AbiMain_flat.sol"]')).toBeVisible({ timeout: 15_000 })
    await activateAndOpen(page, 'solidity', 'solidity')
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('AbiMain', { timeout: 30_000 })
    await expect(page.locator('#compileTabView')).not.toContainText(/ParserError|DeclarationError|already/i)
  })

  // TC-FLAT-005 (v2.3.2 hardening, problem 1): re-saving must NOT silently
  // clobber a hand-edited flattened/<Name>_flat.sol. contractVerification is a
  // native plugin so fileManager.writeFile no longer prompts; saveFlatten must
  // show its own Overwrite/Cancel confirm. Cancel keeps the user's edit.
  test('TC-FLAT-005: re-save confirms before overwriting an edited flat file', async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    const storage = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await storage.isVisible()) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await storage.click()
    await activateAndOpen(page, 'solidity', 'solidity')
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Storage', { timeout: 30_000 })

    await activateAndOpen(page, 'contractVerification', 'contractVerification')
    await page.locator('button[data-id="contractVerificationFlatten"]').click()
    await expect(page.locator('textarea[data-id="contractVerificationFlattenText"]')).toBeVisible({ timeout: 10_000 })

    // First save: no existing file -> writes straight through, no modal.
    await page.locator('button[data-id="contractVerificationSaveFlatten"]').click()
    await expect(page.locator('remix-tab[id$="Storage_flat.sol"]')).toBeVisible({ timeout: 15_000 })
    const statusResult = page.locator('*[data-id="contractVerificationStatusResult"]')
    await expect(statusResult).toContainText('Saved flattened source', { timeout: 10_000 })

    // Simulate the user hand-editing the saved flat file so its content diverges
    // from the freshly flattened output. The editor in this IDE is Ace (exposed
    // as `#input`.editor), not Monaco — edit through the Ace session and persist
    // with Ctrl+S so the change lands on disk, exactly like editor-format.spec.ts.
    const MARKER = '// USER-EDIT-MARKER-DO-NOT-CLOBBER'
    const flatTab = page.locator('remix-tab[id$="Storage_flat.sol"]')
    await flatTab.click()
    await page.locator('#input').waitFor({ timeout: 15_000 })
    await page.evaluate((marker) => {
      const el = document.getElementById('input') as any
      el.editor.session.setValue(marker + '\n' + el.editor.session.getValue())
    }, MARKER)
    await page.waitForTimeout(500)
    await page.keyboard.press('Control+S')
    await page.waitForTimeout(800)

    const editorContent = () => page.evaluate(() => {
      const el = document.getElementById('input') as any
      return el && el.editor ? el.editor.session.getValue() : ''
    })

    // Re-save from the plugin: content now differs -> Overwrite/Cancel modal.
    // CV is still the active side panel; clicking its icon again would TOGGLE it
    // shut (hiding the Save button), so only (re)activate if it isn't visible.
    const saveFlattenBtn = page.locator('button[data-id="contractVerificationSaveFlatten"]')
    if (!await saveFlattenBtn.isVisible()) await page.locator('#icon-panel div[plugin="contractVerification"]').click()
    await saveFlattenBtn.click()
    const overwriteBody = page.locator('[data-id="contractVerificationOverwriteBody"]')
    await expect(overwriteBody).toBeVisible({ timeout: 10_000 })
    await expect(overwriteBody).toContainText('already exists and differs')

    // Cancel keeps the user edit.
    await page.locator('#modal-footer-cancel').click()
    await expect(statusResult).toContainText('not saved', { timeout: 10_000 })
    await flatTab.click()
    await page.locator('#input').waitFor({ timeout: 15_000 })
    await expect.poll(editorContent, { timeout: 10_000 }).toContain(MARKER)

    // Re-save again and Overwrite: the marker is replaced by fresh flatten output.
    if (!await saveFlattenBtn.isVisible()) await page.locator('#icon-panel div[plugin="contractVerification"]').click()
    await saveFlattenBtn.click()
    await expect(overwriteBody).toBeVisible({ timeout: 10_000 })
    await page.locator('#modal-footer-ok').click()
    await expect(statusResult).toContainText('Saved flattened source', { timeout: 10_000 })
    await flatTab.click()
    await page.locator('#input').waitFor({ timeout: 15_000 })
    await expect.poll(editorContent, { timeout: 10_000 }).not.toContain(MARKER)

    // If the user explicitly compiles and previews the edited flat file, that
    // fresh preview becomes authoritative; Save must not fall back to the older
    // restoration snapshot merely because the path is the same.
    const FRESH_MARKER = '// FRESH-PREVIEW-MUST-WIN'
    await page.evaluate((marker) => {
      const el = document.getElementById('input') as any
      el.editor.session.setValue(marker + '\n' + el.editor.session.getValue())
    }, FRESH_MARKER)
    await activateAndOpen(page, 'solidity', 'solidity')
    const compileButton = page.locator('*[data-id="compilerContainerCompileBtn"]')
    const compileIcon = compileButton.locator('i.remixui_icon')
    // The Compile button saves the active editor before compiling. Do not also
    // press Ctrl+S: TronIDE maps that shortcut to another compile, and the two
    // overlapping runs can make this test flatten the previous artifact. Wait
    // for this specific compile's spinner cycle instead of matching the stale
    // "Storage" option that is already present from the earlier compilation.
    await compileButton.click()
    await expect(compileIcon).toHaveAttribute('title', 'compiling...', { timeout: 10_000 })
    await expect(compileIcon).not.toHaveAttribute('title', 'compiling...', { timeout: 30_000 })
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('Storage', { timeout: 30_000 })
    await activateAndOpen(page, 'contractVerification', 'contractVerification')
    await page.locator('button[data-id="contractVerificationFlatten"]').click()
    const freshPreview = page.locator('textarea[data-id="contractVerificationFlattenText"]')
    await expect(freshPreview).toBeVisible()
    expect(await freshPreview.inputValue()).toContain(FRESH_MARKER)
    await page.locator('button[data-id="contractVerificationSaveFlatten"]').click()
    await expect(overwriteBody).toBeVisible({ timeout: 10_000 })
    await page.locator('#modal-footer-ok').click()
    await flatTab.click()
    await page.locator('#input').waitFor({ timeout: 15_000 })
    await expect.poll(editorContent, { timeout: 10_000 }).toContain(FRESH_MARKER)
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

    // Re-activation must restore compiler listeners as well as the visible DOM.
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    const storage = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await storage.isVisible()) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await storage.click()
    await cvVerticalIcon.click()
    await page.locator('button[data-id="contractVerificationCompileCurrent"]').click()
    await expect(page.locator('[data-id="contractVerificationStatusResult"]')).toContainText('ready to flatten', { timeout: 30_000 })
    await expect(page.locator('select[data-id="contractVerificationContractSelect"]')).toBeEnabled()
  })

  test('TRONIDE-140 status copy stays in normal flow and cannot cover form controls', async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
    await activateAndOpen(page, 'contractVerification', 'contractVerification')

    const status = page.locator('[data-id="contractVerificationStatusResult"]')
    const network = page.locator('[data-id="contractVerificationNetworkSelect"]')
    await expect(status).toBeVisible()
    await expect(network).toBeVisible()
    expect(await status.evaluate((element) => getComputedStyle(element).position)).toBe('static')

    const boxes = await page.evaluate(() => {
      const statusRect = document.querySelector('[data-id="contractVerificationStatusResult"]')?.getBoundingClientRect()
      const networkRect = document.querySelector('[data-id="contractVerificationNetworkSelect"]')?.getBoundingClientRect()
      return statusRect && networkRect
        ? { statusBottom: statusRect.bottom, networkTop: networkRect.top }
        : null
    })
    expect(boxes).not.toBeNull()
    if (!boxes) throw new Error('Contract Verification status or network control was not rendered')
    expect(boxes.statusBottom).toBeLessThanOrEqual(boxes.networkTop)

    const afterScroll = await page.evaluate(() => {
      const root = document.querySelector('[data-id="contractVerificationPlugin"]') as HTMLElement | null
      const statusElement = document.querySelector('[data-id="contractVerificationStatusResult"]') as HTMLElement | null
      const networkElement = document.querySelector('[data-id="contractVerificationNetworkSelect"]') as HTMLElement | null
      if (!root || !statusElement || !networkElement) return null
      const rootRect = root.getBoundingClientRect()
      const networkRectBeforeScroll = networkElement.getBoundingClientRect()
      root.scrollTop = Math.max(0, root.scrollTop + networkRectBeforeScroll.top - rootRect.top - 8)
      const statusRect = statusElement.getBoundingClientRect()
      const networkRect = networkElement.getBoundingClientRect()
      const overlap = statusRect.left < networkRect.right && statusRect.right > networkRect.left &&
        statusRect.top < networkRect.bottom && statusRect.bottom > networkRect.top
      const hit = document.elementFromPoint(networkRect.left + networkRect.width / 2, networkRect.top + networkRect.height / 2)
      return { overlap, networkReceivesPointer: hit === networkElement || networkElement.contains(hit) }
    })
    expect(afterScroll).not.toBeNull()
    expect(afterScroll).toEqual({ overlap: false, networkReceivesPointer: true })
  })

  test('TRONIDE-141 groups verification into three readable steps without side-panel overflow', async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
    await activateAndOpen(page, 'contractVerification', 'contractVerification')

    const stepIds = [
      'contractVerificationStepCompile',
      'contractVerificationStepStatus',
      'contractVerificationStepFiles'
    ]
    for (const id of stepIds) await expect(page.locator(`[data-id="${id}"]`)).toBeVisible()

    const layout = await page.evaluate((ids) => {
      const root = document.querySelector('[data-id="contractVerificationPlugin"]') as HTMLElement | null
      const steps = ids.map((id) => document.querySelector(`[data-id="${id}"]`) as HTMLElement | null)
      if (!root || steps.some((step) => !step)) return null
      const rects = steps.map((step) => step!.getBoundingClientRect())
      const buttons = Array.from(root.querySelectorAll('button, a[data-id="contractVerificationOpenTronScan"]')) as HTMLElement[]
      return {
        noHorizontalOverflow: root.scrollWidth <= root.clientWidth + 1,
        ordered: rects.every((rect, index) => index === 0 || rect.top > rects[index - 1].bottom),
        controlsStayInside: buttons.every((button) => {
          const rect = button.getBoundingClientRect()
          const rootRect = root.getBoundingClientRect()
          return rect.left >= rootRect.left && rect.right <= rootRect.right + 1
        })
      }
    }, stepIds)
    expect(layout).toEqual({ noHorizontalOverflow: true, ordered: true, controlsStayInside: true })

    const checklist = page.locator('details').filter({ hasText: 'Manual submission checklist' })
    await expect(checklist).not.toHaveAttribute('open', '')
    await checklist.locator('summary').click()
    await expect(page.locator('[data-id="contractVerificationPackageChecklist"]')).toBeVisible()
  })
})
