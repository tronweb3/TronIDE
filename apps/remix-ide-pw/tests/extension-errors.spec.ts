import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// TC-EXTERR-001/002: errors thrown by injected wallet extensions (MetaMask's
// inpage.js "Failed to connect to MetaMask", etc.) must NOT surface in the
// runtime-error overlay / be filed as IDE P0 bugs — but genuine app errors
// must still propagate.

async function openHome (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
}

// dispatch a synthetic unhandledrejection and report whether our capture-phase
// handler cancelled it (defaultPrevented) before the overlay could see it
async function rejectionPrevented (page: Page, message: string, stack: string): Promise<boolean> {
  return page.evaluate(({ message, stack }) => {
    const reason: any = new Error(message)
    reason.stack = stack
    const p = Promise.reject(reason)
    p.catch(() => {}) // keep the real engine quiet; we test the synthetic event
    const ev = new PromiseRejectionEvent('unhandledrejection', { promise: p, reason, cancelable: true })
    window.dispatchEvent(ev)
    return ev.defaultPrevented
  }, { message, stack })
}

async function errorPrevented (page: Page, message: string, filename: string): Promise<boolean> {
  return page.evaluate(({ message, filename }) => {
    const error: any = new Error(message)
    error.stack = `Error: ${message}\n    at connect (${filename}:7:81161)`
    const ev = new ErrorEvent('error', { message, filename, error, cancelable: true })
    window.dispatchEvent(ev)
    return ev.defaultPrevented
  }, { message, filename })
}

test.describe('Wallet-extension error suppression', () => {
  test('TC-EXTERR-001: a MetaMask inpage rejection is suppressed, a real app rejection is not', async ({ page }) => {
    await openHome(page)

    // the exact shape from the bug report: MetaMask inpage.js connect failure
    const metamask = await rejectionPrevented(
      page,
      'Failed to connect to MetaMask',
      'Error: Failed to connect to MetaMask\n    at Object.connect (chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/scripts/inpage.js:7:81161)'
    )
    expect(metamask).toBe(true)

    // a generic extension rejection without a clear message but extension stack
    const okx = await rejectionPrevented(
      page,
      'provider error',
      'Error\n    at chrome-extension://mcohilncbfahbmgdjkbpemcciiolgcge/inpage.js:1:200'
    )
    expect(okx).toBe(true)

    // a genuine application error (from our own bundle) must NOT be suppressed
    const appErr = await rejectionPrevented(
      page,
      'Cannot read properties of undefined (reading foo)',
      'TypeError: ...\n    at RunTab.render (http://localhost:18080/main.js:12345:6)'
    )
    expect(appErr).toBe(false)
  })

  test('TC-EXTERR-003: a real MetaMask inpage rejection does not show the runtime-error overlay', async ({ page }) => {
    await openHome(page)

    // a genuinely unhandled rejection with a MetaMask inpage stack — the exact
    // P0 scenario from the bug report
    await page.evaluate(() => {
      const r: any = new Error('Failed to connect to MetaMask')
      r.stack = 'Error: Failed to connect to MetaMask\n    at Object.connect (chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/scripts/inpage.js:7:81161)'
      Promise.reject(r) // not caught — would normally raise the overlay
    })
    await page.waitForTimeout(2_000)

    // the dev-server overlay must not be visible (absent, or display:none)
    const visible = await page.evaluate(() => {
      const f = document.getElementById('webpack-dev-server-client-overlay') as HTMLElement | null
      if (!f) return false
      return window.getComputedStyle(f).display !== 'none'
    })
    expect(visible).toBe(false)
    // and the top-level page is still usable
    await expect(page.locator('[data-id="landingWorkspaceStatus"]')).toBeVisible()
  })

  test('TC-EXTERR-002: a window error from an extension inpage script is suppressed, app errors are not', async ({ page }) => {
    await openHome(page)

    const extError = await errorPrevented(page, 'Failed to connect to MetaMask', 'chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/scripts/inpage.js')
    expect(extError).toBe(true)

    const appError = await errorPrevented(page, 'boom', 'http://localhost:18080/main.js')
    expect(appError).toBe(false)
  })
})
