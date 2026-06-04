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
import { Tooltip } from 'antd'
import './button-navigator.css'

export const ButtonNavigation = ({ stepOverBack, stepIntoBack, stepIntoForward, stepOverForward, jumpOut, jumpPreviousBreakpoint, jumpNextBreakpoint, jumpToException, revertedReason, stepState, jumpOutDisabled }) => {
  const [state, setState] = useState({
    intoBackDisabled: true,
    overBackDisabled: true,
    intoForwardDisabled: true,
    overForwardDisabled: true,
    jumpOutDisabled: true,
    jumpNextBreakpointDisabled: true,
    jumpPreviousBreakpointDisabled: true
  })

  useEffect(() => {
    stepChanged(stepState, jumpOutDisabled)
  }, [stepState, jumpOutDisabled])

  const reset = () => {
    setState(() => {
      return {
        intoBackDisabled: true,
        overBackDisabled: true,
        intoForwardDisabled: true,
        overForwardDisabled: true,
        jumpOutDisabled: true,
        jumpNextBreakpointDisabled: true,
        jumpPreviousBreakpointDisabled: true
      }
    })
  }

  const stepChanged = (stepState, jumpOutDisabled) => {
    if (stepState === 'invalid') {
      // TODO: probably not necessary, already implicit done in the next steps
      reset()
      return
    }

    setState(() => {
      return {
        intoBackDisabled: stepState === 'initial',
        overBackDisabled: stepState === 'initial',
        jumpPreviousBreakpointDisabled: stepState === 'initial',
        intoForwardDisabled: stepState === 'end',
        overForwardDisabled: stepState === 'end',
        jumpNextBreakpointDisabled: stepState === 'end',
        jumpOutDisabled: (jumpOutDisabled !== null) && (jumpOutDisabled !== undefined) ? jumpOutDisabled : true
      }
    })
  }

  return (
    <div className="buttons">
      <div className="stepButtons btn-group py-1">
        <Tooltip title='Step over back'>
          <button id='overback' className='btn btn-primary btn-sm navigator stepButton fas fa-reply' onClick={() => { stepOverBack && stepOverBack() }} disabled={state.overBackDisabled} ></button>
        </Tooltip>
        <Tooltip title='Step back'>
          <button id='intoback' data-id="buttonNavigatorIntoBack" className='btn btn-primary btn-sm navigator stepButton fas fa-level-up-alt' onClick={() => { stepIntoBack && stepIntoBack() }} disabled={state.intoBackDisabled}></button>
        </Tooltip>
        <Tooltip title='Step into'>
          <button id='intoforward' data-id="buttonNavigatorIntoForward" className='btn btn-primary btn-sm navigator stepButton fas fa-level-down-alt' onClick={() => { stepIntoForward && stepIntoForward() }} disabled={state.intoForwardDisabled}></button>
        </Tooltip>
        <Tooltip title='Step over forward'>
          <button id='overforward' className='btn btn-primary btn-sm navigator stepButton fas fa-share' onClick={() => { stepOverForward && stepOverForward() }} disabled={state.overForwardDisabled}></button>
        </Tooltip>
      </div>

      <div className="jumpButtons btn-group py-1">
        <Tooltip title='Jump to the previous breakpoint'>
          <button className='btn btn-primary btn-sm navigator jumpButton fas fa-step-backward' id='jumppreviousbreakpoint' data-id="buttonNavigatorJumpPreviousBreakpoint" onClick={() => { jumpPreviousBreakpoint && jumpPreviousBreakpoint() }} disabled={state.jumpPreviousBreakpointDisabled}></button>
        </Tooltip>
        <Tooltip title='Jump out'>
          <button className='btn btn-primary btn-sm navigator jumpButton fas fa-eject' id='jumpout' onClick={() => { jumpOut && jumpOut() }} disabled={state.jumpOutDisabled}></button>
        </Tooltip>
        <Tooltip title='Jump to the next breakpoint'>
          <button className='btn btn-primary btn-sm navigator jumpButton fas fa-step-forward' id='jumpnextbreakpoint' data-id="buttonNavigatorJumpNextBreakpoint" onClick={() => { jumpNextBreakpoint && jumpNextBreakpoint() }} disabled={state.jumpNextBreakpointDisabled}></button>
        </Tooltip>
      </div>
      <div id='reverted' style={{ display: revertedReason === '' ? 'none' : 'block' }}>
        <button id='jumptoexception' title='Jump to exception' className='btn btn-danger btn-sm navigator button fas fa-exclamation-triangle' onClick={() => { jumpToException && jumpToException() }} disabled={state.jumpOutDisabled}>
        </button>
        <span>State changes made during this call will be reverted.</span>
        <span id='outofgas' style={{ display: revertedReason === 'outofgas' ? 'inline' : 'none' }}>This call will run out of gas.</span>
        <span id='parenthasthrown' style={{ display: revertedReason === 'parenthasthrown' ? 'inline' : 'none' }}>The parent call will throw an exception</span>
      </div>
    </div>
  )
}

export default ButtonNavigation
