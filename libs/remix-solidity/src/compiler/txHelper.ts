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

import { CompilationResult, visitContractsCallbackParam, visitContractsCallbackInterface } from './types'
export default {

  /**
   * @dev Get contract obj of given contract name from last compilation result.
   * @param name contract name
   * @param contracts 'contracts' object from last compilation result
   */

  getContract: (contractName: string, contracts: CompilationResult['contracts']) : Record<string, any> | null => {
    for (const file in contracts) {
      if (contracts[file][contractName]) {
        return { object: contracts[file][contractName], file: file }
      }
    }
    return null
  },

  /**
   * @dev call the given callback for all contracts from last compilation result, stop visiting when cb return true
   * @param contracts - 'contracts' object from last compilation result
   * @param cb    - callback
   */

  visitContracts: (contracts: CompilationResult['contracts'], cb: visitContractsCallbackInterface) : void => {
    for (const file in contracts) {
      for (const name in contracts[file]) {
        const param: visitContractsCallbackParam = {
          name: name,
          object: contracts[file][name],
          file: file
        }
        if (cb(param)) return
      }
    }
  }

}
