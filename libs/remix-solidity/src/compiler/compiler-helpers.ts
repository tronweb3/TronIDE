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
import { canUseWorker, urlFromVersion } from './compiler-utils'
import { CompilerAbstract } from './compiler-abstract'
import { Compiler } from './compiler'

// Compiler.loadVersion has its own watchdog. Keep this helper bounded as well
// so callers never wait forever if a custom Compiler implementation fails to
// emit either success or failure.
const COMPILE_WITH_PARAMETERS_TIMEOUT_MS = 130000

export const compile = async (compilationTargets, settings, contentResolverCallback?) => {
  if (!settings || typeof settings !== 'object') throw new Error('Compiler settings are required')
  const version = String(settings.version || '').trim()
  if (!version) throw new Error('A compiler version is required')

  let usingWorker: boolean
  let compilerURL: string
  try {
    usingWorker = canUseWorker(version)
    compilerURL = urlFromVersion(version)
  } catch (error) {
    throw new Error(`Unable to select compiler ${version}: ${error && error.message ? error.message : String(error)}`)
  }

  return await new Promise((resolve, reject) => {
    const compiler = new Compiler(contentResolverCallback)
    compiler.set('evmVersion', settings.evmVersion === undefined ? null : settings.evmVersion)
    compiler.set('optimize', settings.optimize === true)
    compiler.set('language', settings.language || 'Solidity')
    compiler.set('runs', settings.runs === undefined ? 200 : settings.runs)
    compiler.set('remappings', Array.isArray(settings.remappings) ? settings.remappings : [])

    let compilerLoaded = false
    let settled = false
    const timeout = setTimeout(() => finishFailure(`Compiler load timed out after ${Math.round(COMPILE_WITH_PARAMETERS_TIMEOUT_MS / 1000)}s`), COMPILE_WITH_PARAMETERS_TIMEOUT_MS)
    const unregister = () => {
      clearTimeout(timeout)
      compiler.event.unregister('compilerLoaded', onCompilerLoaded)
      compiler.event.unregister('compilerLoadFailed', onCompilerLoadFailed)
      compiler.event.unregister('compilationFinished', onCompilationFinished)
    }
    const finishFailure = (error) => {
      if (settled) return
      settled = true
      unregister()
      reject(error instanceof Error ? error : new Error(String(error || 'Failed to initialise Solidity compiler')))
    }
    const onCompilerLoaded = () => {
      compilerLoaded = true
      compiler.compile(compilationTargets, '')
    }
    const onCompilerLoadFailed = (message) => finishFailure(new Error(message || 'Failed to initialise Solidity compiler'))
    const onCompilationFinished = (success, compilationData, source) => {
      // load failures also emit compilationFinished(false). Resolve only after
      // the compiler has explicitly reported that it is ready.
      if (!compilerLoaded || settled) return
      settled = true
      unregister()
      resolve(new CompilerAbstract(version, compilationData, source))
    }

    compiler.event.register('compilerLoaded', onCompilerLoaded)
    compiler.event.register('compilerLoadFailed', onCompilerLoadFailed)
    compiler.event.register('compilationFinished', onCompilationFinished)

    try {
      Promise.resolve(compiler.loadVersion(usingWorker, compilerURL)).catch(finishFailure)
    } catch (error) {
      finishFailure(error)
    }
  })
}
