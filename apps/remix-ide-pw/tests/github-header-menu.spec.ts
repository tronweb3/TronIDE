import { test, expect, Page } from '@playwright/test'
import { gotoHome, seedGithubBffSession } from './helpers'

// TC-GITHUB-003 (v2.3.2): once GitHub is connected, the HEADER GitHub button
// must open an account menu (Reconnect / Disconnect) instead of re-running the
// OAuth popup. Re-triggering OAuth while already authorized makes GitHub flash a
// popup open and immediately closed (it redirects straight back) — confusing and
// pointless. Connected state is seeded with an opaque BFF session so the test is
// deterministic (no real OAuth, GitHub token, network, or compile) → @gate.

async function connectViaBffSession (page: Page) {
  await seedGithubBffSession(page)
}

test.describe('Header GitHub menu', () => {
  test('TC-GITHUB-003: a connected GitHub button opens a menu, never a re-auth popup', { tag: '@gate' }, async ({ page, context }) => {
    await gotoHome(page)
    await connectViaBffSession(page)

    const headerBtn = page.locator('[data-id="headerGithubConnect"]')
    await expect(headerBtn).toContainText('tron-tester', { timeout: 10_000 })

    // Trap any popup the buggy OAuth re-trigger would have opened.
    let popupOpened = false
    context.on('page', () => { popupOpened = true })
    page.on('popup', () => { popupOpened = true })

    // Click while connected → the account menu opens; NO OAuth popup fires.
    await headerBtn.click()
    await expect(page.locator('[data-id="headerGithubMenu"]')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('[data-id="headerGithubAccount"]')).toContainText('tron-tester')
    await page.waitForTimeout(500)
    expect(popupOpened, 'clicking the connected GitHub button must not open an OAuth popup').toBe(false)

    // Disconnect from the header flips the button back and closes the menu.
    await page.locator('[data-id="headerGithubDisconnect"]').click()
    await expect(page.locator('[data-id="headerGithubMenu"]')).toHaveCount(0)
    await expect(headerBtn).toContainText('Connect GitHub', { timeout: 10_000 })
  })

  // TC-GITHUB-005 (v2.3.2): Escape closes the header account menu. It's a
  // lightweight popover — outside-click alone left keyboard users stuck.
  test('TC-GITHUB-005: Escape closes the header GitHub menu', { tag: '@gate' }, async ({ page }) => {
    await gotoHome(page)
    await connectViaBffSession(page)
    const headerBtn = page.locator('[data-id="headerGithubConnect"]')
    await expect(headerBtn).toContainText('tron-tester', { timeout: 10_000 })

    await headerBtn.click()
    await expect(page.locator('[data-id="headerGithubMenu"]')).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-id="headerGithubMenu"]')).toBeHidden({ timeout: 3_000 })
  })

  // TC-GITHUB-006 (v2.3.2): a header-menu Disconnect must refresh the HOME
  // panel too. The landing page kept advertising "Reconnect GitHub" against an
  // empty token store because only its OWN disconnect path re-rendered the
  // panel; it now listens to tronideGithubConnectionChanged.
  test('TC-GITHUB-006: header Disconnect refreshes the Home panel button label', { tag: '@gate' }, async ({ page }) => {
    await gotoHome(page)
    await connectViaBffSession(page)
    const advanced = page.locator('[data-id="landingAdvancedToolsToggle"]')
    if ((await advanced.getAttribute('aria-expanded')) === 'false') await advanced.click()
    const headerBtn = page.locator('[data-id="headerGithubConnect"]')
    await expect(headerBtn).toContainText('tron-tester', { timeout: 10_000 })
    // connected state reflected on the Home button
    await expect(page.locator('[data-id="landingGithubOAuthConnect"]')).toContainText('Reconnect GitHub', { timeout: 10_000 })

    await headerBtn.click()
    await page.locator('[data-id="headerGithubDisconnect"]').click()
    await expect(headerBtn).toContainText('Connect GitHub', { timeout: 10_000 })
    // the Home panel must say "Connect to GitHub" again — not keep "Reconnect"
    await expect(page.locator('[data-id="landingGithubOAuthConnect"]')).toContainText('Connect to GitHub', { timeout: 10_000 })
  })

  test('TC-GITHUB-004: the disconnected GitHub button still starts the connect flow', { tag: '@gate' }, async ({ page }) => {
    // When NOT connected, the button must keep its original behavior: route to
    // the Home GitHub panel and start the connect flow (no menu).
    await gotoHome(page)
    let capabilityChecks = 0
    await page.route('**/capabilities', (route) => {
      capabilityChecks++
      return route.fulfill({ status: 404, body: 'legacy proxy' })
    })
    const headerBtn = page.locator('[data-id="headerGithubConnect"]')
    await expect(headerBtn).toContainText('Connect GitHub')
    await headerBtn.click()
    // No account menu in the disconnected state…
    await expect(page.locator('[data-id="headerGithubMenu"]')).toHaveCount(0)
    // …and the Home GitHub token panel is brought into view (connect entry point).
    await expect(page.locator('[data-id="landingGithubTokenPanel"]')).toBeVisible({ timeout: 10_000 })
    await expect.poll(() => capabilityChecks).toBe(1)
    await expect(page.locator('[data-id="landingGithubOAuthConnect"]')).toHaveText('Connect to GitHub')
    expect(await page.evaluate(() => window.sessionStorage.getItem('tronide.github.session'))).toBeNull()
  })
})
