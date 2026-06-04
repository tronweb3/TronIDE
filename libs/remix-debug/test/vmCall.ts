/*
 * Original work Copyright © 2018-2021 Remix Team
 * Licensed under the Apache License, Version 2.0.
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
import { Block } from '@tvmjs/block'
import VM from '@tvmjs/vm'
import { Transaction as Tx } from '@tvmjs/tx'
import { BN, bufferToHex, Address } from 'ethereumjs-util'
import * as remixLib from '@remix-project/remix-lib'
const { Common, Mainnet } = require('@tvmjs/common')

function sendTx (vm, from, to, value, data, cb) {
  var tx = new Tx({
    nonce: new BN(from.nonce++),
    // gasPrice: new BN(1),
    gasLimit: new BN(3000000, 10),
    to: to,
    value: new BN(value, 10),
    data: Buffer.from(data, 'hex')
  })
  tx = tx.sign(from.privateKey)

  var block = Block.fromBlockData({
    header: {
      timestamp: new Date().getTime() / 1000 | 0,
      number: 0
    }
  }, { common: vm._common })
  vm.runTx({ block: block, tx: tx, skipBalance: true, skipNonce: true }).then(function (result) {
    setTimeout(() => {
      cb(null, bufferToHex(tx.hash()))
    }, 500)
  }).catch((error) => {
    console.error(error)
    cb(error)
  })
}

/*
  Init VM / Send Transaction
*/
async function initVM (privateKey) {
  var address = Address.fromPrivateKey(privateKey)
  const common = new Common({ chain: Mainnet, hardfork: 'shanghai' })
  var vm = new VM({
    common,
    activatePrecompiles: true
  })
  await vm.init()

  try {
    const account = await vm.stateManager.getAccount(address)
    account.balance = new BN('f00000000000000001', 16)
    await vm.stateManager.putAccount(address, account)
  } catch (error) {
    console.log(error)
  }

  var web3Provider = new remixLib.vm.Web3VMProvider()
  web3Provider.setVM(vm)
  vm.web3 = web3Provider
  return vm
}

module.exports = {
  sendTx: sendTx,
  initVM: initVM
}
