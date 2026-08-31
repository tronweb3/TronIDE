import { test, expect, Page } from '@playwright/test'
import { gotoHome, seedGithubBffSession } from './helpers'

async function expandAdvancedTools (page: Page) {
  const advanced = page.locator('[data-id="landingAdvancedToolsToggle"]')
  if ((await advanced.getAttribute('aria-expanded')) === 'false') await advanced.click()
  await expect(page.locator('[data-id="landingGithubTokenPanel"]')).toBeVisible({ timeout: 10_000 })
}

test.describe('GitHub BFF session survives refresh in this tab', () => {
  test('TC-GITHUB-002: reload keeps only the opaque session and connected UI', { tag: '@gate' }, async ({ page }) => {
    await page.route('**/session', (route) => route.fulfill({ status: 204 }))
    await gotoHome(page)
    await seedGithubBffSession(page)
    await expandAdvancedTools(page)

    const connect = page.locator('[data-id="landingGithubOAuthConnect"]')
    const accessIcon = page.locator('[data-id="landingGithubAccessIcon"] svg')
    await expect(accessIcon).toBeVisible()
    await expect(connect).toHaveText('Reconnect GitHub')
    await expect(page.locator('[data-id="landingGithubTokenDisconnect"]')).toBeVisible()
    await expect(page.locator('[data-id="landingGithubTokenPanel"]')).toContainText('tron-tester')
    expect(await page.evaluate(() => window.sessionStorage.getItem('tronide.github.session'))).toContain('test_bff_session')
    expect(await page.evaluate(() => window.sessionStorage.getItem('tronide.github.token'))).toBeNull()
    expect(await page.evaluate(() => window.localStorage.getItem('tronide.github.token'))).toBeNull()

    await gotoHome(page)
    await expandAdvancedTools(page)
    await expect(connect).toHaveText('Reconnect GitHub')

    await page.locator('[data-id="landingGithubTokenDisconnect"]').click()
    await expect(connect).toHaveText('Connect to GitHub')
    await expect(accessIcon).toBeVisible()
    expect(await page.evaluate(() => window.sessionStorage.getItem('tronide.github.session'))).toBeNull()
    expect(await page.evaluate(() => window.sessionStorage.getItem('tronide.github.token'))).toBeNull()
  })
})
