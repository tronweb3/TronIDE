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

import { EventManager } from './eventManager'
import * as uiHelper from './helpers/uiHelper'
import * as compilerHelper from './helpers/compilerHelper'
import * as util from './util'
import { Web3Providers } from './web3Provider/web3Providers'
import { DummyProvider } from './web3Provider/dummyProvider'
import { Web3VmProvider } from './web3Provider/web3VmProvider'
import { Storage } from './storage'
import { EventsDecoder } from './execution/eventsDecoder'
import * as txExecution from './execution/txExecution'
import * as txHelper from './execution/txHelper'
import * as txFormat from './execution/txFormat'
import * as txIntegerUtils from './execution/txIntegerUtils'
import * as walletProviderAdapter from './execution/walletProviderAdapter'
import * as walletAdapterManager from './execution/walletAdapterManager'
import * as runtimeFacade from './execution/runtimeFacade'
import * as githubGistSecurity from './workspace/githubGistSecurity'
import * as searchReplaceSafety from './workspace/searchReplaceSafety'
import * as pluginSecurity from './workspace/pluginSecurity'
import * as tronTemplates from './workspace/tronTemplates'
import * as tronStaticAnalysis from './workspace/tronStaticAnalysis'
import * as workspaceCapabilities from './workspace/workspaceCapabilities'
import { TxListener } from './execution/txListener'
import { TxRunner } from './execution/txRunner'
import { LogsManager } from './execution/logsManager'
import { forkAt } from './execution/forkAt'
import * as typeConversion from './execution/typeConversion'
import { TxRunnerVM } from './execution/txRunnerVM'
import { TxRunnerWeb3 } from './execution/txRunnerWeb3'
import * as txResultHelper from './helpers/txResultHelper'
const helpers = {
  ui: uiHelper,
  compiler: compilerHelper,
  txResultHelper
}
const vm = {
  Web3Providers: Web3Providers,
  DummyProvider: DummyProvider,
  Web3VMProvider: Web3VmProvider
}
const execution = {
  EventsDecoder: EventsDecoder,
  txExecution: txExecution,
  txHelper: txHelper,
  txFormat: txFormat,
  txIntegerUtils: txIntegerUtils,
  walletProviderAdapter: walletProviderAdapter,
  walletAdapterManager: walletAdapterManager,
  runtimeFacade: runtimeFacade,
  txListener: TxListener,
  TxRunner: TxRunner,
  TxRunnerWeb3: TxRunnerWeb3,
  TxRunnerVM: TxRunnerVM,
  typeConversion: typeConversion,
  LogsManager,
  forkAt
}
const workspace = {
  githubGistSecurity,
  searchReplaceSafety,
  pluginSecurity,
  tronTemplates,
  tronStaticAnalysis,
  workspaceCapabilities
}
export { EventManager, helpers, vm, Storage, util, execution, workspace }
