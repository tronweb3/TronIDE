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
import { nameOpCodes } from './codeUtils'

export class CodeResolver {
  getCode
  bytecodeByAddress
  instructionsByAddress
  instructionsIndexByBytesOffset
  fork

  constructor ({ getCode, fork }) {
    this.getCode = getCode
    this.bytecodeByAddress = {} // bytes code by contract addesses
    this.instructionsByAddress = {} // assembly items instructions list by contract addesses
    this.instructionsIndexByBytesOffset = {} // mapping between bytes offset and instructions index.
    this.fork = fork
  }

  clear () {
    this.bytecodeByAddress = {}
    this.instructionsByAddress = {}
    this.instructionsIndexByBytesOffset = {}
  }

  async resolveCode (address) {
    const cache = this.getExecutingCodeFromCache(address)
    if (cache) {
      return cache
    }

    const code = await this.getCode(address)
    return this.cacheExecutingCode(address, code)
  }

  cacheExecutingCode (address, hexCode) {
    const codes = this.formatCode(hexCode)
    this.bytecodeByAddress[address] = hexCode
    this.instructionsByAddress[address] = codes.code
    this.instructionsIndexByBytesOffset[address] = codes.instructionsIndexByBytesOffset
    return this.getExecutingCodeFromCache(address)
  }

  formatCode (hexCode) {
    const [code, instructionsIndexByBytesOffset] = nameOpCodes(Buffer.from(hexCode.substring(2), 'hex'), this.fork)
    return { code, instructionsIndexByBytesOffset }
  }

  getExecutingCodeFromCache (address) {
    if (!this.instructionsByAddress[address]) {
      return null
    }
    return {
      instructions: this.instructionsByAddress[address],
      instructionsIndexByBytesOffset: this.instructionsIndexByBytesOffset[address],
      bytecode: this.bytecodeByAddress[address]
    }
  }

  getInstructionIndex (address, pc) {
    return this.getExecutingCodeFromCache(address).instructionsIndexByBytesOffset[pc]
  }
}
