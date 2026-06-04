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
import { ValueType } from './ValueType'

export class Enum extends ValueType {
  enumDef

  constructor (enumDef) {
    let storageBytes = 0
    let length = enumDef.members.length
    while (length > 1) {
      length = length / 256
      storageBytes++
    }
    super(1, storageBytes, 'enum')
    this.enumDef = enumDef
  }

  decodeValue (value) {
    if (!value) {
      return this.enumDef.members[0].name
    }
    value = parseInt(value, 16)
    if (this.enumDef.members.length > value) {
      return this.enumDef.members[value].name
    }
    return 'INVALID_ENUM<' + value + '>'
  }
}
