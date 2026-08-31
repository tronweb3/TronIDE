import { test, expect } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

test.describe('GitHub BFF credential boundary', () => {
  test('GitHub panel exposes OAuth only and never a browser PAT input', async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingAdvancedToolsToggle"]').click()
    const panel = page.locator('[data-id="landingGithubTokenPanel"]')
    await panel.waitFor({ timeout: 30_000 })

    await expect(panel).toContainText('never receives or stores the GitHub access token')
    await expect(page.locator('[data-id="landingGithubTokenConnect"]')).toHaveCount(0)
    await expect(page.locator('text=Connect token (PAT)')).toHaveCount(0)
    await expect(page.locator('[data-id="landingGithubOAuthConnect"]')).toHaveText('Connect to GitHub')
    await expect(page.locator('[data-id="landingGithubConnectionHint"]')).toHaveText('Connect GitHub to import or commit repository files.')
    await expect(page.locator('[data-id="landingGithubTokenImport"]')).toBeDisabled()
    await expect(page.locator('[data-id="landingGithubTokenCommit"]')).toBeDisabled()
    await expect(page.locator('[data-id="landingGithubTokenImport"]')).toHaveAttribute('title', 'Connect GitHub first.')
    await expect(page.locator('[data-id="landingGithubTokenCommit"]')).toHaveAttribute('title', 'Connect GitHub first.')
    await expect(page.locator('[data-id="landingGithubTokenChecklist"]')).toBeEnabled()

    const storage = await page.evaluate(() => ({
      session: window.sessionStorage.getItem('tronide.github.session'),
      token: window.sessionStorage.getItem('tronide.github.token'),
      localToken: window.localStorage.getItem('tronide.github.token')
    }))
    expect(storage).toEqual({ session: null, token: null, localToken: null })
  })
})
