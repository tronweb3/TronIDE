import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// Regression coverage for the 2026-06-22 wallet connect fixes. CI has no real
// TronLink, so each test injects a fake window.tronLink / window.tronWeb that
// reproduces a specific provider state, then asserts the Connect Wallet button
// surfaces the correct, distinct, user-visible message (antd toast).
//
// Covered:
//  - no provider                          → "TronLink is not installed"        (visible toast, not just hover)
//  - reject  (ready, resolves no account) → concise unlock/approve guidance
//  - locked  (ready === false, no account)→ concise account/reload guidance
//  - stale/dead bridge (cached account,   → optimistic connect then demotes to
//    request never settles)                  the reload hint (liveness probe)

const NILE_GENESIS = '0000000000000000d698d4192c56cb6be724a558448e2684802de4d6cd8690dc'
const ACCOUNT = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb' // well-known valid base58 fixture

const HEADER_BTN = '[data-id="headerWalletConnect"]'
const TOAST = '.ant-message'

// Build an init script for a fake injected provider.
//  opts.account      - cached defaultAddress.base58 ('' = none)
//  opts.ready        - tronLink.ready
//  opts.requestMode  - 'resolveEmpty' (grants nothing) | 'hang' (never settles)
//                      | 'rejectLocked' (rejects with an explicit unlock error)
function injectedProvider (opts: { account: string; ready: boolean; requestMode: 'resolveEmpty' | 'hang' | 'rejectLocked' }) {
  return `(() => {
    const account = ${JSON.stringify(opts.account)}
    const ready = ${opts.ready}
    window.tronWeb = {
      defaultAddress: { base58: account, hex: account ? '41aa' : '' },
      fullNode: { host: 'https://api.trongrid.io', headers: {} },
      trx: { getBlock: async () => ({ blockID: '${NILE_GENESIS}' }), getNodeInfo: async () => ({}) },
      ready
    }
    window.__walletConnectRequests = 0
    window.tronLink = {
      ready,
      tronWeb: window.tronWeb,
      request: () => {
        window.__walletConnectRequests += 1
        return ${opts.requestMode === 'hang'
        ? 'new Promise(() => {})'
        : opts.requestMode === 'rejectLocked'
          ? "Promise.reject(Object.assign(new Error('TronLink is locked. Please unlock TronLink.'), { code: 'WALLET_LOCKED' }))"
          : 'Promise.resolve([])'}
      },
      on: () => {}, removeListener: () => {}
    }
  })()`
}

function mutableLivenessProvider () {
  return `(() => {
    const realNow = Date.now.bind(Date)
    const state = { mode: 'live', requests: 0, nowOffset: 0 }
    window.__walletLivenessFixture = state
    Date.now = () => realNow() + state.nowOffset
    window.tronWeb = {
      defaultAddress: { base58: '${ACCOUNT}', hex: '41aa' },
      fullNode: { host: 'https://api.trongrid.io', headers: {} },
      trx: { getBlock: async () => ({ blockID: '${NILE_GENESIS}' }), getNodeInfo: async () => ({}) },
      ready: true
    }
    window.tronLink = {
      ready: true,
      tronWeb: window.tronWeb,
      request: () => {
        state.requests += 1
        return state.mode === 'hang'
          ? new Promise(() => {})
          : Promise.resolve({ code: 200, message: 'The site is already in the whitelist' })
      },
      on: () => {}, removeListener: () => {}
    }
  })()`
}

async function boot (page: Page, initScript?: string) {
  if (initScript) await page.addInitScript(initScript)
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="remixIdeIconPanel"]').waitFor({ timeout: 30_000 })
  await page.locator(HEADER_BTN).waitFor({ timeout: 30_000 })
}

test.describe('Wallet connect — distinct, visible messages', () => {
  test('TC-WAL-MSG-1: no TronLink surfaces a visible "not installed" toast', async ({ page }) => {
    await boot(page) // no provider injected
    await page.locator(HEADER_BTN).click()
    await expect(page.locator(TOAST)).toContainText('TronLink is not installed', { timeout: 10_000 })
  })

  // A denied connection (resolve with no account) is ambiguous — locked vs
  // user-rejected can't be told apart from the page — so it shows ONE unified
  // message that's correct for both ("unlock it, then approve").
  test('TC-WAL-MSG-2: a denied connection shows the unified unlock/approve message', async ({ page }) => {
    await boot(page, injectedProvider({ account: '', ready: true, requestMode: 'resolveEmpty' }))
    await page.locator(HEADER_BTN).click()
    await expect(page.locator(TOAST)).toContainText('did not connect', { timeout: 15_000 })
    await expect(page.locator(TOAST)).toContainText('approve this site')
  })

  // An EXPLICIT lock error from TronLink still maps to the locked-specific message
  // (via normalizeTronLinkErrorMessage's unlock/locked keywords).
  test('TC-WAL-MSG-3: an explicit lock error asks the user to unlock', async ({ page }) => {
    await boot(page, injectedProvider({ account: '', ready: false, requestMode: 'rejectLocked' }))
    await page.locator(HEADER_BTN).click()
    const toast = page.locator(TOAST)
    await expect(toast).toContainText('Unlock an account', { timeout: 15_000 })
    await expect(toast).not.toContainText('was rejected')
    const prompt = page.locator('[data-id="headerWalletConnectPrompt"]')
    await expect(prompt).toContainText('TronLink needs attention')
    await expect(prompt).toContainText('Unlock an account')
    await expect(page.locator('[data-id="headerWalletConnectRetry"]')).toBeVisible()

    await page.locator('[data-id="headerWalletConnectRetry"]').click()
    await expect.poll(() => page.evaluate(() => (window as any).__walletConnectRequests)).toBe(2)
  })

  test('TC-WAL-MSG-4: a pending approval shows a persistent action and countdown', { tag: '@gate' }, async ({ page }) => {
    await boot(page, injectedProvider({ account: '', ready: false, requestMode: 'hang' }))
    await page.locator(HEADER_BTN).click()

    const prompt = page.locator('[data-id="headerWalletConnectPrompt"]')
    await expect(prompt).toBeVisible()
    await expect(prompt).toContainText('Open TronLink')
    await expect(prompt).toContainText('Approve this site in the TronLink popup')
    await expect(page.locator('[data-id="headerWalletConnectCountdown"]')).toHaveText(/\d+s remaining/)
    await expect(page.locator(HEADER_BTN)).toContainText('Waiting for TronLink')
    await expect(page.locator('[data-id="headerWalletConnectRetry"]')).toHaveCount(0)
  })

  // A provider whose objects linger after the extension was disabled: the cached
  // account makes the header optimistically connect, but the dead message bridge
  // never answers the liveness probe, so it must self-correct to the reload hint.
  test('TC-WAL-STALE-1: a stale/dead bridge demotes from connected to a reload hint', async ({ page }) => {
    test.setTimeout(45_000)
    await boot(page, injectedProvider({ account: ACCOUNT, ready: true, requestMode: 'hang' }))
    const btn = page.locator(HEADER_BTN)
    // Optimistic reflect from the cached account.
    await expect(btn).toContainText('T9yD14…HxuWwb · Nile', { timeout: 10_000 })
    // Liveness probe times out (~8s) and demotes: the reload hint is a toast and
    // the button drops back to the compact "Connect Wallet" label.
    await expect(page.locator('.ant-message')).toContainText('reload the page', { timeout: 20_000 })
    await expect(btn).not.toContainText('T9yD14…HxuWwb')
    await expect(btn).toContainText('Connect Wallet')
  })

  test('TC-WAL-STALE-2: a live provider that dies later is re-probed and demoted', { tag: '@gate' }, async ({ page }) => {
    test.setTimeout(45_000)
    await boot(page, mutableLivenessProvider())
    const btn = page.locator(HEADER_BTN)
    await expect(btn).toContainText('T9yD14…HxuWwb · Nile', { timeout: 10_000 })
    await page.locator('#icon-panel div[plugin="udapp"]').click()
    const environment = page.locator('select#selectExEnvOptions')
    await environment.waitFor({ timeout: 15_000 })
    await environment.selectOption('injected')
    await expect(environment).toHaveValue('injected', { timeout: 15_000 })
    await expect.poll(() => page.evaluate(() => (window as any).__walletLivenessFixture.requests)).toBeGreaterThanOrEqual(1)
    const requestsBeforeDisconnect = await page.evaluate(() => (window as any).__walletLivenessFixture.requests)

    // Move the liveness clock beyond the low-frequency recheck interval without
    // slowing the suite down, then simulate returning focus to the IDE after the
    // extension bridge became unresponsive. setTimeout remains real-time.
    await page.evaluate(() => {
      const fixture = (window as any).__walletLivenessFixture
      fixture.mode = 'hang'
      fixture.nowOffset = 60_000
      window.dispatchEvent(new Event('focus'))
    })
    await expect.poll(
      () => page.evaluate(() => (window as any).__walletLivenessFixture.requests),
      { timeout: 3_000 }
    ).toBeGreaterThan(requestsBeforeDisconnect)
    await expect(page.locator(TOAST)).toContainText('reload the page', { timeout: 12_000 })
    await expect(btn).toContainText('Connect Wallet')
    await expect(environment).toHaveValue('vm-tron')
  })
})
