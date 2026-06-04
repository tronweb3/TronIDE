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
import { solidityLocals } from '../../../src/solidity-decoder/localDecoder'

/*
  Decode local variable
*/
export function decodeLocals (st, index, traceManager, callTree, verifier) {
  try {
    traceManager.waterfall([
      function getStackAt (stepIndex, callback) {
        try {
          const result = traceManager.getStackAt(stepIndex)
          callback(null, result)
        } catch (error) {
          callback(error)
        }
      },
      function getMemoryAt (stepIndex, callback) {
        try {
          const result = traceManager.getMemoryAt(stepIndex)
          callback(null, result)
        } catch (error) {
          callback(error)
        }
      },
      function getCallDataAt (stepIndex, callback) {
        try {
          const result = traceManager.getCallDataAt(stepIndex)
          callback(null, result)
        } catch (error) {
          callback(error)
        }
      }],
    index,
    function (error, result) {
      if (error) {
        return st.fail(error)
      }
      solidityLocals(index, callTree, result[0].value, result[1].value, {}, result[2].value, { start: 5000 }, null).then((locals) => {
        verifier(locals)
      })
    })
  } catch (e) {
    st.fail(e.message)
  }
}
