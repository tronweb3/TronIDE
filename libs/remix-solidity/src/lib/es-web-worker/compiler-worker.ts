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
let compileJSON: ((input: CompilerInput) => string) | null = null
const missingInputs: string[] = []
type SoljsonModule = { cwrap: (...args: unknown[]) => unknown }
const workerScope = self as unknown as typeof globalThis & { importScripts: (...urls: string[]) => void; Module?: unknown }

const isSoljsonModule = (value: unknown): value is SoljsonModule => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { cwrap?: unknown }
  return typeof candidate.cwrap === 'function'
}

const normalizeHash = (hash: string) => String(hash || '').replace(/^0x/i, '').toLowerCase()

async function importCompilerScript (url: string, integrity?: string): Promise<void> {
  if (!integrity) {
    // importScripts() method synchronously imports scripts into the worker.
    workerScope.importScripts(url)
    return
  }
  if (typeof fetch !== 'function' || !workerScope.crypto || !workerScope.crypto.subtle) {
    throw new Error('This browser cannot verify the compiler integrity hash')
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Compiler download failed with HTTP ${response.status}`)
  const bytes = await response.arrayBuffer()
  const digest = await workerScope.crypto.subtle.digest('SHA-256', bytes)
  const actual = Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('')
  if (actual !== normalizeHash(integrity)) throw new Error('Compiler integrity hash mismatch')
  // Execute only the bytes whose manifest digest was verified above. Using a
  // blob URL here looks equivalent, but importScripts(blob:...) is governed by
  // the worker response's script-src policy. Deployments that intentionally do
  // not allow blob scripts therefore downloaded and verified every compiler,
  // then rejected it during execution and fell back to the builtin compiler.
  // The worker policy already permits unsafe-eval for Emscripten soljson; an
  // indirect eval preserves importScripts' global-script semantics (notably
  // the global Module variable) without weakening script-src with blob:.
  const source = new TextDecoder().decode(bytes)
  // eslint-disable-next-line no-eval
  workerScope.eval(source)
}

self.addEventListener('message', (e) => {
  const data: MessageToWorker = e.data
  switch (data.cmd) {
    case 'loadVersion':
    {
      // Loading and integrity verification are asynchronous. Keep the worker
      // compile handler disabled until the whole operation has succeeded.
      const loadCompiler = async () => {
        try {
          if (typeof data.data !== 'string') throw new Error('Invalid compiler URL payload')
          const validatedCompilerURL = assertAllowedCompilerURL(data.data)
          await importCompilerScript(validatedCompilerURL, data.integrity)
          // soljson exposes the Emscripten module as `self.Module`.  Passing
          // the worker global itself happens to work only for compiler builds
          // that copy cwrap onto `self`; the bundled and current remote
          // binaries keep it on Module, so the wrapper otherwise fails with
          // "solJson.cwrap is not a function".
          const soljson = workerScope.Module
          if (!isSoljsonModule(soljson)) {
            throw new Error('Solidity compiler initialised without cwrap')
          }
          const compiler = solcWrapper(soljson)
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
        } catch (error) {
          compileJSON = null
          self.postMessage({
            cmd: 'loadFailed',
            error: error && error.message ? error.message : String(error)
          })
        }
      }
      loadCompiler().catch(() => {})
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
