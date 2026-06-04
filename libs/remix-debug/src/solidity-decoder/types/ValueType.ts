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
import { extractHexValue } from './util'

export class ValueType {
  storageSlots
  storageBytes
  typeName
  basicType

  constructor (storageSlots, storageBytes, typeName) {
    this.storageSlots = storageSlots
    this.storageBytes = storageBytes
    this.typeName = typeName
    this.basicType = 'ValueType'
  }

  decodeValue (input? : any) {
    throw new Error('This method is abstract')
  }

  /**
    * decode the type with the @arg location from the storage
    *
    * @param {Object} location - containing offset and slot
    * @param {Object} storageResolver  - resolve storage queries
    * @return {Object} - decoded value
    */
  async decodeFromStorage (location, storageResolver) {
    try {
      var value = await extractHexValue(location, storageResolver, this.storageBytes)
      return { value: this.decodeValue(value), type: this.typeName }
    } catch (e) {
      console.log(e)
      return { value: '<decoding failed - ' + e.message + '>', type: this.typeName }
    }
  }

  /**
    * decode the type from the stack
    *
    * @param {Int} stackDepth - position of the type in the stack
    * @param {Array} stack - stack
    * @param {String} - memory
    * @return {Object} - decoded value
    */
  async decodeFromStack (stackDepth, stack, memory, calldata, variableDetails?) {
    let value
    if (stackDepth >= stack.length) {
      value = this.decodeValue('')
    } else {
      value = this.decodeValue(stack[stack.length - 1 - stackDepth].replace('0x', ''))
    }
    return { value, type: this.typeName }
  }

  /**
    * decode the type with the @arg offset location from the memory
    *
    * @param {Int} stackDepth - position of the type in the stack
    * @return {String} - memory
    * @return {Object} - decoded value
    */
  decodeFromMemory (offset, memory) {
    const value = memory.substr(2 * offset, 64)
    return { value: this.decodeValue(value), type: this.typeName }
  }
}
