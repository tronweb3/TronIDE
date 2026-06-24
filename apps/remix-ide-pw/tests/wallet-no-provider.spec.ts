import { test, expect } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// TC-WAL-001: no TronLink installed (headless chromium has no extension).
// Clicking Connect Wallet must surface a clear "not installed" prompt as a toast
// (the button label stays compact "Connect Wallet" — the message is not crammed
// into it), with no white screen and no bogus connected account.
test.describe('Wallet without injected provider', () => {
  test('TC-WAL-001: connect prompts a clear not-installed message and nothing breaks', async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)
    const headerBtn = page.locator('[data-id="headerWalletConnect"]')
    await headerBtn.waitFor({ timeout: 30_000 })

    await headerBtn.click()
    // The prompt is a toast, not inline button text; the button stays compact.
    await expect(page.locator('.ant-message')).toContainText('TronLink is not installed', { timeout: 10_000 })
    await expect(headerBtn).toContainText('Connect Wallet')
    await expect(headerBtn).not.toContainText(/Wallet T\w/)

    // No connected-wallet menu, no account leaked into Deploy & Run.
    await expect(page.locator('[data-id="headerWalletMenu"]')).toHaveCount(0)
    await page.locator('#icon-panel div[plugin="udapp"]').click()
    await expect(page.locator('select#selectExEnvOptions')).toHaveValue('vm-tron')

    // The app is still alive: the home view renders and the button stays clickable.
    await expect(page.locator('[data-id="landingWorkspaceStatus"]')).toBeVisible()
    await headerBtn.click()
    await expect(page.locator('.ant-message')).toContainText('TronLink is not installed')
  })
})
