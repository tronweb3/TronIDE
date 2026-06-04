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

import test from 'tape'
import { helpers } from '@remix-project/remix-lib'
import { readFileSync } from 'fs'
import { join } from 'path'
import { default as StatRunner } from '../../src/solidity-analyzer'
import solc from 'solc'
import { CompilationResult, AnalysisReportObj, AnalysisReport } from '../../src/types'
import { checksEffectsInteraction } from '../../src/solidity-analyzer/modules/'
const { compilerInput } = helpers.compiler
const folder: string = 'solidity-v0.5'

let compiler
test('setup', function (t) {
  solc.loadRemoteVersion('v0.5.0+commit.1d4f565a', (error, solcVersion) => {
    if (error) throw error
    compiler = solcVersion
    t.end()
  })
})

function compile (fileName): CompilationResult {
  const content: string = readFileSync(join(__dirname, 'test-contracts/' + folder, fileName), 'utf8')
  return JSON.parse(compiler.compile(compilerInput(content)))
}

test('staticAnalysisIssues.functionParameterPassingError', function (t) {
  // https://github.com/ethereum/remix-ide/issues/889#issuecomment-351746474
  t.plan(2)
  const res: CompilationResult = compile('functionParameters.sol')
  const Module: any = checksEffectsInteraction
  const statRunner: StatRunner = new StatRunner()

  t.doesNotThrow(() => {
    statRunner.runWithModuleList(res, [{ name: new Module().name, mod: new Module() }], (reports: AnalysisReport[]) => {})
  }, 'Analysis should not throw')

  statRunner.runWithModuleList(res, [{ name: new Module().name, mod: new Module() }], (reports: AnalysisReport[]) => {
    t.ok(!reports.some((mod: AnalysisReport) => mod.report.some((rep: AnalysisReportObj) => rep.warning.includes('INTERNAL ERROR')), 'Should not have internal errors'))
  })
})
