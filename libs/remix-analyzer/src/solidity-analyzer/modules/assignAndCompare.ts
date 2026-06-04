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
import { isSubScopeWithTopLevelUnAssignedBinOp, getUnAssignedTopLevelBinOps } from './staticAnalysisCommon'
import algorithm from './algorithmCategories'
import {
  AnalyzerModule, ModuleAlgorithm, ModuleCategory, ReportObj, BlockAstNode, IfStatementAstNode,
  WhileStatementAstNode, ForStatementAstNode, CompilationResult, ExpressionStatementAstNode, SupportedVersion
} from './../../types'

export default class assignAndCompare implements AnalyzerModule {
  warningNodes: ExpressionStatementAstNode[] = []
  name = 'Result not used: '
  description = 'The result of an operation not used'
  category: ModuleCategory = category.MISC
  algorithm: ModuleAlgorithm = algorithm.EXACT
  version: SupportedVersion = {
    start: '0.4.12'
  }

  visit (node: BlockAstNode | IfStatementAstNode | WhileStatementAstNode | ForStatementAstNode): void {
    if (node?.nodeType && isSubScopeWithTopLevelUnAssignedBinOp(node)) getUnAssignedTopLevelBinOps(node).forEach((n) => this.warningNodes.push(n))
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  report (compilationResults: CompilationResult): ReportObj[] {
    return this.warningNodes.map((item) => {
      return {
        warning: 'A binary operation yields a value that is not used further. This is often caused by confusing assignment (=) and comparison (==).',
        location: item.src
      }
    })
  }
}
