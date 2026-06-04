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
import { AstWalker } from '@remix-project/remix-astwalker'
import list from './modules/list'
import { CompilationResult, AnalyzerModule, AnalysisReportObj, AnalysisReport } from '../types'

type ModuleObj = {
  name: string
  mod: AnalyzerModule
}

export default class staticAnalysisRunner {
  /**
   * Run analysis (Used by IDE)
   * @param compilationResult contract compilation result
   * @param toRun module indexes (compiled from remix IDE)
   * @param callback callback
   */
  run (compilationResult: CompilationResult, toRun: number[], callback: ((reports: AnalysisReport[]) => void)): void {
    const modules: ModuleObj[] = toRun.map((i) => {
      const Module = this.modules()[i]
      const m = new Module()
      return { name: m.name, mod: m }
    })
    this.runWithModuleList(compilationResult, modules, callback)
  }

  /**
   * Run analysis passing list of modules to run
   * @param compilationResult contract compilation result
   * @param modules analysis module
   * @param callback callback
   */
  runWithModuleList (compilationResult: CompilationResult, modules: ModuleObj[], callback: ((reports: AnalysisReport[]) => void)): void {
    let reports: AnalysisReport[] = []
    // Also provide convenience analysis via the AST walker.
    const walker = new AstWalker()
    for (const k in compilationResult.sources) {
      walker.walkFull(compilationResult.sources[k].ast,
        (node: any) => {
          modules.map((item: ModuleObj) => {
            if (item.mod.visit !== undefined) {
              try {
                item.mod.visit(node)
              } catch (e) {
                reports.push({
                  name: item.name, report: [{ warning: 'INTERNAL ERROR in module ' + item.name + ' ' + e.message, error: e.stack }]
                })
              }
            }
          })
          return true
        }
      )
    }

    // Here, modules can just collect the results from the AST walk,
    // but also perform new analysis.
    reports = reports.concat(modules.map((item: ModuleObj) => {
      let report: AnalysisReportObj[] | null = null
      try {
        report = item.mod.report(compilationResult)
      } catch (e) {
        report = [{ warning: 'INTERNAL ERROR in module ' + item.name + ' ' + e.message, error: e.stack }]
      }
      return { name: item.name, report: report }
    }))
    callback(reports)
  }

  /**
   * Get list of all analysis modules
   */
  modules (): any[] {
    return list
  }
}
