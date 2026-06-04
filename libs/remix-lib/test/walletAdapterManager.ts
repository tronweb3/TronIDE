'use strict'
import tape from 'tape'
import { connectWalletAdapter, createWalletAdapterManagerState, detectWalletAdapters } from '../src/execution/walletAdapterManager'
import { WALLET_ERROR_CODES, WALLET_STATUS } from '../src/execution/walletProviderAdapter'

tape('walletAdapterManager detects TronLink and keeps other wallets behind flags', function (t) {
  t.plan(7)

  const state = createWalletAdapterManagerState({
    tronLink: { ready: true, request: async () => undefined },
    tronWeb: { defaultAddress: { base58: 'TAccount' }, trx: { sign: async () => ({}), sendRawTransaction: async () => ({}) } },
    okxwallet: { tronLink: { request: async () => undefined } },
    ethereum: { request: async () => undefined }
  })

  t.equal(state.active?.kind, 'tronlink')
  t.equal(state.active?.status, WALLET_STATUS.connected)
  t.equal(state.adapters.find((adapter) => adapter.kind === 'okx')?.enabled, true)
  t.equal(state.adapters.find((adapter) => adapter.kind === 'walletconnect')?.enabled, false)
  t.equal(state.adapters.find((adapter) => adapter.kind === 'metamask-tron')?.enabled, false)
  t.equal(state.adapters.find((adapter) => adapter.kind === 'tronlink')?.capabilities.sign, true)
  t.equal(detectWalletAdapters({}).length, 4)
})

tape('walletAdapterManager connects TronLink and rejects unsupported wallets', async function (t) {
  t.plan(3)

  const scope = {
    tronWeb: { defaultAddress: { base58: '' } },
    tronLink: {
      ready: false,
      request: async () => {
        scope.tronLink.ready = true
        scope.tronWeb.defaultAddress.base58 = 'TConnected'
      }
    }
  }

  t.deepEqual(await connectWalletAdapter('tronlink', scope), ['TConnected'])

  try {
    await connectWalletAdapter('walletconnect', {})
    t.fail('walletconnect should require feature flag implementation')
  } catch (error: any) {
    t.equal(error.code, WALLET_ERROR_CODES.WALLET_CAPABILITY_MISSING)
    t.equal(error.message.includes('unsupported'), true)
  }
})
