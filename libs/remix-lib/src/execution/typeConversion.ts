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
import { BN, bufferToHex } from 'ethereumjs-util'

export function toInt (h) {
  if (h.indexOf && h.indexOf('0x') === 0) {
    return (new BN(h.replace('0x', ''), 16)).toString(10)
  } else if ((h.constructor && h.constructor.name === 'BigNumber') || BN.isBN(h)) {
    return h.toString(10)
  }
  return h
}

export var stringify = convertToString

function convertToString (v) {
  try {
    if (v instanceof Array) {
      const ret = []
      for (var k in v) {
        ret.push(convertToString(v[k]))
      }
      return ret
    } else if (BN.isBN(v) || (v.constructor && v.constructor.name === 'BigNumber')) {
      return v.toString(10)
    } else if (v._isBuffer) {
      return bufferToHex(v)
    } else if (typeof v === 'object') {
      const retObject = {}
      for (const i in v) {
        retObject[i] = convertToString(v[i])
      }
      return retObject
    } else {
      return v
    }
  } catch (e) {
    console.log(e)
    return v
  }
}
