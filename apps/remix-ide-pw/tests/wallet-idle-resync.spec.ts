import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal } from './helpers'

// WAL-IDLE-1: after the page sits idle, TronLink re-injects a fresh window.tronWeb
// (auto-lock unlock / MV3 service-worker restart) — a NEW object identity. The
// app bound the injected instance once (execution-context tronWebInstance) and
// handed that frozen reference to the signing path, so trx.sign() posted into a
// dead bridge and the deploy/sign popup never appeared.
//
// This locks the fix in on the ACTUAL bug path (signing via executionContext.web3()):
// when window.tronWeb is replaced by a new identity (same network, so the
// pre-sign context guard still passes), a sign must route through the LIVE object.
// CI has no real TronLink, so we mock the injected provider; the mock's
// signMessageV2 records which instance the app actually signed through.
// Pre-fix this records the stale 'A'; with the re-sync it records the live 'B'.

const NILE_GENESIS = '0000000000000000d698d4192c56cb6be724a558448e2684802de4d6cd8690dc'
const ACCOUNT = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb' // well-known valid base58 fixture
const MOCK = `
(() => {
  const ACCOUNT = '${ACCOUNT}'
  const HOST = 'https://nile.trongrid.io'
  window.__signedBy = null
  window.__mkMock = (tag) => {
    const trx = new Proxy({
      getBlock: async () => ({ blockID: '${NILE_GENESIS}', block_header: { raw_data: {} } }),
      getCurrentBlock: async () => ({ blockID: '${NILE_GENESIS}', block_header: { raw_data: { number: 1, timestamp: 1 } } }),
      getBalance: async () => 0,
      getAccount: async () => ({ balance: 0 }),
      sign: async (t) => { window.__signedBy = tag; return t },
      signMessageV2: async () => { window.__signedBy = tag; return '0xsig-' + tag }
    }, { get (t, p) { return (p in t) ? t[p] : (async () => undefined) } })
    return new Proxy({
      defaultAddress: { base58: ACCOUNT, hex: '410000000000000000000000000000000000000000' },
      fullNode: { host: HOST }, solidityNode: { host: HOST }, eventServer: { host: HOST },
      setHeader: () => {}, trx,
      transactionBuilder: new Proxy({}, { get () { return async () => ({}) } }),
      address: { toHex: (a) => a, fromHex: (a) => a, fromPrivateKey: () => ACCOUNT },
      contract: () => ({ at: async () => ({}) }), isAddress: () => true
    }, { get (t, p) { return (p in t) ? t[p] : (() => undefined) } })
  }
  window.tronWeb = window.__mkMock('A')
  window.tronLink = { ready: true, request: async () => [ACCOUNT], tronWeb: window.tronWeb }
})()
`

async function openInjected (page: Page) {
  await page.addInitScript(MOCK)
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
  await page.locator('#icon-panel div[plugin="udapp"]').click()
  const env = page.locator('select#selectExEnvOptions')
  await env.waitFor({ timeout: 15_000 })
  await env.selectOption('injected')
  await expect(env).toHaveValue('injected', { timeout: 15_000 })
  // wait for the run-tab account list to pick up the injected account
  await expect.poll(async () => page.locator('#txorigin option').count(), { timeout: 15_000 }).toBeGreaterThan(0)
}

async function signMessage (page: Page, msg: string) {
  await page.locator('[data-id="settingsRemixRunSignMsg"]').click()
  await page.locator('#prompt_text').waitFor({ timeout: 8_000 })
  await page.locator('#prompt_text').fill(msg)
  await page.locator('#modal-footer-ok').click() // message prompt -> opens the confirmation modal
  await page.getByText('Confirm message signature').waitFor({ timeout: 8_000 })
  await page.locator('#modal-footer-ok').click() // "Sign" -> blockchain.signMessage -> web3().trx.signMessageV2
}

test.describe('WAL-IDLE-1 injected provider re-sync (signing path)', () => {
  test('signs through a replaced window.tronWeb (new identity), not the stale cached ref', async ({ page }) => {
    await openInjected(page)

    // Simulate TronLink re-injection: a brand-new identity, same network so the
    // pre-sign context guard (account/provider/network) still passes.
    await page.evaluate(() => {
      const w = window as any
      w.__signedBy = null
      w.tronWeb = w.__mkMock('B')
      w.tronLink = { ready: true, request: async () => [w.tronWeb.defaultAddress.base58], tronWeb: w.tronWeb }
    })

    await signMessage(page, 'wal-idle-1 probe')

    // With the fix, executionContext.web3() re-syncs to the live instance, so the
    // sign runs on B. Pre-fix it stays on the stale cached A.
    await expect.poll(async () => page.evaluate(() => (window as any).__signedBy), { timeout: 15_000 }).toBe('B')
  })
})
