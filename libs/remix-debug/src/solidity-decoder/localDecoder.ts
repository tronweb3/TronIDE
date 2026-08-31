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

import { ethers } from 'ethers'

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
          const calldataValue = decodeInputParameterFromCalldata(variable, calldata, vmtraceIndex)
          locals[name] = calldataValue === null
            ? await variable.type.decodeFromStack(variable.stackDepth, stack, formattedMemory, storageResolver, calldata, cursor, variable)
            : calldataValue
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

function decodeInputParameterFromCalldata (variable, calldata, vmtraceIndex) {
  if (!variable.decodeFromCalldata ||
    variable.calldataEntryStep !== vmtraceIndex ||
    !variable.abi ||
    variable.parameterIndex === undefined) return null
  const rawCalldata = Array.isArray(calldata) ? calldata[0] : calldata
  if (typeof rawCalldata !== 'string' || rawCalldata.length < 10) return null

  try {
    const iface = new ethers.utils.Interface(variable.abi)
    const functionFragment = iface.getFunction(rawCalldata.slice(0, 10))
    if (!functionFragment ||
      functionFragment.name !== variable.functionName ||
      functionFragment.inputs.length !== variable.functionParameterCount) return null
    if (variable.functionSelector &&
      iface.getSighash(functionFragment).slice(2).toLowerCase() !== variable.functionSelector.toLowerCase()) return null

    const decoded = iface.decodeFunctionData(functionFragment, rawCalldata)
    const abiInput = functionFragment.inputs[variable.parameterIndex]
    if (!abiInput || decoded[variable.parameterIndex] === undefined) return null
    return formatCalldataValue(decoded[variable.parameterIndex], abiInput, variable.type)
  } catch (error) {
    return null
  }
}

function formatCalldataValue (value, abiType, decoderType) {
  const typeName = decoderType && decoderType.typeName ? decoderType.typeName : abiType.type

  if (abiType.baseType === 'array' && Array.isArray(value)) {
    const underlyingType = decoderType && decoderType.underlyingType
    return {
      value: value.map(item => formatCalldataValue(item, abiType.arrayChildren, underlyingType)),
      length: '0x' + value.length.toString(16),
      type: typeName
    }
  }

  if (abiType.baseType === 'tuple' && Array.isArray(value)) {
    const tuple = {}
    abiType.components.forEach((component, index) => {
      const member = decoderType && decoderType.members && decoderType.members[index]
      tuple[component.name || index] = formatCalldataValue(value[index], component, member && member.type)
    })
    return { value: tuple, type: typeName }
  }

  if (typeName === 'string') {
    const raw = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(value))
    return {
      length: '0x' + ethers.utils.hexDataLength(raw).toString(16),
      raw,
      type: typeName,
      value
    }
  }

  if (abiType.baseType === 'bytes') {
    return {
      length: '0x' + ethers.utils.hexDataLength(value).toString(16),
      value,
      type: typeName
    }
  }

  if (decoderType && decoderType.basicType === 'ValueType' && typeof decoderType.decodeValue === 'function') {
    let encodedValue
    const integerType = abiType.type.match(/^(u?int)(\d*)$/)
    if (integerType) {
      const bitWidth = Number(integerType[2] || 256)
      const integerValue = ethers.BigNumber.from(value)
      encodedValue = (integerType[1] === 'int' ? integerValue.toTwos(bitWidth) : integerValue)
        .toHexString()
        .replace('0x', '')
    } else if (ethers.BigNumber.isBigNumber(value)) encodedValue = value.toHexString().replace('0x', '')
    else if (typeof value === 'boolean') encodedValue = value ? '01' : '00'
    else encodedValue = String(value).replace('0x', '')
    return { value: decoderType.decodeValue(encodedValue), type: typeName }
  }

  return {
    value: ethers.BigNumber.isBigNumber(value) ? value.toString() : value,
    type: typeName
  }
}

function formatMemory (memory) {
  if (memory instanceof Array) {
    memory = memory.join('').replace(/0x/g, '')
  }
  return memory
}
