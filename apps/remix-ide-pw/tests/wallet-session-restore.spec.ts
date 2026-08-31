import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal, gotoHome } from './helpers'

const NILE_GENESIS = '0000000000000000d698d4192c56cb6be724a558448e2684802de4d6cd8690dc'
const ACCOUNT_A = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'
const ACCOUNT_B = 'TCrDi83pUoK17GbwxN1SckM3YNXzahWvoN'
const MANUAL_DISCONNECT_KEY = 'tronide.wallet.manuallyDisconnected'
const HEADER_WALLET = '[data-id="headerWalletConnect"]'

const WALLET_FACTORY = `(() => {
  window.__installWalletRestoreFixture = (initialAccount = '${ACCOUNT_A}') => {
    const listeners = Object.create(null)
    const state = {
      account: initialAccount,
      requests: [],
      listeners,
      emit (name, value) {
        ;(listeners[name] || []).slice().forEach((handler) => handler(value))
      },
      setAccount (account) {
        this.account = account
        window.tronWeb.defaultAddress.base58 = account
        this.emit('accountsChanged', account ? [account] : [])
      }
    }
    const trx = new Proxy({
      getBlock: async () => ({ blockID: '${NILE_GENESIS}', block_header: { raw_data: {} } }),
      getCurrentBlock: async () => ({ blockID: '${NILE_GENESIS}', block_header: { raw_data: { number: 1, timestamp: 1 } } }),
      getBalance: async () => 0,
      getAccount: async () => ({ balance: 0 }),
      getNodeInfo: async () => ({})
    }, { get (target, property) { return property in target ? target[property] : (async () => undefined) } })
    const tronWeb = new Proxy({
      ready: true,
      defaultAddress: { base58: state.account, hex: '410000000000000000000000000000000000000000' },
      fullNode: { host: 'https://nile.trongrid.io', headers: {} },
      solidityNode: { host: 'https://nile.trongrid.io' },
      eventServer: { host: 'https://nile.trongrid.io' },
      setHeader: () => {},
      trx,
      transactionBuilder: new Proxy({}, { get () { return async () => ({}) } }),
      address: { toHex: (address) => address, fromHex: (address) => address, fromPrivateKey: () => state.account },
      contract: () => ({ at: async () => ({}) }),
      isAddress: () => true
    }, { get (target, property) { return property in target ? target[property] : (() => undefined) } })
    const tronLink = {
      ready: true,
      tronWeb,
      request: async ({ method }) => {
        state.requests.push(method)
        if (method === 'tron_disconnect') return { code: 200 }
        return state.account ? [state.account] : []
      },
      on: (name, handler) => {
        listeners[name] = listeners[name] || []
        listeners[name].push(handler)
      },
      removeListener: (name, handler) => {
        listeners[name] = (listeners[name] || []).filter((entry) => entry !== handler)
      }
    }
    window.tronWeb = tronWeb
    window.tronLink = tronLink
    window.__walletRestoreFixture = state
    return state
  }
})()`

async function waitForHomeAfterReload (page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
  await page.locator(HEADER_WALLET).waitFor({ timeout: 30_000 })
}

test.describe('Wallet session restoration and provider reinjection', () => {
  test('TC-WAL-RESTORE-001: a provider injected after mount is restored and receives account events', { tag: '@gate' }, async ({ page }) => {
    await page.addInitScript(WALLET_FACTORY)
    await gotoHome(page)
    const walletButton = page.locator(HEADER_WALLET)
    await expect(walletButton).toContainText('Connect Wallet')

    await page.evaluate(() => {
      ;(window as any).__installWalletRestoreFixture()
      window.dispatchEvent(new Event('tronLink#initialized'))
    })

    await expect(walletButton).toContainText('T9yD14…HxuWwb · Nile', { timeout: 3_000 })
    await expect.poll(() => page.evaluate(() => (
      ((window as any).__walletRestoreFixture.listeners.accountsChanged || []).length
    )), { timeout: 3_000 }).toBeGreaterThan(0)

    await page.evaluate((account) => (window as any).__walletRestoreFixture.setAccount(account), ACCOUNT_B)
    await expect(walletButton).toContainText('TCrDi8…ahWvoN · Nile', { timeout: 1_500 })
  })

  test('TC-WAL-RESTORE-002: manual disconnect survives reload until explicit reconnect', { tag: '@gate' }, async ({ page }) => {
    await page.addInitScript(`${WALLET_FACTORY}; window.__installWalletRestoreFixture()`)
    await gotoHome(page)
    const walletButton = page.locator(HEADER_WALLET)
    await expect(walletButton).toContainText('T9yD14…HxuWwb · Nile', { timeout: 10_000 })

    await walletButton.click()
    await page.locator('[data-id="headerWalletDisconnect"]').click()
    await expect(walletButton).toContainText('Connect Wallet')
    await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), MANUAL_DISCONNECT_KEY)).toBe('1')

    await waitForHomeAfterReload(page)
    await expect(walletButton).toContainText('Connect Wallet')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForTimeout(3_500)
    await expect(walletButton).toContainText('Connect Wallet')
    await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), MANUAL_DISCONNECT_KEY)).toBe('1')

    await walletButton.click()
    await expect(walletButton).toContainText('T9yD14…HxuWwb · Nile', { timeout: 20_000 })
    await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), MANUAL_DISCONNECT_KEY)).toBeNull()
  })
})
