import { test, expect } from '@playwright/test'
import { blockCompilerSources, ensureFilePanel, gotoHome } from './helpers'

test.describe('File Explorer context menu placement', () => {
  test('TC-FE-CONTEXT-001: a zero-coordinate context menu stays above the header and Delete is clickable', { tag: '@gate' }, async ({ page }) => {
    await blockCompilerSources(page)
    await gotoHome(page)
    await ensureFilePanel(page)

    const row = page.locator('[data-path="contracts"]').first()
    await row.waitFor({ state: 'visible', timeout: 10_000 })

    // Nightwatch, keyboard context-menu shortcuts, and some assistive tools
    // dispatch contextmenu at (0, 0). This used to put Delete underneath the
    // horizontal TronIDE logo, where WebDriver correctly refused the click.
    await row.dispatchEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 0,
      clientY: 0
    })

    const menu = page.locator('#menuItemsContainer')
    const deleteItem = page.locator('#menuitemdelete')
    await expect(menu).toBeVisible()
    await expect(deleteItem).toBeVisible()

    const colors = await menu.evaluate((element) => {
      const item = element.querySelector('li')
      return {
        menu: getComputedStyle(element).color,
        item: item ? getComputedStyle(item).color : '',
        background: getComputedStyle(element).backgroundColor
      }
    })
    expect(colors.menu).not.toBe('rgb(33, 37, 41)')
    expect(colors.item).toBe(colors.menu)
    expect(colors.background).not.toBe('rgba(0, 0, 0, 0)')

    const placement = await deleteItem.evaluate((item) => {
      const menu = document.getElementById('menuItemsContainer')
      if (!menu) throw new Error('Context menu was not rendered')
      const header = document.querySelector('.top-header-wrapper')
      const menuBox = menu.getBoundingClientRect()
      const itemBox = item.getBoundingClientRect()
      const headerBox = header && header.getBoundingClientRect()
      const hit = document.elementFromPoint(
        itemBox.left + itemBox.width / 2,
        itemBox.top + itemBox.height / 2
      )
      return {
        insideViewport:
          menuBox.left >= 0 &&
          menuBox.top >= 0 &&
          menuBox.right <= window.innerWidth &&
          menuBox.bottom <= window.innerHeight,
        belowHeader: !headerBox || itemBox.top >= headerBox.bottom,
        hitIsDelete: hit === item || item.contains(hit),
        menuZIndex: Number(window.getComputedStyle(menu).zIndex),
        headerZIndex: header
          ? Number(window.getComputedStyle(header).zIndex)
          : 0
      }
    })

    expect(placement.insideViewport).toBe(true)
    expect(placement.belowHeader).toBe(true)
    expect(placement.hitIsDelete).toBe(true)
    expect(placement.menuZIndex).toBeGreaterThan(placement.headerZIndex)

    await deleteItem.click()
    const deleteDialog = page.locator('[data-id$="ModalDialogContainer-react"]')
      .filter({ hasText: 'Are you sure you want to delete this item?' })
    await expect(deleteDialog).toBeVisible()
    await deleteDialog.locator('.modal-cancel').click()
    await expect(row).toBeVisible()
  })

  test('TC-FE-CONTEXT-002: Escape cancels an inline rename without changing the file', { tag: '@gate' }, async ({ page }) => {
    await blockCompilerSources(page)
    await gotoHome(page)
    await ensureFilePanel(page)

    const row = page.locator('[data-path="contracts/1_Storage.sol"]')
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.dispatchEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 0,
      clientY: 0
    })
    await page.locator('#menuitemrename').click()

    const editable = page.locator('div.remixui_items[contenteditable="true"]')
    await expect(editable).toHaveText('1_Storage.sol')
    await expect(editable).toBeFocused()
    await editable.press('Escape')

    await expect(editable).toHaveCount(0)
    await expect(page.locator('[data-path="contracts/1_Storage.sol"]')).toBeVisible()
  })

  test('TC-FE-CONTEXT-003: menu roles, roving keys, activation, and Escape focus restoration', { tag: '@gate' }, async ({ page }) => {
    await blockCompilerSources(page)
    await gotoHome(page)
    await ensureFilePanel(page)

    const row = page.locator('[data-path="contracts/1_Storage.sol"]')
    const rowTrigger = row.locator('xpath=ancestor::li[1]')
    await expect(row).toBeVisible({ timeout: 10_000 })

    const openMenu = async () => {
      await row.dispatchEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 0,
        clientY: 0
      })
      const menu = page.getByRole('menu', { name: 'File actions' })
      await expect(menu).toBeVisible()
      return menu
    }

    let menu = await openMenu()
    let items = menu.getByRole('menuitem')
    const itemCount = await items.count()
    expect(itemCount).toBeGreaterThan(1)
    await expect(items.first()).toBeFocused()
    await expect(menu.locator('[role="menuitem"][tabindex="0"]')).toHaveCount(1)

    await page.keyboard.press('End')
    await expect(items.last()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(items.last()).toBeFocused()
    await page.keyboard.press('Home')
    await expect(items.first()).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(rowTrigger).toBeFocused()

    menu = await openMenu()
    items = menu.getByRole('menuitem')
    const labels = (await items.allTextContents()).map(label => label.trim())
    const renameIndex = labels.indexOf('Rename')
    expect(renameIndex).toBeGreaterThanOrEqual(0)
    await page.keyboard.press('Home')
    for (let index = 0; index < renameIndex; index++) await page.keyboard.press('ArrowDown')
    await expect(items.nth(renameIndex)).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(menu).toHaveCount(0)
    const editable = page.locator('div.remixui_items[contenteditable="true"]')
    await expect(editable).toHaveText('1_Storage.sol')
    await expect(editable).toBeFocused()
    await editable.press('Escape')
    await expect(page.locator('[data-path="contracts/1_Storage.sol"]')).toBeVisible()
  })
})
