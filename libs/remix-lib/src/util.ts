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
import { BN, bufferToHex, keccak, setLengthLeft, toBuffer, addHexPrefix } from 'ethereumjs-util'
import stringSimilarity from 'string-similarity'
import { ethers } from 'ethers'

/*
 contains misc util: @TODO should be splitted
  - hex conversion
  - binary search
  - CALL related look up
  - sha3 calculation
  - swarm hash extraction
  - bytecode comparison
*/
/*
    ints: IntArray
  */

/**
   * Converts a hex string to an array of integers.
   */
export function hexToIntArray (hexString) {
  if (hexString.slice(0, 2) === '0x') {
    hexString = hexString.slice(2)
  }
  const integers = []
  for (let i = 0; i < hexString.length; i += 2) {
    integers.push(parseInt(hexString.slice(i, i + 2), 16))
  }
  return integers
}

/*
    ints: list of BNs
  */
export function hexListFromBNs (bnList) {
  const ret = []
  for (const k in bnList) {
    const v = bnList[k]
    if (BN.isBN(v)) {
      ret.push('0x' + v.toString('hex', 64))
    } else {
      ret.push('0x' + (new BN(v)).toString('hex', 64)) // TEMP FIX TO REMOVE ONCE https://github.com/ethereumjs/ethereumjs-vm/pull/293 is released
    }
  }
  return ret
}

/*
  ints: ints: IntArray
*/
export function formatMemory (mem) {
  // mem may be a Buffer or — in the current @tvmjs generation — a Uint8Array.
  // Normalise to a Buffer first: Uint8Array.toString('hex') does NOT emit hex,
  // so bufferToHex(uint8array) would corrupt the decoded memory (and break
  // memory-backed Solidity locals such as strings/bytes).
  const memBuffer = mem == null ? Buffer.alloc(0) : (Buffer.isBuffer(mem) ? mem : Buffer.from(mem as any))
  const hexMem = bufferToHex(memBuffer).substr(2)
  const ret = []
  for (let k = 0; k < hexMem.length; k += 32) {
    const row = hexMem.substr(k, 32)
    ret.push(row)
  }
  return ret
}

/*
  Binary Search:
  Assumes that @arg array is sorted increasingly
  return largest i such that array[i] <= target; return -1 if array[0] > target || array is empty
*/
export function findLowerBound (target, array) {
  let start = 0
  let length = array.length
  while (length > 0) {
    const half = length >> 1
    const middle = start + half
    if (array[middle] <= target) {
      length = length - 1 - half
      start = middle + 1
    } else {
      length = half
    }
  }
  return start - 1
}

/*
  Binary Search:
  Assumes that @arg array is sorted increasingly
  return largest array[i] such that array[i] <= target; return null if array[0] > target || array is empty
*/
export function findLowerBoundValue (target, array) {
  const index = this.findLowerBound(target, array)
  return index >= 0 ? array[index] : null
}

/*
  Binary Search:
  Assumes that @arg array is sorted increasingly
  return Return i such that |array[i] - target| is smallest among all i and -1 for an empty array.
  Returns the smallest i for multiple candidates.
*/
export function findClosestIndex (target, array): number {
  if (array.length === 0) {
    return -1
  }
  const index = this.findLowerBound(target, array)
  if (index < 0) {
    return 0
  } else if (index >= array.length - 1) {
    return array.length - 1
  } else {
    const middle = (array[index] + array[index + 1]) / 2
    return target <= middle ? index : index + 1
  }
}

/**
  * Find the call from @args rootCall which contains @args index (recursive)
  *
  * @param {Int} index - index of the vmtrace
  * @param {Object} rootCall  - call tree, built by the trace analyser
  * @return {Object} - return the call which include the @args index
  */
export function findCall (index, rootCall) {
  const ret = buildCallPath(index, rootCall)
  return ret[ret.length - 1]
}

/**
  * Find calls path from @args rootCall which leads to @args index (recursive)
  *
  * @param {Int} index - index of the vmtrace
  * @param {Object} rootCall  - call tree, built by the trace analyser
  * @return {Array} - return the calls path to @args index
  */
export function buildCallPath (index, rootCall) {
  const ret = []
  findCallInternal(index, rootCall, ret)
  return ret
}

/**
  * sha3 the given @arg value (left pad to 32 bytes)
  *
  * @param {String} value - value to sha3
  * @return {Object} - return sha3ied value
  */
// eslint-disable-next-line camelcase
export function sha3_256 (value) {
  value = toBuffer(addHexPrefix(value))
  const retInBuffer: Buffer = keccak(setLengthLeft(value, 32))
  return bufferToHex(retInBuffer)
}

/**
  * return a regex which extract the swarmhash from the bytecode.
  *
  * @return {RegEx}
  */
export function swarmHashExtraction () {
  return /a165627a7a72305820([0-9a-f]{64})0029$/
}

/**
  * return a regex which extract the swarmhash from the bytecode, from POC 0.3
  *
  * @return {RegEx}
  */
export function swarmHashExtractionPOC31 () {
  return /a265627a7a72315820([0-9a-f]{64})64736f6c6343([0-9a-f]{6})0032$/
}

/**
  * return a regex which extract the swarmhash from the bytecode, from POC 0.3
  *
  * @return {RegEx}
  */
export function swarmHashExtractionPOC32 () {
  return /a265627a7a72305820([0-9a-f]{64})64736f6c6343([0-9a-f]{6})0032$/
}

/**
  * return a regex which extract the cbor encoded metadata : {"ipfs": <IPFS hash>, "solc": <compiler version>} from the bytecode.
  * ref https://solidity.readthedocs.io/en/v0.6.6/metadata.html?highlight=ipfs#encoding-of-the-metadata-hash-in-the-bytecode
  * @return {RegEx}
  */
export function cborEncodedValueExtraction () {
  return /64697066735822([0-9a-f]{68})64736f6c6343([0-9a-f]{6})0033$/
}

export function extractcborMetadata (value) {
  return value.replace(this.cborEncodedValueExtraction(), '')
}

export function extractSwarmHash (value) {
  value = value.replace(this.swarmHashExtraction(), '')
  value = value.replace(this.swarmHashExtractionPOC31(), '')
  value = value.replace(this.swarmHashExtractionPOC32(), '')
  return value
}

export function tronEncodedValueExtraction () {
  return /6474726f6e5822([0-9a-f]{68})64736f6c6343([0-9a-f]{6})0033$/
}

export function extractTronMetadata (value) {
  return value.replace(this.tronEncodedValueExtraction(), '')
}

export function tronHashExtraction () {
  return /a16474726f6e5820([0-9a-f]{64})0029$/
}

export function tronHashExtractionPOC32 () {
  return /a26474726f6e5820([0-9a-f]{64})64736f6c6343([0-9a-f]{6})0032$/
}

export function extractTronHash (value) {
  value = value.replace(this.tronHashExtraction(), '')
  value = value.replace(this.tronHashExtractionPOC32(), '')
  return value
}

/**
  * Compare bytecode. return true if the code is equal (handle swarm hash and library references)
  * @param {String} code1 - the bytecode that is actually deployed (contains resolved library reference and a potentially different swarmhash)
  * @param {String} code2 - the bytecode generated by the compiler (contains unresolved library reference and a potentially different swarmhash)
                            this will return false if the generated bytecode is empty (asbtract contract cannot be deployed)
  *
  * @return {bool}
  */
export function compareByteCode (code1, code2) {
  if (code1 === code2) return true
  if (code2 === '0x') return false // abstract contract. see comment

  if (code2.substr(2, 46) === '7300000000000000000000000000000000000000003014') {
    // testing the following signature: PUSH20 00..00 ADDRESS EQ
    // in the context of a library, that slot contains the address of the library (pushed by the compiler to avoid calling library other than with a DELEGATECALL)
    // if code2 is not a library, well we still suppose that the comparison remain relevant even if we remove some information from `code1`
    code1 = replaceLibReference(code1, 4)
  }
  let pos = -1
  while ((pos = code2.search(/__(.*)__/)) !== -1) {
    code2 = replaceLibReference(code2, pos)
    code1 = replaceLibReference(code1, pos)
  }
  code1 = this.extractSwarmHash(code1)
  code1 = this.extractcborMetadata(code1)
  code1 = this.extractTronHash(code1)
  code1 = this.extractTronMetadata(code1)
  code2 = this.extractSwarmHash(code2)
  code2 = this.extractcborMetadata(code2)
  code2 = this.extractTronHash(code2)
  code2 = this.extractTronMetadata(code2)

  if (code1 && code2) {
    const compare = stringSimilarity.compareTwoStrings(code1, code2)
    return compare > 0.93
  }

  return false
}
/* util extracted out from remix-ide. @TODO split this file, cause it mix real util fn with solidity related stuff ... */
export function groupBy (arr, key) {
  return arr.reduce((sum, item) => {
    const groupByVal = item[key]
    const groupedItems = sum[groupByVal] || []
    groupedItems.push(item)
    sum[groupByVal] = groupedItems
    return sum
  }, {})
}

export function concatWithSeperator (list, seperator) {
  return list.reduce((sum, item) => sum + item + seperator, '').slice(0, -seperator.length)
}

export function escapeRegExp (str) {
  return str.replace(/[-[\]/{}()+?.\\^$|]/g, '\\$&')
}

function replaceLibReference (code, pos) {
  return code.substring(0, pos) + '0000000000000000000000000000000000000000' + code.substring(pos + 40)
}

function findCallInternal (index, rootCall, callsPath) {
  const calls = Object.keys(rootCall.calls)
  const ret = rootCall
  callsPath.push(rootCall)
  for (const k in calls) {
    const subCall = rootCall.calls[calls[k]]
    if (index >= subCall.start && index <= subCall.return) {
      findCallInternal(index, subCall, callsPath)
      break
    }
  }
  return ret
}

export function tConvertLogs (logs = []) {
  logs.forEach(_ => {
    _.address = `0x${_.address}`
    _.data = `0x${_.data ? _.data : ''}`
    if (_.topics) {
      const { topics } = _
      for (let i = 0; i < topics.length; i++) {
        topics[i] = `0x${topics[i]}`
      }
    } else {
      _.topics = ['0x']
    }
  })
}

export function tConvertTypes (types) {
  for (let i = 0; i < types.length; i++) {
    const type = types[i]
    if (/trcToken/.test(type)) {
      types[i] = type.replace(/trcToken/, 'uint256')
    }
  }
}

export const tConvertAddresses = addrArr => {
  if (Array.isArray(addrArr)) {
    addrArr.forEach((addrs, i) => {
      addrArr[i] = tConvertAddresses(addrs)
    })
    return addrArr
  } else {
    return addressToHex(addrArr)
  }
}

export function addressToBase58 (address) {
  const isHexAddress = str => { // 0x|41 prefixed, hexadecimal, 40digit
    return /^(0x|41)[0-9a-fA-F]{40}$/.test(str)
  }
  const encodeBase58Address = (hexString) => {
    hexString = hexString.replace(/^0x/, '41')
    const hexAddress = Buffer.from(ethers.utils.arrayify(`0x${hexString}`))

    const hash0 = ethers.utils.sha256(hexAddress)
    const hash1 = ethers.utils.sha256(hash0)
    const checkSum = Buffer.from([...hexAddress, ...Buffer.from(ethers.utils.arrayify(hash1)).slice(0, 4)])
    return ethers.utils.base58.encode(checkSum)
  }

  if (isHexAddress(address)) {
    return encodeBase58Address(address)
  }

  return address
}

export function addressToHex (address) {
  const isHexAddress = str => { // 0x prefixed, hexadecimal, 40digit
    return /^0x[0-9a-fA-F]{40}$/.test(str)
  }

  const isTronHexAddress = str => { // 41 prefixed, hexadecimal, 40digit
    return /^41[0-9a-fA-F]{40}$/.test(str)
  }

  const decodeBase58Address = base58String => {
    if (typeof (base58String) !== 'string') {
      return false
    }

    if (base58String.length <= 4) {
      return false
    }

    let address = ethers.utils.base58.decode(base58String)

    const len = address.length
    const offset = len - 4
    const checkSum0 = address.slice(offset)

    address = address.slice(0, offset)

    const hash0 = ethers.utils.sha256(address)
    const hash1 = ethers.utils.sha256(hash0)
    const checkSum1 = Buffer.from(ethers.utils.arrayify(hash1)).slice(0, 4)

    if (checkSum0[0] === checkSum1[0] && checkSum0[1] === checkSum1[1] && checkSum0[2] === checkSum1[2] && checkSum0[3] === checkSum1[3]
    ) {
      return Buffer.from(address).toString('hex').replace(/^(41)/, '0x')
    }

    throw new Error('Invalid address provided')
  }

  if (isHexAddress(address)) {
    return address.toLowerCase()
  }

  if (isTronHexAddress(address)) {
    return address.replace(/^(41)/, '0x').toLowerCase()
  }

  return decodeBase58Address(address)
}
