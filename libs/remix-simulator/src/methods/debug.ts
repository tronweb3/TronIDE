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

export class Debug {
  vmContext

  constructor (vmContext) {
    this.vmContext = vmContext
  }

  methods () {
    return {
      debug_traceTransaction: this.debug_traceTransaction.bind(this),
      debug_preimage: this.debug_preimage.bind(this),
      debug_storageRangeAt: this.debug_storageRangeAt.bind(this)
    }
  }

  debug_traceTransaction (payload, cb) {
    this.vmContext.web3().debug.traceTransaction(payload.params[0], {}, cb)
  }

  debug_preimage (payload, cb) {
    this.vmContext.web3().debug.preimage(payload.params[0], cb)
  }

  debug_storageRangeAt (payload, cb) {
    this.vmContext.web3().debug.storageRangeAt(
      payload.params[0],
      payload.params[1],
      payload.params[2],
      payload.params[3],
      payload.params[4],
      cb)
  }
}
