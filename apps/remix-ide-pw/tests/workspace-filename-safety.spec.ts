import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'
import * as path from 'path'
import * as fs from 'fs'

// TC-WS-006: malicious file names (HTML/JS injection, javascript: scheme) are
// rejected by the workspace and never executed.

const tmpDir = path.resolve(__dirname, '../../../tmp')

async function createWorkspace (page: Page, name: string) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
  await page.locator('[data-id="workspaceCreate"]').click()
  const input = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
  await input.waitFor({ state: 'visible', timeout: 5000 })
  await input.fill(name)
  await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()
  await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue(name, { timeout: 15_000 })
}

async function dismissModal (page: Page) {
  // App modals expose an OK/Close button as `<id>-modal-footer-ok-react`. Click it
  // via evaluate to bypass the fade animation (which fails Playwright stability).
  await page.evaluate(() => {
    const el = document.querySelector('[data-id$="-modal-footer-ok-react"]') as HTMLElement | null
    if (el) el.click()
  })
  await page.waitForTimeout(500)
}

test.beforeAll(() => fs.mkdirSync(tmpDir, { recursive: true }))

test.describe('Workspace filename safety', () => {
  test('TC-WS-006: malicious file names are rejected and never executed', async ({ page }) => {
    // Any injected payload that actually ran would surface as a native dialog.
    let nativeDialogFired = false
    page.on('dialog', async (d) => { nativeDialogFired = true; await d.dismiss().catch(() => {}) })

    await createWorkspace(page, 'ws-malicious')

    // 1) Upload a file whose name carries an HTML injection payload — the upload
    //    path rejects special characters (file-explorer.tsx:592).
    const xssName = '<img src=x onerror=alert(1)>.sol'
    const xssPath = path.join(tmpDir, xssName)
    fs.writeFileSync(xssPath, '// payload', 'utf8')
    try {
      await page.locator('[data-id="fileExplorerFileUpload"]').setInputFiles(xssPath)
      await expect(page.getByText('Special characters are not allowed').first()).toBeVisible({ timeout: 10_000 })
      await dismissModal(page)
    } finally {
      if (fs.existsSync(xssPath)) fs.unlinkSync(xssPath)
    }

    // 2) Create a new file using a javascript: scheme name — the create/rename
    //    path rejects special characters (file-explorer.tsx:1082).
    await page.locator('[data-id="fileExplorerNewFilecreateNewFile"]').click()
    const editable = page.locator('div.remixui_items[contenteditable="true"]')
    await editable.waitFor({ state: 'visible', timeout: 5000 })
    await editable.focus()
    await page.evaluate((el) => { (el as HTMLElement).innerText = 'javascript:alert(1).sol' }, await editable.elementHandle())
    await editable.press('Enter')
    await expect(page.getByText('Special characters are not allowed').first()).toBeVisible({ timeout: 10_000 })
    await dismissModal(page)

    // Neither malicious file may exist in the workspace tree, and nothing executed.
    await expect(page.locator('[data-id*="treeViewLitreeViewItem"][data-id*="onerror"]')).toHaveCount(0)
    await expect(page.locator('[data-id*="treeViewLitreeViewItem"][data-id*="javascript:"]')).toHaveCount(0)
    expect(nativeDialogFired, 'no injected payload executed (no native dialog)').toBe(false)
  })
})
