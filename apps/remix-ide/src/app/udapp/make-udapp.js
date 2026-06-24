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

var registry = require('../../global/registry')
var remixLib = require('@remix-project/remix-lib')
var yo = require('yo-yo')
var EventsDecoder = remixLib.execution.EventsDecoder

const transactionDetailsLinks = {
  TRON: {
    main: 'https://tronscan.org/#/transaction/',
    shasta: 'https://shasta.tronscan.org/#/transaction/',
    nile: 'https://nile.tronscan.org/#/transaction/'
  },
  Main: 'https://www.etherscan.io/tx/',
  Rinkeby: 'https://rinkeby.etherscan.io/tx/',
  Ropsten: 'https://ropsten.etherscan.io/tx/',
  Kovan: 'https://kovan.etherscan.io/tx/',
  Goerli: 'https://goerli.etherscan.io/tx/'
}

function txDetailsLink (network, hash) {
  if (transactionDetailsLinks[network]) {
    return transactionDetailsLinks[network] + hash
  } else {
    if (transactionDetailsLinks.TRON[network]) {
      return transactionDetailsLinks.TRON[network] + hash
    }
  }
}

export function makeUdapp (blockchain, compilersArtefacts, logHtmlCallback) {
  // ----------------- UniversalDApp -----------------
  // TODO: to remove when possible
  blockchain.event.register('transactionBroadcasted', (txhash, networkName) => {
    var txLink = txDetailsLink(networkName, txhash)
    if (txLink && logHtmlCallback) logHtmlCallback(yo`<a href="${txLink}" target="_blank" rel="noopener noreferrer">${txLink}</a>`)
  })

  // ----------------- Tx listener -----------------
  const _transactionReceipts = {}
  // A freshly broadcast contract-creation tx is often not yet populated in
  // getUnconfirmedTransactionInfo (no contract_address / blockNumber). Poll a
  // few times with a bounded budget so the receipt resolves instead of throwing
  // a TypeError on `undefined.replace(...)`. Mirrors the budget/interval shape of
  // tryTillTxAvailableTron in txRunnerWeb3, but with a short wall-clock cap since
  // this only fills in receipt details for an already-confirmed broadcast.
  const TRON_INFO_BUDGET_MS = 8000
  const TRON_INFO_INTERVAL_MS = 500
  const fetchTronTxInfo = async (txHash, needsContractAddress) => {
    const start = Date.now()
    let lastInfo = null
    while (Date.now() - start < TRON_INFO_BUDGET_MS) {
      const info = await blockchain.web3().trx.getUnconfirmedTransactionInfo(txHash)
      if (info && Object.keys(info).length) {
        lastInfo = info
        // A creation tx is only fully resolvable once contract_address is set, so
        // keep polling for it (blockNumber can appear first). A non-creation tx
        // has no contract_address, so the first populated info (blockNumber) is enough.
        if (info.contract_address || (!needsContractAddress && info.blockNumber)) return info
      }
      await new Promise((resolve) => setTimeout(resolve, TRON_INFO_INTERVAL_MS))
    }
    return lastInfo
  }
  const transactionReceiptResolver = async (tx, cb) => {
    if (_transactionReceipts[tx.hash]) {
      return cb(null, _transactionReceipts[tx.hash])
    }
    if (!blockchain.executionContext.isVM()) {
      try {
        // A creation tx carries the deployed address on `tx.contractAddress`; for
        // those we must wait for (or fall back to) a real address.
        const needsContractAddress = !!tx.contractAddress
        const txn = (await fetchTronTxInfo(tx.hash, needsContractAddress)) || {}
        const { blockNumber, fee, log = [], contractResult = [] } = txn
        // Defend against an unconfirmed/not-yet-populated creation tx where
        // contract_address is still undefined: fall back to the address already
        // known from the deploy result rather than calling .replace() on undefined.
        let contractAddress
        if (txn.contract_address) {
          contractAddress = txn.contract_address.replace(/^(41)/, '0x')
        } else if (tx.contractAddress) {
          contractAddress = remixLib.util.addressToHex
            ? remixLib.util.addressToHex(tx.contractAddress)
            : tx.contractAddress
        }

        remixLib.util.tConvertLogs(log)
        const receipt = {
          blockNumber,
          contractAddress,
          gasUsed: fee,
          logs: log,
          status: true,
          transactionHash: tx.hash
        }
        tx.returnValue = contractResult.length ? `0x${contractResult[0]}` : ''

        // Only memoize a fully-resolved receipt. Caching a creation receipt whose
        // contractAddress is still undefined would pin the deployed contract under
        // `undefined` in TxListener and block the retry that resolves the address.
        if (!needsContractAddress || contractAddress) {
          _transactionReceipts[tx.hash] = receipt
        }
        cb(null, receipt)
        return
      } catch (error) {
        cb(error)
      }
      return
    }

    blockchain.web3().eth.getTransactionReceipt(tx.hash, (error, receipt) => {
      if (error) {
        return cb(error)
      }
      _transactionReceipts[tx.hash] = receipt
      cb(null, receipt)
    })
  }

  const txlistener = blockchain.getTxListener({
    api: {
      contracts: function () {
        if (compilersArtefacts.__last) return compilersArtefacts.getAllContractDatas()
        return null
      },
      resolveReceipt: transactionReceiptResolver
    }
  })

  registry.put({ api: txlistener, name: 'txlistener' })
  blockchain.startListening(txlistener)

  const eventsDecoder = new EventsDecoder({
    resolveReceipt: transactionReceiptResolver
  })
  txlistener.startListening()
  registry.put({ api: eventsDecoder, name: 'eventsDecoder' })
}
