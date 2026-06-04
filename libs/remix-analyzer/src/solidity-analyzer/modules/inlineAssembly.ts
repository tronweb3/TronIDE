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
import { AnalyzerModule, ModuleAlgorithm, ModuleCategory, ReportObj, CompilationResult, InlineAssemblyAstNode, SupportedVersion } from './../../types'
import { getCompilerVersion } from './staticAnalysisCommon'

export default class inlineAssembly implements AnalyzerModule {
  inlineAssNodes: InlineAssemblyAstNode[] = []
  name = 'Inline assembly: '
  description = 'Inline assembly used'
  category: ModuleCategory = category.SECURITY
  algorithm: ModuleAlgorithm = algorithm.EXACT
  version: SupportedVersion = {
    start: '0.4.12'
  }

  visit (node: InlineAssemblyAstNode): void {
    if (node.nodeType === 'InlineAssembly') this.inlineAssNodes.push(node)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  report (compilationResults: CompilationResult): ReportObj[] {
    const version = getCompilerVersion(compilationResults.contracts)
    return this.inlineAssNodes.map((node) => {
      return {
        warning: `The Contract uses inline assembly, this is only advised in rare cases. 
                  Additionally static analysis modules do not parse inline Assembly, this can lead to wrong analysis results.`,
        location: node.src,
        more: `https://solidity.readthedocs.io/en/${version}/assembly.html`
      }
    })
  }
}
