import { Page } from '@playwright/test'

/**
 * Hide the webpack dev-server overlay and dismiss the first-load "I Understand"
 * welcome dialog if it appears. Safe to call on every page that may show it.
 */
export async function dismissWelcomeModal(page: Page) {
  try {
    await page.addStyleTag({ content: '#webpack-dev-server-client-overlay { display: none !important; }' })
  } catch (e) {}
  const welcomeDialogBtn = page.locator('button:has-text("I Understand")')
  try {
    await welcomeDialogBtn.waitFor({ state: 'visible', timeout: 5000 })
    await welcomeDialogBtn.click()
  } catch (e) {
    // Ignore if dialog does not appear
  }
}
