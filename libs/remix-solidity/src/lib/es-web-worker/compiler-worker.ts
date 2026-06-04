/*
 * Copyright 2022 [TronIDE]
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

import solcWrapper from 'solc/wrapper'
import { assertAllowedCompilerURL } from '../../compiler/compiler-utils'
import { CompilerInput, MessageToWorker } from '../../compiler/types'
let compileJSON: ((input: CompilerInput) => string) | null = (input) => { return '' }
const missingInputs: string[] = []
const workerScope = self as unknown as typeof globalThis & { importScripts: (...urls: string[]) => void }

self.addEventListener('message', (e) => {
  const data: MessageToWorker = e.data
  switch (data.cmd) {
    case 'loadVersion':
    {
      if (typeof data.data !== 'string') throw new Error('Invalid compiler URL payload')
      const validatedCompilerURL = assertAllowedCompilerURL(data.data)
      // importScripts() method of synchronously imports one or more scripts into the worker's scope
      workerScope.importScripts(validatedCompilerURL)
      const compiler = solcWrapper(workerScope)
      compileJSON = (input) => {
        try {
          const missingInputsCallback = (path) => {
            missingInputs.push(path)
            return { error: 'Deferred import' }
          }
          return compiler.compile(input, { import: missingInputsCallback })
        } catch (exception) {
          return JSON.stringify({ error: 'Uncaught JavaScript exception:\n' + exception })
        }
      }
      self.postMessage({
        cmd: 'versionLoaded',
        data: compiler.version()
      })
      break
    }

    case 'compile':
      missingInputs.length = 0
      if (data.input && compileJSON) {
        self.postMessage({
          cmd: 'compiled',
          job: data.job,
          data: compileJSON(data.input),
          missingInputs: missingInputs
        })
      }
      break
  }
}, false)
