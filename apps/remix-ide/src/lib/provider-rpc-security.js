/*
 * Read-only JSON-RPC/full-node capabilities available to untrusted plugins.
 * A remembered permission for web3Provider.sendAsync is not authority to sign,
 * submit transactions, unlock accounts, or call node administration APIs.
 */

'use strict'

const readOnlyJsonRpcMethods = new Set([
  'web3_clientVersion',
  'net_version', 'net_listening', 'net_peerCount',
  'eth_chainId', 'eth_protocolVersion', 'eth_syncing', 'eth_coinbase',
  'eth_mining', 'eth_hashrate', 'eth_gasPrice', 'eth_accounts', 'eth_blockNumber',
  'eth_getBalance', 'eth_getStorageAt', 'eth_getTransactionCount', 'eth_getBlockTransactionCountByHash',
  'eth_getBlockTransactionCountByNumber', 'eth_getUncleCountByBlockHash', 'eth_getUncleCountByBlockNumber',
  'eth_getCode', 'eth_call', 'eth_estimateGas', 'eth_createAccessList',
  'eth_getBlockByHash', 'eth_getBlockByNumber', 'eth_getTransactionByHash',
  'eth_getTransactionByBlockHashAndIndex', 'eth_getTransactionByBlockNumberAndIndex',
  'eth_getTransactionReceipt', 'eth_getBlockReceipts', 'eth_getUncleByBlockHashAndIndex',
  'eth_getUncleByBlockNumberAndIndex', 'eth_getLogs', 'eth_feeHistory',
  'eth_maxPriorityFeePerGas', 'eth_getProof',
  'debug_traceTransaction', 'debug_traceCall', 'trace_transaction', 'trace_call'
])

const readOnlyTronWalletMethods = new Set([
  'wallet/getaccount', 'wallet/getaccountbyid', 'wallet/getaccountnet', 'wallet/getaccountresource',
  'wallet/getassetissuebyaccount', 'wallet/getassetissuebyid', 'wallet/getassetissuebyname',
  'wallet/getassetissuelist', 'wallet/getassetissuelistbyname', 'wallet/getpaginatedassetissuelist',
  'wallet/getblockbyid', 'wallet/getblockbynum', 'wallet/getblockbylatestnum', 'wallet/getblockbylimitnext',
  'wallet/getblock', 'wallet/getnowblock', 'wallet/gettransactionbyid', 'wallet/gettransactioninfobyid',
  'wallet/gettransactioncountbyblocknum', 'wallet/getcontract', 'wallet/getcontractinfo',
  'wallet/getdelegatedresource', 'wallet/getdelegatedresourceaccountindex',
  'wallet/getexchangebyid', 'wallet/listexchanges', 'wallet/getpaginatedexchangelist',
  'wallet/getproposalbyid', 'wallet/listproposals', 'wallet/getpaginatedproposallist',
  'wallet/listnodes', 'wallet/listwitnesses', 'wallet/getchainparameters', 'wallet/getnodeinfo',
  'wallet/getrewardinfo', 'wallet/getbrokerageinfo', 'wallet/getburntrx', 'wallet/getapprovedlist',
  'wallet/triggerconstantcontract', 'wallet/estimateenergy',
  'walletsolidity/getaccount', 'walletsolidity/getaccountbyid', 'walletsolidity/getaccountnet',
  'walletsolidity/getaccountresource', 'walletsolidity/getblockbyid', 'walletsolidity/getblockbynum',
  'walletsolidity/getblockbylatestnum', 'walletsolidity/getblockbylimitnext', 'walletsolidity/getnowblock',
  'walletsolidity/gettransactionbyid', 'walletsolidity/gettransactioninfobyid',
  'walletsolidity/gettransactioncountbyblocknum', 'walletsolidity/getcontract',
  'walletsolidity/getdelegatedresource', 'walletsolidity/getdelegatedresourceaccountindex',
  'walletsolidity/getexchangebyid', 'walletsolidity/listexchanges', 'walletsolidity/getproposalbyid',
  'walletsolidity/listproposals', 'walletsolidity/listwitnesses', 'walletsolidity/getrewardinfo',
  'walletsolidity/getbrokerageinfo', 'walletsolidity/triggerconstantcontract', 'walletsolidity/estimateenergy'
])

function normalizeProviderMethod (method) {
  return typeof method === 'string' ? method.trim().replace(/^\/+/, '') : ''
}

function isReadOnlyProviderMethod (method) {
  const normalized = normalizeProviderMethod(method)
  if (!normalized || normalized.length > 200) return false
  return readOnlyJsonRpcMethods.has(normalized) || readOnlyTronWalletMethods.has(normalized.toLowerCase())
}

function assertReadOnlyProviderRequest (payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !isReadOnlyProviderMethod(payload.method)) {
    throw new Error('External plugins may call only allowlisted read-only provider methods.')
  }
  return true
}

module.exports = {
  assertReadOnlyProviderRequest,
  isReadOnlyProviderMethod
}
