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

const assertionEvents = [
  {
    name: 'AssertionEvent',
    params: ['bool', 'string', 'string']
  },
  {
    name: 'AssertionEventUint',
    params: ['bool', 'string', 'string', 'uint256', 'uint256']
  },
  {
    name: 'AssertionEventInt',
    params: ['bool', 'string', 'string', 'int256', 'int256']
  },
  {
    name: 'AssertionEventBool',
    params: ['bool', 'string', 'string', 'bool', 'bool']
  },
  {
    name: 'AssertionEventAddress',
    params: ['bool', 'string', 'string', 'address', 'address']
  },
  {
    name: 'AssertionEventBytes32',
    params: ['bool', 'string', 'string', 'bytes32', 'bytes32']
  },
  {
    name: 'AssertionEventString',
    params: ['bool', 'string', 'string', 'string', 'string']
  },
  {
    name: 'AssertionEventUintInt',
    params: ['bool', 'string', 'string', 'uint256', 'int256']
  },
  {
    name: 'AssertionEventIntUint',
    params: ['bool', 'string', 'string', 'int256', 'uint256']
  }
]

export default assertionEvents
