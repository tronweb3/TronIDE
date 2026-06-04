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

import React, { useState, useEffect } from 'react' // eslint-disable-line
import CalldataPanel from './calldata-panel' // eslint-disable-line
import MemoryPanel from './memory-panel' // eslint-disable-line
import CallstackPanel from './callstack-panel' // eslint-disable-line
import StackPanel from './stack-panel' // eslint-disable-line
import StoragePanel from './storage-panel' // eslint-disable-line
import ReturnValuesPanel from './dropdown-panel' // eslint-disable-line
import FullStoragesChangesPanel from './full-storages-changes' // eslint-disable-line

export const VmDebugger = ({ vmDebugger: { registerEvent } }) => {
  const [calldataPanel, setCalldataPanel] = useState(null)
  const [memoryPanel, setMemoryPanel] = useState(null)
  const [callStackPanel, setCallStackPanel] = useState(null)
  const [stackPanel, setStackPanel] = useState(null)
  const [storagePanel, setStoragePanel] = useState({
    calldata: null,
    header: null
  })
  const [returnValuesPanel, setReturnValuesPanel] = useState(null)
  const [fullStoragesChangesPanel, setFullStoragesChangesPanel] = useState(null)

  useEffect(() => {
    registerEvent && registerEvent('traceManagerCallDataUpdate', (calldata) => {
      setCalldataPanel(() => calldata)
    })
    registerEvent && registerEvent('traceManagerMemoryUpdate', (calldata) => {
      setMemoryPanel(() => calldata)
    })
    registerEvent && registerEvent('traceManagerCallStackUpdate', (calldata) => {
      setCallStackPanel(() => calldata)
    })
    registerEvent && registerEvent('traceManagerStackUpdate', (calldata) => {
      setStackPanel(() => calldata)
    })
    registerEvent && registerEvent('traceManagerStorageUpdate', (calldata, header) => {
      setStoragePanel(() => {
        return { calldata, header }
      })
    })
    registerEvent && registerEvent('traceReturnValueUpdate', (calldata) => {
      setReturnValuesPanel(() => calldata)
    })
    registerEvent && registerEvent('traceAddressesUpdate', (calldata) => {
      setFullStoragesChangesPanel(() => {
        return {}
      })
    })
    registerEvent && registerEvent('traceStorageUpdate', (calldata) => {
      setFullStoragesChangesPanel(() => calldata)
    })
  }, [registerEvent])

  return (
    <div id='vmdebugger' className="px-2">
      <div>
        <StackPanel calldata={stackPanel} />
        <MemoryPanel calldata={memoryPanel} />
        <StoragePanel calldata={storagePanel.calldata} header={storagePanel.header} />
        <CallstackPanel calldata={callStackPanel} />
        <CalldataPanel calldata={calldataPanel} />
        <ReturnValuesPanel dropdownName='Return Value' calldata={returnValuesPanel || {}} />
        <FullStoragesChangesPanel calldata={fullStoragesChangesPanel} />
      </div>
    </div>
  )
}

export default VmDebugger
