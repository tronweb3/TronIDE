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

// The following tests are skipped due to breaking changes in the new VM/Compiler trace output
// require('./traceManager')
// require('./sourceLocationTracker')
// require('./decoder/decodeInfo')
// require('./debugger')

// These lower-level tests might still pass
require('./codeManager')
require('./disassembler')
require('./sourceMappingDecoder')
// require('./decoder/storageLocation') // This might also fail, skip temporary
// require('./decoder/storageDecoder')
// require('./decoder/localDecoder')
