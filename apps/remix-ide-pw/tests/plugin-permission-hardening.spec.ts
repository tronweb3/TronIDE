import { test, expect } from '@playwright/test'
import { gotoHome } from './helpers'

test.describe('Plugin permission hardening', () => {
  test('plugin manager actions are not covered by the permissions footer @gate', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await gotoHome(page)
    await page.locator('#icon-panel div[plugin="pluginManager"]').click()
    const root = page.locator('[data-id="pluginManagerComponentPluginManager"]')
    await root.waitFor({ state: 'visible', timeout: 10_000 })

    const inspect = async () => page.evaluate(() => {
      const pluginRoot = document.querySelector('[data-id="pluginManagerComponentPluginManager"]') as HTMLElement
      const scroller = pluginRoot.parentElement as HTMLElement
      const footer = pluginRoot.querySelector('footer') as HTMLElement
      const footerRect = footer.getBoundingClientRect()
      const scrollerRect = scroller.getBoundingClientRect()
      const buttons = Array.from(pluginRoot.querySelectorAll(
        'button[data-id^="pluginManagerComponentActivateButton"], button[data-id^="pluginManagerComponentDeactivateButton"]'
      )) as HTMLElement[]
      const visible = buttons.filter((button) => {
        const rect = button.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 &&
          rect.top >= Math.max(0, scrollerRect.top) &&
          rect.bottom <= Math.min(window.innerHeight, scrollerRect.bottom)
      })
      const overlapping: string[] = []
      const intercepted: string[] = []
      for (const button of visible) {
        const rect = button.getBoundingClientRect()
        const overlapWidth = Math.max(0, Math.min(rect.right, footerRect.right) - Math.max(rect.left, footerRect.left))
        const overlapHeight = Math.max(0, Math.min(rect.bottom, footerRect.bottom) - Math.max(rect.top, footerRect.top))
        if (overlapWidth * overlapHeight > 0) overlapping.push(button.dataset.id || '')
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        if (hit !== button && !button.contains(hit)) intercepted.push(button.dataset.id || '')
      }
      return { visible: visible.length, overlapping, intercepted }
    })

    const initial = await inspect()
    expect(initial.visible).toBeGreaterThan(0)
    expect(initial.overlapping).toEqual([])
    expect(initial.intercepted).toEqual([])

    await page.evaluate(() => {
      const root = document.querySelector('[data-id="pluginManagerComponentPluginManager"]') as HTMLElement
      const scroller = root.parentElement as HTMLElement
      scroller.scrollTop = scroller.scrollHeight
    })
    await page.waitForTimeout(100)
    const atBottom = await inspect()
    expect(atBottom.visible).toBeGreaterThan(0)
    expect(atBottom.overlapping).toEqual([])
    expect(atBottom.intercepted).toEqual([])
  })

  test('legacy modals stay FIFO and one click runs only one callback @gate', async ({ page }) => {
    await gotoHome(page)
    await page.locator('#icon-panel div[plugin="pluginManager"]').click()
    const permissions = page.locator('[data-id="pluginManagerPermissionsButton"]')
    await permissions.click()
    const title = page.locator('[data-id="modalDialogModalTitle"]')
    await expect(title).toHaveText('Plugin Manager Permissions')

    // Programmatically request another legacy modal while the first is active.
    // The backdrop intentionally prevents a real click on the underlying panel.
    await page.evaluate(() => {
      const button = document.querySelector('[data-id="pluginManagerComponentPluginSearchButton"]') as HTMLElement
      button.click()
    })
    await expect(title).toHaveText('Plugin Manager Permissions')
    await expect(page.locator('[data-id="localPluginName"]')).toHaveCount(0)

    await page.locator('#modal-footer-ok').click()
    await expect(title).toHaveText('Local Plugin')
    await expect(page.locator('[data-id="localPluginName"]')).toBeVisible()
    await page.locator('#modal-footer-cancel').click()
    await expect(page.locator('#modal-dialog')).toHaveCount(0)
  })

  test('permission settings labels target the correct caller checkbox @gate', async ({ page }) => {
    await gotoHome(page)
    await page.evaluate(() => {
      localStorage.setItem('permissionVersion', '1')
      localStorage.setItem('plugins/permissions', JSON.stringify({
        fileManager: {
          writeFile: {
            alphaPlugin: { allow: true, hash: 'alpha-v1' },
            betaPlugin: { allow: false, hash: 'beta-v1' }
          }
        }
      }))
    })
    await page.locator('#icon-panel div[plugin="pluginManager"]').click()
    await page.locator('[data-id="pluginManagerPermissionsButton"]').click()

    const alpha = page.locator('#permission-checkbox-fileManager-writeFile-alphaPlugin')
    const beta = page.locator('#permission-checkbox-fileManager-writeFile-betaPlugin')
    await expect(alpha).toBeChecked()
    await expect(beta).not.toBeChecked()
    await page.locator('[data-id="permission-label-fileManager-writeFile-betaPlugin"]').click()
    await expect(alpha).toBeChecked()
    await expect(beta).toBeChecked()
    await page.locator('#modal-footer-cancel').click()
  })
})
