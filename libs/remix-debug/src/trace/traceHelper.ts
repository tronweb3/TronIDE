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
import { helpers } from '@remix-project/remix-lib'
const { ui } = helpers

// vmTraceIndex has to point to a CALL, CODECALL, ...
export function resolveCalledAddress (vmTraceIndex, trace) {
  const step = trace[vmTraceIndex]
  if (isCreateInstruction(step)) {
    return contractCreationToken(vmTraceIndex)
  } else if (isCallInstruction(step)) {
    const stack = step.stack // callcode, delegatecall, ...
    return ui.normalizeHexAddress(stack[stack.length - 2])
  }
  return undefined
}

export function isCallInstruction (step) {
  return ['CALL', 'STATICCALL', 'CALLCODE', 'CREATE', 'DELEGATECALL', 'CREATE2'].includes(step.op)
}

export function isCreateInstruction (step) {
  return step.op === 'CREATE' || step.op === 'CREATE2'
}

export function isReturnInstruction (step) {
  return step.op === 'RETURN'
}

export function isJumpDestInstruction (step) {
  return step.op === 'JUMPDEST'
}

export function isStopInstruction (step) {
  return step.op === 'STOP'
}

export function isRevertInstruction (step) {
  return step.op === 'REVERT'
}

export function isSSTOREInstruction (step) {
  return step.op === 'SSTORE'
}

export function isSHA3Instruction (step) {
  return step.op === 'SHA3'
}

export function newContextStorage (step) {
  return step.op === 'CREATE' || step.op === 'CALL' || step.op === 'CREATE2'
}

export function isCallToPrecompiledContract (index, trace) {
  // if stack empty => this is not a precompiled contract
  const step = trace[index]
  if (this.isCallInstruction(step)) {
    return index + 1 < trace.length && trace[index + 1].stack.length !== 0
  }
  return false
}

export function contractCreationToken (index) {
  return '(Contract Creation - Step ' + index + ')'
}

export function isContractCreation (address) {
  return address.indexOf('(Contract Creation - Step') !== -1
}
