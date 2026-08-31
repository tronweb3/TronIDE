import { test, expect, Page } from '@playwright/test'
import { dismissWelcomeModal, ensureFilePanel, useBuiltinCompiler } from './helpers'

// Browser-level regression for the injected transaction status path. The
// provider below is entirely in-page: trx.getUnconfirmedTransactionInfo
// delegates to the mocked FullNode `wallet/gettransactioninfobyid` RPC and no
// real wallet or remote node is contacted. Keeping the RPC response behind a
// test-controlled release gate lets the assertions observe the real UI
// transition from the terminal's "pending" message to the transaction logger's
// confirmed success/failure icon.

const NILE_GENESIS = '0000000000000000d698d4192c56cb6be724a558448e2684802de4d6cd8690dc'
const ACCOUNT = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'
const SUCCESS_TX = '1'.repeat(64)
const FAILED_TX = '2'.repeat(64)

const MOCK_FULLNODE = `
(() => {
  const txIds = ['${SUCCESS_TX}', '${FAILED_TX}']
  const contractAddresses = ['41${'1'.repeat(40)}', '41${'2'.repeat(40)}']
  const state = {
    broadcasts: 0,
    released: Object.create(null),
    statusRpcCalls: Object.create(null),
    rpcPaths: [],
    release (txId, result) { this.released[txId] = result },
    statusCalls (txId) { return this.statusRpcCalls[txId] || 0 }
  }
  window.__fullNodeStatusFixture = state

  const fullNode = {
    host: 'https://nile.trongrid.io',
    headers: {},
    request: async (path, payload) => {
      state.rpcPaths.push(path)
      if (path === 'wallet/gettransactioninfobyid') {
        const txId = String((payload && (payload.value || payload.txID)) || '').replace(/^0x/, '')
        state.statusRpcCalls[txId] = (state.statusRpcCalls[txId] || 0) + 1
        const result = state.released[txId]
        if (!result) return {}
        const index = txIds.indexOf(txId)
        return {
          id: txId,
          blockNumber: 7000 + index,
          fee: 123,
          contract_address: contractAddresses[index],
          contractResult: [''],
          receipt: { result }
        }
      }
      if (path === 'wallet/getcontractinfo') return {}
      return {}
    }
  }

  const trx = new Proxy({
    getBlock: async () => ({ blockID: '${NILE_GENESIS}', block_header: { raw_data: {} } }),
    getCurrentBlock: async () => ({ blockID: '${NILE_GENESIS}', block_header: { raw_data: { number: 7000, timestamp: 1 } } }),
    getBalance: async () => 10_000_000,
    getAccount: async () => ({ balance: 10_000_000 }),
    getNodeInfo: async () => ({}),
    sign: async (transaction) => ({ ...transaction, signature: ['mock-signature'] }),
    sendRawTransaction: async (transaction) => {
      const index = state.broadcasts++
      return {
        result: true,
        transaction: {
          ...transaction,
          txID: txIds[index],
          contract_address: contractAddresses[index]
        }
      }
    },
    // TronWeb's helper is the product-facing FullNode status API. Delegate to
    // request() so the test can prove which RPC endpoint drove the DOM state.
    getUnconfirmedTransactionInfo: async (txId) =>
      fullNode.request('wallet/gettransactioninfobyid', { value: txId })
  }, { get (target, property) { return property in target ? target[property] : (async () => undefined) } })

  window.tronWeb = new Proxy({
    ready: true,
    defaultAddress: {
      base58: '${ACCOUNT}',
      hex: '410000000000000000000000000000000000000000'
    },
    fullNode,
    solidityNode: { host: fullNode.host },
    eventServer: { host: fullNode.host },
    setHeader: () => {},
    trx,
    transactionBuilder: new Proxy({
      createSmartContract: async () => ({ raw_data: {}, visible: true }),
      triggerSmartContract: async () => ({ result: { result: true }, transaction: { raw_data: {} } })
    }, { get (target, property) { return property in target ? target[property] : (async () => undefined) } }),
    address: {
      toHex: (address) => address,
      fromHex: (address) => address,
      fromPrivateKey: () => '${ACCOUNT}'
    },
    contract: () => ({ at: async () => ({}) }),
    isAddress: () => true
  }, { get (target, property) { return property in target ? target[property] : (() => undefined) } })
  trx.tronWeb = window.tronWeb
  window.tronLink = {
    ready: true,
    tronWeb: window.tronWeb,
    request: async () => [window.tronWeb.defaultAddress.base58],
    on: () => {},
    removeListener: () => {}
  }
})()
`

async function compileStorageOnInjected (page: Page) {
  // Bind the injected provider before spending time in solc. This mirrors the
  // real flow (connect wallet, then compile/deploy) and prevents a background
  // VM refresh from winning the initial environment switch.
  await page.locator('#icon-panel div[plugin="udapp"]').click()
  const environment = page.locator('#selectExEnvOptions')
  await environment.waitFor({ state: 'visible', timeout: 15_000 })
  if (await environment.inputValue() !== 'injected') await environment.selectOption('injected')
  await expect(environment).toHaveValue('injected')
  await expect.poll(() => page.locator('#txorigin option').count(), { timeout: 15_000 }).toBeGreaterThan(0)

  await ensureFilePanel(page)
  const storage = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
  if (!await storage.isVisible().catch(() => false)) {
    await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
  }
  await storage.click()

  await page.locator('#icon-panel div[plugin="solidity"]').click()
  await useBuiltinCompiler(page)
  await page.locator('[data-id="compilerContainerCompileBtn"]').click()
  await expect(page.locator('[data-id="compiledContracts"]')).toContainText('Storage', { timeout: 60_000 })

  await page.locator('#icon-panel div[plugin="udapp"]').click()
  await expect(environment).toHaveValue('injected')

  // Reproduce TronLink's normal post-startup re-injection once udapp is active.
  // Besides matching the real extension lifecycle, the new provider identity
  // invalidates any network probe attempted while the plugin was still
  // activating, so the transaction begins with fresh genesis evidence.
  await page.evaluate(() => {
    const scope = window as any
    const current = scope.tronWeb
    const next = new Proxy({ ...current }, {
      get (target, property) { return property in target ? (target as any)[property] : (() => undefined) }
    })
    current.trx.tronWeb = next
    scope.tronWeb = next
    scope.tronLink = { ...scope.tronLink, tronWeb: next }
  })
}

async function deployAndHoldPending (page: Page, txId: string) {
  const groups = page.locator('[data-id="transactionAttemptGroup"]')
  const before = await groups.count()
  await page.locator('#runTabView button').filter({ hasText: /^Deploy$/ }).first().click()

  const attempt = groups.nth(before)
  await expect(groups).toHaveCount(before + 1, { timeout: 15_000 })
  await expect(attempt).toHaveAttribute('data-status', 'pending')
  await expect(attempt).toContainText('creation of Storage')
  await expect(attempt).toContainText('Waiting for TronLink approval')

  // The first empty FullNode response must leave the transaction unresolved,
  // proving the pending assertion is not just a transient pre-broadcast label.
  await expect.poll(
    () => page.evaluate((id) => (window as any).__fullNodeStatusFixture.statusCalls(id), txId),
    { timeout: 15_000 }
  ).toBeGreaterThan(0)
  await expect(page.locator(`#tx0x${txId}`)).toHaveCount(0)
  return attempt
}

async function releaseStatus (page: Page, txId: string, status: 'SUCCESS' | 'FAILED') {
  await page.evaluate(({ id, result }) => {
    (window as any).__fullNodeStatusFixture.release(id, result)
  }, { id: txId, result: status })
}

test.describe('Injected transaction status — mocked FullNode', () => {
  test('pending transactions settle to confirmed success and confirmed failure in the DOM', { tag: '@gate' }, async ({ page }) => {
    test.setTimeout(90_000)
    await page.addInitScript(MOCK_FULLNODE)
    await page.goto('/')
    await dismissWelcomeModal(page)
    await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
    await compileStorageOnInjected(page)

    const successAttempt = await deployAndHoldPending(page, SUCCESS_TX)
    await releaseStatus(page, SUCCESS_TX, 'SUCCESS')
    const success = page.locator(`#tx0x${SUCCESS_TX}`)
    await expect(success).toBeVisible({ timeout: 20_000 })
    // Font Awesome can resolve its pseudo-element a frame after the tx row is
    // painted, which gives the otherwise-correct <i> a transient zero-size box.
    // The logger's status contract is the semantic icon/class rendered in the
    // visible row, not the glyph font's load timing.
    await expect(success.locator('.fa-check-circle')).toHaveClass(/succeeded/)
    await expect(successAttempt).toHaveAttribute('data-status', 'success', { timeout: 20_000 })
    await expect.poll(
      () => page.evaluate(() => (window as any).__tronideLastDeployment?.contractAddress || ''),
      { timeout: 10_000 }
    ).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/)
    const deployment = await page.evaluate(() => (window as any).__tronideLastDeployment)
    expect(deployment.provider).toBe('injected')
    expect(deployment.networkId).toBe('nile')
    expect(deployment.network).toMatch(/Nile/i)

    const failedAttempt = await deployAndHoldPending(page, FAILED_TX)
    await releaseStatus(page, FAILED_TX, 'FAILED')
    const failed = page.locator(`#tx0x${FAILED_TX}`)
    await expect(failed).toBeVisible({ timeout: 20_000 })
    await expect(failed.locator('.fa-times-circle')).toHaveClass(/failed/)
    await expect(failedAttempt).toHaveAttribute('data-status', 'error', { timeout: 20_000 })

    const statusRpc = await page.evaluate(([successTx, failedTx]) => ({
      success: (window as any).__fullNodeStatusFixture.statusCalls(successTx),
      failed: (window as any).__fullNodeStatusFixture.statusCalls(failedTx),
      paths: (window as any).__fullNodeStatusFixture.rpcPaths
    }), [SUCCESS_TX, FAILED_TX])
    expect(statusRpc.success).toBeGreaterThanOrEqual(2)
    expect(statusRpc.failed).toBeGreaterThanOrEqual(2)
    expect(statusRpc.paths).toContain('wallet/gettransactioninfobyid')
  })
})
