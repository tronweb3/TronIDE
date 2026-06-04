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
import { encodeParams as encodeParamsHelper, encodeFunctionId, tMakeFullTypeDefinition } from './txHelper'
import { eachOfSeries } from 'async'
import { linkBytecode as linkBytecodeSolc } from 'solc/linker'
import { isValidAddress, addHexPrefix, BN } from 'ethereumjs-util'
import { tConvertTypes, addressToBase58 } from '../util'

const SAFE_INTEGER_MAX = new BN(Number.MAX_SAFE_INTEGER.toString(), 10)

/**
  * build the transaction data
  *
  * @param {Object} function abi
  * @param {Object} values to encode
  * @param {String} contractbyteCode
  */
export function encodeData (funABI, values, contractbyteCode) {
  let encoded
  let encodedHex
  try {
    encoded = encodeParamsHelper(funABI, values)
    encodedHex = encoded.toString('hex')
  } catch (e) {
    return { error: 'cannot encode arguments' }
  }
  if (contractbyteCode) {
    return { data: '0x' + contractbyteCode + encodedHex.replace('0x', '') }
  } else {
    return { data: encodeFunctionId(funABI) + encodedHex.replace('0x', '') }
  }
}

/**
* encode function / constructor parameters
*
* @param {Object} params    - input paramater of the function to call
* @param {Object} funAbi    - abi definition of the function to call. null if building data for the ctor.
* @param {Function} callback    - callback
*/
export function encodeParams (params, funAbi, callback) {
  let data: Buffer | string = ''
  let dataHex: string = ''
  let funArgs
  if (params.indexOf('raw:0x') === 0) {
    // in that case we consider that the input is already encoded and *does not* contain the method signature
    dataHex = params.replace('raw:0x', '')
    if (!isValidRawHex(dataHex)) {
      return callback('Error encoding arguments: invalid raw hex data')
    }
    data = Buffer.from(dataHex, 'hex')
  } else {
    try {
      params = normalizeJsonLikeParamLiterals(params)
      funArgs = JSON.parse('[' + params + ']')
    } catch (e) {
      return callback('Error encoding arguments: ' + e)
    }
    if (funArgs.length > 0) {
      try {
        data = encodeParamsHelper(funAbi, funArgs)
        dataHex = data.toString()
      } catch (e) {
        return callback('Error encoding arguments: ' + e)
      }
    }
    if (data.slice(0, 9) === 'undefined') {
      dataHex = data.slice(9)
    }
    if (data.slice(0, 2) === '0x') {
      dataHex = data.slice(2)
    }
  }
  callback(null, { data: data, dataHex: dataHex, funArgs: funArgs })
}

/**
* encode function call (function id + encoded parameters)
*
* @param {Object} params    - input paramater of the function to call
* @param {Object} funAbi    - abi definition of the function to call. null if building data for the ctor.
* @param {Function} callback    - callback
*/
export function encodeFunctionCall (params, funAbi, callback) {
  this.encodeParams(params, funAbi, (error, encodedParam) => {
    if (error) return callback(error)
    callback(null, { dataHex: encodeFunctionId(funAbi) + encodedParam.dataHex, funAbi, funArgs: encodedParam.funArgs })
  })
}

/**
* encode constructor creation and link with provided libraries if needed
*
* @param {Object} contract    - input paramater of the function to call
* @param {Object} params    - input paramater of the function to call
* @param {Object} funAbi    - abi definition of the function to call. null if building data for the ctor.
* @param {Object} linkLibraries    - contains {linkReferences} object which list all the addresses to be linked
* @param {Object} linkReferences    - given by the compiler, contains the proper linkReferences
* @param {Function} callback    - callback
*/
export function encodeConstructorCallAndLinkLibraries (contract, params, funAbi, linkLibraries, linkReferences, callback) {
  this.encodeParams(params, funAbi, (error, encodedParam) => {
    if (error) return callback(error)
    let bytecodeToDeploy = contract.evm.bytecode.object
    if (bytecodeToDeploy.indexOf('_') >= 0) {
      if (linkLibraries && linkReferences) {
        for (const libFile in linkLibraries) {
          for (const lib in linkLibraries[libFile]) {
            const address = linkLibraries[libFile][lib]
            if (!isValidAddress(address)) return callback(address + ' is not a valid address. Please check the provided address is valid.')
            bytecodeToDeploy = this.linkLibraryStandardFromlinkReferences(lib, address.replace('0x', ''), bytecodeToDeploy, linkReferences)
          }
        }
      }
    }
    if (bytecodeToDeploy.indexOf('_') >= 0) {
      return callback('Failed to link some libraries')
    }
    return callback(null, { dataHex: bytecodeToDeploy + encodedParam.dataHex, funAbi, funArgs: encodedParam.funArgs, contractBytecode: contract.evm.bytecode.object })
  })
}

/**
* encode constructor creation and deploy librairies if needed
*
* @param {String} contractName    - current contract name
* @param {Object} contract    - input paramater of the function to call
* @param {Object} contracts    - map of all compiled contracts.
* @param {Object} params    - input paramater of the function to call
* @param {Object} funAbi    - abi definition of the function to call. null if building data for the ctor.
* @param {Function} callback    - callback
* @param {Function} callbackStep  - callbackStep
* @param {Function} callbackDeployLibrary  - callbackDeployLibrary
* @param {Function} callback    - callback
*/
export function encodeConstructorCallAndDeployLibraries (contractName, contract, contracts, params, funAbi, callback, callbackStep, callbackDeployLibrary) {
  this.encodeParams(params, funAbi, (error, encodedParam) => {
    if (error) return callback(error)
    let dataHex = ''
    const contractBytecode = contract.evm.bytecode.object
    let bytecodeToDeploy = contract.evm.bytecode.object
    if (bytecodeToDeploy.indexOf('_') >= 0) {
      this.linkBytecode(contract, contracts, (err, bytecode) => {
        if (err) {
          callback('Error deploying required libraries: ' + err)
        } else {
          bytecodeToDeploy = bytecode + dataHex
          return callback(null, { dataHex: bytecodeToDeploy, funAbi, funArgs: encodedParam.funArgs, contractBytecode, contractName: contractName })
        }
      }, callbackStep, callbackDeployLibrary)
      return
    } else {
      dataHex = bytecodeToDeploy + encodedParam.dataHex
    }
    callback(null, { dataHex: bytecodeToDeploy, funAbi, funArgs: encodedParam.funArgs, contractBytecode, contractName: contractName })
  })
}

/**
* (DEPRECATED) build the transaction data
*
* @param {String} contractName
* @param {Object} contract    - abi definition of the current contract.
* @param {Object} contracts    - map of all compiled contracts.
* @param {Bool} isConstructor    - isConstructor.
* @param {Object} funAbi    - abi definition of the function to call. null if building data for the ctor.
* @param {Object} params    - input paramater of the function to call
* @param {Function} callback    - callback
* @param {Function} callbackStep  - callbackStep
* @param {Function} callbackDeployLibrary  - callbackDeployLibrary
*/
export function buildData (contractName, contract, contracts, isConstructor, funAbi, params, callback, callbackStep, callbackDeployLibrary) {
  let funArgs = []
  let data: Buffer | string = ''
  let dataHex: string = ''

  if (params.indexOf('raw:0x') === 0) {
    // in that case we consider that the input is already encoded and *does not* contain the method signature
    dataHex = params.replace('raw:0x', '')
    if (!isValidRawHex(dataHex)) {
      return callback('Error encoding arguments: invalid raw hex data')
    }
    data = Buffer.from(dataHex, 'hex')
  } else {
    try {
      if (params.length > 0) {
        funArgs = this.parseFunctionParams(params)
      }
    } catch (e) {
      return callback('Error encoding arguments: ' + e)
    }
    try {
      data = encodeParamsHelper(funAbi, funArgs)
      dataHex = data.toString()
    } catch (e) {
      return callback('Error encoding arguments: ' + e)
    }
    if (data.slice(0, 9) === 'undefined') {
      dataHex = data.slice(9)
    }
    if (data.slice(0, 2) === '0x') {
      dataHex = data.slice(2)
    }
  }
  let contractBytecode
  if (isConstructor) {
    contractBytecode = contract.evm.bytecode.object
    let bytecodeToDeploy = contract.evm.bytecode.object
    if (bytecodeToDeploy.indexOf('_') >= 0) {
      this.linkBytecode(contract, contracts, (err, bytecode) => {
        if (err) {
          callback('Error deploying required libraries: ' + err)
        } else {
          bytecodeToDeploy = bytecode + dataHex
          return callback(null, { dataHex: bytecodeToDeploy, funAbi, funArgs, contractBytecode, contractName: contractName })
        }
      }, callbackStep, callbackDeployLibrary)
      return
    } else {
      dataHex = bytecodeToDeploy + dataHex
    }
  } else {
    dataHex = encodeFunctionId(funAbi) + dataHex
  }
  callback(null, { dataHex, funAbi, funArgs, contractBytecode, contractName: contractName })
}

function isValidRawHex (value: string): boolean {
  return /^[0-9a-fA-F]*$/.test(value) && value.length % 2 === 0
}

export function atAddress () {}

export function linkBytecodeStandard (contract, contracts, callback, callbackStep, callbackDeployLibrary) {
  let contractBytecode = contract.evm.bytecode.object
  eachOfSeries(contract.evm.bytecode.linkReferences, (libs, file, cbFile) => {
    eachOfSeries(contract.evm.bytecode.linkReferences[file], (libRef, libName, cbLibDeployed) => {
      const library = contracts[file][libName]
      if (library) {
        this.deployLibrary(file + ':' + libName, libName, library, contracts, (error, address) => {
          if (error) {
            return cbLibDeployed(error)
          }
          let hexAddress = address.toString('hex')
          if (hexAddress.slice(0, 2) === '0x') {
            hexAddress = hexAddress.slice(2)
          }
          contractBytecode = this.linkLibraryStandard(libName, hexAddress, contractBytecode, contract)
          cbLibDeployed()
        }, callbackStep, callbackDeployLibrary)
      } else {
        cbLibDeployed('Cannot find compilation data of library ' + libName)
      }
    }, (error) => {
      cbFile(error)
    })
  }, (error) => {
    if (error) {
      callbackStep(error)
    }
    callback(error, contractBytecode)
  })
}

export function linkBytecodeLegacy (contract, contracts, callback, callbackStep, callbackDeployLibrary) {
  const libraryRefMatch = contract.evm.bytecode.object.match(/__([^_]{1,36})__/)
  if (!libraryRefMatch) {
    return callback('Invalid bytecode format.')
  }
  const libraryName = libraryRefMatch[1]
  // file_name:library_name
  const libRef = libraryName.match(/(.*):(.*)/)
  if (!libRef) {
    return callback('Cannot extract library reference ' + libraryName)
  }
  if (!contracts[libRef[1]] || !contracts[libRef[1]][libRef[2]]) {
    return callback('Cannot find library reference ' + libraryName)
  }
  const libraryShortName = libRef[2]
  const library = contracts[libRef[1]][libraryShortName]
  if (!library) {
    return callback('Library ' + libraryName + ' not found.')
  }
  this.deployLibrary(libraryName, libraryShortName, library, contracts, (err, address) => {
    if (err) {
      return callback(err)
    }
    let hexAddress = address.toString('hex')
    if (hexAddress.slice(0, 2) === '0x') {
      hexAddress = hexAddress.slice(2)
    }
    contract.evm.bytecode.object = this.linkLibrary(libraryName, hexAddress, contract.evm.bytecode.object)
    this.linkBytecode(contract, contracts, callback, callbackStep, callbackDeployLibrary)
  }, callbackStep, callbackDeployLibrary)
}

export function linkBytecode (contract, contracts, callback?, callbackStep?, callbackDeployLibrary?) {
  if (contract.evm.bytecode.object.indexOf('_') < 0) {
    return callback(null, contract.evm.bytecode.object)
  }
  if (contract.evm.bytecode.linkReferences && Object.keys(contract.evm.bytecode.linkReferences).length) {
    this.linkBytecodeStandard(contract, contracts, callback, callbackStep, callbackDeployLibrary)
  } else {
    this.linkBytecodeLegacy(contract, contracts, callback, callbackStep, callbackDeployLibrary)
  }
}

export function deployLibrary (libraryName, libraryShortName, library, contracts, callback, callbackStep, callbackDeployLibrary) {
  const address = library.address
  if (address) {
    return callback(null, address)
  }
  const bytecode = library.evm.bytecode.object
  if (bytecode.indexOf('_') >= 0) {
    this.linkBytecode(library, contracts, (err, bytecode) => {
      if (err) callback(err)
      else {
        library.evm.bytecode.object = bytecode
        this.deployLibrary(libraryName, libraryShortName, library, contracts, callback, callbackStep, callbackDeployLibrary)
      }
    }, callbackStep, callbackDeployLibrary)
  } else {
    callbackStep(`creation of library ${libraryName} pending...`)
    const data = { dataHex: bytecode, funAbi: { type: 'constructor' }, funArgs: [], contractBytecode: bytecode, contractName: libraryShortName, contractABI: library.abi }
    callbackDeployLibrary({ data: data, useCall: false }, (err, txResult) => {
      if (err) {
        return callback(err)
      }
      const address = txResult.receipt.contractAddress
      library.address = address
      callback(err, address)
    })
  }
}

export function linkLibraryStandardFromlinkReferences (libraryName, address, bytecode, linkReferences) {
  for (const file in linkReferences) {
    for (const libName in linkReferences[file]) {
      if (libraryName === libName) {
        bytecode = this.setLibraryAddress(address, bytecode, linkReferences[file][libName])
      }
    }
  }
  return bytecode
}

export function linkLibraryStandard (libraryName, address, bytecode, contract) {
  return this.linkLibraryStandardFromlinkReferences(libraryName, address, bytecode, contract.evm.bytecode.linkReferences)
}

export function setLibraryAddress (address, bytecodeToLink, positions) {
  if (positions) {
    for (const pos of positions) {
      const regpos = bytecodeToLink.match(new RegExp(`(.{${2 * pos.start}})(.{${2 * pos.length}})(.*)`))
      if (regpos) {
        bytecodeToLink = regpos[1] + address + regpos[3]
      }
    }
  }
  return bytecodeToLink
}

export function linkLibrary (libraryName, address, bytecodeToLink) {
  return linkBytecodeSolc(bytecodeToLink, { [libraryName]: addHexPrefix(address) })
}

export function decodeResponse (response, fnabi) {
  // Only decode if there supposed to be fields
  if (fnabi.outputs && fnabi.outputs.length > 0) {
    try {
      let i
      const outputTypes = []
      for (i = 0; i < fnabi.outputs.length; i++) {
        const type = fnabi.outputs[i].type
        outputTypes.push(type.indexOf('tuple') === 0 ? tMakeFullTypeDefinition(fnabi.outputs[i]) : type)
      }

      tConvertTypes(outputTypes)

      if (!response || !response.length) response = new Uint8Array(32 * fnabi.outputs.length) // ensuring the data is at least filled by 0 cause `AbiCoder` throws if there's not engouh data
      // decode data
      const abiCoder = new ethers.utils.AbiCoder()
      const decodedObj = abiCoder.decode(outputTypes, response)

      const json = {}
      for (i = 0; i < outputTypes.length; i++) {
        const name = fnabi.outputs[i].name
        const val = outputTypes[i] == 'address' ? addressToBase58(decodedObj[i]) : decodedObj[i]
        json[i] = outputTypes[i] + ': ' + (name ? name + ' ' + val : val)
      }

      return json
    } catch (e) {
      return { error: 'Failed to decode output: ' + e }
    }
  }
  return {}
}

export function parseFunctionParams (params) {
  let args = []
  // Check if parameter string starts with array or string
  let startIndex = this.isArrayOrStringStart(params, 0) ? -1 : 0
  for (let i = 0; i < params.length; i++) {
    // If a quote is received
    if (params.charAt(i) === '"') {
      startIndex = -1
      let endQuoteIndex = false
      // look for closing quote. On success, push the complete string in arguments list
      for (let j = i + 1; !endQuoteIndex; j++) {
        if (params.charAt(j) === '"') {
          args.push(params.substring(i + 1, j))
          endQuoteIndex = true
          i = j
        }
        // Throw error if end of params string is arrived but couldn't get end quote
        if (!endQuoteIndex && j === params.length - 1) {
          throw new Error('invalid params')
        }
      }
    } else if (params.charAt(i) === '[') { // If an array/struct opening bracket is received
      startIndex = -1
      let bracketCount = 1
      let j
      for (j = i + 1; bracketCount !== 0; j++) {
        // Increase count if another array opening bracket is received (To handle nested array)
        if (params.charAt(j) === '[') {
          bracketCount++
        } else if (params.charAt(j) === ']') { // // Decrease count if an array closing bracket is received (To handle nested array)
          bracketCount--
        }
        // Throw error if end of params string is arrived but couldn't get end of tuple
        if (bracketCount !== 0 && j === params.length - 1) {
          throw new Error('invalid tuple params')
        }
      }
      // If bracketCount = 0, it means complete array/nested array parsed, push it to the arguments list
      args.push(JSON.parse(normalizeJsonLikeParamLiterals(params.substring(i, j))))
      i = j - 1
    } else if (params.charAt(i) === ',') {
      // if startIndex >= 0, it means a parameter was being parsed, it can be first or other parameter
      if (startIndex >= 0) {
        args.push(params.substring(startIndex, i))
      }
      // Register start index of a parameter to parse
      startIndex = this.isArrayOrStringStart(params, i + 1) ? -1 : i + 1
    } else if (startIndex >= 0 && i === params.length - 1) {
      // If start index is registered and string is completed (To handle last parameter)
      args.push(params.substring(startIndex, params.length))
    }
  }
  args = args.map(e => {
    if (!Array.isArray(e)) {
      return e.trim()
    } else {
      return e
    }
  })
  return args
}

export function findUnsafeIntegerLiteralParams (params, inputs: Array<{ name?: string, type?: string }> = []) {
  const findingsByIndex = new Map<number, { index: number, name?: string, type?: string, value: string }>()
  let currentArgIndex = 0
  let inString = false
  let escaping = false
  let bracketDepth = 0

  for (let i = 0; i < params.length; i++) {
    const char = params.charAt(i)

    if (inString) {
      if (escaping) {
        escaping = false
      } else if (char === '\\') {
        escaping = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '[' || char === '{') {
      bracketDepth++
      continue
    }

    if (char === ']' || char === '}') {
      bracketDepth = Math.max(0, bracketDepth - 1)
      continue
    }

    if (bracketDepth === 0 && char === ',') {
      currentArgIndex++
      continue
    }

    const input = inputs[currentArgIndex]
    if (!shouldValidateUnsafeIntegerInput(input)) {
      continue
    }

    if (isIntegerLiteralStart(params, i)) {
      const endIndex = findIntegerLiteralEnd(params, i)
      const token = params.substring(i, endIndex)
      const normalizedToken = token.charAt(0) === '-' ? token.slice(1) : token
      const value = new BN(normalizedToken, 10)

      if (value.gt(SAFE_INTEGER_MAX) && !findingsByIndex.has(currentArgIndex)) {
        findingsByIndex.set(currentArgIndex, {
          index: currentArgIndex,
          name: input?.name,
          type: input?.type,
          value: token
        })
      }
      i = endIndex - 1
      continue
    }

    if (isHexLiteralStart(params, i)) {
      const endIndex = findHexLiteralEnd(params, i)
      const token = params.substring(i, endIndex)
      const value = new BN(token.replace(/^0[xX]/, ''), 16)

      if (value.gt(SAFE_INTEGER_MAX) && !findingsByIndex.has(currentArgIndex)) {
        findingsByIndex.set(currentArgIndex, {
          index: currentArgIndex,
          name: input?.name,
          type: input?.type,
          value: token
        })
      }
      i = endIndex - 1
    }
  }

  return Array.from(findingsByIndex.values())
}

export function isArrayOrStringStart (str, index) {
  return str.charAt(index) === '"' || str.charAt(index) === '['
}

function shouldValidateUnsafeIntegerInput (input?: { type?: string }) {
  if (!input || !input.type) return true
  return /^u?int(?:\d+)?(?:\[\d*\])*$/.test(input.type)
}

function normalizeJsonLikeParamLiterals (value: string): string {
  let normalized = ''
  let inString = false
  let escaping = false

  for (let i = 0; i < value.length; i++) {
    const char = value.charAt(i)

    if (inString) {
      normalized += char
      if (escaping) {
        escaping = false
      } else if (char === '\\') {
        escaping = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      normalized += char
      continue
    }

    if (isIntegerLiteralStart(value, i)) {
      const endIndex = findIntegerLiteralEnd(value, i)
      const token = value.substring(i, endIndex)
      normalized += `"${token}"`
      i = endIndex - 1
      continue
    }

    if (isHexLiteralStart(value, i)) {
      const endIndex = findHexLiteralEnd(value, i)
      const token = value.substring(i, endIndex)
      normalized += `"${token}"`
      i = endIndex - 1
      continue
    }

    normalized += char
  }

  return normalized
}

function isIntegerLiteralStart (value: string, index: number): boolean {
  const char = value.charAt(index)

  if (char === '-') {
    return /\d/.test(value.charAt(index + 1)) && isBoundaryBefore(value, index) && isIntegerBoundaryAfter(value, findIntegerLiteralEnd(value, index))
  }

  return /\d/.test(char) && !isHexPrefix(value, index) && isBoundaryBefore(value, index) && isIntegerBoundaryAfter(value, findIntegerLiteralEnd(value, index))
}

function findIntegerLiteralEnd (value: string, index: number): number {
  let endIndex = index
  if (value.charAt(endIndex) === '-') endIndex++
  while (/\d/.test(value.charAt(endIndex))) endIndex++
  return endIndex
}

function isIntegerBoundaryAfter (value: string, index: number): boolean {
  const char = value.charAt(index)
  return !char || /[\s,\]\}]/.test(char)
}

function isHexLiteralStart (value: string, index: number): boolean {
  if (!isHexPrefix(value, index) || !isBoundaryBefore(value, index)) return false

  const endIndex = findHexLiteralEnd(value, index)
  return endIndex > index + 2 && isIntegerBoundaryAfter(value, endIndex)
}

function isHexPrefix (value: string, index: number): boolean {
  return value.charAt(index) === '0' && /[xX]/.test(value.charAt(index + 1))
}

function findHexLiteralEnd (value: string, index: number): number {
  let endIndex = index + 2
  while (/[0-9a-fA-F]/.test(value.charAt(endIndex))) endIndex++
  return endIndex
}

function isBoundaryBefore (value: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const char = value.charAt(i)
    if (!/\s/.test(char)) return /[[{,:]/.test(char)
  }
  return true
}
