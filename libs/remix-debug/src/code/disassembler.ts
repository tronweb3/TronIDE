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

import { parseCode } from './codeUtils'
import { util } from '@remix-project/remix-lib'
import { bufferToHex } from 'ethereumjs-util'

function createExpressions (instructions) {
  const expressions = []
  let labels = 0
  for (let i = 0; i < instructions.length; i++) {
    const expr = instructions[i]
    expr.functional = false
    if (expr.name === 'JUMPDEST') {
      expr.label = 'label' + (++labels)
    // eslint-disable-next-line no-empty
    } else if (expr.name.slice(0, 3) === 'DUP') {
    // eslint-disable-next-line no-empty
    } else if (expr.name.slice(0, 4) === 'SWAP') {
    } else if (expr.out <= 1 && expr.in <= expressions.length) {
      let error = false
      for (let j = 0; j < expr.in && !error; j++) {
        const arg = expressions[expressions.length - j - 1]
        if (!arg.functional || arg.out !== 1) {
          error = true
          break
        }
      }
      if (!error) {
        expr.args = expressions.splice(expressions.length - expr.in)
        expr.functional = true
      }
    }
    expressions.push(expr)
  }
  return expressions
}

function toString (expr) {
  if (expr.name.slice(0, 4) === 'PUSH') {
    return bufferToHex(expr.pushData)
  } else if (expr.name === 'JUMPDEST') {
    return expr.label + ':'
  } else if (expr.args) {
    return expr.name.toLowerCase() + '(' + expr.args.reverse().map(toString).join(', ') + ')'
  }
  return expr.name.toLowerCase()
}

/**
  * Disassembler that turns bytecode (as a hex string) into Solidity inline assembly.
  */
export function disassemble (input) {
  const code = parseCode(util.hexToIntArray(input))
  return createExpressions(code).map(toString).join('\n')
}
