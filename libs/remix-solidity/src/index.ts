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

export { Compiler } from './compiler/compiler'
export { normalizeRuns, DEFAULT_OPTIMIZER_RUNS, MIN_OPTIMIZER_RUNS, MAX_OPTIMIZER_RUNS } from './compiler/runs'
export { parseOptimizeParam } from './compiler/optimize'
export { normalizeEvmVersion } from './compiler/evm-version'
export { compile } from './compiler/compiler-helpers'
export { default as CompilerInput } from './compiler/compiler-input'
export { CompilerAbstract } from './compiler/compiler-abstract'
export * from './compiler/types'
export { promisedMiniXhr, pathToURL, baseURLBin, baseURLWasm, baseURLTron, tronCompilerSourceProvider, canUseWorker, urlFromVersion, compilerSourceMockMode, maybeMockCompilerSourceURL, assertAllowedCompilerURL, ALLOWED_COMPILER_ORIGINS } from './compiler/compiler-utils'
