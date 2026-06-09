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

import getOpcodes from './opcodes'
'use strict'
const { Common, Mainnet } = require('@tvmjs/common')
const { getOpcodesForHF, paramsTVM } = require('@tvmjs/tvm')

export function nameOpCodes (raw, hardfork) {
  // The disassembled bytecode is always TVM bytecode, so resolve opcodes under the
  // 'tron' hardfork (the incoming `hardfork` can be undefined at construction time).
  // paramsTVM supplies the opcode gas schedule (stopGas, …); without it the
  // @tvmjs v7-generation Common.param() throws 'Missing parameter value for …'.
  const common = new Common({ chain: Mainnet, hardfork: 'tron', params: paramsTVM })
  // @tvmjs getOpcodesForHF returns { opcodes: Map, opcodeMap, ... } — the actual
  // opcode Map is `.opcodes`. Calling `.get()` on the wrapper threw for every byte,
  // so every instruction decoded as INVALID, PUSH data was never skipped, and the
  // pc→instruction-index map degenerated to identity — corrupting every source-map
  // lookup (wrong/empty debugger locals, revert mapped to the wrong function).
  const opcodes = getOpcodesForHF(common).opcodes

  let pushData = ''
  const codeMap = {}
  const code = []

  for (let i = 0; i < raw.length; i++) {
    const pc = i
    let curOpCode
    try {
      curOpCode = opcodes.get(raw[pc]).fullName
    } catch (e) {
      curOpCode = 'INVALID'
    }
    codeMap[i] = code.length
    // no destinations into the middle of PUSH
    if (curOpCode.slice(0, 4) === 'PUSH') {
      const jumpNum = raw[pc] - 0x5f
      pushData = raw.slice(pc + 1, pc + jumpNum + 1)
      i += jumpNum
    }

    const data = (pushData as any).toString('hex') !== '' ? ' ' + (pushData as any).toString('hex') : ''

    code.push(pad(pc, roundLog(raw.length, 10)) + ' ' + curOpCode + data)
    pushData = ''
  }
  return [code, codeMap]
}

type Opcode = {
  name: String,
  pushData?: Array<number>
  in?: number
  out?: number
}
/**
 * Parses code as a list of integers into a list of objects containing
 * information about the opcode.
 */
export function parseCode (raw) {
  const common = new Common({ chain: Mainnet, hardfork: 'tron', params: paramsTVM })
  const opcodes = getOpcodesForHF(common).opcodes

  const code = []
  for (let i = 0; i < raw.length; i++) {
    const opcode: Opcode = { name: 'INVALID' }
    try {
      const code = opcodes.get(raw[i])
      const opcodeDetails = getOpcodes(raw[i], false)
      opcode.in = opcodeDetails.in
      opcode.out = opcodeDetails.out
      opcode.name = code.fullName
    } catch (e) {
      opcode.name = 'INVALID'
    }
    if (opcode.name.slice(0, 4) === 'PUSH') {
      const length = raw[i] - 0x5f
      opcode.pushData = raw.slice(i + 1, i + length + 1)
      // in case pushdata extends beyond code
      if (i + 1 + length > raw.length) {
        for (let j = opcode['pushData'].length; j < length; j++) {
          opcode['pushData'].push(0)
        }
      }
      i += length
    }
    code.push(opcode)
  }
  return code
}

export function pad (num, size) {
  let s = num + ''
  while (s.length < size) s = '0' + s
  return s
}

export function log (num, base) {
  return Math.log(num) / Math.log(base)
}

export function roundLog (num, base) {
  return Math.ceil(log(num, base))
}
