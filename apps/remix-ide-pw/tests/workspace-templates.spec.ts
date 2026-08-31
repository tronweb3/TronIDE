import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal, useBuiltinCompiler } from './helpers'

// TC-TPL-001..003 (v2.3.1 R1): the create-workspace modal offers the TRON
// template catalogue, the default seed stays the default, and the landing
// page template entries open a chooser instead of hardcoding the first one.

async function openHome (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
}

test.describe('Workspace templates', () => {
  test('TC-TPL-HEADER: the header workspace action opens the template picker and seeds the selection', { tag: '@gate' }, async ({ page }) => {
    await openHome(page)
    await page.locator('[data-id="headerWorkspaceDropdown"]').click()
    await page.locator('[data-id="headerCreateWorkspace"]').click()

    const nameInput = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    const templateSelect = page.locator('select[data-id="modalDialogCustomSelectTemplate"]')
    await expect(nameInput).toBeVisible({ timeout: 10_000 })
    await expect(templateSelect).toBeVisible()
    await nameInput.fill('header-tpl-trc721')
    await templateSelect.selectOption('trc721-minimal')
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()

    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('header-tpl-trc721', { timeout: 15_000 })
    await expect(page.locator('[data-id="treeViewLitreeViewItemcontracts/TRC721Minimal.sol"]')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('remix-tab[id$="TRC721Minimal.sol"]')).toBeVisible({ timeout: 15_000 })
  })

  test('TC-TPL-001: create a workspace from a TRON template — template file lands, opens and compiles', async ({ page }) => {
    await openHome(page)
    await page.locator('[data-id="workspaceCreate"]').click()
    const nameInput = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    await nameInput.waitFor({ state: 'visible', timeout: 5_000 })
    await nameInput.fill('tpl-trc20')
    await page.locator('select[data-id="modalDialogCustomSelectTemplate"]').selectOption('trc20-full')
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()

    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('tpl-trc20', { timeout: 15_000 })
    // The template contract is seeded and opened; the default samples are not.
    await expect(page.locator('[data-id="treeViewLitreeViewItemcontracts/TRC20Token.sol"]')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('remix-tab[id$="TRC20Token.sol"]')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')).toHaveCount(0)

    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await useBuiltinCompiler(page)
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await expect(page.locator('*[data-id="compiledContracts"]')).toContainText('TRC20Token', { timeout: 30_000 })
  })

  test('TC-TPL-002: leaving the template select on Default keeps the historical sample seed', async ({ page }) => {
    await openHome(page)
    await page.locator('[data-id="workspaceCreate"]').click()
    const nameInput = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    await nameInput.waitFor({ state: 'visible', timeout: 5_000 })
    await nameInput.fill('tpl-default')
    // template select untouched (Default)
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()

    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('tpl-default', { timeout: 15_000 })
    const contractsFolder = page.locator('[data-id="treeViewLitreeViewItemcontracts"]')
    await expect(contractsFolder).toBeVisible({ timeout: 15_000 })
    await contractsFolder.click()
    await expect(page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')).toBeVisible({ timeout: 10_000 })
  })

  test('TC-TPL-EMPTY: selecting Empty workspace creates no sample files', async ({ page }) => {
    await openHome(page)
    await page.locator('[data-id="workspaceCreate"]').click()
    const nameInput = page.locator('input[data-id="modalDialogCustomPromptTextCreate"]')
    await nameInput.waitFor({ state: 'visible', timeout: 5_000 })
    await nameInput.fill('tpl-empty')
    await page.locator('select[data-id="modalDialogCustomSelectTemplate"]').selectOption('empty')
    await page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]').click()

    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue('tpl-empty', { timeout: 15_000 })
    const files = await page.evaluate(() => {
      const fs = (window as any).remixFileSystem
      return fs.readdirSync('.workspaces/tpl-empty')
    })
    expect(files).toEqual([])
  })

  test('TC-TPL-003: the landing template card opens a chooser and seeds the picked template', async ({ page }) => {
    await openHome(page)
    await page.locator('[data-id="landingDappStarterCard"]').first().click()

    const select = page.locator('select[data-id="landingTemplateSelect"]')
    await select.waitFor({ state: 'visible', timeout: 10_000 })
    // every catalogue entry is offered, not just the first
    expect(await select.locator('option').count()).toBeGreaterThanOrEqual(6)
    await select.selectOption('trc721-minimal')
    await page.locator('#modal-footer-ok').click()

    await expect(page.locator('remix-tab[id$="TRC721Minimal.sol"]')).toBeVisible({ timeout: 15_000 })
    // clicking an already-active plugin icon toggles the panel closed — only
    // click when the file panel isn't currently showing
    if (!await page.locator('select[data-id="workspacesSelect"]').isVisible()) {
      await page.locator('#icon-panel div[plugin="filePanel"]').click()
    }
    const item = page.locator('[data-id="treeViewLitreeViewItemcontracts/TRC721Minimal.sol"]')
    if (!await item.isVisible()) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await expect(item).toBeVisible({ timeout: 10_000 })
  })

  // TC-TPL-004 (v2.3.2 DEF-R1-1): re-seeding a template over a file the user has
  // diverged from must confirm first — Cancel preserves edits, Overwrite replaces
  // them, and a failed overwrite surfaces an error instead of silently rejecting.
  test('TC-TPL-004: template overwrite confirms, preserves on Cancel, replaces on Overwrite, surfaces failures', async ({ page }) => {
    const MARKER = '// user-edit-do-not-clobber'

    async function pickTemplate () {
      // Seeding/opening a template switches the main panel to the editor, so the
      // landing card is no longer visible on subsequent calls — bring the Home
      // tab back to the front first (no-op when it is already showing).
      const card = page.locator('[data-id="landingDappStarterCard"]').first()
      if (!await card.isVisible()) {
        await page.locator('span.title', { hasText: 'Home' }).first().click({ timeout: 8_000 })
        await card.waitFor({ state: 'visible', timeout: 10_000 })
      }
      await card.click()
      const select = page.locator('select[data-id="landingTemplateSelect"]')
      await select.waitFor({ state: 'visible', timeout: 10_000 })
      await select.selectOption('trc721-minimal')
      await page.locator('#modal-footer-ok').click()
    }

    await openHome(page)

    // seed the template once, then diverge the file in the editor and save it
    await pickTemplate()
    await expect(page.locator('remix-tab[id$="TRC721Minimal.sol"]')).toBeVisible({ timeout: 15_000 })
    await page.locator('#input').waitFor({ timeout: 10_000 })
    await page.evaluate((m) => {
      const el = document.getElementById('input') as any
      el.editor.session.setValue('// ' + m + '\n' + el.editor.session.getValue())
    }, MARKER.replace('// ', ''))
    await page.waitForTimeout(600)
    await page.keyboard.press('Control+S')
    await page.waitForTimeout(1_000)

    // re-seeding the same template now detects the divergence and confirms
    await pickTemplate()
    const overwriteBody = page.locator('[data-id="landingTemplateOverwriteBody"]')
    await expect(overwriteBody).toBeVisible({ timeout: 10_000 })

    // Cancel preserves the user's edits
    await page.locator('#modal-footer-cancel').click()
    await expect(overwriteBody).toBeHidden({ timeout: 5_000 })
    expect(await page.evaluate(() => {
      const el = document.getElementById('input') as any
      return el.editor.session.getValue() as string
    })).toContain(MARKER)

    // a failed overwrite surfaces an error tooltip and keeps the edits intact
    await page.evaluate(() => {
      const fs = (window as any).remixFileSystem
      const real = fs.writeFileSync.bind(fs)
      ;(window as any).__realWriteFileSync = real
      fs.writeFileSync = () => { throw new Error('disk full') }
    })
    await pickTemplate()
    await expect(overwriteBody).toBeVisible({ timeout: 10_000 })
    await page.locator('#modal-footer-ok').click()
    // The seed also fires a "...created at" toast, so filter to the error one
    // (multiple tooltipPopup elements would trip strict-mode otherwise).
    await expect(page.locator('[data-shared="tooltipPopup"]').filter({ hasText: 'disk full' })).toBeVisible({ timeout: 10_000 })
    expect(await page.evaluate(() => {
      const el = document.getElementById('input') as any
      return el.editor.session.getValue() as string
    })).toContain(MARKER)

    // restore the writer; Overwrite now replaces the diverged content
    await page.evaluate(() => {
      const fs = (window as any).remixFileSystem
      fs.writeFileSync = (window as any).__realWriteFileSync
    })
    await pickTemplate()
    await expect(overwriteBody).toBeVisible({ timeout: 10_000 })
    await page.locator('#modal-footer-ok').click()
    await expect(overwriteBody).toBeHidden({ timeout: 5_000 })
    await expect.poll(() => page.evaluate(() => {
      const el = document.getElementById('input') as any
      return el.editor.session.getValue() as string
    }), { timeout: 10_000 }).not.toContain(MARKER)
  })
})
