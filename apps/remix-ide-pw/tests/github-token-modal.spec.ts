import { test, expect } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

test.describe('GitHub token modal (audit 2026-05-27 regression)', () => {
  test('Connect token modal does not offer "Remember in this browser" and shows tab-only storage notice', async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)

    // Toggle Advanced Tools open to make GitHub Token panel visible
    await page.locator('[data-id="landingAdvancedToolsToggle"]').click()

    await page.locator('[data-id="landingGithubTokenPanel"]').waitFor({ timeout: 30_000 })

    // Sanity-check the pre-modal state: sessionStorage is empty and no legacy
    // localStorage tokens survive a fresh load.
    const storageBefore = await page.evaluate(() => ({
      session: window.sessionStorage.getItem('tronide.github.token'),
      local: window.localStorage.getItem('tronide.github.token')
    }))
    expect(storageBefore.session).toBeNull()
    expect(storageBefore.local).toBeNull()

    await page.locator('[data-id="landingGithubTokenConnect"]').click()

    // The modal text changed in 2026-05-27 from "Remember in this browser"
    // to a tab-only-storage notice — assert both directions.
    await expect(page.locator('text=Tokens stay in this browser tab only')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('#githubTokenRemember')).toHaveCount(0)
    await expect(page.locator('text=Remember in this browser')).toHaveCount(0)
  })
})
