import { test, expect, Page } from '@playwright/test'
import { gotoHome } from './helpers'

const NILE_GENESIS = '0000000000000000d698d4192c56cb6be724a558448e2684802de4d6cd8690dc'
const SHASTA_GENESIS = '0000000000000000de1aa88295e1fcf982742f773e0419c5a9c134c994a9059e'
const ACCOUNT_A = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'
const ACCOUNT_B = 'TCrDi83pUoK17GbwxN1SckM3YNXzahWvoN'

async function bootWithMutableTronLink (page: Page) {
  await page.addInitScript(({ account, genesis }) => {
    const state = { account, genesis }
    ;(window as any).__walletHeaderFixture = state
    ;(window as any).tronWeb = {
      defaultAddress: { base58: state.account, hex: '41aa' },
      // Keep the endpoint stable so the network assertion proves that setNode
      // invalidates genesis detection rather than merely changing the host key.
      fullNode: { host: 'https://tron-rpc.example.test', headers: {} },
      trx: {
        getBlock: async () => ({ blockID: state.genesis }),
        getNodeInfo: async () => ({})
      },
      ready: true
    }
    ;(window as any).tronLink = {
      ready: true,
      tronWeb: (window as any).tronWeb,
      request: async () => [state.account],
      on: () => {},
      removeListener: () => {}
    }
  }, { account: ACCOUNT_A, genesis: NILE_GENESIS })
  await gotoHome(page)
  await expect(page.locator('[data-id="headerWalletConnect"]')).toContainText('T9yD14…HxuWwb · Nile', { timeout: 10_000 })
}

test.describe('Wallet header provider events', () => {
  test('TC-WAL-HDR-EVT-000: cross-origin wallet messages cannot alter header state', { tag: '@gate' }, async ({ page }) => {
    await bootWithMutableTronLink(page)
    const walletButton = page.locator('[data-id="headerWalletConnect"]')

    await page.evaluate(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { message: { action: 'disconnect' }, isTronLink: true },
        origin: 'https://evil.example',
        source: window
      }))
    })

    await expect(walletButton).toContainText('T9yD14…HxuWwb · Nile')
  })

  test('TC-WAL-HDR-EVT-001: nested setAccount updates the address before the poll', { tag: '@gate' }, async ({ page }) => {
    await bootWithMutableTronLink(page)

    await page.evaluate((account) => {
      const fixture = (window as any).__walletHeaderFixture
      fixture.account = account
      ;(window as any).tronWeb.defaultAddress.base58 = account
      window.postMessage({ message: { action: 'setAccount', data: { address: account } } }, '*')
    }, ACCOUNT_B)

    await expect(page.locator('[data-id="headerWalletConnect"]')).toContainText('TCrDi8…ahWvoN · Nile', { timeout: 1_500 })
  })

  test('TC-WAL-HDR-EVT-002: nested setNode refreshes a same-host network', { tag: '@gate' }, async ({ page }) => {
    await bootWithMutableTronLink(page)

    await page.evaluate((genesis) => {
      ;(window as any).__walletHeaderFixture.genesis = genesis
      window.postMessage({ message: { action: 'setNode', data: {} } }, '*')
    }, SHASTA_GENESIS)

    await expect(page.locator('[data-id="headerWalletConnect"]')).toContainText('T9yD14…HxuWwb · Shasta', { timeout: 1_500 })
    await page.locator('[data-id="headerWalletConnect"]').click()
    await expect(page.locator('[data-id="headerWalletNetwork"]')).toHaveText('Shasta')
  })

  test('TC-WAL-HDR-EVT-003: revoked accounts stay disconnected despite a stale cached address', { tag: '@gate' }, async ({ page }) => {
    test.setTimeout(45_000)
    await bootWithMutableTronLink(page)
    const walletButton = page.locator('[data-id="headerWalletConnect"]')
    const homeWalletStatus = page.locator('[data-id="landingWalletStatus"]')
    await expect(homeWalletStatus).toHaveText('Wallet: TronLink connected')

    // TronLink's event is authoritative. Deliberately leave defaultAddress at
    // ACCOUNT_A to reproduce the extension's briefly/stale cached injection.
    await page.evaluate(() => {
      window.postMessage({ message: { action: 'accountsChanged', data: { accounts: [] } } }, '*')
    })
    await expect(walletButton).toHaveText(/Connect Wallet/, { timeout: 1_500 })
    await expect(homeWalletStatus).toHaveText('Wallet: Not connected', { timeout: 1_500 })

    // Cross the 3s status poll: it must not resurrect ACCOUNT_A from the stale
    // injected object after the provider explicitly revoked account access.
    await page.waitForTimeout(3_500)
    await expect(walletButton).toHaveText(/Connect Wallet/)

    await page.evaluate((account) => {
      const fixture = (window as any).__walletHeaderFixture
      fixture.account = account
      ;(window as any).tronWeb.defaultAddress.base58 = account
      window.postMessage({ message: { action: 'accountsChanged', data: { address: account } } }, '*')
    }, ACCOUNT_B)
    await expect(walletButton).toContainText('TCrDi8…ahWvoN · Nile', { timeout: 1_500 })
    await expect(homeWalletStatus).toHaveText('Wallet: TronLink connected', { timeout: 1_500 })
  })

  test('TC-WAL-HDR-EVT-004: provider disconnect returns Deploy & Run to VM', { tag: '@gate' }, async ({ page }) => {
    test.setTimeout(45_000)
    await bootWithMutableTronLink(page)
    const walletButton = page.locator('[data-id="headerWalletConnect"]')
    await page.locator('#icon-panel div[plugin="udapp"]').click()
    const environment = page.locator('select#selectExEnvOptions')
    await environment.waitFor({ timeout: 15_000 })
    await environment.selectOption('injected')
    await expect(environment).toHaveValue('injected', { timeout: 15_000 })

    await page.evaluate(() => {
      window.postMessage({ message: { action: 'disconnect' }, isTronLink: true }, '*')
    })
    await expect(walletButton).toHaveText(/Connect Wallet/, { timeout: 1_500 })
    await expect(environment).toHaveValue('vm-tron', { timeout: 5_000 })
    await page.waitForTimeout(3_500)
    await expect(walletButton).toHaveText(/Connect Wallet/)

    await page.evaluate(() => {
      window.postMessage({ message: { action: 'connect' }, isTronLink: true }, '*')
    })
    await expect(walletButton).toContainText('T9yD14…HxuWwb · Nile', { timeout: 1_500 })
    await expect(environment).toHaveValue('vm-tron')
  })
})
