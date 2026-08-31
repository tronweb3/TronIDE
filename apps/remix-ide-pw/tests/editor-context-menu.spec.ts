import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// The Ace editor renders its OWN selection (not a native DOM selection), so the
// browser's right-click "Copy" copies nothing. A custom editor context menu
// (Copy/Cut/Paste/Select all) wires those to Ace + the clipboard.

async function openStorage (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
  const f = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
  if (!await f.isVisible().catch(() => false)) {
    await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
  }
  await f.click()
  await page.locator('#input').waitFor({ timeout: 10_000 })
}

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

test.describe('Editor right-click context menu', () => {
  // TC-ED-CTX-001: right-click shows the custom menu, and "Copy" puts the Ace
  // selection on the clipboard (the native menu could not).
  test('TC-ED-CTX-001: right-click Copy copies the editor selection', { tag: '@gate' }, async ({ page }) => {
    await openStorage(page)
    // select all in the editor via Ace
    await page.evaluate(() => {
      const ed = (document.getElementById('input') as any).editor
      ed.focus(); ed.selectAll()
    })
    const selected: string = await page.evaluate(() => (document.getElementById('input') as any).editor.getSelectedText())
    expect(selected.length).toBeGreaterThan(20)

    // open the custom context menu over the code
    await page.locator('#input .ace_content').click({ button: 'right' })
    const menu = page.locator('[data-id="editorContextMenu"]')
    await expect(menu).toBeVisible({ timeout: 5_000 })
    // Copy is enabled (there is a selection); Cut/Paste/Select all are present
    await expect(page.locator('[data-id="editorContextMenuCopy"]')).toBeVisible()
    await expect(page.locator('[data-id="editorContextMenuSelectall"]')).toBeVisible()

    await page.locator('[data-id="editorContextMenuCopy"]').click()
    await expect(menu).toHaveCount(0) // menu closes after the action
    const clip: string = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toBe(selected)
  })

  // TC-ED-CTX-002: Paste inserts clipboard text at the cursor; the menu closes
  // on Escape / outside click.
  test('TC-ED-CTX-002: Paste inserts clipboard text; menu dismisses cleanly', { tag: '@gate' }, async ({ page }) => {
    await openStorage(page)
    await page.evaluate(() => navigator.clipboard.writeText('// PASTED_MARKER\n'))
    // put the cursor at the very start
    await page.evaluate(() => {
      const ed = (document.getElementById('input') as any).editor
      ed.focus(); ed.gotoLine(1, 0)
    })
    await page.locator('#input .ace_content').click({ button: 'right' })
    await expect(page.locator('[data-id="editorContextMenu"]')).toBeVisible({ timeout: 5_000 })
    await page.locator('[data-id="editorContextMenuPaste"]').click()
    await expect.poll(() =>
      page.evaluate(() => (document.getElementById('input') as any).editor.session.getValue())
    ).toContain('PASTED_MARKER')

    // Escape dismisses the menu without acting
    await page.locator('#input .ace_content').click({ button: 'right' })
    await expect(page.locator('[data-id="editorContextMenu"]')).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-id="editorContextMenu"]')).toHaveCount(0)
  })

  // TC-ED-CTX-003: Cut removes the selection and puts it on the clipboard;
  // Select all selects the whole document.
  test('TC-ED-CTX-003: Cut removes + copies the selection; Select all selects everything', { tag: '@gate' }, async ({ page }) => {
    await openStorage(page)
    const full: string = await page.evaluate(() => (document.getElementById('input') as any).editor.session.getValue())

    // Select all via the menu, then Cut.
    await page.locator('#input .ace_content').click({ button: 'right' })
    await expect(page.locator('[data-id="editorContextMenu"]')).toBeVisible({ timeout: 5_000 })
    await page.locator('[data-id="editorContextMenuSelectall"]').click()
    await expect.poll(() =>
      page.evaluate(() => (document.getElementById('input') as any).editor.getSelectedText().length)
    ).toBe(full.length)

    await page.locator('#input .ace_content').click({ button: 'right' })
    await expect(page.locator('[data-id="editorContextMenuCut"]')).toBeVisible({ timeout: 5_000 })
    await page.locator('[data-id="editorContextMenuCut"]').click()
    // the document is now empty, and the clipboard holds the cut content
    await expect.poll(() =>
      page.evaluate(() => (document.getElementById('input') as any).editor.session.getValue())
    ).toBe('')
    const clip: string = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toBe(full)
  })

  // TC-ED-CTX-004: a keyboard-invoked contextmenu (Shift+F10 / menu key)
  // reports no mouse point — the menu must anchor at the text cursor, not the
  // viewport's top-left clamp. And the menu's own Escape must be consumed,
  // not fall through to whatever is underneath.
  test('TC-ED-CTX-004: keyboard-invoked menu anchors at the cursor; Escape does not leak', { tag: '@gate' }, async ({ page }) => {
    await openStorage(page)
    // park the cursor deep in the document so "anchored at the cursor" is
    // clearly distinguishable from the old (2,2) top-left fallback
    await page.evaluate(() => {
      const ed = (document.getElementById('input') as any).editor
      ed.focus(); ed.gotoLine(8, 4)
    })
    await page.evaluate(() => {
      document.getElementById('input')!.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }))
    })
    const menu = page.locator('[data-id="editorContextMenu"]')
    await expect(menu).toBeVisible({ timeout: 5_000 })
    const menuBox = await menu.boundingBox()
    const cursorPos = await page.evaluate(() => {
      const ed = (document.getElementById('input') as any).editor
      const c = ed.getCursorPosition()
      const sc = ed.renderer.textToScreenCoordinates(c.row, c.column)
      return { x: sc.pageX - window.scrollX, y: sc.pageY - window.scrollY }
    })
    expect(Math.abs(menuBox!.x - cursorPos.x)).toBeLessThan(60)
    expect(Math.abs(menuBox!.y - cursorPos.y)).toBeLessThan(60)

    // Escape closes the menu and is consumed: a bubble-phase document listener
    // must not see the keypress while the menu was open
    await page.evaluate(() => {
      (window as any).__escLeaked = 0
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') (window as any).__escLeaked++ })
    })
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__escLeaked)).toBe(0)

    // and with the menu closed, Escape flows normally again
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => (window as any).__escLeaked)).toBe(1)
  })

  // TC-ED-CTX-005: opening the menu was keyboard-possible but OPERATING it was
  // not — item rows were click-only, focus stayed in Ace's hidden textarea, and
  // typing edited the document underneath the floating menu. The menu now owns
  // focus while open: arrows walk the enabled items, Enter activates, plain
  // characters go nowhere.
  test('TC-ED-CTX-005: keyboard-opened menu is operable — arrows walk items, Enter activates, typing does not leak', { tag: '@gate' }, async ({ page }) => {
    await openStorage(page)
    const before = await page.evaluate(() => {
      const ed = (document.getElementById('input') as any).editor
      ed.focus(); ed.gotoLine(3, 0)
      return ed.session.getValue()
    })
    await page.evaluate(() => {
      document.getElementById('input')!.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }))
    })
    const menu = page.locator('[data-id="editorContextMenu"]')
    await expect(menu).toBeVisible({ timeout: 5_000 })

    // a keyboard invocation focuses the first ENABLED item immediately
    const items = menu.locator('[role="menuitem"][data-enabled="true"]')
    await expect(items.first()).toBeFocused()

    // plain characters while the menu is open must NOT edit the document
    await page.keyboard.type('XYZZY')
    expect(await page.evaluate(() => (document.getElementById('input') as any).editor.session.getValue())).toBe(before)

    // ArrowDown walks to the last enabled item (Select all — no selection, so
    // Copy/Cut are disabled and skipped by construction)…
    const count = await items.count()
    for (let i = 1; i < count; i++) await page.keyboard.press('ArrowDown')
    await expect(items.last()).toBeFocused()
    await expect(items.last()).toHaveText('Select all')

    // …and Enter activates it: the menu closes and the whole document is selected
    await page.keyboard.press('Enter')
    await expect(menu).toHaveCount(0)
    expect(await page.evaluate(() => (document.getElementById('input') as any).editor.getSelectedText())).toBe(before)
  })

  // TC-ED-CTX-006: the menu used an undefined --text custom property with a
  // dark fallback. On dark themes that produced dark text on a dark surface;
  // disabled commands were effectively invisible. Exercise both a dark and a
  // light built-in theme and measure the final, composited foreground.
  test('TC-ED-CTX-006: menu commands stay readable in dark and light themes', { tag: '@gate' }, async ({ page }) => {
    for (const theme of ['Dark', 'Light']) {
      await page.addInitScript((themeName) => {
        const key = 'config-v0.8:.remix.config'
        const config = JSON.parse(window.localStorage.getItem(key) || '{}')
        config['settings/theme'] = themeName
        window.localStorage.setItem(key, JSON.stringify(config))
      }, theme)
      await openStorage(page)
      await page.locator('#input .ace_content').click({ button: 'right' })
      const menu = page.locator('[data-id="editorContextMenu"]')
      await expect(menu).toBeVisible()

      const result = await menu.evaluate((menuElement) => {
        const parseRgb = (value: string) => {
          const channels = (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
          if (channels.length !== 3) throw new Error(`Unsupported color: ${value}`)
          return channels
        }
        const luminance = (channels: number[]) => channels
          .map((value) => value / 255)
          .map((value) => value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4))
          .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
        const contrast = (first: number[], second: number[]) => {
          const a = luminance(first)
          const b = luminance(second)
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
        }
        const background = parseRgb(getComputedStyle(menuElement).backgroundColor)
        return Array.from(menuElement.querySelectorAll<HTMLElement>('[role="menuitem"]')).map((item) => {
          const style = getComputedStyle(item)
          const foreground = parseRgb(style.color)
          const opacity = Number(style.opacity)
          const composited = foreground.map((value, index) => (value * opacity) + (background[index] * (1 - opacity)))
          return {
            label: item.textContent,
            disabled: item.getAttribute('aria-disabled') === 'true',
            contrast: contrast(composited, background)
          }
        })
      })

      for (const item of result) {
        expect(item.contrast, `${theme} ${item.label} contrast`).toBeGreaterThanOrEqual(4.5)
      }
      await page.keyboard.press('Escape')
    }
  })
})
