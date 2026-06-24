/*
 * Original work Copyright © 2018-2021 Remix Team
 * Licensed under the MIT License.
 *
 * Modifications Copyright © 2022 TronIDE
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Plugin } from '@remixproject/engine'
import { BN } from 'ethereumjs-util'
import * as remixLib from '@remix-project/remix-lib'
import * as packageJson from '../../../../../package.json'

export const profile = {
  name: 'web3Provider',
  displayName: 'Global Web3 Provider',
  description: 'Represent the current web3 provider used by the app at global scope',
  methods: ['sendAsync'],
  version: packageJson.version,
  kind: 'provider'
}

export class Web3ProviderModule extends Plugin {
  constructor (blockchain) {
    super(profile)
    this.blockchain = blockchain
  }

  async sendTronWebRequest (tronWeb, payload) {
    const request = async (endpoint, params = {}) => tronWeb.fullNode.request(endpoint, params, 'post')
    const params = payload.params || []

    switch (payload.method) {
      case 'net_version':
        return this.jsonRpcResult(payload, 'tron')
      case 'eth_getTransactionReceipt':
        return this.jsonRpcResult(payload, this.toWeb3Receipt(await request('wallet/gettransactioninfobyid', { value: this.normalizeTxHash(params[0]) }), params[0]))
      case 'eth_getTransactionByHash':
        return this.jsonRpcResult(payload, this.toWeb3Tx(await request('wallet/gettransactionbyid', { value: this.normalizeTxHash(params[0]) }), params[0]))
      case 'eth_getCode':
        return this.jsonRpcResult(payload, this.toWeb3Code(await request('wallet/getcontract', { value: this.toBase58Address(params[0]) })))
      case 'debug_traceTransaction':
        throw new Error('Injected TronWeb provider does not expose debug_traceTransaction. Debugging on-chain transactions requires a TRON debug-capable provider.')
      default:
        return this.jsonRpcResult(payload, await request(payload.method, params[0] || {}))
    }
  }

  normalizeTxHash (hash) {
    return typeof hash === 'string' ? hash.replace(/^0x/, '') : hash
  }

  toBase58Address (address) {
    return typeof address === 'string' && address.startsWith('0x') ? remixLib.util.addressToBase58(address) : address
  }

  toHexAddress (address) {
    if (typeof address !== 'string') return address
    // A base58 (T...) address needs a real decode; 41.../0x... only swap the
    // prefix. Only the base58 branch is new — the 41/0x/other paths are unchanged.
    if (address.startsWith('T')) {
      try { return remixLib.util.addressToHex(address) } catch (error) { return address }
    }
    return address.replace(/^(41)/, '0x')
  }

  toWeb3Code (contract) {
    return contract?.bytecode ? `0x${contract.bytecode.replace(/^0x/, '')}` : '0x'
  }

  formatTronValueHex (value) {
    return `0x${new BN(String(value || 0), 10).toString(16)}`
  }

  toWeb3Receipt (transactionInfo, hash) {
    if (!transactionInfo || !transactionInfo.id) return null

    return {
      blockNumber: transactionInfo.blockNumber,
      contractAddress: this.toHexAddress(transactionInfo.contract_address),
      gasUsed: transactionInfo.fee || transactionInfo.receipt?.energy_usage_total || 0,
      logs: transactionInfo.log || [],
      status: transactionInfo.receipt?.result !== 'FAILED',
      transactionHash: hash
    }
  }

  /**
   * Convert TRON `wallet/gettransactionbyid` shape to a Web3-formatted tx so
   * web3-eth's outputTransactionFormatter doesn't choke on undefined fields
   * (e.g. "[number-to-bn] while converting number undefined" when feeding the
   * raw shape into the EVM debugger). Numeric fields default to '0x0' so BN
   * conversion succeeds; the call still terminates at debug_traceTransaction
   * with the user-facing "not exposed" error.
   */
  toWeb3Tx (transactionByHash, hash) {
    if (!transactionByHash || !transactionByHash.txID) return null
    const contract = transactionByHash.raw_data && Array.isArray(transactionByHash.raw_data.contract)
      ? transactionByHash.raw_data.contract[0]
      : null
    const value = (contract && contract.parameter && contract.parameter.value) || {}
    const callValue = value.call_value || value.amount || 0
    const dataHex = value.data ? `0x${value.data.replace(/^0x/, '')}` : '0x'
    const requestedHash = typeof hash === 'string' && hash.length ? hash : transactionByHash.txID
    return {
      blockHash: null,
      blockNumber: null,
      from: this.toHexAddress(value.owner_address),
      gas: '0x0',
      gasPrice: '0x0',
      hash: requestedHash.startsWith('0x') ? requestedHash : `0x${requestedHash}`,
      input: dataHex,
      nonce: '0x0',
      to: this.toHexAddress(value.contract_address || value.to_address),
      transactionIndex: null,
      value: this.formatTronValueHex(callValue)
    }
  }

  jsonRpcResult (payload, result) {
    return {
      jsonrpc: payload.jsonrpc || '2.0',
      id: payload.id,
      result
    }
  }

  /*
    that is used by plugins to call the current ethereum provider.
    Should be taken carefully and probably not be release as it is now.
  */
  sendAsync (payload) {
    return new Promise((resolve, reject) => {
      const web3 = this.blockchain.web3()
      const provider = web3.currentProvider

      if (!provider || (!provider.sendAsync && !provider.send)) {
        if (web3.fullNode?.request) {
          return this.sendTronWebRequest(web3, payload).then(resolve).catch(reject)
        }
        return reject(new Error('Current provider does not expose send/sendAsync or TronWeb fullNode.request'))
      }

      // see https://github.com/ethereum/web3.js/pull/1018/files#diff-d25786686c1053b786cc2626dc6e048675050593c0ebaafbf0814e1996f22022R129
      provider[provider.sendAsync ? 'sendAsync' : 'send'](payload, (error, message) => {
        if (error) return reject(error)
        resolve(message)
      })
    })
  }
}
