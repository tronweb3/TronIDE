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

import { Web3VmProvider } from './web3VmProvider'
import { loadWeb3, extendWeb3 } from '../init'

export class Web3Providers {
  modes
  constructor () {
    this.modes = {}
  }

  addProvider (type, obj) {
    if (type === 'INTERNAL') {
      const web3 = loadWeb3()
      this.addWeb3(type, web3)
    } else if (type === 'vm') {
      this.addVM(type, obj)
    } else {
      extendWeb3(obj)
      this.addWeb3(type, obj)
    }
  }

  get (type, cb) {
    if (this.modes[type]) {
      return cb(null, this.modes[type])
    }
    cb('error: this provider has not been setup (' + type + ')', null)
  }

  addWeb3 (type, web3) {
    this.modes[type] = web3
  }

  addVM (type, vm) {
    const vmProvider = new Web3VmProvider()
    vmProvider.setVM(vm)
    this.modes[type] = vmProvider
  }
}
