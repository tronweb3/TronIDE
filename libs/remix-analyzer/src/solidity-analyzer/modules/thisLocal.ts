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
import { isThisLocalCall, getCompilerVersion } from './staticAnalysisCommon'
import algorithm from './algorithmCategories'
import { AnalyzerModule, ModuleAlgorithm, ModuleCategory, ReportObj, CompilationResult, MemberAccessAstNode, SupportedVersion } from './../../types'

export default class thisLocal implements AnalyzerModule {
  warningNodes: MemberAccessAstNode[] = []
  name = 'This on local calls: '
  description = 'Invocation of local functions via \'this\''
  category: ModuleCategory = category.GAS
  algorithm: ModuleAlgorithm = algorithm.EXACT
  version: SupportedVersion = {
    start: '0.4.12'
  }

  visit (node: MemberAccessAstNode): void {
    if (node.nodeType === 'MemberAccess' && isThisLocalCall(node)) this.warningNodes.push(node)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  report (compilationResults: CompilationResult): ReportObj[] {
    const version = getCompilerVersion(compilationResults.contracts)
    return this.warningNodes.map(function (item, i) {
      return {
        warning: 'Use of "this" for local functions: Never use "this" to call functions in the same contract, it only consumes more gas than normal local calls.',
        location: item.src,
        more: `https://solidity.readthedocs.io/en/${version}/control-structures.html#external-function-calls`
      }
    })
  }
}
