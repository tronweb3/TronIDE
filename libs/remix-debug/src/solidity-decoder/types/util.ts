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
import { BN, bufferToHex, unpadHexString } from 'ethereumjs-util'

export function decodeIntFromHex (value, byteLength, signed) {
  let bigNumber = new BN(value, 16)
  if (signed) {
    bigNumber = bigNumber.fromTwos(8 * byteLength)
  }
  return bigNumber.toString(10)
}

export function readFromStorage (slot, storageResolver): Promise<string> {
  const hexSlot = '0x' + normalizeHex(bufferToHex(slot))
  return new Promise((resolve, reject) => {
    storageResolver.storageSlot(hexSlot, (error, slot) => {
      if (error) {
        return reject(error)
      }
      if (!slot) {
        slot = { key: slot, value: '' }
      }
      return resolve(normalizeHex(slot.value))
    })
  })
}

/**
 * @returns a hex encoded byte slice of length @arg byteLength from inside @arg slotValue.
 *
 * @param {String} slotValue  - hex encoded value to extract the byte slice from
 * @param {Int} byteLength  - Length of the byte slice to extract
 * @param {Int} offsetFromLSB  - byte distance from the right end slot value to the right end of the byte slice
 */
export function extractHexByteSlice (slotValue, byteLength, offsetFromLSB) {
  const offset = slotValue.length - 2 * offsetFromLSB - 2 * byteLength
  return slotValue.substr(offset, 2 * byteLength)
}

/**
 * @returns a hex encoded storage content at the given @arg location. it does not have Ox prefix but always has the full length.
 *
 * @param {Object} location  - object containing the slot and offset of the data to extract.
 * @param {Object} storageResolver  - storage resolver
 * @param {Int} byteLength  - Length of the byte slice to extract
 */
export async function extractHexValue (location, storageResolver, byteLength) {
  let slotvalue
  try {
    slotvalue = await readFromStorage(location.slot, storageResolver)
  } catch (e) {
    return ''
  }
  return extractHexByteSlice(slotvalue, byteLength, location.offset)
}

export function toBN (value) {
  if (value instanceof BN) {
    return value
  } else if (value.match && value.match(/^(0x)?([a-f0-9]*)$/)) {
    value = unpadHexString(value)
    value = new BN(value === '' ? '0' : value, 16)
  } else if (!isNaN(value)) {
    value = new BN(value)
  }
  return value
}

export function add (value1, value2) {
  return toBN(value1).add(toBN(value2))
}

export function sub (value1, value2) {
  return toBN(value1).sub(toBN(value2))
}

export function removeLocation (type) {
  return type.replace(/( storage ref| storage pointer| memory| calldata)/g, '')
}

export function extractLocation (type) {
  const match = type.match(/( storage ref| storage pointer| memory| calldata)?$/)
  if (match[1] !== '') {
    return match[1].trim()
  }
  return null
}

export function extractLocationFromAstVariable (node) {
  if (node.storageLocation !== 'default') {
    return node.storageLocation
  } else if (node.stateVariable) {
    return 'storage'
  }
  return 'default' // local variables => storage, function parameters & return values => memory, state => storage
}

export function normalizeHex (hex): string {
  hex = hex.replace('0x', '')
  if (hex.length < 64) {
    return (new Array(64 - hex.length + 1).join('0')) + hex
  }
  return hex
}
