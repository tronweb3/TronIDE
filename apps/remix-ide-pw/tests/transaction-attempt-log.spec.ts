import { test, expect, Page } from '@playwright/test'
import { gotoHome, useBuiltinCompiler } from './helpers'

async function compileStorageOnVm (page: Page) {
  await gotoHome(page)
  const file = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
  if (!await file.isVisible().catch(() => false)) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
  await file.click()
  await page.locator('#icon-panel div[plugin="solidity"]').click()
  await useBuiltinCompiler(page)
  await page.locator('[data-id="compilerContainerCompileBtn"]').click()
  await expect(page.locator('[data-id="compiledContracts"]')).toContainText('Storage', { timeout: 60_000 })
  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await page.locator('#selectExEnvOptions').selectOption({ label: 'JavaScript VM (Tron)' })
  await expect(page.locator('[data-id="settingsNetworkEnv"]')).toContainText('JavaScript VM (Tron)')
}

test.describe('Transaction terminal attempt groups', () => {
  test('TC-TX-ATTEMPT-1: repeated deployments have separate pending-to-success histories', { tag: '@gate' }, async ({ page }) => {
    test.setTimeout(90_000)
    await compileStorageOnVm(page)

    const deploy = page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' })
    const groups = page.locator('[data-id="transactionAttemptGroup"]')

    await deploy.click()
    await expect(groups).toHaveCount(1, { timeout: 20_000 })
    await expect(groups.nth(0)).toHaveAttribute('data-attempt', '1')
    await expect(groups.nth(0)).toHaveAttribute('data-status', 'success', { timeout: 20_000 })
    await expect(groups.nth(0)).toContainText('creation of Storage')
    await expect(groups.nth(0)).toContainText('Succeeded')

    await deploy.click()
    await expect(groups).toHaveCount(2, { timeout: 20_000 })
    await expect(groups.nth(1)).toHaveAttribute('data-attempt', '2')
    await expect(groups.nth(1)).toHaveAttribute('data-status', 'success', { timeout: 20_000 })
    await expect(groups.nth(0)).toHaveAttribute('data-attempt', '1')
    await expect(page.locator('[data-id="transactionAttemptRetry"]')).toHaveCount(0)
  })
})
