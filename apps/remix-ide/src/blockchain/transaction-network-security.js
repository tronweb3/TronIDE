/*
 * Network policy and provenance marker for plugin-initiated transactions.
 * The marker is a module-private Symbol so connector JSON cannot forge or
 * clear it by adding a similarly named property.
 */

'use strict'

const JS_VM_TRON = 'JavaScript VM (Tron)'
const ALLOWED_TRON_TEST_NETWORKS = new Set(['nile', 'shasta'])
const externalPluginTransactionMarker = Symbol('externalPluginTransaction')
const PLUGIN_TRANSACTION_NETWORK_ERROR = 'External plugin transactions are allowed only on JavaScript VM, Nile, or Shasta.'
const PLUGIN_TRANSACTION_NETWORK_VERIFICATION_ERROR = 'Could not verify the active network for an external plugin transaction.'

function isPluginTransactionNetworkAllowed (network) {
  if (!network || typeof network !== 'object') return false
  if (network.name === JS_VM_TRON && network.id === '-') return true
  return network.name === 'TRON' && ALLOWED_TRON_TEST_NETWORKS.has(network.id)
}

function markExternalPluginTransaction (value) {
  if (!value || typeof value !== 'object') throw new Error('A plugin transaction marker needs an object.')
  Object.defineProperty(value, externalPluginTransactionMarker, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false
  })
  return value
}

function isExternalPluginTransaction (value) {
  return Boolean(value && typeof value === 'object' && value[externalPluginTransactionMarker] === true)
}

function inheritExternalPluginTransaction (source, target) {
  if (isExternalPluginTransaction(source)) markExternalPluginTransaction(target)
  return target
}

function assertPluginTransactionNetworkAllowed (network) {
  if (!isPluginTransactionNetworkAllowed(network)) throw new Error(PLUGIN_TRANSACTION_NETWORK_ERROR)
  return network
}

function verifyPluginTransactionNetwork (detectNetwork) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, network) => {
      if (settled) return
      settled = true
      // ExecutionContext labels a cached fallback as stale while a failed/rate-
      // limited probe is in backoff. It is suitable for a status indicator but
      // not proof of the network on which an external transaction will land.
      if (error || (network && network.stale === true)) {
        return reject(new Error(PLUGIN_TRANSACTION_NETWORK_VERIFICATION_ERROR))
      }
      try {
        resolve(assertPluginTransactionNetworkAllowed(network))
      } catch (policyError) {
        reject(policyError)
      }
    }
    if (typeof detectNetwork !== 'function') return finish(new Error('Network detection is unavailable.'))
    try {
      const result = detectNetwork((error, network) => finish(error, network))
      // detectNetwork is callback-based in the IDE but implemented as an async
      // function. Consume an unexpected outer rejection as another fail-closed
      // probe error without racing a callback that already settled.
      if (result && typeof result.catch === 'function') result.catch((error) => finish(error))
    } catch (error) {
      finish(error)
    }
  })
}

async function guardPluginTransactionCommit (transaction, detectNetwork, commit) {
  if (typeof commit !== 'function') throw new Error('A plugin transaction commit needs an action.')
  if (!isExternalPluginTransaction(transaction)) return commit()
  const network = await verifyPluginTransactionNetwork(detectNetwork)
  return commit(network)
}

module.exports = {
  assertPluginTransactionNetworkAllowed,
  guardPluginTransactionCommit,
  inheritExternalPluginTransaction,
  isExternalPluginTransaction,
  isPluginTransactionNetworkAllowed,
  markExternalPluginTransaction,
  PLUGIN_TRANSACTION_NETWORK_ERROR,
  PLUGIN_TRANSACTION_NETWORK_VERIFICATION_ERROR,
  verifyPluginTransactionNetwork
}
