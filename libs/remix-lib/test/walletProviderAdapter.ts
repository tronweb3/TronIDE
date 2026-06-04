'use strict'
import tape from 'tape'
import {
  getInjectedWalletStatus,
  normalizeWalletError,
  requestInjectedWalletAccounts,
  WALLET_ERROR_CODES,
  WALLET_ERROR_MESSAGES,
  WALLET_STATUS
} from '../src/execution/walletProviderAdapter'

tape('walletProviderAdapter classifies injected TronLink status', function (t) {
  t.plan(4)

  t.equal(getInjectedWalletStatus({}), WALLET_STATUS.unavailable)
  t.equal(getInjectedWalletStatus({ tronLink: { ready: false }, tronWeb: { defaultAddress: {} } }), WALLET_STATUS.unauthorized)
  t.equal(getInjectedWalletStatus({ tronLink: { ready: true }, tronWeb: { defaultAddress: {} } }), WALLET_STATUS.locked)
  t.equal(getInjectedWalletStatus({ tronLink: { ready: true }, tronWeb: { defaultAddress: { base58: 'TAccount' } } }), WALLET_STATUS.connected)
})

tape('walletProviderAdapter normalizes provider errors for user-facing text', function (t) {
  t.plan(12)

  t.deepEqual(
    normalizeWalletError({ code: 4001, message: 'User rejected the request.' }),
    {
      code: WALLET_ERROR_CODES.WALLET_CONNECTION_REJECTED,
      message: WALLET_ERROR_MESSAGES.WALLET_CONNECTION_REJECTED,
      originalError: { code: 4001, message: 'User rejected the request.' }
    }
  )
  t.equal(normalizeWalletError(new Error('Wallet is locked')).message, WALLET_ERROR_MESSAGES.WALLET_LOCKED)
  t.equal(normalizeWalletError(new Error('Request timed out')).code, WALLET_ERROR_CODES.WALLET_REQUEST_TIMEOUT)
  t.equal(normalizeWalletError(new Error('accounts changed during request')).code, WALLET_ERROR_CODES.WALLET_ACCOUNT_CHANGED)
  t.equal(normalizeWalletError(new Error('wrong network selected')).code, WALLET_ERROR_CODES.WALLET_WRONG_NETWORK)
  t.equal(normalizeWalletError(new Error('chainChanged event received')).code, WALLET_ERROR_CODES.WALLET_NETWORK_CHANGED)
  t.equal(normalizeWalletError({ code: 4200, message: 'method is unsupported' }).code, WALLET_ERROR_CODES.WALLET_CAPABILITY_MISSING)
  t.equal(normalizeWalletError(new Error('invalid address format')).message, WALLET_ERROR_MESSAGES.WALLET_ADDRESS_INVALID)
  t.equal(normalizeWalletError(new Error('sign transaction rejected by user')).code, WALLET_ERROR_CODES.WALLET_SIGN_REJECTED)
  t.equal(normalizeWalletError(new Error('sign transaction timed out')).code, WALLET_ERROR_CODES.WALLET_SIGN_TIMEOUT)
  t.equal(normalizeWalletError(new Error('sendRawTransaction broadcast failed')).code, WALLET_ERROR_CODES.WALLET_BROADCAST_FAILED)
  t.equal(normalizeWalletError({ foo: 'bar' }).message, '{"foo":"bar"}')
})

tape('walletProviderAdapter guards duplicate connect requests', async function (t) {
  t.plan(3)

  let requestCount = 0
  const scope = {
    tronWeb: { defaultAddress: { base58: '' } },
    tronLink: {
      ready: false,
      request: async () => {
        requestCount++
        await new Promise((resolve) => setTimeout(resolve, 10))
        scope.tronLink.ready = true
        scope.tronWeb.defaultAddress.base58 = 'TConnected'
      }
    }
  }

  const [first, second] = await Promise.all([
    requestInjectedWalletAccounts(scope),
    requestInjectedWalletAccounts(scope)
  ])

  t.equal(requestCount, 1)
  t.deepEqual(first, ['TConnected'])
  t.deepEqual(second, ['TConnected'])
})
