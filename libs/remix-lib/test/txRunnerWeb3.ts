'use strict'
import tape from 'tape'
import { TxRunnerWeb3 } from '../src/execution/txRunnerWeb3'
import { WALLET_ERROR_CODES, withWalletTimeout } from '../src/execution/walletProviderAdapter'

type TronRunResult = {
  error: any
  result: any
}

function runInTronWithStub (tronWebOverrides, argsOverrides = {}): Promise<TronRunResult> {
  // Destructure first so overrides for top-level keys (defaultAddress, etc.) win without
  // clobbering the merged transactionBuilder/trx defaults below.
  const {
    transactionBuilder: tbOverride = {},
    trx: trxOverride = {},
    defaultAddress: defaultAddressOverride,
    ...restOverrides
  } = tronWebOverrides

  const tronWeb = {
    ...restOverrides,
    transactionBuilder: {
      triggerSmartContract: async () => ({
        result: { result: true }
      }),
      createSmartContract: async () => ({
        result: true,
        transaction: {}
      }),
      ...tbOverride
    },
    trx: {
      sign: async () => ({}),
      sendRawTransaction: async () => ({
        result: true,
        transaction: { txID: '0x123' }
      }),
      getUnconfirmedTransactionInfo: async () => ({
        id: '0x123',
        result: 'SUCCESS',
        blockNumber: 1,
        fee: 1,
        contract_address: '41' + '0'.repeat(40)
      }),
      ...trxOverride
    },
    fullNode: { host: 'https://nile.trongrid.io' },
    defaultAddress: defaultAddressOverride !== undefined
      ? defaultAddressOverride
      : { base58: 'TFromAddress' }
  }
  tronWeb.trx.tronWeb = tronWeb

  const runner = new TxRunnerWeb3(null, () => tronWeb as any, () => 0)
  const args = {
    from: 'TFromAddress',
    to: 'TContractAddress',
    data: '0x',
    value: '0',
    tokenId: '0x0',
    tokenValue: '0x0',
    gasLimit: '0x1',
    useCall: false,
    pendingTransactionSnapshot: { account: 'TFromAddress', network: 'https://nile.trongrid.io' },
    ...argsOverrides
  }

  return new Promise<TronRunResult>((resolve) => {
    runner.runInTron(
      args,
      null,
      (_err, continueCb) => continueCb(),
      null,
      (error, result) => resolve({ error, result })
    )
  })
}

tape('txRunnerWeb3 normalizes tron trc10 validation messages', function (t) {
  t.test('returns VM invalid argument wording when tokenId is 0 and tokenValue is positive', async function (st) {
    st.plan(1)

    const { error } = await runInTronWithStub({
      transactionBuilder: {
        triggerSmartContract: async () => {
          throw new Error('CONTRACT_VALIDATE_ERROR')
        }
      }
    }, {
      tokenId: '0x0',
      tokenValue: '0x1'
    })

    st.equal(error, 'invalid argument')
  })

  t.test('returns VM invalid argument wording when tokenId is below the TRC10 minimum', async function (st) {
    st.plan(1)

    const { error } = await runInTronWithStub({
      transactionBuilder: {
        triggerSmartContract: async () => ({
          result: {
            result: false,
            code: 'CONTRACT_VALIDATE_ERROR',
            message: 'contract validate error : invalid token id'
          }
        })
      }
    }, {
      tokenId: '0xf4240',
      tokenValue: '0x0'
    })

    st.equal(error, 'invalid argument')
  })

  t.test('returns VM no asset wording when tron validation exposes missing asset details', async function (st) {
    st.plan(1)

    const { error } = await runInTronWithStub({
      transactionBuilder: {
        triggerSmartContract: async () => ({
          result: {
            result: false,
            code: 'CONTRACT_VALIDATE_ERROR',
            message: 'assetBalance must be greater than 0.'
          }
        })
      }
    }, {
      tokenId: '0xf4241',
      tokenValue: '0x64'
    })

    st.equal(error, 'No asset')
  })

  t.test('keeps injected provider wording for non-trc10 provider errors', async function (st) {
    st.plan(1)

    const { error } = await runInTronWithStub({
      transactionBuilder: {
        triggerSmartContract: async () => {
          throw new Error('User rejected the request.')
        }
      }
    })

    st.equal(
      error,
      'Send transaction failed: Connection request was rejected. . if you use an injected provider, please check it is properly unlocked. '
    )
  })

  t.test('returns WALLET_DISCONNECTED before signing when injected wallet has disconnected', async function (st) {
    st.plan(2)

    let signCalled = false
    const { error } = await runInTronWithStub({
      defaultAddress: {},
      trx: {
        sign: async () => {
          signCalled = true
          return {}
        }
      }
    })

    st.equal(error.message, 'Wallet disconnected. Please reconnect TronLink.')
    st.equal(signCalled, false)
  })

  t.test('stub preserves trx defaults when only trx.sign is overridden', async function (st) {
    st.plan(2)

    // Regression: an earlier stub spread `...tronWebOverrides` after the merged
    // trx defaults, which silently dropped sendRawTransaction / getUnconfirmedTransactionInfo
    // when a test overrode any single trx method. The deploy then crashed before
    // returning. Lock that in.
    let signCalled = false
    const { error } = await runInTronWithStub({
      trx: {
        sign: async (transaction) => {
          signCalled = true
          return { ...transaction, signed: true }
        }
      }
    })

    st.equal(signCalled, true, 'overridden trx.sign was called')
    st.equal(error, null, 'default sendRawTransaction / getUnconfirmedTransactionInfo survived alongside the trx.sign override')
  })

  t.test('normalizes rejected wallet signatures before broadcasting', async function (st) {
    st.plan(2)

    let broadcastCalled = false
    const { error } = await runInTronWithStub({
      trx: {
        sign: async () => {
          throw new Error('sign transaction rejected by user')
        },
        sendRawTransaction: async () => {
          broadcastCalled = true
          return { result: true }
        }
      }
    })

    st.equal(
      error,
      'Send transaction failed: Transaction signature was rejected by the wallet. . if you use an injected provider, please check it is properly unlocked. '
    )
    st.equal(broadcastCalled, false)
  })

  t.test('normalizes wallet broadcast failures', async function (st) {
    st.plan(1)

    const { error } = await runInTronWithStub({
      trx: {
        sendRawTransaction: async () => {
          throw new Error('sendRawTransaction broadcast failed')
        }
      }
    })

    st.equal(
      error,
      'Send transaction failed: Transaction broadcast failed. Please verify the wallet network and try again. . if you use an injected provider, please check it is properly unlocked. '
    )
  })

  t.test('blocks stale pending signatures when account changes before signing', async function (st) {
    st.plan(2)

    let signCalled = false
    const { error } = await runInTronWithStub({
      defaultAddress: { base58: 'TOtherAccount' },
      trx: {
        sign: async () => {
          signCalled = true
          return {}
        }
      }
    })

    st.equal(
      error,
      'Send transaction failed: Wallet account changed. Please reconnect TronLink. . if you use an injected provider, please check it is properly unlocked. '
    )
    st.equal(signCalled, false)
  })

  t.test('blocks broadcast when account changes while wallet signature is pending', async function (st) {
    st.plan(2)

    let broadcastCalled = false
    const { error } = await runInTronWithStub({
      trx: {
        sign: async function (transaction) {
          this.tronWeb.defaultAddress.base58 = 'TOtherAccount'
          return { ...transaction, signature: ['0xsignature'] }
        },
        sendRawTransaction: async () => {
          broadcastCalled = true
          return { result: true }
        }
      }
    })

    st.equal(
      error,
      'Send transaction failed: Wallet account changed. Please reconnect TronLink. . if you use an injected provider, please check it is properly unlocked. '
    )
    st.equal(broadcastCalled, false)
  })
})

// Regression for the injected sign/broadcast hang: an injected TronLink call that
// never settles (a zombie bridge — extension disabled/removed but window.tronWeb
// lingers) must be bounded so it rejects with a timeout — which clears the stuck
// "pending…" and lets the user retry — while a normal, fast call is untouched.
tape('txRunnerWeb3.withWalletTimeout', function (t) {
  t.test('a fast operation resolves with its own value (no false timeout)', async function (st) {
    st.plan(1)
    const value = await withWalletTimeout(Promise.resolve('signed-tx'), 10_000, WALLET_ERROR_CODES.WALLET_SIGN_TIMEOUT)
    st.equal(value, 'signed-tx')
  })

  t.test('a never-settling operation rejects with the given timeout code', async function (st) {
    st.plan(1)
    try {
      await withWalletTimeout(new Promise(() => { /* never settles */ }), 10, WALLET_ERROR_CODES.WALLET_SIGN_TIMEOUT)
      st.fail('a wedged operation should reject, not hang')
    } catch (error) {
      st.equal((error as any).code, WALLET_ERROR_CODES.WALLET_SIGN_TIMEOUT)
    }
  })

  t.test('a rejecting operation propagates its own error (the timeout never masks it)', async function (st) {
    st.plan(1)
    try {
      await withWalletTimeout(Promise.reject(new Error('node says no')), 10_000, WALLET_ERROR_CODES.WALLET_BROADCAST_FAILED)
      st.fail('should have rejected with the operation error')
    } catch (error) {
      st.equal((error as any).message, 'node says no')
    }
  })
})
