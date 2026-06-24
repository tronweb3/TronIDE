import { test, expect } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// Regression: "Commit current file" lives on the Home tab, but switching to the
// Home tab runs fileManager.unselectCurrentFile() (main-view showApp), clearing
// config.currentFile. So fileManager.currentFile() was always '' by the time the
// button was clicked → the commit was permanently blocked with "open a file
// first", even with a file tab still open. The fix falls back to the still-open
// editor file (last selected / getOpenedFiles), so the gate passes on Home.
test.describe('GitHub commit from the Home tab', () => {
  test('CV-GH-COMMIT-1: commit is not blocked after the Home tab clears currentFile', async ({ page }) => {
    test.setTimeout(45_000)
    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })

    // Open a file in the editor (the TRON DApp template card creates + opens one).
    await page.locator('[data-id="landingDappStarterCard"]').first().click({ timeout: 15_000 })
    await page.waitForTimeout(2500)
    // editor now holds a file
    const hasFile = await page.evaluate(() => {
      const el = document.getElementById('input') as any
      return !!(el && el.editor && el.editor.session.getValue())
    })
    expect(hasFile).toBe(true)

    // Switch to the Home tab — this is what clears currentFile (the bug trigger).
    await page.locator('span.title', { hasText: 'Home' }).first().click({ timeout: 8_000 })
    await page.waitForTimeout(1200)
    const currentFileNowEmpty = await page.evaluate(() => {
      try { return (JSON.parse(localStorage.getItem('config-v0.8:.remix.config') || '{}').currentFile || '') === '' } catch { return false }
    })
    expect(currentFileNowEmpty).toBe(true) // confirms the bug condition is reproduced

    // Expand Advanced Tools and click Commit current file.
    const toggle = page.locator('[data-id="landingAdvancedToolsToggle"]')
    if (await toggle.count() && (await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click()
      await page.waitForTimeout(700)
    }
    const commit = page.locator('[data-id="landingGithubTokenCommit"]')
    await commit.scrollIntoViewIfNeeded()
    await commit.click({ timeout: 8_000 })
    await page.waitForTimeout(1200)

    // The gate must PASS: it should ask for the destination URL, not block with
    // "No file is open in the editor".
    await expect(page.locator('[data-id="modalDialogCustomPromptText"]')).toBeVisible({ timeout: 8_000 })
    await expect(page.locator('body')).not.toContainText('No file is open in the editor')
  })
})
