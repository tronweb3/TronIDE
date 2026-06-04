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

import txOrigin from './txOrigin'
import gasCosts from './gasCosts'
import thisLocal from './thisLocal'
import checksEffectsInteraction from './checksEffectsInteraction'
import constantFunctions from './constantFunctions'
import similarVariableNames from './similarVariableNames'
import inlineAssembly from './inlineAssembly'
import blockTimestamp from './blockTimestamp'
import lowLevelCalls from './lowLevelCalls'
import blockBlockhash from './blockBlockhash'
import noReturn from './noReturn'
import selfdestruct from './selfdestruct'
import guardConditions from './guardConditions'
import deleteDynamicArrays from './deleteDynamicArrays'
import assignAndCompare from './assignAndCompare'
import erc20Decimals from './erc20Decimals'
import stringBytesLength from './stringBytesLength'
import deleteFromDynamicArray from './deleteFromDynamicArray'
import forLoopIteratesOverDynamicArray from './forLoopIteratesOverDynamicArray'
import etherTransferInLoop from './etherTransferInLoop'
import intDivisionTruncate from './intDivisionTruncate'
import tronTransactionConfig from './tronTransactionConfig'

export default [
  txOrigin,
  gasCosts,
  thisLocal,
  checksEffectsInteraction,
  erc20Decimals,
  constantFunctions,
  similarVariableNames,
  inlineAssembly,
  blockTimestamp,
  lowLevelCalls,
  blockBlockhash,
  noReturn,
  selfdestruct,
  guardConditions,
  deleteDynamicArrays,
  assignAndCompare,
  stringBytesLength,
  deleteFromDynamicArray,
  forLoopIteratesOverDynamicArray,
  etherTransferInLoop,
  intDivisionTruncate,
  tronTransactionConfig
]
