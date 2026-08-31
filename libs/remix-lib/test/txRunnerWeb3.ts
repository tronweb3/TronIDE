'use strict'
import tape from 'tape'
import { TxRunnerWeb3 } from '../src/execution/txRunnerWeb3'
import { WALLET_ERROR_CODES, withWalletTimeout } from '../src/execution/walletProviderAdapter'

type TronRunResult = {
  error: any
  result: any
}

function runInTronWithStub (tronWebOverrides, argsOverrides = {}, apiOverrides = {}, runnerOverrides = {}): Promise<TronRunResult> {
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

  const api = {
    detectNetwork: (callback) => callback(null, { name: 'TRON', id: 'nile' }),
    ...apiOverrides
  }
  const getTronWeb = (runnerOverrides as any).getTronWeb
    ? () => (runnerOverrides as any).getTronWeb(tronWeb)
    : () => tronWeb as any
  const runner = new TxRunnerWeb3(api, getTronWeb, () => 0)
  const args = {
    from: 'TFromAddress',
    to: 'TContractAddress',
    data: '0x',
    value: '0',
    tokenId: '0x0',
    tokenValue: '0x0',
    gasLimit: '0x1',
    useCall: false,
    pendingTransactionSnapshot: { account: 'TFromAddress', network: 'TRON/nile' },
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
  t.test('rejects unsafe injected call values before TronWeb builders run', async function (st) {
    st.plan(2)

    let builderCalled = false
    const { error } = await runInTronWithStub({
      transactionBuilder: {
        triggerSmartContract: async () => {
          builderCalled = true
          return { result: { result: true } }
        }
      }
    }, { value: '9007199254740993' })

    st.ok(error && /Transaction value exceeds safe integer range/.test(error.message || String(error)), 'unsafe value is rejected with an actionable precision error')
    st.equal(builderCalled, false, 'unsafe value never reaches the injected TronWeb builder')
  })

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

    st.equal(error.message, 'TronLink disconnected. Reconnect to continue.')
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
      'Send transaction failed: Transaction broadcast failed. Check the wallet network and try again. . if you use an injected provider, please check it is properly unlocked. '
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
      'Send transaction failed: TronLink account changed. Reconnect to continue. . if you use an injected provider, please check it is properly unlocked. '
    )
    st.equal(signCalled, false)
  })

  t.test('fails closed before building when network detection returns stale Nile cache', async function (st) {
    st.plan(3)

    let builderCalled = false
    const { error } = await runInTronWithStub({
      transactionBuilder: {
        triggerSmartContract: async () => {
          builderCalled = true
          return { result: { result: true }, transaction: {} }
        }
      }
    }, {}, {
      // Equivalent to Nile being cached during detector backoff after the
      // wallet has switched nodes: a stale allowlisted label is not proof that
      // the transaction will still land on Nile.
      detectNetwork: (callback) => callback(null, { name: 'TRON', id: 'nile', stale: true })
    })

    st.ok(error && /Wallet network could not be verified/.test(error), 'stale cache reports a clear verification error')
    st.equal(builderCalled, false, 'no transaction is built from stale network evidence')
    st.notOk(/Wallet network changed/.test(error), 'the message distinguishes an unverifiable network from a verified switch')
  })

  t.test('fails closed when the wallet account changes during network detection', async function (st) {
    st.plan(2)

    const defaultAddress = { base58: 'TFromAddress' }
    let builderCalled = false
    const { error } = await runInTronWithStub({
      defaultAddress,
      transactionBuilder: {
        triggerSmartContract: async () => {
          builderCalled = true
          return { result: { result: true }, transaction: {} }
        }
      }
    }, {}, {
      detectNetwork: (callback) => {
        defaultAddress.base58 = 'TOtherAccount'
        callback(null, { name: 'TRON', id: 'nile' })
      }
    })

    st.ok(error && /TronLink account changed/.test(error), 'account drift during the async probe is rejected')
    st.equal(builderCalled, false, 'account drift is rejected before a transaction is built')
  })

  t.test('accepts a confirmed contract call receipt without contract_address', async function (st) {
    st.plan(2)

    let observed = null
    const { error, result } = await runInTronWithStub({
      trx: {
        getUnconfirmedTransactionInfo: async () => ({
          id: '0x123',
          blockNumber: 12,
          receipt: { result: 'SUCCESS' }
        })
      }
    })

    observed = result
    st.equal(error, null, 'a normal contract call does not require contract_address')
    st.equal(observed.receipt.contractAddress, null, 'missing contract_address remains explicit for a call')
  })

  t.test('rejects a nested TRON failed receipt instead of reporting success', async function (st) {
    st.plan(2)

    const { error, result } = await runInTronWithStub({
      trx: {
        getUnconfirmedTransactionInfo: async () => ({
          id: '0x123',
          blockNumber: 12,
          receipt: { result: 'FAILED' }
        })
      }
    })

    st.equal(error, 'FAILED', 'receipt.result drives the final transaction error')
    st.equal(result.receipt.status, false, 'the failed receipt is retained for transaction logging')
  })

  t.test('keeps fresh custom-network transactions available to the native UI', async function (st) {
    st.plan(1)

    const { error } = await runInTronWithStub({}, {
      pendingTransactionSnapshot: { account: 'TFromAddress', network: 'Custom/Unknown' }
    }, {
      detectNetwork: (callback) => callback(null, { name: 'Custom', id: 'Unknown' })
    })

    st.equal(error, null, 'a fresh custom network uses its full-node endpoint as the stable fingerprint')
  })

  t.test('fails closed before signing when the builder outlives a switch to an unknown network', async function (st) {
    st.plan(4)

    let probes = 0
    let builderCalled = false
    let signCalled = false
    const { error } = await runInTronWithStub({
      transactionBuilder: {
        triggerSmartContract: async () => {
          builderCalled = true
          return { result: { result: true }, transaction: {} }
        }
      },
      trx: {
        sign: async () => {
          signCalled = true
          return {}
        }
      }
    }, {}, {
      detectNetwork: (callback) => {
        probes++
        callback(null, probes === 1
          ? { name: 'TRON', id: 'nile' }
          : { name: 'Unknown', id: 'Unknown' })
      }
    })

    st.equal(builderCalled, true, 'the builder ran under the verified initial network')
    st.equal(probes, 2, 'network is checked again after the async builder')
    st.ok(error && /Wallet network could not be verified/.test(error), 'unknown network is reported as unverifiable')
    st.equal(signCalled, false, 'an unknown post-build network never opens a signing request')
  })

  t.test('fails closed when TronLink replaces the injected provider during the builder request', async function (st) {
    st.plan(2)

    let providerReads = 0
    let signCalled = false
    const { error } = await runInTronWithStub({
      trx: {
        sign: async () => {
          signCalled = true
          return {}
        }
      }
    }, {}, {}, {
      getTronWeb: (original) => {
        providerReads++
        return providerReads < 3 ? original : { ...original }
      }
    })

    st.ok(error && /Wallet provider changed/.test(error), 'provider identity drift has an actionable error')
    st.equal(signCalled, false, 'a transaction built by the replaced provider is never signed')
  })

  t.test('fails closed before broadcast when the post-sign network probe errors', async function (st) {
    st.plan(4)

    let probes = 0
    let signCalled = false
    let broadcastCalled = false
    const { error } = await runInTronWithStub({
      trx: {
        sign: async (transaction) => {
          signCalled = true
          return { ...transaction, signature: ['0xsignature'] }
        },
        sendRawTransaction: async () => {
          broadcastCalled = true
          return { result: true }
        }
      }
    }, {}, {
      detectNetwork: (callback) => {
        probes++
        if (probes < 3) callback(null, { name: 'TRON', id: 'nile' })
        else callback(new Error('genesis probe failed'), { name: 'TRON', id: 'nile', stale: true })
      }
    })

    st.equal(signCalled, true, 'the transaction was signed only after two fresh checks')
    st.equal(probes, 3, 'network is checked again after signing')
    st.ok(error && /Wallet network could not be verified/.test(error), 'the callback probe error is preserved as a verification failure')
    st.equal(broadcastCalled, false, 'a signed transaction is not broadcast without fresh network proof')
  })

  t.test('does not sign a contract call when the account changes while triggerSmartContract is pending', async function (st) {
    st.plan(2)

    const defaultAddress = { base58: 'TFromAddress' }
    let signCalled = false
    const { error } = await runInTronWithStub({
      defaultAddress,
      transactionBuilder: {
        triggerSmartContract: async () => {
          await Promise.resolve()
          defaultAddress.base58 = 'TOtherAccount'
          return { result: { result: true }, transaction: {} }
        }
      },
      trx: {
        sign: async () => {
          signCalled = true
          return {}
        }
      }
    })

    st.equal(
      error,
      'Send transaction failed: TronLink account changed. Reconnect to continue. . if you use an injected provider, please check it is properly unlocked. '
    )
    st.equal(signCalled, false, 'stale builder result never opens a signature request')
  })

  t.test('does not sign a deployment when the account changes while createSmartContract is pending', async function (st) {
    st.plan(2)

    const defaultAddress = { base58: 'TFromAddress' }
    let signCalled = false
    const { error } = await runInTronWithStub({
      defaultAddress,
      transactionBuilder: {
        createSmartContract: async () => {
          await Promise.resolve()
          defaultAddress.base58 = 'TOtherAccount'
          return { result: true, transaction: {} }
        }
      },
      trx: {
        sign: async () => {
          signCalled = true
          return {}
        }
      }
    }, {
      to: null
    })

    st.equal(
      error,
      'Send transaction failed: TronLink account changed. Reconnect to continue. . if you use an injected provider, please check it is properly unlocked. '
    )
    st.equal(signCalled, false, 'stale deployment builder result never opens a signature request')
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
      'Send transaction failed: TronLink account changed. Reconnect to continue. . if you use an injected provider, please check it is properly unlocked. '
    )
    st.equal(broadcastCalled, false)
  })

  t.test('fails closed before building when an AI transaction is cancelled', async function (st) {
    st.plan(3)

    let builderCalled = false
    let signCalled = false
    const { error } = await runInTronWithStub({
      transactionBuilder: {
        triggerSmartContract: async () => {
          builderCalled = true
          return { result: { result: true }, transaction: {} }
        }
      },
      trx: {
        sign: async () => {
          signCalled = true
          return {}
        }
      }
    }, {
      cancelState: { isCancelled: () => true }
    })

    st.equal(error && error.message, 'Transaction stopped before signing or broadcast.')
    st.equal(builderCalled, false, 'cancelled work does not call the transaction builder')
    st.equal(signCalled, false, 'cancelled work does not open the wallet signature prompt')
  })

  t.test('does not broadcast a signed AI transaction after cancellation', async function (st) {
    st.plan(3)

    const cancelState = { cancelled: false, isCancelled () { return this.cancelled } }
    let broadcastCalled = false
    const { error } = await runInTronWithStub({
      trx: {
        sign: async (transaction) => {
          cancelState.cancelled = true
          return { ...transaction, signature: ['0xsignature'] }
        },
        sendRawTransaction: async () => {
          broadcastCalled = true
          return { result: true }
        }
      }
    }, { cancelState })

    st.equal(error, 'Send transaction failed: Transaction stopped before signing or broadcast. . if you use an injected provider, please check it is properly unlocked. ')
    st.equal(broadcastCalled, false, 'cancellation after signing prevents broadcast')
    st.equal(cancelState.cancelled, true, 'the test models cancellation while sign is pending')
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
