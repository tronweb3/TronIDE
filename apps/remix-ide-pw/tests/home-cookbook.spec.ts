import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

const NILE_GENESIS = '0000000000000000d698d4192c56cb6be724a558448e2684802de4d6cd8690dc'
const NILE_ACCOUNT = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'

// TRON Cookbook recipe cards (v2.3.2): each card click must give visible
// feedback and must not double-fire toasts. These run in a fresh browser with
// NO TronLink injected, which is the case the user hit ("no reaction" /
// "two toasts").

async function openHomeCookbook (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
  // The Cookbook lives in the Advanced Tools section — expand it if collapsed.
  const advToggle = page.locator('[data-id="landingAdvancedToolsToggle"]')
  if ((await advToggle.getAttribute('aria-expanded')) === 'false') await advToggle.click()
  await page.locator('[data-id="landingRecipeTronLink"]').waitFor({ state: 'visible', timeout: 10_000 })
}

const toast = (page: Page) => page.locator('[data-shared="tooltipPopup"]')

async function injectReadyNileWallet (page: Page) {
  await page.addInitScript(({ account, genesis }) => {
    const fullNode = { host: 'https://nile.trongrid.io', headers: {}, request: async () => ({}) }
    const trx = new Proxy({
      getBlock: async () => ({ blockID: genesis }),
      getNodeInfo: async () => ({}),
      getAccount: async () => ({ balance: 10_000_000 }),
      getBalance: async () => 10_000_000
    }, { get: (target, property) => property in target ? (target as any)[property] : (async () => undefined) })
    ;(window as any).tronWeb = new Proxy({
      ready: true,
      defaultAddress: { base58: account, hex: '410000000000000000000000000000000000000000' },
      fullNode,
      solidityNode: { host: fullNode.host },
      eventServer: { host: fullNode.host },
      trx
    }, { get: (target, property) => property in target ? (target as any)[property] : (() => undefined) })
    ;(trx as any).tronWeb = (window as any).tronWeb
    ;(window as any).tronLink = {
      ready: true,
      tronWeb: (window as any).tronWeb,
      request: async () => [account],
      on: () => {},
      removeListener: () => {}
    }
  }, { account: NILE_ACCOUNT, genesis: NILE_GENESIS })
}

async function rebindInjectedWallet (page: Page) {
  await page.evaluate(() => {
    const scope = window as any
    const current = scope.tronWeb
    const next = new Proxy({ ...current }, {
      get: (target, property) => property in target ? (target as any)[property] : (() => undefined)
    })
    current.trx.tronWeb = next
    scope.tronWeb = next
    scope.tronLink = { ...scope.tronLink, tronWeb: next }
  })
}

test.describe('Home TRON Cookbook recipes', () => {
  // TC-CB-001: TronLink readiness gives visible feedback (a toast), not just a
  // silent bell notification — the locked/uninjected case looked like a no-op.
  test('TC-CB-001: TronLink readiness shows a visible toast', { tag: '@gate' }, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await openHomeCookbook(page)
    await page.locator('[data-id="landingRecipeTronLink"]').click()
    // a toast appears mentioning TronLink (installed-or-not / locked guidance)
    await expect(toast(page).filter({ hasText: /TronLink/i }).first()).toBeVisible({ timeout: 10_000 })
    expect(errors).toEqual([])
  })

  // TC-CB-002: Nile deploy checklist must show a SINGLE toast, not two. The
  // udapp connect flow already surfaces the outcome; the Home handler used to
  // also tooltip the same error, producing a duplicate.
  test('TC-CB-002: Nile deploy checklist shows a single toast, not a duplicate', { tag: '@gate' }, async ({ page }) => {
    await openHomeCookbook(page)
    await page.locator('[data-id="landingRecipeNileDeploy"]').click()
    // wait for the connect outcome toast to appear…
    await expect(toast(page).first()).toBeVisible({ timeout: 15_000 })
    // …then there must be exactly one toast (no duplicate from the Home handler).
    // Poll briefly to let any second toast surface before asserting the count.
    await page.waitForTimeout(1_000)
    await expect(toast(page)).toHaveCount(1)
  })

  // TC-CB-003: GitHub token safety gives visible feedback (a toast) — success
  // used to only add a silent bell notification, and the async clipboard
  // rejection was never caught, so the click looked like a no-op.
  test('TC-CB-003: GitHub token safety shows a visible toast', { tag: '@gate' }, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await openHomeCookbook(page)
    await page.locator('[data-id="landingRecipeGithubToken"]').click()
    // either the "copied" confirmation or the checklist fallback — a toast shows
    await expect(toast(page).filter({ hasText: /checklist|copied|GitHub token/i }).first()).toBeVisible({ timeout: 10_000 })
    expect(errors).toEqual([])
  })

  test('TC-CB-004: Nile deploy checklist requires a fresh connected Nile environment', { tag: '@gate' }, async ({ page }) => {
    await injectReadyNileWallet(page)
    await openHomeCookbook(page)
    // Match TronLink's normal post-startup provider re-injection so the
    // environment probe is fresh instead of reusing startup detection state.
    await rebindInjectedWallet(page)
    await page.locator('[data-id="landingRecipeNileDeploy"]').click()
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('tronide.home.notifications') || '[]').length), { timeout: 15_000 }).toBeGreaterThan(0)
    const notification = await page.evaluate(() => JSON.parse(localStorage.getItem('tronide.home.notifications') || '[]')[0])
    expect(notification).toMatchObject({ title: 'Nile deploy checklist' })
    expect(notification.message).toMatch(/Nile ready/i)
    expect(notification.message).not.toMatch(/environment not ready|network required/i)
  })
})
