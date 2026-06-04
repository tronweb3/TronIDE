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

export async function solidityLocals (vmtraceIndex, internalTreeCall, stack, memory, storageResolver, calldata, currentSourceLocation, cursor) {
  const scope = internalTreeCall.findScope(vmtraceIndex)
  if (!scope) {
    const error = { message: 'Can\'t display locals. reason: compilation result might not have been provided' }
    throw error
  }

  const locals = {}
  const formattedMemory = formatMemory(memory)
  let anonymousIncr = 1

  for (const localNameKey in scope.locals) {
    const variable = scope.locals[localNameKey]

    if (variable.stackDepth < stack.length && variable.sourceLocation.start <= currentSourceLocation.start) {
      let name = variable.name
      if (name.indexOf('$') !== -1) {
        name = '<' + anonymousIncr + '>'
        anonymousIncr++
      }

      // 在使用 variable.type 之前检查它是否存在且有 decodeFromStack 方法
      if (variable.type && typeof variable.type.decodeFromStack === 'function') {
        try {
          locals[name] = await variable.type.decodeFromStack(variable.stackDepth, stack, formattedMemory, storageResolver, calldata, cursor, variable)
        } catch (e) {
          console.error(`Error decoding local variable '${name}':`, e)
          locals[name] = `<decoding failed - ${e.message}>`
        }
      } else {
        // 如果 variable.type 为 null 或没有 decodeFromStack 方法
        const typeName = variable.type ? (variable.type.typeName || 'unknown structure') : 'type info missing'
        console.warn(`Cannot decode local variable '${name}'. Reason: 'variable.type' is ${variable.type === null ? 'null' : 'invalid or missing decodeFromStack method'}. Declared type: ${variable.typeName || 'N/A'}`)
        locals[name] = `<${typeName} - decoding not possible>`
      }
    }
  }
  return locals
}

function formatMemory (memory) {
  if (memory instanceof Array) {
    memory = memory.join('').replace(/0x/g, '')
  }
  return memory
}
