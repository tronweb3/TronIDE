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
import { util } from '@remix-project/remix-lib'

export class MockStorageResolver {
  storage

  constructor (_storage) {
    this.storage = {}
    for (var k in _storage) {
      var hashed = util.sha3_256(k)
      this.storage[hashed] = {
        hashed: hashed,
        key: k,
        value: _storage[k]
      }
    }
  }

  storageRange (callback) {
    callback(null, this.storage)
  }

  storageSlot (slot, callback) {
    var hashed = util.sha3_256(slot)
    callback(null, this.storage[hashed])
  }

  isComplete (address) {
    return true
  }

  fromCache (address, slotKey) {
    return this.storage[slotKey]
  }

  toCache (address, storage, complete) {
  }
}
