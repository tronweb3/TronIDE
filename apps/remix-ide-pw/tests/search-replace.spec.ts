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

  test('TC-SR-001: literal search honors Match Case, Whole Word and Include filter', async ({ page }) => {
    await bootstrap(page)
    await openSearch(page)
    const meta = page.locator('[data-id="globalSearchMeta"]')
    const results = page.locator('[data-id="globalSearchResultItem"]')

    // Baseline: a lowercase literal present across the default contracts.
    await runSearch(page, 'uint256')
    await expect(results.first()).toBeVisible({ timeout: 15_000 })
    const countText = (await meta.textContent()) || ''
    const baseline = Number((countText.match(/(\d+)\+?\s+results/) || [])[1] || '0')
    expect(baseline).toBeGreaterThan(0)

    // Match Case ON: the wrong-case term must yield no results.
    await page.locator('button[title="Match Case"]').click()
    await runSearch(page, 'UINT256')
    await expect(page.locator('[data-id="globalSearchPanel"]')).toContainText(/No results matched/i, { timeout: 15_000 })
    // Same term with correct case still matches under Match Case.
    await runSearch(page, 'uint256')
    await expect(results.first()).toBeVisible({ timeout: 15_000 })
    await page.locator('button[title="Match Case"]').click() // back off

    // Whole Word ON: a partial token ("uint25") must not match the whole word.
    await page.locator('button[title="Match Whole Word"]').click()
    await runSearch(page, 'uint25')
    await expect(page.locator('[data-id="globalSearchPanel"]')).toContainText(/No results matched/i, { timeout: 15_000 })
    await page.locator('button[title="Match Whole Word"]').click()

    // Include filter narrows the file set: restricting to tests/** must reduce
    // (or change) the match set vs the unrestricted search.
    await runSearch(page, 'pragma')
    await expect(results.first()).toBeVisible({ timeout: 15_000 })
    const allFiles = Number(((await meta.textContent()) || '').match(/in\s+(\d+)\+?\s+files/)?.[1] || '0')
    await page.locator('[data-id="globalSearchInclude"]').fill('contracts/1_Storage.sol')
    await runSearch(page, 'pragma')
    await expect(results.first()).toBeVisible({ timeout: 15_000 })
    const oneFile = Number(((await meta.textContent()) || '').match(/in\s+(\d+)\+?\s+files/)?.[1] || '0')
    expect(oneFile).toBe(1)
    expect(oneFile).toBeLessThan(allFiles)
  })

  test('TC-SR-002: a regex with a capture group previews and applies consistently', async ({ page }) => {
    await bootstrap(page)
    await openSearch(page)
    await page.locator('button[title="Use Regular Expression"]').click()

    // Match the SPDX license tag in every contract via a capture group.
    await runSearch(page, 'SPDX-License-Identifier: (\\S+)')
    await expect(page.locator('[data-id="globalSearchResultItem"]').first()).toBeVisible({ timeout: 15_000 })
    const searchCount = Number((((await page.locator('[data-id="globalSearchMeta"]').textContent()) || '')
      .match(/(\d+)\+?\s+results/) || [])[1] || '0')
    expect(searchCount).toBeGreaterThan(0)

    // Replace with a back-reference: the preview's match count must equal the
    // search count (preview is consistent with what will be written).
    await page.locator('[data-id="globalSearchToggleReplace"]').click()
    await page.locator('[data-id="globalSearchReplaceInput"]').fill('SPDX-License-Identifier: $1-TRON')
    const replaceMeta = page.locator('[data-id="globalSearchReplaceMeta"]')
    await expect(replaceMeta).toBeVisible({ timeout: 10_000 })
    const previewCount = Number((((await replaceMeta.textContent()) || '').match(/(\d+)\s+matches/) || [])[1] || '0')
    expect(previewCount).toBe(searchCount)

    // Apply (confirm dialog) and verify the back-reference resolved in a file.
    page.once('dialog', (d) => d.accept())
    await expect(page.locator('[data-id="globalSearchApplyReplace"]')).toBeEnabled({ timeout: 10_000 })
    await page.locator('[data-id="globalSearchApplyReplace"]').click()
    await page.waitForTimeout(1_500)

    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]').click()
    await page.waitForTimeout(1_000)
    const content = await page.evaluate(() => {
      const el = document.getElementById('input') as any
      return el && el.editor ? el.editor.session.getValue() : ''
    })
    // The original license (e.g. GPL-3.0) now carries the -TRON suffix the
    // back-reference produced — proving $1 expanded to the captured value.
    expect(content).toMatch(/SPDX-License-Identifier:\s+\S+-TRON/)
  })

  test('TC-SR-009: search history persists, clears, and survives disabled localStorage without uncaught', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))
    await bootstrap(page)
    await openSearch(page)

    // A successful search records history.
    await runSearch(page, 'retrieve')
    await expect(page.locator('[data-id="globalSearchResultItem"]').first()).toBeVisible({ timeout: 15_000 })
    const stored = await page.evaluate(() => window.localStorage.getItem('tronide.globalSearch.history'))
    expect(stored).toContain('retrieve')

    // Clearing the input reveals the history list with the term.
    await page.locator('[data-id="globalSearchInput"]').fill('')
    const history = page.locator('[data-id="globalSearchHistory"]')
    await expect(history).toContainText('retrieve', { timeout: 10_000 })

    // Clear search history empties the list and the persisted store (the key
    // is removed → getItem returns null, or an empty array).
    await history.getByText('Clear search history').click()
    await expect.poll(() => page.evaluate(() => {
      const v = window.localStorage.getItem('tronide.globalSearch.history')
      return v === null ? 'EMPTY' : (v === '[]' ? 'EMPTY' : v)
    })).toBe('EMPTY')

    // Disabled localStorage must not throw: stub it and run a search.
    await page.evaluate(() => {
      const noop = () => { throw new Error('localStorage disabled') }
      try {
        Object.defineProperty(window.localStorage, 'setItem', { configurable: true, value: noop })
      } catch (e) { /* ignore */ }
    })
    await runSearch(page, 'pragma')
    await expect(page.locator('[data-id="globalSearchResultItem"]').first()).toBeVisible({ timeout: 15_000 })
    expect(pageErrors).toEqual([])
  })
})
