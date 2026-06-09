import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// TC-SR-003 / TC-SR-004 / TC-SR-005: workspace global search & replace —
// invalid regex is surfaced (and Apply is blocked), a replace is applied across
// matching files, and Undo restores the original content.

async function bootstrap (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
}

async function openSearch (page: Page) {
  await page.locator('[data-id="verticalIconsKindglobalSearch"]').click()
  await page.locator('[data-id="globalSearchInput"]').waitFor({ state: 'visible', timeout: 10_000 })
}

async function runSearch (page: Page, term: string) {
  const input = page.locator('[data-id="globalSearchInput"]')
  await input.click()
  await input.fill('')
  await input.fill(term)
}

test.describe('Workspace search & replace', () => {
  test('TC-SR-003: invalid regex shows an error and disables Apply', async ({ page }) => {
    await bootstrap(page)
    await openSearch(page)

    // Enable regex mode and type a catastrophically invalid pattern.
    await page.locator('button[title="Use Regular Expression"]').click()
    await runSearch(page, '[')

    // The panel reports the regex error and does not freeze.
    await expect(page.locator('[data-id="globalSearchPanel"]')).toContainText(/Regex error/i, { timeout: 10_000 })

    // In replace mode, Apply must be disabled while the query is invalid.
    await page.locator('[data-id="globalSearchToggleReplace"]').click()
    await expect(page.locator('[data-id="globalSearchApplyReplace"]')).toBeDisabled()
  })

  // Uses `retrieve` from the default contracts/1_Storage.sol as the search token.
  test('TC-SR-004: a replace is applied across matching files', async ({ page }) => {
    // applyReplace() asks for confirmation via window.confirm — accept it.
    page.on('dialog', (dialog) => dialog.accept())
    await bootstrap(page)
    await openSearch(page)

    await runSearch(page, 'retrieve')
    await expect(page.locator('[data-id="globalSearchResultItem"]').first()).toBeVisible({ timeout: 15_000 })

    await page.locator('[data-id="globalSearchToggleReplace"]').click()
    await page.locator('[data-id="globalSearchReplaceInput"]').fill('TRONIDE_SR_BETA')
    await expect(page.locator('[data-id="globalSearchApplyReplace"]')).toBeEnabled({ timeout: 10_000 })
    await page.locator('[data-id="globalSearchApplyReplace"]').click()

    // After applying, the replacement token is now present in the workspace.
    await runSearch(page, 'TRONIDE_SR_BETA')
    await expect(page.locator('[data-id="globalSearchResultItem"]').first()).toBeVisible({ timeout: 15_000 })
  })

  test('TC-SR-005: Undo restores the replaced content', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept())
    await bootstrap(page)
    await openSearch(page)

    await runSearch(page, 'retrieve')
    await expect(page.locator('[data-id="globalSearchResultItem"]').first()).toBeVisible({ timeout: 15_000 })

    await page.locator('[data-id="globalSearchToggleReplace"]').click()
    await page.locator('[data-id="globalSearchReplaceInput"]').fill('TRONIDE_SR_DONE')
    await expect(page.locator('[data-id="globalSearchApplyReplace"]')).toBeEnabled({ timeout: 10_000 })
    await page.locator('[data-id="globalSearchApplyReplace"]').click()
    // Confirm the replacement landed before undoing.
    await runSearch(page, 'TRONIDE_SR_DONE')
    await expect(page.locator('[data-id="globalSearchResultItem"]').first()).toBeVisible({ timeout: 15_000 })

    // Undo and confirm the original token is searchable again.
    const undo = page.locator('[data-id="globalSearchUndoReplace"]')
    await expect(undo).toBeEnabled({ timeout: 10_000 })
    await undo.click()

    await runSearch(page, 'retrieve')
    await expect(page.locator('[data-id="globalSearchResultItem"]').first()).toBeVisible({ timeout: 15_000 })
  })
})
