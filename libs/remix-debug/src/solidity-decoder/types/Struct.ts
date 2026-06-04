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
import { add } from './util'
import { RefType } from './RefType'
import { Mapping } from './Mapping'

export class Struct extends RefType {
  members

  constructor (memberDetails, location, fullType) {
    super(memberDetails.storageSlots, 32, 'struct ' + fullType, location)
    this.members = memberDetails.members
  }

  async decodeFromStorage (location, storageResolver) {
    const ret = {}
    for (var item of this.members) {
      const globalLocation = {
        offset: location.offset + item.storagelocation.offset,
        slot: add(location.slot, item.storagelocation.slot)
      }
      try {
        ret[item.name] = await item.type.decodeFromStorage(globalLocation, storageResolver)
      } catch (e) {
        console.log(e)
        ret[item.name] = '<decoding failed - ' + e.message + '>'
      }
    }
    return { value: ret, type: this.typeName }
  }

  decodeFromMemoryInternal (offset, memory) {
    const ret = {}
    this.members.map((item, i) => {
      var contentOffset = offset
      var member = item.type.decodeFromMemory(contentOffset, memory)
      ret[item.name] = member
      if (!(item.type instanceof Mapping)) offset += 32
    })
    return { value: ret, type: this.typeName }
  }
}
