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

import tape from 'tape'
import { ethers } from 'ethers'
import { DebuggerSolidityLocals } from '../src/debugger/solidityLocals'
import { solidityLocals } from '../src/solidity-decoder/localDecoder'
import { Int } from '../src/solidity-decoder/types/Int'
import { StringType } from '../src/solidity-decoder/types/StringType'
import { Uint } from '../src/solidity-decoder/types/Uint'

type ScheduledDecode = {
  callback: () => void
  cleared: boolean
}

function withFakeTimers (run: (scheduled: ScheduledDecode[]) => void) {
  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  const scheduled: ScheduledDecode[] = []

  global.setTimeout = ((callback: () => void) => {
    scheduled.push({ callback, cleared: false })
    return scheduled.length as unknown as NodeJS.Timeout
  }) as typeof setTimeout
  global.clearTimeout = ((timeout: NodeJS.Timeout) => {
    const scheduledDecode = scheduled[Number(timeout) - 1]
    if (scheduledDecode) scheduledDecode.cleared = true
  }) as typeof clearTimeout

  try {
    run(scheduled)
  } finally {
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
  }
}

function createSubject () {
  const stepManager = { currentStepIndex: 0 }
  const subject = new DebuggerSolidityLocals(
    {},
    stepManager,
    {},
    {}
  )
  subject.storageResolver = {}
  return { subject, stepManager }
}

tape('solidity locals debounce keeps only the newest step/source request', (t) => {
  withFakeTimers((scheduled) => {
    const { subject, stepManager } = createSubject()
    const decoded = []
    subject.decode = ((sourceLocation, cursor, stepIndex, generation) => {
      decoded.push({ sourceLocation, cursor, stepIndex, generation })
    }) as typeof subject.decode

    const firstSource = { start: 10, length: 1, file: 0 }
    const secondSource = { start: 20, length: 1, file: 0 }
    stepManager.currentStepIndex = 1
    subject.init(firstSource)
    stepManager.currentStepIndex = 2
    subject.init(secondSource)

    t.equal(scheduled.length, 2, 'both source changes schedule a decode')
    t.equal(scheduled[0].cleared, true, 'the previous timer is cancelled')

    // A cleared browser timer can already be queued. Its generation guard must
    // still prevent it from publishing a stale step/source pairing.
    scheduled[0].callback()
    t.equal(decoded.length, 0, 'a stale queued callback is ignored')

    scheduled[1].callback()
    t.deepEqual(decoded, [{
      sourceLocation: secondSource,
      cursor: undefined,
      stepIndex: 2,
      generation: 2
    }], 'the newest request captures one consistent step/source pair')
  })
  t.end()
})

tape('solidity locals debounce refuses a callback after the VM step changes', (t) => {
  withFakeTimers((scheduled) => {
    const { subject, stepManager } = createSubject()
    let decodeCalls = 0
    subject.decode = (() => {
      decodeCalls++
    }) as typeof subject.decode

    stepManager.currentStepIndex = 7
    subject.init({ start: 70, length: 1, file: 0 })
    stepManager.currentStepIndex = 8
    scheduled[0].callback()

    t.equal(decodeCalls, 0, 'a source event cannot decode data from a newer VM step')
  })
  t.end()
})

tape('solidity locals decode ignores an async result after navigation', async (t) => {
  const { subject, stepManager } = createSubject()
  let resolveLocal
  const pendingLocal = new Promise((resolve) => {
    resolveLocal = resolve
  })
  const scope = {
    locals: {
      value: {
        name: 'value',
        stackDepth: 0,
        sourceLocation: { start: 0 },
        type: {
          decodeFromStack: () => pendingLocal
        }
      }
    }
  }
  subject.internalTreeCall = { findScope: () => scope }
  subject.traceManager = {
    waterfall: (_tasks, stepIndex, callback) => {
      callback(null, [
        { value: ['0x01'] },
        { value: [] },
        { value: '0x0000000000000000000000000000000000000001' },
        { value: '0x' }
      ])
    }
  }
  const published = []
  subject.event.register('solidityLocals', (locals) => published.push(locals))

  stepManager.currentStepIndex = 3
  subject.decode({ start: 1, length: 1, file: 0 })
  stepManager.currentStepIndex = 4
  subject.init({ start: 2, length: 1, file: 0 })
  resolveLocal({ value: '1', type: 'uint256' })
  await pendingLocal
  await Promise.resolve()

  t.deepEqual(published, [], 'the previous step cannot overwrite the current locals')
  subject._clearDecodeTimeout()
  t.end()
})

tape('external function inputs decode from calldata instead of unstable entry stack slots', async (t) => {
  const abi = [{
    inputs: [
      { internalType: 'string', name: 'name', type: 'string' },
      { internalType: 'uint256', name: 'goal', type: 'uint256' }
    ],
    name: 'createProject',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }]
  const iface = new ethers.utils.Interface(abi)
  const calldata = iface.encodeFunctionData('createProject', ['toast', 999])
  const common = {
    sourceLocation: { start: 0 },
    abi,
    decodeFromCalldata: true,
    calldataEntryStep: 1,
    functionName: 'createProject',
    functionSelector: iface.getSighash('createProject').slice(2),
    functionParameterCount: 2
  }
  const scope = {
    locals: {
      name: {
        ...common,
        name: 'name',
        parameterIndex: 0,
        stackDepth: 0,
        type: new StringType('memory')
      },
      goal: {
        ...common,
        name: 'goal',
        parameterIndex: 1,
        stackDepth: 1,
        type: new Uint(32)
      }
    }
  }

  // These deliberately wrong stack values reproduce the compiler entry layout
  // that previously rendered name="" and goal=4 for createProject("toast", 999).
  const locals: any = await solidityLocals(
    1,
    { findScope: () => scope },
    ['0x04', '0x00'],
    [],
    {},
    [calldata],
    { start: 1 },
    null
  )

  t.equal(locals.name.value, 'toast', 'dynamic string parameter uses the transaction calldata')
  t.equal(locals.name.raw, ethers.utils.hexlify(ethers.utils.toUtf8Bytes('toast')), 'string raw bytes are preserved')
  t.equal(locals.goal.value, '999', 'value parameter uses the transaction calldata')

  const laterLocals: any = await solidityLocals(
    2,
    { findScope: () => scope },
    ['0x04', '0x00'],
    [],
    {},
    [calldata],
    { start: 1 },
    null
  )
  t.equal(laterLocals.name.value, '', 'a later step decodes a reassigned reference from the current stack')
  t.equal(laterLocals.goal.value, '4', 'a later step decodes a reassigned value from the current stack')
  t.end()
})

tape('small integer calldata parameters preserve decimal and signed values', async (t) => {
  const abi = [{
    inputs: [
      { internalType: 'uint8', name: 'small', type: 'uint8' },
      { internalType: 'int16', name: 'delta', type: 'int16' }
    ],
    name: 'setSmall',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }]
  const iface = new ethers.utils.Interface(abi)
  const calldata = iface.encodeFunctionData('setSmall', [10, -128])
  const common = {
    sourceLocation: { start: 0 },
    abi,
    decodeFromCalldata: true,
    calldataEntryStep: 7,
    functionName: 'setSmall',
    functionSelector: iface.getSighash('setSmall').slice(2),
    functionParameterCount: 2
  }
  const scope = {
    locals: {
      small: {
        ...common,
        name: 'small',
        parameterIndex: 0,
        stackDepth: 0,
        type: new Uint(1)
      },
      delta: {
        ...common,
        name: 'delta',
        parameterIndex: 1,
        stackDepth: 1,
        type: new Int(2)
      }
    }
  }
  const locals: any = await solidityLocals(
    7,
    { findScope: () => scope },
    ['0x00', '0x00'],
    [],
    {},
    [calldata],
    { start: 1 },
    null
  )

  t.equal(locals.small.value, '10', 'uint8 value 10 is not reinterpreted as hexadecimal 0x10')
  t.equal(locals.delta.value, '-128', "int16 value -128 is encoded as two's complement before decoding")
  t.end()
})
