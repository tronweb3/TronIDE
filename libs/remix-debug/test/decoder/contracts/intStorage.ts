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

module.exports = {
  contract: `
 contract intStorage {
    uint8 ui8 = 130;
    uint16 ui16 = 456;
    uint32 ui32 = 4356;
    uint64 ui64 = 3543543543;
    uint128 ui128 = 234567;
    uint256 public ui256 = 115792089237316195423570985008687907853269984665640564039457584007880697216513;
    uint ui = 123545666;
    int8 i8 = -45;
    int16 i16 = -1234;
    int32 i32 = 3455;
    int64 i64 = -35566;
    int128 i128 = -444444;
    int256 i256 = 3434343;
    int i = -32432423423;
    int32 ishrink = 2;
  }
`,
  fullStorage: {
    '0x0000000000000000000000000000000000000000000000000000000000000000': '0x000000000000000000000000000003944700000000d3362ef70000110401c882',
    '0x0000000000000000000000000000000000000000000000000000000000000001': '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffff872e07e01',
    '0x0000000000000000000000000000000000000000000000000000000000000002': '0x00000000000000000000000000000000000000000000000000000000075d2842',
    '0x0000000000000000000000000000000000000000000000000000000000000003': '0x00fffffffffffffffffffffffffff937e4ffffffffffff751200000d7ffb2ed3',
    '0x0000000000000000000000000000000000000000000000000000000000000004': '0x0000000000000000000000000000000000000000000000000000000000346767',
    '0x0000000000000000000000000000000000000000000000000000000000000005': '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffff872e07e01',
    '0x0000000000000000000000000000000000000000000000000000000000000006': '0x0000000000000000000000000000000000000000000000000000000000000002'
  }
}
