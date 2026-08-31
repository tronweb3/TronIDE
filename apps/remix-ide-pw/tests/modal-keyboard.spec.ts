import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

async function openHome (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
}

test.describe('Modal keyboard actions', () => {
  test('TC-MODAL-KEY-001: Enter on the legacy Cancel button cancels', { tag: '@gate' }, async ({ page }) => {
    await openHome(page)
    await page.locator('[data-id="landingDappStarterCard"]').click()
    await page.locator('[data-id="landingTemplateSelect"]').waitFor({ timeout: 10_000 })

    const cancel = page.locator('#modal-footer-cancel')
    await cancel.focus()
    await expect(cancel).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page.locator('#modal-dialog')).toHaveCount(0)
    await expect(page.locator('[data-id="landingDappStarterCard"]')).toBeVisible()
  })

  test('TC-MODAL-KEY-002: Enter on a React OK button invokes its action once', { tag: '@gate' }, async ({ page }) => {
    const modalErrors: string[] = []
    page.on('console', (message) => {
      const text = message.text()
      if (message.type() === 'error' && text.includes('[ModalDialog]')) modalErrors.push(text)
    })
    await openHome(page)

    const workspaceName = `keyboard_workspace_${Date.now()}`
    await page.locator('[data-id="workspaceCreate"]').click()
    await page.locator('input[data-id="modalDialogCustomPromptTextCreate"]').fill(workspaceName)
    const ok = page.locator('[data-id="workspacesModalDialog-modal-footer-ok-react"]')
    await ok.focus()
    await expect(ok).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page.locator('select[data-id="workspacesSelect"]')).toHaveValue(workspaceName, { timeout: 15_000 })
    await page.waitForTimeout(500)
    expect(modalErrors).toEqual([])
  })
})
