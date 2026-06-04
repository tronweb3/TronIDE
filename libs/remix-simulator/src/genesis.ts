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

import { BN } from 'ethereumjs-util'
const { createBlock } = require('@tvmjs/block')
const { runBlock } = require('@tvmjs/vm')

export function generateBlock (vmContext) {
  return new Promise((resolve, reject) => {
    const block = createBlock({
      header: {
        timestamp: (new Date().getTime() / 1000 | 0),
        number: 0,
        coinbase: '0x0e9281e9c6a0808672eaba6bd1220e144c9bb07a',
        gasLimit: BigInt('8000000')
      }
    }, { common: vmContext.vmObject().common })

    runBlock(vmContext.vm(), { block: block, generate: true, skipBlockValidation: true, skipBalance: false }).then(() => {
      vmContext.addBlock(block)
      resolve({})
    }).catch((e) => reject(e))
  })
}
