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
import { DynamicByteArray } from './DynamicByteArray'

export class StringType extends DynamicByteArray {
  typeName

  constructor (location) {
    super(location)
    this.typeName = 'string'
  }

  async decodeFromStorage (location, storageResolver) {
    let decoded: any = '0x'
    try {
      decoded = await super.decodeFromStorage(location, storageResolver)
    } catch (e) {
      console.log(e)
      return '<decoding failed - ' + e.message + '>'
    }
    return format(decoded)
  }

  async decodeFromStack (stackDepth, stack, memory, calldata, variableDetails?) {
    try {
      return await super.decodeFromStack(stackDepth, stack, memory, null, calldata, variableDetails)
    } catch (e) {
      console.log(e)
      return '<decoding failed - ' + e.message + '>'
    }
  }

  decodeFromMemoryInternal (offset, memory) {
    const decoded = super.decodeFromMemoryInternal(offset, memory)
    return format(decoded)
  }
}

function format (decoded) {
  if (decoded.error) {
    return decoded
  }
  let value = decoded.value
  value = value.replace('0x', '').replace(/(..)/g, '%$1')
  const ret = { length: decoded.length, raw: decoded.value, type: 'string' }
  try {
    ret['value'] = decodeURIComponent(value)
  } catch (e) {
    ret['error'] = 'Invalid UTF8 encoding'
    ret.raw = decoded.value
  }
  return ret
}
