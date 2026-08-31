import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

async function openHomeWithLegacyFile (page: Page) {
  await page.addInitScript(() => {
    localStorage.removeItem('remix_browserFS_migration:status')
    localStorage.removeItem('tron_migrate_success')
    localStorage.removeItem('tron_legacy_migration_fingerprint')
    localStorage.setItem('sol:legacy-migration.sol', 'pragma solidity ^0.8.20; contract LegacyMigration {}')
  })
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
}

test.describe('Legacy workspace migration', () => {
  test('TC-WS-MIGRATE-001: Home exposes migration and activates the migrated workspace', async ({ page }) => {
    await openHomeWithLegacyFile(page)

    const advancedToggle = page.locator('[data-id="landingAdvancedToolsToggle"]')
    if ((await advancedToggle.getAttribute('aria-expanded')) === 'false') await advancedToggle.click()
    await expect(page.locator('[data-id="landingMigrationPanel"]')).toBeVisible()

    await page.locator('[data-id="landingMigrateWorkspace"]').click()
    await expect(page.getByText('Back up your legacy files before migrating?', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Migrate without backup', exact: true }).click()

    const workspaceSelect = page.locator('select[data-id="workspacesSelect"]')
    await expect.poll(() => workspaceSelect.inputValue(), { timeout: 20_000 }).toMatch(/^workspace_migrated_/)
    const migrated = await page.evaluate(() => {
      const workspace = (document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement).value
      const fs = (window as any).remixFileSystem
      return fs.readFileSync(`.workspaces/${workspace}/legacy-migration.sol`, 'utf8')
    })
    expect(migrated).toContain('LegacyMigration')

    const firstMigration = await page.evaluate(() => ({
      workspace: (document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement).value,
      workspaceCount: (document.querySelector('select[data-id="workspacesSelect"]') as HTMLSelectElement).options.length,
      fingerprint: localStorage.getItem('tron_legacy_migration_fingerprint')
    }))
    expect(firstMigration.fingerprint).toMatch(/^[a-f0-9]{64}$/)

    // The legacy root is intentionally retained for old-version compatibility,
    // so idempotency must come from its content fingerprint rather than deletion.
    if ((await advancedToggle.getAttribute('aria-expanded')) === 'false') await advancedToggle.click()
    await page.locator('[data-id="landingMigrateWorkspace"]').click()
    await page.getByRole('button', { name: 'Migrate without backup', exact: true }).click()
    await expect(page.locator('[data-shared="tooltipPopup"]').filter({ hasText: 'already migrated and unchanged' }).first()).toBeVisible({ timeout: 10_000 })
    await expect(workspaceSelect).toHaveValue(firstMigration.workspace)
    await expect(workspaceSelect.locator('option')).toHaveCount(firstMigration.workspaceCount)
  })
})
