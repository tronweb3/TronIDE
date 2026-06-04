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

import React, { useState, useEffect, useRef } from 'react'  //eslint-disable-line
import './tx-browser.css'

export const TxBrowser = ({ requestDebug, updateTxNumberFlag, unloadRequested, transactionNumber, debugging }) => {
  const [state, setState] = useState({
    txNumber: ''
  })

  const inputValue = useRef(null)
  useEffect(() => {
    setState(prevState => {
      return {
        ...prevState,
        txNumber: transactionNumber
      }
    })
  }, [transactionNumber])

  const handleSubmit = () => {
    if (debugging) {
      unload()
    } else {
      requestDebug(undefined, state.txNumber)
    }
    window?.gtag('event', 'click', { event_category: 'debugger_user_action', event_label: `${debugging ? 'stop' : 'start'}_debugging` })
  }

  const unload = () => {
    unloadRequested()
  }

  const txInputChanged = (value) => {
    // todo check validation of txnumber in the input element, use
    // required
    // oninvalid="setCustomValidity('Please provide a valid transaction number, must start with 0x and have length of 22')"
    // pattern="^0[x,X]+[0-9a-fA-F]{22}"
    // this.state.txNumberInput.setCustomValidity('')
    setState(prevState => {
      return {
        ...prevState,
        txNumber: value
      }
    })
  }

  const txInputOnInput = () => {
    updateTxNumberFlag(!inputValue.current.value)
  }

  return (
    <div className='container px-0'>
      <div className='txContainer'>
        <div className='py-1 d-flex justify-content-center w-100 input-group'>
          <input
            ref={inputValue}
            value={state.txNumber}
            className='form-control m-0 txinput'
            id='txinput'
            type='text'
            onChange={({ target: { value } }) => txInputChanged(value)}
            onInput={txInputOnInput}
            placeholder={'Transaction hash, should start with 0x'}
            data-id='debuggerTransactionInput'
            disabled={debugging}
          />
        </div>
        <div className='d-flex justify-content-center w-100 btn-group py-1'>
          <button
            className='btn btn-primary btn-sm txbutton'
            id='load'
            title={debugging ? 'Stop debugging' : 'Start debugging'}
            onClick={handleSubmit}
            data-id='debuggerTransactionStartButton'
            disabled={!state.txNumber }
          >
            { debugging ? 'Stop' : 'Start' } debugging
          </button>
        </div>
      </div>
      <span id='error' />
    </div>
  )
}

export default TxBrowser
