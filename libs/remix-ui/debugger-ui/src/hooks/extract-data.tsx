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

import React, { useState, useEffect } from 'react' // eslint-disable-line
import { ExtractData, ExtractFunc } from '../types' // eslint-disable-line

export const useExtractData = (json, extractFunc?: ExtractFunc): Array<{ key: string, data: ExtractData }> => {
  const [data, setData] = useState([])

  useEffect(() => {
    const data: Array<{ key: string, data: ExtractData }> = Object.keys(json).map((innerKey) => {
      if (extractFunc) {
        return {
          key: innerKey,
          data: extractFunc(json[innerKey], json)
        }
      } else {
        return {
          key: innerKey,
          data: extractDataDefault(json[innerKey], json)
        }
      }
    })

    setData(data)

    return () => {
      setData(null)
    }
  }, [json, extractFunc])

  const extractDataDefault: ExtractFunc = (item, parent?) => {
    const ret: ExtractData = {}

    if (item instanceof Array) {
      ret.children = item.map((item, index) => {
        return { key: index, value: item }
      })
      ret.self = 'Array'
      ret.isNode = true
      ret.isLeaf = false
    } else if (item instanceof Object) {
      ret.children = Object.keys(item).map((key) => {
        return { key: key, value: item[key] }
      })
      ret.self = 'Object'
      ret.isNode = true
      ret.isLeaf = false
    } else {
      ret.self = item
      ret.children = null
      ret.isNode = false
      ret.isLeaf = true
    }
    return ret
  }

  return data
}

export default useExtractData
