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

'use strict'
var yo = require('yo-yo')
var copyToClipboard = require('./copy-to-clipboard')

// -------------- styling ----------------------
var csjs = require('csjs-inject')
var remixLib = require('@remix-project/remix-lib')

var EventManager = require('../../lib/events')
var helper = require('../../lib/helper')
var modalDialog = require('./modal-dialog-custom')
var typeConversion = remixLib.execution.typeConversion
var globlalRegistry = require('../../global/registry')

const tronExplorerLinks = {
  main: { tx: 'https://tronscan.org/#/transaction/', address: 'https://tronscan.org/#/address/' },
  shasta: { tx: 'https://shasta.tronscan.org/#/transaction/', address: 'https://shasta.tronscan.org/#/address/' },
  nile: { tx: 'https://nile.tronscan.org/#/transaction/', address: 'https://nile.tronscan.org/#/address/' }
}

function tronExplorerLink (blockchain, type, value) {
  if (!value || !blockchain || blockchain.getProvider() === 'vm') return null
  const networkStatus = blockchain.getCurrentNetworkStatus && blockchain.getCurrentNetworkStatus()
  const networkId = networkStatus && networkStatus.network && networkStatus.network.id
  return tronExplorerLinks[networkId] && tronExplorerLinks[networkId][type] ? tronExplorerLinks[networkId][type] + value : null
}

var css = csjs`
  .log {
    display: flex;
    cursor: pointer;
    align-items: center;
    cursor: pointer;
  }
  .log:hover {
    opacity: 0.8;
  }
  .arrow {
    color: var(--text-info);
    font-size: 20px;
    cursor: pointer;
    display: flex;
    margin-left: 10px;
  }
  .arrow:hover {
    color: var(--secondary);
  }
  .txLog {
  }
  .txStatus {
    display: flex;
    font-size: 20px;
    margin-right: 20px;
    float: left;
  }
  .succeeded {
    color: var(--success);
  }
  .failed {
    color: var(--danger);
  }
  .notavailable {
  }
  .call {
    font-size: 7px;
    border-radius: 50%;
    min-width: 20px;
    min-height: 20px;
    display: flex;
    justify-content: center;
    align-items: center;
    color: var(--text-info);
    text-transform: uppercase;
    font-weight: bold;
  }
  .txItem {
    color: var(--text-info);
    margin-right: 5px;
    float: left;
  }
  .txItemTitle {
    font-weight: bold;
  }
  .tx {
    color: var(--text-info);
    font-weight: bold;
    float: left;
    margin-right: 10px;
  }
  .txTable,
  .tr,
  .td {
    border-collapse: collapse;
    font-size: 10px;
    color: var(--text-info);
    border: 1px solid var(--text-info);
  }
  #txTable {
    margin-top: 1%;
    margin-bottom: 5%;
    align-self: center;
    width: 85%;
  }
  .tr, .td {
    padding: 4px;
    vertical-align: baseline;
  }
  .td:first-child {
    min-width: 30%;
    width: 30%;
    align-items: baseline;
    font-weight: bold;
  }
  .tableTitle {
    width: 25%;
  }
  .buttons {
    display: flex;
    margin-left: auto;
  }
  .debug {
    white-space: nowrap;
  }
  .debug:hover {
    opacity: 0.8;
  }`
/**
  * This just export a function that register to `newTransaction` and forward them to the logger.
  *
  */
class TxLogger {
  constructor (terminal, blockchain) {
    this.event = new EventManager()
    this.seen = {}
    this.blockchain = blockchain
    function filterTx (value, query) {
      if (value.length) {
        return helper.find(value, query)
      }
      return false
    }
    this.eventsDecoder = globlalRegistry.get('eventsDecoder').api
    this.txListener = globlalRegistry.get('txlistener').api
    this.terminal = terminal
    // dependencies
    this._deps = {
      compilersArtefacts: globlalRegistry.get('compilersartefacts').api
    }

    this.logKnownTX = this.terminal.registerCommand('knownTransaction', (args, cmds, append) => {
      var data = args[0]
      var el
      if (data.tx.isCall) {
        el = renderCall(this, data)
      } else {
        el = renderKnownTransaction(this, data, blockchain)
      }
      this.seen[data.tx.hash] = el
      append(el)
    }, { activate: true, filterFn: filterTx })

    this.logUnknownTX = this.terminal.registerCommand('unknownTransaction', (args, cmds, append) => {
      // triggered for transaction AND call
      var data = args[0]
      var el = renderUnknownTransaction(this, data, blockchain)
      append(el)
    }, { activate: false, filterFn: filterTx })

    this.logEmptyBlock = this.terminal.registerCommand('emptyBlock', (args, cmds, append) => {
      var data = args[0]
      var el = renderEmptyBlock(this, data)
      append(el)
    }, { activate: true })

    this.txListener.event.register('newBlock', (block) => {
      if (!block.transactions || (block.transactions && !block.transactions.length)) {
        this.logEmptyBlock({ block: block })
      }
    })

    this.txListener.event.register('newTransaction', (tx, receipt) => {
      log(this, tx, receipt)
    })

    this.txListener.event.register('newCall', (tx) => {
      log(this, tx, null)
    })

    this.terminal.updateJournal({ type: 'select', value: 'unknownTransaction' })
    this.terminal.updateJournal({ type: 'select', value: 'knownTransaction' })
  }
}

function debug (e, data, self) {
  e.stopPropagation()
  if (data.tx.isCall && data.tx.envMode !== 'vm') {
    modalDialog.alert('Cannot debug this call. Debugging calls is only possible in JavaScript VM (Tron) mode.')
  } else {
    self.event.trigger('debuggingRequested', [data.tx.hash])
  }
  window?.gtag('event', 'click', { event_category: 'logger_user_action', event_label: 'logger_debug' })
}

function log (self, tx, receipt) {
  var resolvedTransaction = self.txListener.resolvedTransaction(tx.hash)
  if (resolvedTransaction) {
    var compiledContracts = null
    if (self._deps.compilersArtefacts.__last) {
      compiledContracts = self._deps.compilersArtefacts.__last.getContracts()
    }
    self.eventsDecoder.parseLogs(tx, resolvedTransaction.contractName, compiledContracts, (error, logs) => {
      if (!error) {
        self.logKnownTX({ tx: tx, receipt: receipt, resolvedData: resolvedTransaction, logs: logs })
      } else {
        // Log decoding can fail for a freshly broadcast tx (e.g. receipt/logs not
        // yet populated). Still render the known transaction so the terminal shows
        // status/hash/from/to instead of staying stuck on "pending...".
        console.error(error)
        self.logKnownTX({ tx: tx, receipt: receipt, resolvedData: resolvedTransaction, logs: null })
      }
    })
  } else {
    // contract unknown - just displaying raw tx.
    self.logUnknownTX({ tx: tx, receipt: receipt })
  }
}

function renderKnownTransaction (self, data, blockchain) {
  var from = data.tx.from
  var to = data.resolvedData.contractName + '.' + data.resolvedData.fn
  var obj = { from, to }
  var txType = 'knownTx'
  var tx = yo`
    <span id="tx${data.tx.hash}" data-id="txLogger${data.tx.hash}">
      <div class="${css.log}" onclick=${e => txDetails(e, tx, data, obj, self)}>
        ${checkTxStatus(data.receipt, txType)}
        ${context(self, { from, to, data }, blockchain)}
        <div class=${css.buttons}>
          <button
            class="${css.debug} btn btn-primary btn-sm"
            data-shared="txLoggerDebugButton"
            data-id="txLoggerDebugButton${data.tx.hash}"
            onclick=${(e) => debug(e, data, self)}
          >
            Debug
          </div>
        </div>
        <i class="${css.arrow} fas fa-angle-down"></i>
      </div>
    </span>
  `
  return tx
}

function renderCall (self, data) {
  var to = data.resolvedData.contractName + '.' + data.resolvedData.fn
  var from = data.tx.from ? data.tx.from : ' - '
  var input = data.tx.input ? helper.shortenHexData(data.tx.input) : ''
  var obj = { from, to }
  var txType = 'call'
  var tx = yo`
    <span id="tx${data.tx.hash}">
      <div class="${css.log}" onclick=${e => txDetails(e, tx, data, obj, self)}>
        ${checkTxStatus(data.tx, txType)}
        <span class=${css.txLog}>
          <span class=${css.tx}>[call]</span>
          <div class=${css.txItem}><span class=${css.txItemTitle}>from:</span> ${from}</div>
          <div class=${css.txItem}><span class=${css.txItemTitle}>to:</span> ${to}</div>
          <div class=${css.txItem}><span class=${css.txItemTitle}>data:</span> ${input}</div>
        </span>
        <div class=${css.buttons}>
          <div class="${css.debug} btn btn-primary btn-sm" onclick=${(e) => debug(e, data, self)}>Debug</div>
        </div>
        <i class="${css.arrow} fas fa-angle-down"></i>
      </div>
    </span>
  `
  return tx
}

function renderUnknownTransaction (self, data, blockchain) {
  var from = data.tx.from
  var to = data.tx.to
  var obj = { from, to }
  var txType = 'unknown' + (data.tx.isCall ? 'Call' : 'Tx')
  var tx = yo`
    <span id="tx${data.tx.hash}">
      <div class="${css.log}" onclick=${e => txDetails(e, tx, data, obj, self)}>
        ${checkTxStatus(data.receipt || data.tx, txType)}
        ${context(self, { from, to, data }, blockchain)}
        <div class=${css.buttons}>
          <div class="${css.debug} btn btn-primary btn-sm" onclick=${(e) => debug(e, data, self)}>Debug</div>
        </div>
        <i class="${css.arrow} fas fa-angle-down"></i>
      </div>
    </span>
  `
  return tx
}

function renderEmptyBlock (self, data) {
  return yo`
    <span class=${css.txLog}>
      <span class='${css.tx}'><div class=${css.txItem}>[<span class=${css.txItemTitle}>block:${data.block.number} - </span> 0 transactions]</span></span>
    </span>`
}

function checkTxStatus (tx, type) {
  if (tx.status === '0x1' || tx.status === true) {
    return yo`<i class="${css.txStatus} ${css.succeeded} fas fa-check-circle"></i>`
  }
  if (type === 'call' || type === 'unknownCall') {
    return yo`<i class="${css.txStatus} ${css.call}">call</i>`
  } else if (tx.status === '0x0' || tx.status === false) {
    return yo`<i class="${css.txStatus} ${css.failed} fas fa-times-circle"></i>`
  } else {
    return yo`<i class="${css.txStatus} ${css.notavailable} fas fa-circle-thin" title='Status not available' ></i>`
  }
}

function context (self, opts, blockchain) {
  var data = opts.data || ''
  var from = opts.from ? helper.shortenHexData(remixLib.util.addressToBase58(opts.from)) : ''
  var to = opts.to
  if (data.tx.to) to = to + ' ' + helper.shortenHexData(remixLib.util.addressToBase58(data.tx.to))
  var val = data.tx.value
  var hash = data.tx.hash ? helper.shortenHexData(data.tx.hash) : ''
  var input = data.tx.input ? helper.shortenHexData(data.tx.input) : ''
  var logs = data.logs && data.logs.decoded && data.logs.decoded.length ? data.logs.decoded.length : 0
  var block = data.receipt ? data.receipt.blockNumber : data.tx.blockNumber || ''
  var i = data.receipt ? data.receipt.transactionIndex : data.tx.transactionIndex
  var value = val ? typeConversion.toInt(val) : 0
  var tokenId = data.tx.tokenId ? typeConversion.toInt(data.tx.tokenId) : 0
  var tokenValue = data.tx.tokenValue ? typeConversion.toInt(data.tx.tokenValue) : 0
  if (blockchain.getProvider() === 'vm') {
    return yo`
      <div>
        <span class=${css.txLog}>
          <span class=${css.tx}>[VM (Tron)]</span>
          <div class=${css.txItem}><span class=${css.txItemTitle}>from:</span> ${from}</div>
          <div class=${css.txItem}><span class=${css.txItemTitle}>to:</span> ${to}</div>
          <div class=${css.txItem}><span class=${css.txItemTitle}>value:</span> ${value} sun</div>
          <div class=${css.txItem}><span class=${css.txItemTitle}>tokenId:</span> ${tokenId}</div>
          <div class=${css.txItem}><span class=${css.txItemTitle}>tokenValue:</span> ${tokenValue}</div>
          <div class=${css.txItem}><span class=${css.txItemTitle}>data:</span> ${input}</div>
          <div class=${css.txItem}><span class=${css.txItemTitle}>logs:</span> ${logs}</div>
          <div class=${css.txItem}><span class=${css.txItemTitle}>hash:</span> ${hash}</div>
        </span>
      </div>`
  } else if (blockchain.getProvider() !== 'vm' && data.resolvedData) {
    return yo`
      <div>
        <span class=${css.txLog}>
        <span class='${css.tx}'>[block:${block} txIndex:${i}]</span>
          <div class=${css.txItem}><span class=${css.txItemTitle}>from:</span> ${from}</div>
          <div class=${css.txItem}><span class=${css.txItemTitle}>to:</span> ${to}</div>
          <div class=${css.txItem}><span class=${css.txItemTitle}>value:</span> ${value} sun</div>
          <div class=${css.txItem}><span class=${css.txItemTitle}>tokenId:</span> ${tokenId}</div>
          <div class=${css.txItem}><span class=${css.txItemTitle}>tokenValue:</span> ${tokenValue}</div>
          <div class=${css.txItem}><span class=${css.txItemTitle}>data:</span> ${input}</div>
          <div class=${css.txItem}><span class=${css.txItemTitle}>logs:</span> ${logs}</div>
          <div class=${css.txItem}><span class=${css.txItemTitle}>hash:</span> ${hash}</div>
        </span>
      </div>`
  } else {
    to = helper.shortenHexData(to)
    hash = helper.shortenHexData(data.tx.blockHash)
    return yo`
      <div>
        <span class=${css.txLog}>
          <span class='${css.tx}'>[block:${block} txIndex:${i}]</span>
          <div class=${css.txItem}><span class=${css.txItemTitle}>from:</span> ${from}</div>
          <div class=${css.txItem}><span class=${css.txItemTitle}>to:</span> ${to}</div>
          <div class=${css.txItem}><span class=${css.txItemTitle}>value:</span> ${value} sun</div>
        </span>
      </div>`
  }
}

module.exports = TxLogger

// helpers

function isDescendant (parent, child) {
  var node = child.parentNode
  while (node != null) {
    if (node === parent) {
      return true
    }
    node = node.parentNode
  }
  return false
}

function txDetails (e, tx, data, obj, self) {
  const from = obj.from
  const to = obj.to
  const arrowUp = yo`<i class="${css.arrow} fas fa-angle-up"></i>`
  const arrowDown = yo`<i class="${css.arrow} fas fa-angle-down"></i>`

  let blockElement = e.target
  while (true) { // get the parent block element
    if (blockElement.className.startsWith('block')) break
    else if (blockElement.parentElement) {
      blockElement = blockElement.parentElement
    } else break
  }

  const tables = blockElement.querySelectorAll(`#${tx.id} [class^="txTable"]`)
  const logs = blockElement.querySelectorAll(`#${tx.id} [class^='log']`)
  const arrows = blockElement.querySelectorAll(`#${tx.id} [class^='arrow']`)

  let table = [...tables].filter((t) => isDescendant(tx, t))[0]
  const log = [...logs].filter((t) => isDescendant(tx, t))[0]
  const arrow = [...arrows].filter((t) => isDescendant(tx, t))[0]

  if (table && table.parentNode) {
    tx.removeChild(table)
    log.removeChild(arrow)
    log.appendChild(arrowDown)
  } else {
    log.removeChild(arrow)
    log.appendChild(arrowUp)
    var output = data?.tx?.returnValue
    var outputBase16 = Array.isArray(output) && output?.length > 0 ? output && '0x' + output.map(byte => byte.toString(16).padStart(2, '0')).join('') : output
    table = createTable({
      blockchain: self.blockchain,
      hash: data.tx.hash,
      status: data.receipt ? data.receipt.status : null,
      isCall: data.tx.isCall,
      contractAddress: data.tx.contractAddress,
      data: data.tx,
      from,
      to,
      gas: data.tx.gas,
      input: data.tx.input,
      output: outputBase16,
      'decoded input': data.resolvedData && data.resolvedData.params ? JSON.stringify(typeConversion.stringify(data.resolvedData.params), null, '\t') : ' - ',
      'decoded output': data.resolvedData && data.resolvedData.decodedReturnValue ? JSON.stringify(typeConversion.stringify(data.resolvedData.decodedReturnValue), null, '\t') : ' - ',
      logs: data.logs,
      val: data.tx.value,
      tokenId: data.tx.tokenId,
      tokenValue: data.tx.tokenValue,
      transactionCost: data.tx.transactionCost,
      executionCost: data.tx.executionCost
    })
    tx.appendChild(table)
  }
}

function createTable (opts) {
  var table = yo`<table class="${css.txTable}" id="txTable" data-id="txLoggerTable${opts.hash}"></table>`
  if (!opts.isCall) {
    var msg = ''
    if (opts.status !== undefined && opts.status !== null) {
      if (opts.status === '0x0' || opts.status === false) {
        msg = ' Transaction mined but execution failed'
      } else if (opts.status === '0x1' || opts.status === true) {
        msg = ' Transaction mined and execution succeed'
      }
    } else {
      msg = ' Status not available at the moment'
    }
    table.appendChild(yo`
      <tr class="${css.tr}">
        <td class="${css.td}" data-shared="key_${opts.hash}"> status </td>
        <td class="${css.td}" data-id="txLoggerTableStatus${opts.hash}" data-shared="pair_${opts.hash}">${opts.status}${msg}</td>
      </tr>`)
  }

  const txLink = tronExplorerLink(opts.blockchain, 'tx', opts.hash)
  var transactionHash = yo`
    <tr class="${css.tr}">
      <td class="${css.td}" data-shared="key_${opts.hash}"> transaction hash </td>
      <td class="${css.td}" data-id="txLoggerTableHash${opts.hash}" data-shared="pair_${opts.hash}">${txLink ? yo`<a href="${txLink}" target="_blank" rel="noopener noreferrer">${opts.hash}</a>` : opts.hash}
        ${copyToClipboard(() => opts.hash)}
      </td>
    </tr>
  `
  table.appendChild(transactionHash)

  const contractBase58Address = opts.contractAddress ? remixLib.util.addressToBase58(opts.contractAddress) : ''
  const contractLink = tronExplorerLink(opts.blockchain, 'address', contractBase58Address)
  var contractAddress = yo`
    <tr class="${css.tr}">
      <td class="${css.td}" data-shared="key_${opts.hash}"> contract address </td>
      <td class="${css.td}" data-id="txLoggerTableContractAddress${opts.hash}" data-shared="pair_${opts.hash}">${contractLink ? yo`<a href="${contractLink}" target="_blank" rel="noopener noreferrer">${contractBase58Address}</a>` : opts.contractAddress}
        ${copyToClipboard(() => opts.contractAddress)}
      </td>
    </tr>
  `
  if (opts.contractAddress) table.appendChild(contractAddress)

  if (opts.from) {
    opts.from = remixLib.util.addressToBase58(opts.from)
  }
  var from = yo`
    <tr class="${css.tr}">
      <td class="${css.td} ${css.tableTitle}" data-shared="key_${opts.hash}"> from </td>
      <td class="${css.td}" data-id="txLoggerTableFrom${opts.hash}" data-shared="pair_${opts.hash}">${opts.from}
        ${copyToClipboard(() => opts.from)}
      </td>
    </tr>
  `
  if (opts.from) table.appendChild(from)

  var toHash
  var data = opts.data // opts.data = data.tx
  if (data.to) {
    data.to = remixLib.util.addressToBase58(data.to)
  }
  if (data.to) {
    toHash = opts.to + ' ' + data.to
  } else {
    toHash = opts.to
  }
  var to = yo`
    <tr class="${css.tr}">
    <td class="${css.td}" data-shared="key_${opts.hash}"> to </td>
    <td class="${css.td}" data-id="txLoggerTableTo${opts.hash}" data-shared="pair_${opts.hash}">${toHash}
      ${copyToClipboard(() => data.to ? data.to : toHash)}
    </td>
    </tr>
  `
  if (opts.to) table.appendChild(to)

  var gas = yo`
    <tr class="${css.tr}">
      <td class="${css.td}" data-shared="key_${opts.hash}"> fee </td>
      <td class="${css.td}" data-id="txLoggerTableGas${opts.hash}" data-shared="pair_${opts.hash}">${opts.gas} fee
        ${copyToClipboard(() => opts.gas)}
      </td>
    </tr>
  `
  if (opts.gas) table.appendChild(gas)

  var callWarning = ''
  if (opts.isCall) {
    callWarning = '(Cost only applies when called by a contract)'
  }
  if (opts.transactionCost) {
    table.appendChild(yo`
    <tr class="${css.tr}">
      <td class="${css.td}" data-shared="key_${opts.hash}"> transaction cost </td>
      <td class="${css.td}" data-id="txLoggerTableTransactionCost${opts.hash}" data-shared="pair_${opts.hash}">${opts.transactionCost} fee ${callWarning}
        ${copyToClipboard(() => opts.transactionCost)}
      </td>
    </tr>`)
  }

  if (opts.executionCost) {
    table.appendChild(yo`
    <tr class="${css.tr}">
      <td class="${css.td}" data-shared="key_${opts.hash}"> execution cost </td>
      <td class="${css.td}" data-id="txLoggerTableExecutionHash${opts.hash}" data-shared="pair_${opts.hash}">${opts.executionCost} fee ${callWarning}
        ${copyToClipboard(() => opts.executionCost)}
      </td>
    </tr>`)
  }

  var hash = yo`
    <tr class="${css.tr}">
      <td class="${css.td}" data-shared="key_${opts.hash}"> hash </td>
      <td class="${css.td}" data-id="txLoggerTableHash${opts.hash}" data-shared="pair_${opts.hash}">${opts.hash}
        ${copyToClipboard(() => opts.hash)}
      </td>
    </tr>
  `
  if (opts.hash) table.appendChild(hash)

  var input = yo`
    <tr class="${css.tr}">
      <td class="${css.td}" data-shared="key_${opts.hash}"> input </td>
      <td class="${css.td}" data-id="txLoggerTableInput${opts.hash}" data-shared="pair_${opts.hash}">${helper.shortenHexData(opts.input)}
        ${copyToClipboard(() => opts.input)}
      </td>
    </tr>
  `
  if (opts.input) table.appendChild(input)

  var output = yo`
    <tr class="${css.tr}">
      <td class="${css.td}" data-shared="key_${opts.hash}"> output </td>
      <td class="${css.td}" data-id="txLoggerTableInput${opts.hash}" data-shared="pair_${opts.hash}">${opts.output}
        ${copyToClipboard(() => opts.output)}
      </td>
    </tr>
  `
  if (opts.output) table.appendChild(output)

  if (opts['decoded input']) {
    var inputDecoded = yo`
    <tr class="${css.tr}">
      <td class="${css.td}" data-shared="key_${opts.hash}"> decoded input </td>
      <td class="${css.td}" data-id="txLoggerTableDecodedInput${opts.hash}" data-shared="pair_${opts.hash}">${opts['decoded input']}
        ${copyToClipboard(() => opts['decoded input'])}
      </td>
    </tr>`
    table.appendChild(inputDecoded)
  }

  if (opts['decoded output']) {
    var outputDecoded = yo`
    <tr class="${css.tr}">
      <td class="${css.td}" data-shared="key_${opts.hash}"> decoded output </td>
      <td class="${css.td}" id="decodedoutput" data-id="txLoggerTableDecodedOutput${opts.hash}" data-shared="pair_${opts.hash}">${opts['decoded output']}
        ${copyToClipboard(() => opts['decoded output'])}
      </td>
    </tr>`
    table.appendChild(outputDecoded)
  }

  var stringified = ' - '
  if (opts.logs && opts.logs.decoded) {
    stringified = typeConversion.stringify(opts.logs.decoded)
  }
  var logs = yo`
    <tr class="${css.tr}">
      <td class="${css.td}" data-shared="key_${opts.hash}"> logs </td>
      <td class="${css.td}" id="logs" data-id="txLoggerTableLogs${opts.hash}" data-shared="pair_${opts.hash}">
        ${JSON.stringify(stringified, null, '\t')}
        ${copyToClipboard(() => JSON.stringify(stringified, null, '\t'))}
        ${copyToClipboard(() => JSON.stringify(opts.logs.raw || '0'))}
      </td>
    </tr>
  `
  if (opts.logs) table.appendChild(logs)

  var val = opts.val != null ? typeConversion.toInt(opts.val) : 0
  val = yo`
    <tr class="${css.tr}">
      <td class="${css.td}" data-shared="key_${opts.hash}"> value </td>
      <td class="${css.td}" data-id="txLoggerTableValue${opts.hash}" data-shared="pair_${opts.hash}">${val} sun
        ${copyToClipboard(() => `${typeConversion.toInt(opts.val)} sun`)}
      </td>
    </tr>
  `
  if (opts.val) table.appendChild(val)

  var tokenId = opts.tokenId != null ? typeConversion.toInt(opts.tokenId) : 0
  tokenId = yo`
    <tr class="${css.tr}">
      <td class="${css.td}" data-shared="key_${opts.hash}"> tokenId </td>
      <td class="${css.td}" data-id="txLoggerTableTokenId${opts.hash}" data-shared="pair_${opts.hash}">${tokenId}
        ${copyToClipboard(() => `${typeConversion.toInt(opts.tokenId)}`)}
      </td>
    </tr>
  `
  if (opts.tokenId) table.appendChild(tokenId)

  var tokenValue = opts.tokenValue != null ? typeConversion.toInt(opts.tokenValue) : 0
  tokenValue = yo`
    <tr class="${css.tr}">
      <td class="${css.td}" data-shared="key_${opts.hash}"> tokenValue </td>
      <td class="${css.td}" data-id="txLoggerTableTokenValue${opts.hash}" data-shared="pair_${opts.hash}">${tokenValue}
        ${copyToClipboard(() => `${typeConversion.toInt(opts.tokenValue)}`)}
      </td>
    </tr>
  `
  if (opts.tokenValue) table.appendChild(tokenValue)

  return table
}
