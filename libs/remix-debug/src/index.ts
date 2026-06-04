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
import * as init from './init'
import { Ethdebugger as EthDebugger } from './Ethdebugger'
import { Debugger as TransactionDebugger } from './debugger/debugger'
import { CmdLine } from './cmdline'
import { StorageViewer } from './storage/storageViewer'
import { StorageResolver } from './storage/storageResolver'
import * as SolidityDecoder from './solidity-decoder'
import { BreakpointManager } from './code/breakpointManager'
import * as sourceMappingDecoder from './source/sourceMappingDecoder'
import * as traceHelper from './trace/traceHelper'

const storage = {
  StorageViewer: StorageViewer,
  StorageResolver: StorageResolver
}
/*
  Use of breakPointManager :

  var breakPointManager = new BreakpointManager(this.debugger, (sourceLocation) => {
    return line/column from offset (sourceLocation)
  })
  this.debugger.setBreakpointManager(breakPointManager)
*/
export {
  init,
  traceHelper,
  sourceMappingDecoder,
  EthDebugger,
  TransactionDebugger,
  /**
   * constructor
   *
   * @param {Object} _debugger - type of EthDebugger
   * @return {Function} _locationToRowConverter - function implemented by editor which return a column/line position for a char source location
   */
  BreakpointManager,
  SolidityDecoder,
  storage,
  CmdLine
}
