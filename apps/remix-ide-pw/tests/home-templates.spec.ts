import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// "Use TRON Template" (Start building) adds a template FILE to the current
// workspace. Re-adding a file that already exists unchanged must say so
// honestly — the old path silently re-wrote and claimed "created".

async function openHome (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
}

// Adding a template opens the created file in the editor, switching away from
// the Home tab — re-focus it so the card is clickable again for the next add.
async function focusHomeTab (page: Page) {
  const homeTab = page.locator('.nav-item .title:has-text("Home"), .title:has-text("Home")').first()
  if (await homeTab.isVisible().catch(() => false)) await homeTab.click()
  await page.locator('[data-id="landingDappStarterCard"]').waitFor({ state: 'visible', timeout: 15_000 })
}

async function addFirstTemplate (page: Page) {
  await page.locator('[data-id="landingDappStarterCard"]').click()
  const select = page.locator('[data-id="landingTemplateSelect"]')
  await expect(select).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('#modal-footer-ok')).toHaveJSProperty('tagName', 'BUTTON')
  await expect(page.locator('#modal-footer-cancel')).toHaveJSProperty('tagName', 'BUTTON')
  await select.selectOption({ index: 0 }) // same template both times → same path
  await page.locator('#modal-footer-ok').click()
}

test.describe('Home "Use TRON Template"', () => {
  // TC-HOME-TPL-001: re-adding the same template reports that it is unchanged
  // instead of a misleading "created", and does not raise the overwrite confirm
  // (content is identical).
  test('TC-HOME-TPL-001: re-adding an unchanged template file is reported honestly', { tag: '@gate' }, async ({ page }) => {
    await openHome(page)

    // first add — creates it (or, if the template path already matches a seeded
    // file with identical content, immediately reports "already exists").
    await addFirstTemplate(page)
    await page.waitForTimeout(1_500)

    // adding opened the file in the editor — get back to the Home tab.
    await focusHomeTab(page)

    // second add of the SAME template — must honestly report it is unchanged,
    // and must NOT show the overwrite confirm.
    await addFirstTemplate(page)
    await expect(
      page.locator('[data-shared="tooltipPopup"]').filter({ hasText: /is unchanged\. Opened .+/i }).first()
    ).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-id="landingTemplateOverwriteBody"]')).toHaveCount(0)
  })
})
