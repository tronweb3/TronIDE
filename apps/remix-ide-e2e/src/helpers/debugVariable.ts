/*
 * Original work Copyright © 2018-2021 Remix Team
 * Licensed under the MIT License.
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

import { NightwatchBrowser } from 'nightwatch'

export interface DebugVariableSnapshot {
  raw: string | null
  traceStep: string | null
  maxTraceStep: string | null
  stepDetail: string
}

export function readDebugVariableSnapshot (
  browser: NightwatchBrowser,
  id: string,
  callback: (snapshot: DebugVariableSnapshot) => void
): void {
  browser.execute(function (debugVariableId: string) {
    const rawContent = document.querySelector('#' + debugVariableId + ' .dropdownrawcontent')
    const slider = document.querySelector('*[data-id="slider"]') as HTMLInputElement

    return {
      raw: rawContent ? rawContent.textContent : null,
      traceStep: slider ? slider.value : null,
      maxTraceStep: slider ? slider.max : null,
      stepDetail: document.querySelector('*[data-id="stepdetail"]')?.textContent || ''
    }
  }, [id], function (result) {
    callback(result.value as unknown as DebugVariableSnapshot)
  })
}

export function parseDebugVariable (snapshot: DebugVariableSnapshot): unknown {
  if (typeof snapshot?.raw !== 'string') {
    throw new Error('debug variable raw content is not available')
  }

  return JSON.parse(snapshot.raw)
}

export function isDeepSubset (expected: unknown, actual: unknown): boolean {
  if (expected === null || typeof expected !== 'object') {
    return Object.is(expected, actual)
  }

  if (Array.isArray(expected)) {
    return Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((value, index) => isDeepSubset(value, actual[index]))
  }

  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false

  return Object.keys(expected).every((key) => {
    return Object.prototype.hasOwnProperty.call(actual, key) &&
      isDeepSubset(expected[key], actual[key])
  })
}

export function formatDebugVariableFailure (
  id: string,
  expected: unknown,
  actual: unknown,
  snapshot: DebugVariableSnapshot
): string {
  const actualText = JSON.stringify(actual)
  const truncatedActual = actualText.length > 4000 ? actualText.slice(0, 4000) + '…' : actualText

  return `Expected #${id} to contain ${JSON.stringify(expected)} at VM trace step ` +
    `${snapshot.traceStep ?? 'unknown'}/${snapshot.maxTraceStep ?? 'unknown'}, but got ${truncatedActual}. ` +
    `Step details: ${snapshot.stepDetail}`
}
