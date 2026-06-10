import { test, expect } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// Regression for the Home "Most used plugins" card: clicking the card action
// (e.g. "Open Verification") activates the plugin, but the card used not to
// refresh — so its toggle still read "Activate". Clicking that stale "Activate"
// then deactivated the now-active plugin and left an empty side panel (title
// only). After the fix the card tracks the real plugin state.
test.describe('Home plugin cards', () => {
  test('opening a plugin updates its card toggle to the active state', async ({ page }) => {
    await page.goto('/')
    await dismissWelcomeModal(page)

    const card = page.locator('[data-id="landingPluginContractVerification"]')
    await expect(card).toBeVisible({ timeout: 30_000 })

    // Initially inactive: no ON tag, toggle offers "Activate".
    const onTag = page.locator('[data-id="landingPluginToggleContractVerification"]')
    await expect(onTag).toHaveCount(0)
    await expect(card).toContainText('Activate')

    // Click the card action ("Open Verification") to open the plugin.
    await card.getByText('Open Verification').click()

    // The card must now reflect the active state (this is the fix): the ON tag
    // appears and the toggle reads "Deactivate" instead of a stale "Activate".
    await expect(onTag).toBeVisible({ timeout: 15_000 })
    await expect(card).toContainText('Deactivate')
    await expect(card).not.toContainText('Activate')

    // The plugin's side panel is shown and populated (not just an empty title).
    await expect(page.locator('[data-id="sidePanelSwapitTitle"]')).toContainText(/contract verification/i, { timeout: 15_000 })
  })
})
