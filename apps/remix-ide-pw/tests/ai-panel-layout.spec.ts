import { test, expect } from '@playwright/test'
import { gotoHome } from './helpers'

test.describe('AI panel layout', () => {
  test('TC-AI-LAYOUT-1: the final chat content scrolls fully above the composer', { tag: '@gate' }, async ({ page }) => {
    await gotoHome(page)
    await page.locator('#chat-wrapper-id').waitFor({ timeout: 30_000 })

    await page.locator('.chat-content-wrapper').evaluate((scrollArea) => {
      const fixture = document.createElement('div')
      fixture.setAttribute('data-id', 'aiScrollFixture')
      fixture.style.height = '1600px'
      fixture.style.display = 'flex'
      fixture.style.alignItems = 'flex-end'
      const tail = document.createElement('div')
      tail.setAttribute('data-id', 'aiScrollFixtureTail')
      tail.textContent = 'End of response'
      fixture.appendChild(tail)
      scrollArea.appendChild(fixture)
      scrollArea.scrollTop = scrollArea.scrollHeight
    })

    const bounds = await page.evaluate(() => {
      const scrollArea = document.querySelector('.chat-content-wrapper')
      const composer = document.querySelector('.chat-input-wrapper')
      const tail = document.querySelector('[data-id="aiScrollFixtureTail"]')
      const scrollRect = scrollArea.getBoundingClientRect()
      const composerRect = composer.getBoundingClientRect()
      const tailRect = tail.getBoundingClientRect()
      return {
        scrollBottom: scrollRect.bottom,
        composerTop: composerRect.top,
        tailBottom: tailRect.bottom
      }
    })

    expect(bounds.scrollBottom).toBeLessThanOrEqual(bounds.composerTop + 1)
    expect(bounds.tailBottom).toBeLessThanOrEqual(bounds.scrollBottom + 1)
    await expect(page.locator('[data-id="aiScrollFixtureTail"]')).toBeVisible()
  })

  test('TC-AI-LAYOUT-2: the final settings controls scroll above the composer', { tag: '@gate' }, async ({ page }) => {
    // 13-inch laptops commonly expose a shorter browser viewport; keep this
    // check below the desktop default so expanded settings cannot cover the
    // composer when the available height is tight.
    await page.setViewportSize({ width: 1280, height: 600 })
    await gotoHome(page)
    await page.locator('.chat-set-content').evaluate((settings) => {
      settings.scrollTop = settings.scrollHeight
    })

    const bounds = await page.evaluate(() => {
      const context = document.querySelector('[data-id="aiContextSelect"]')
      const settings = document.querySelector('.chat-set-content')
      const composer = document.querySelector('.chat-input-wrapper')
      const input = document.querySelector('.textarea-wrapper')
      if (!context || !settings || !composer || !input) throw new Error('AI settings layout is not ready')
      const contextRect = context.getBoundingClientRect()
      const settingsRect = settings.getBoundingClientRect()
      const composerRect = composer.getBoundingClientRect()
      const inputRect = input.getBoundingClientRect()
      return {
        contextBottom: contextRect.bottom,
        settingsBottom: settingsRect.bottom,
        composerTop: composerRect.top,
        inputTop: inputRect.top
      }
    })

    expect(bounds.settingsBottom).toBeLessThanOrEqual(bounds.inputTop + 1)
    expect(bounds.contextBottom).toBeLessThanOrEqual(bounds.composerTop)
    const context = page.locator('[data-id="aiContextSelect"]')
    await expect(context).toBeVisible()
    await expect(context).toContainText('None')
    await context.locator('.ant-select-selector').click()
    const currentFileOption = page.locator('.ant-select-item-option').filter({ hasText: 'Current file' })
    await expect(currentFileOption).toHaveCount(1)
    await currentFileOption.click()
    await expect(context).toContainText('Current file')
  })

  test('TC-AI-LAYOUT-5: the composer stays above expanded settings notices', { tag: '@gate' }, async ({ page }) => {
    await gotoHome(page)
    const layers = await page.evaluate(() => {
      const composer = document.querySelector('.chat-input-wrapper')
      const settings = document.querySelector('.ai-topset-wrapper')
      if (!composer || !settings) throw new Error('AI panel layout is not ready')
      return {
        composerZIndex: Number.parseInt(getComputedStyle(composer).zIndex || '0', 10),
        settingsZIndex: Number.parseInt(getComputedStyle(settings).zIndex || '0', 10),
        inputTop: document.querySelector('.textarea-wrapper')?.getBoundingClientRect().top,
        composerTop: composer.getBoundingClientRect().top
      }
    })

    expect(layers.composerZIndex).toBeGreaterThan(layers.settingsZIndex)
    // The auto-growing textarea may extend above its fixed-height wrapper;
    // the wrapper's stacking context keeps that top border above the settings.
    expect(layers.inputTop).toBeLessThanOrEqual(layers.composerTop)
  })

  test('TC-AI-LAYOUT-3: the AI panel keeps its content at the 768px breakpoint', { tag: '@gate' }, async ({ page }) => {
    await gotoHome(page)
    await page.setViewportSize({ width: 768, height: 768 })

    const chat = page.locator('#chat-wrapper-id')
    await expect(chat).toBeVisible()
    const bounds = await chat.boundingBox()
    expect(bounds?.width).toBeGreaterThan(300)
    expect(bounds?.height).toBeGreaterThan(600)
  })

  test('TC-AI-LAYOUT-4: narrow layout keeps only one auxiliary panel open', { tag: '@gate' }, async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 768 })
    await gotoHome(page)

    const sidePanel = page.locator('[data-id="remixIdeSidePanel"]')
    const aiPanel = page.locator('[data-id="remixIdeAiPanel"]')
    const mainPanel = page.locator('[data-id="remixIdeMainPanel"]')
    await expect(aiPanel).toBeVisible()
    await expect(sidePanel).toBeHidden()
    expect((await mainPanel.boundingBox())?.width).toBeGreaterThan(350)

    await page.locator('[data-id="headerToggleSidePanel"]').click()
    await expect(sidePanel).toBeVisible()
    await expect(aiPanel).toBeHidden()
    expect((await mainPanel.boundingBox())?.width).toBeGreaterThan(350)

    await page.locator('[data-id="headerToggleAiPanel"]').click()
    await expect(aiPanel).toBeVisible()
    await expect(sidePanel).toBeHidden()
    expect((await mainPanel.boundingBox())?.width).toBeGreaterThan(350)

    await page.locator('#icon-panel div[plugin="filePanel"]').click()
    await expect(sidePanel).toBeVisible()
    await expect(aiPanel).toBeHidden()
    expect((await mainPanel.boundingBox())?.width).toBeGreaterThan(350)
  })
})
