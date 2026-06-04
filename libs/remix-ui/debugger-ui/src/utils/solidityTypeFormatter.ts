/*
 * Original work Copyright © 2018-2021 Remix Team
 * Licensed under the MIT License.
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

import { BN } from 'ethereumjs-util'
import { ExtractData } from '../types' // eslint-disable-line

export function extractData (item, parent): ExtractData {
  const ret: ExtractData = {}

  if (item.isProperty || !item.type) {
    return item
  }
  try {
    if (item.type.lastIndexOf(']') === item.type.length - 1) {
      ret.children = (item.value || []).map(function (item, index) {
        return { key: index, value: item }
      })
      ret.children.unshift({
        key: 'length',
        value: {
          self: (new BN(item.length.replace('0x', ''), 16)).toString(10),
          type: 'uint',
          isProperty: true
        }
      })
      ret.isArray = true
      ret.self = parent.isArray ? '' : item.type
      ret.cursor = item.cursor
      ret.hasNext = item.hasNext
    } else if (item.type.indexOf('struct') === 0) {
      ret.children = Object.keys((item.value || {})).map(function (key) {
        return { key: key, value: item.value[key] }
      })
      ret.self = item.type
      ret.isStruct = true
    } else if (item.type.indexOf('mapping') === 0) {
      ret.children = Object.keys((item.value || {})).map(function (key) {
        return { key: key, value: item.value[key] }
      })
      ret.isMapping = true
      ret.self = item.type
    } else {
      ret.children = null
      ret.self = item.value
      ret.type = item.type
    }
  } catch (e) {
    console.log(e)
  }
  return ret
}
