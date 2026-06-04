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
import { bufferToHex } from 'ethereumjs-util'
import { isHexString } from 'ethjs-util'

function convertToPrefixedHex (input) {
  if (input === undefined || input === null || isHexString(input)) {
    return input
  } else if (Buffer.isBuffer(input)) {
    return bufferToHex(input)
  }
  return '0x' + input.toString(16)
}

/*
 txResult.result can be 3 different things:
 - VM call or tx: ethereumjs-vm result object
 - Node transaction: object returned from eth.getTransactionReceipt()
 - Node call: return value from function call (not an object)

 Also, VM results use BN and Buffers, Node results use hex strings/ints,
 So we need to normalize the values to prefixed hex strings
*/
export function resultToRemixTx (txResult, execResult) {
  const { receipt, transactionHash, result } = txResult
  const { status, gasUsed, contractAddress } = receipt
  let returnValue, errorMessage

  if (isHexString(result)) {
    returnValue = result
  } else if (execResult !== undefined) {
    returnValue = execResult.returnValue
    errorMessage = execResult.exceptionError
  }

  return {
    transactionHash,
    status,
    gasUsed: convertToPrefixedHex(gasUsed),
    error: errorMessage,
    return: convertToPrefixedHex(returnValue),
    createdAddress: convertToPrefixedHex(contractAddress)
  }
}
