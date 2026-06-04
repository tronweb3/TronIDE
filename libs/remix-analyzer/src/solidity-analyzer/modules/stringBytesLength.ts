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

import category from './categories'
import algorithm from './algorithmCategories'
import { isStringToBytesConversion, isBytesLengthCheck, getCompilerVersion } from './staticAnalysisCommon'
import { AnalyzerModule, ModuleAlgorithm, ModuleCategory, ReportObj, CompilationResult, MemberAccessAstNode, FunctionCallAstNode, SupportedVersion } from './../../types'

export default class stringBytesLength implements AnalyzerModule {
  name = 'String length: '
  description = 'Bytes length != String length'
  category: ModuleCategory = category.MISC
  algorithm: ModuleAlgorithm = algorithm.EXACT
  version: SupportedVersion = {
    start: '0.4.12'
  }

  stringToBytesConversions: FunctionCallAstNode[] = []
  bytesLengthChecks: MemberAccessAstNode[] = []

  visit (node: FunctionCallAstNode | MemberAccessAstNode): void {
    if (node.nodeType === 'FunctionCall' && isStringToBytesConversion(node)) this.stringToBytesConversions.push(node)
    else if (node.nodeType === 'MemberAccess' && isBytesLengthCheck(node)) this.bytesLengthChecks.push(node)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  report (compilationResults: CompilationResult): ReportObj[] {
    const version = getCompilerVersion(compilationResults.contracts)
    if (this.stringToBytesConversions.length > 0 && this.bytesLengthChecks.length > 0) {
      return [{
        warning: '"bytes" and "string" lengths are not the same since strings are assumed to be UTF-8 encoded (according to the ABI defintion) therefore one character is not nessesarily encoded in one byte of data.',
        location: this.bytesLengthChecks[0].src,
        more: `https://solidity.readthedocs.io/en/${version}/abi-spec.html#argument-encoding`
      }]
    } else {
      return []
    }
  }
}
