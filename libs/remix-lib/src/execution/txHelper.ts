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
import { addressToHex, tConvertAddresses, tConvertTypes } from '../util'

export function makeFullTypeDefinition (typeDef) {
  if (typeDef && typeDef.type.indexOf('tuple') === 0 && typeDef.components) {
    const innerTypes = typeDef.components.map((innerType) => { return this.makeFullTypeDefinition(innerType) })
    return `tuple(${innerTypes.join(',')})${this.extractSize(typeDef.type)}`
  }
  return typeDef.type
}

export function tMakeFullTypeDefinition (typeDef) {
  if (typeDef && typeDef.type.indexOf('tuple') === 0 && typeDef.components) {
    const innerTypes = typeDef.components.map((innerType) => { return tMakeFullTypeDefinition(innerType) })
    return `tuple(${innerTypes.join(',')})${extractSize(typeDef.type)}`
  }

  if (/trcToken/.test(typeDef.type)) {
    return typeDef.type.replace(/trcToken/, 'uint256')
  }

  return typeDef.type
}

const tMapTuple = (components, args, dimension) => {
  if (dimension > 1) {
    if (args.length) {
      args.forEach(arg => {
        tMapTuple(components, arg, dimension - 1)
      })
    }
  } else {
    if (args.length && dimension) {
      args.forEach(arg => {
        encodeArgs(components, arg)
      })
    }
  }
}

const encodeArgs = (inputs = [], args) => {
  if (inputs.length) {
    inputs.forEach((input, i) => {
      const type = input.type

      if (args[i]) {
        if (type === 'address') {
          args[i] = addressToHex(args[i])
        } else if (type.match(/^([^\x5b]*)(\x5b|$)/)[0] === 'address[') {
          tConvertAddresses(args[i])
        } else if (type.indexOf('tuple') === 0) {
          if (extractSize(type)) {
            const dimension = extractSizeDimensions(type)
            tMapTuple(input.components, args[i], dimension)
          } else {
            encodeArgs(input.components, args[i])
          }
        }
      }
    })
  }
}

export function encodeParams (funABI, args) {
  const types = []

  if (funABI.inputs && funABI.inputs.length) {
    for (let i = 0; i < funABI.inputs.length; i++) {
      const type = funABI.inputs[i].type
      // "false" will be converting to `false` and "true" will be working
      // fine as abiCoder assume anything in quotes as `true`
      if (type === 'bool' && args[i] === 'false') {
        args[i] = false
      }
      types.push(type.indexOf('tuple') === 0 ? tMakeFullTypeDefinition(funABI.inputs[i]) : type)
      if (args.length < types.length) {
        args.push('')
      }
    }
  }

  encodeArgs(funABI.inputs, args)
  tConvertTypes(types)

  // NOTE: the caller will concatenate the bytecode and this
  //       it could be done here too for consistency
  const abiCoder = new ethers.utils.AbiCoder()
  return abiCoder.encode(types, args)
}

export function encodeFunctionId (funABI) {
  if (funABI.type === 'fallback' || funABI.type === 'receive') return '0x'
  const abi = new ethers.utils.Interface([funABI])
  return abi.getSighash(funABI.name)
}

export function getFunctionFragment (funABI): ethers.utils.Interface {
  if (funABI.type === 'fallback' || funABI.type === 'receive') return null
  return new ethers.utils.Interface([funABI])
}

export function sortAbiFunction (contractabi) {
  // Check if function is constant (introduced with Solidity 0.6.0)
  const isConstant = ({ stateMutability }) => stateMutability === 'view' || stateMutability === 'pure'
  // Sorts the list of ABI entries. Constant functions will appear first,
  // followed by non-constant functions. Within those t wo groupings, functions
  // will be sorted by their names.
  return contractabi.sort(function (a, b) {
    if (isConstant(a) && !isConstant(b)) {
      return 1
    } else if (isConstant(b) && !isConstant(a)) {
      return -1
    }
    // If we reach here, either a and b are both constant or both not; sort by name then
    // special case for fallback, receive and constructor function
    if (a.type === 'function' && typeof a.name !== 'undefined') {
      return a.name.localeCompare(b.name)
    } else if (a.type === 'constructor' || a.type === 'fallback' || a.type === 'receive') {
      return 1
    }
  })
}

export function getConstructorInterface (abi) {
  const funABI = { name: '', inputs: [], type: 'constructor', payable: false, outputs: [] }
  if (typeof abi === 'string') {
    try {
      abi = JSON.parse(abi)
    } catch (e) {
      console.log('exception retrieving ctor abi ' + abi)
      return funABI
    }
  }

  for (let i = 0; i < abi.length; i++) {
    if (abi[i].type === 'constructor') {
      funABI.inputs = abi[i].inputs || []
      funABI.payable = abi[i].payable
      funABI['stateMutability'] = abi[i].stateMutability
      break
    }
  }

  return funABI
}

export function serializeInputs (fnAbi) {
  let serialized = '('
  if (fnAbi.inputs && fnAbi.inputs.length) {
    serialized += fnAbi.inputs.map((input) => { return input.type }).join(',')
  }
  serialized += ')'
  return serialized
}

export function extractSize (type) {
  const size = type.match(/([a-zA-Z0-9])(\[.*\])/)
  return size ? size[2] : ''
}

function extractSizeDimensions (type) {
  const size = extractSize(type)
  return (size.match(/\]\[/g) || []).length + 1
}

export function getFunction (abi, fnName) {
  for (let i = 0; i < abi.length; i++) {
    const fn = abi[i]
    if (fn.type === 'function' && fnName === fn.name + '(' + fn.inputs.map((value) => {
      if (value.components) {
        const fullType = this.makeFullTypeDefinition(value)
        return fullType.replace(/tuple/g, '') // return of makeFullTypeDefinition might contain `tuple`, need to remove it cause `methodIdentifier` (fnName) does not include `tuple` keyword
      } else {
        return value.type
      }
    }).join(',') + ')') {
      return fn
    }
  }
  return null
}

export function getFallbackInterface (abi) {
  for (let i = 0; i < abi.length; i++) {
    if (abi[i].type === 'fallback') {
      return abi[i]
    }
  }
}

export function getReceiveInterface (abi) {
  for (let i = 0; i < abi.length; i++) {
    if (abi[i].type === 'receive') {
      return abi[i]
    }
  }
}

/**
  * return the contract obj of the given @arg name. Uses last compilation result.
  * return null if not found
  * @param {String} name    - contract name
  * @returns contract obj and associated file: { contract, file } or null
  */
export function getContract (contractName, contracts) {
  for (const file in contracts) {
    if (contracts[file][contractName]) {
      return { object: contracts[file][contractName], file: file }
    }
  }
  return null
}

/**
  * call the given @arg cb (function) for all the contracts. Uses last compilation result
  * stop visiting when cb return true
  * @param {Function} cb    - callback
  */
export function visitContracts (contracts, cb) {
  for (const file in contracts) {
    for (const name in contracts[file]) {
      if (cb({ name: name, object: contracts[file][name], file: file })) return
    }
  }
}

export function inputParametersDeclarationToString (abiinputs) {
  const inputs = (abiinputs || []).map((inp) => inp.type + ' ' + inp.name)
  return inputs.join(', ')
}
