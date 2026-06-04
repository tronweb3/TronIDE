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
  const transactionReceiptResolver = async (tx, cb) => {
    if (_transactionReceipts[tx.hash]) {
      return cb(null, _transactionReceipts[tx.hash])
    }
    if (!blockchain.executionContext.isVM()) {
      try {
        const txn = await blockchain.web3().trx.getUnconfirmedTransactionInfo(tx.hash)
        const { blockNumber, fee, log = [], contractResult = [] } = txn
        const contractAddress = txn.contract_address.replace(/^(41)/, '0x')

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

        _transactionReceipts[tx.hash] = receipt
        cb(null, receipt)
        return
      } catch (error) {
        cb(error)
      }
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
