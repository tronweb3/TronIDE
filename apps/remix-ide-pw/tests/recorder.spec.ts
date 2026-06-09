import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// TC-REC-001 / TC-REC-004: VM (Tron) transactions are recorded and can be saved
// to a scenario file, and a saved scenario can be replayed to re-create state.

// Compile + deploy Storage, run a state-changing call (both recorded), expand the
// recorder card and save the scenario. Leaves the Deploy & Run panel active with
// scenario.json as the current file.
async function recordAndSaveScenario (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

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

  const instance = page.locator('.instance').first()
  await expect(instance).toBeVisible({ timeout: 30_000 })
  await instance.locator('[data-id="universalDappUiTitleExpander"]').click()
  await page.locator('#runTabView input[title="uint256 num"]').fill('42')
  await instance.locator('button[title="store - transact (not payable)"]', { hasText: 'store' }).click()

  // The recorder save/run icons only mount when the card is expanded.
  const recorderCard = page.locator('div[class*="cardContainer"]').filter({ hasText: 'Transactions recorded' })
  await recorderCard.locator('i[class*="arrow"]').first().click()

  await page.locator('i.savetransaction').click()
  const okBtn = page.locator('#modal-footer-ok')
  await expect(okBtn).toBeVisible({ timeout: 10_000 })
  await okBtn.click()
}

test.describe('Transaction recorder', () => {
  test('TC-REC-001: record VM transactions and save them to a scenario file', async ({ page }) => {
    await recordAndSaveScenario(page)

    // The scenario file is created in the workspace.
    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await expect(page.locator('span[data-path$="scenario.json"]').first()).toBeVisible({ timeout: 20_000 })
  })

  test('TC-REC-004: replay a saved scenario re-creates the deployed instance', async ({ page }) => {
    await recordAndSaveScenario(page)

    // Clear the recorded/deployed instances...
    await page.locator('*[data-id="deployAndRunClearInstances"]').click()
    await expect(page.locator('.instance')).toHaveCount(0, { timeout: 10_000 })

    // ...then replay the scenario (scenario.json is the current file). Replaying on
    // the VM auto-proceeds (no Main-net confirmation modal).
    await page.locator('i.runtransaction').click()

    // The deploy from the scenario re-creates the instance.
    await expect(page.locator('.instance').first()).toBeVisible({ timeout: 30_000 })
  })
})
