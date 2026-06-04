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

import { isCallInstruction, isCallToPrecompiledContract, isReturnInstruction } from './traceHelper'
import { util } from '@remix-project/remix-lib'

export class TraceStepManager {
  traceAnalyser

  constructor (_traceAnalyser) {
    this.traceAnalyser = _traceAnalyser
  }

  isCallInstruction (index) {
    const state = this.traceAnalyser.trace[index]
    return isCallInstruction(state) && !isCallToPrecompiledContract(index, this.traceAnalyser.trace)
  }

  isReturnInstruction (index) {
    const state = this.traceAnalyser.trace[index]
    return isReturnInstruction(state)
  }

  findStepOverBack (currentStep) {
    if (this.isReturnInstruction(currentStep)) {
      const call = util.findCall(currentStep, this.traceAnalyser.traceCache.callsTree.call)
      return call.start > 0 ? call.start - 1 : 0
    }
    return currentStep > 0 ? currentStep - 1 : 0
  }

  findStepOverForward (currentStep) {
    if (this.isCallInstruction(currentStep)) {
      const call = util.findCall(currentStep + 1, this.traceAnalyser.traceCache.callsTree.call)
      return call.return + 1 < this.traceAnalyser.trace.length ? call.return + 1 : this.traceAnalyser.trace.length - 1
    }
    return this.traceAnalyser.trace.length >= currentStep + 1 ? currentStep + 1 : currentStep
  }

  findNextCall (currentStep) {
    const call = util.findCall(currentStep, this.traceAnalyser.traceCache.callsTree.call)
    const subCalls = Object.keys(call.calls)
    if (subCalls.length) {
      var callStart = util.findLowerBound(currentStep, subCalls) + 1
      if (subCalls.length > callStart) {
        return parseInt(subCalls[callStart]) - 1
      }
      return currentStep
    }
    return currentStep
  }

  findStepOut (currentStep) {
    const call = util.findCall(currentStep, this.traceAnalyser.traceCache.callsTree.call)
    return call.return
  }
}
