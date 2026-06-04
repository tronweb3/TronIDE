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
import { Transaction as Tx } from '@tvmjs/tx'
import { Block } from '@tvmjs/block'
import { BN, bufferToHex, Address } from 'ethereumjs-util'
import { vm as remixlibVM } from '@remix-project/remix-lib'
import VM from '@tvmjs/vm'
const { Common, Mainnet } = require('@tvmjs/common')

export function sendTx (vm, from, to, value, data, cb?) {
  cb = cb || (() => {})
  return new Promise((resolve, reject) => {
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
    }) // still using default common

    try {
      vm.runTx({ block: block, tx: tx, skipBalance: true, skipNonce: true }).then(function (result) {
        setTimeout(() => {
          const hash = bufferToHex(tx.hash())
          cb(null, { hash, result })
          resolve({ hash, result })
        }, 500)
      }).catch((error) => {
        console.error(error)
        cb(error)
        reject(error)
      })
    } catch (e) {
      console.error(e)
    }
  })
}

async function createVm (hardfork) {
  const common = new Common({ chain: Mainnet, hardfork })
  const vm = new VM({ common })
  await vm.init()
  return { vm, stateManager: vm.stateManager }
}

/*
  Init VM / Send Transaction
*/
export async function initVM (st, privateKey) {
  var VM = await createVm('shanghai')
  const vm = VM.vm

  var address = Address.fromPrivateKey(privateKey)

  try {
    const account = await vm.stateManager.getAccount(address)
    account.balance = new BN('f00000000000000001', 16)
    await vm.stateManager.putAccount(address, account)
  } catch (error) {
    console.log(error)
  }

  var web3Provider = new remixlibVM.Web3VMProvider()
  web3Provider.setVM(vm)
  vm.web3 = web3Provider
  return vm
}
