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

console.log('[DEBUG] Test Runner Arguments:', process.argv)
require('./eventManager.ts')
require('./txIntegerUtils.ts')
require('./walletProviderAdapter.ts')
require('./walletAdapterManager.ts')
require('./runtimeFacade.ts')
require('./workspaceSafety.ts')
require('./workspaceEcosystem.ts')
require('./workspaceCapabilities.ts')
require('./txRunnerWeb3.ts')
require('./util.ts')
require('./txFormat.ts')
require('./txHelper.ts')
require('./txResultHelper.ts')
