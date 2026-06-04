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
import Slider from '../slider/slider' // eslint-disable-line
import ButtonNavigator from '../button-navigator/button-navigator' // eslint-disable-line

export const StepManager = ({ stepManager: { jumpTo, traceLength, stepIntoBack, stepIntoForward, stepOverBack, stepOverForward, jumpOut, jumpNextBreakpoint, jumpPreviousBreakpoint, jumpToException, registerEvent } }) => {
  const [state, setState] = useState({
    sliderValue: 0,
    revertWarning: '',
    stepState: '',
    jumpOutDisabled: true
  })

  useEffect(() => {
    registerEvent && registerEvent('revertWarning', setRevertWarning)
    registerEvent && registerEvent('stepChanged', updateStep)
  }, [registerEvent])

  const setRevertWarning = (warning) => {
    setState(prevState => {
      return { ...prevState, revertWarning: warning }
    })
  }

  const updateStep = (step, stepState, jumpOutDisabled) => {
    setState(prevState => {
      return { ...prevState, sliderValue: step, stepState, jumpOutDisabled }
    })
  }
  const { sliderValue, revertWarning, stepState, jumpOutDisabled } = state

  return (
    <div className="py-1">
      <Slider jumpTo={jumpTo} sliderValue={sliderValue} traceLength={traceLength} />
      <ButtonNavigator
        stepIntoBack={stepIntoBack}
        stepIntoForward={stepIntoForward}
        stepOverBack={stepOverBack}
        stepOverForward={stepOverForward}
        revertedReason={revertWarning}
        stepState={stepState}
        jumpOutDisabled={jumpOutDisabled}
        jumpOut={jumpOut}
        jumpNextBreakpoint={jumpNextBreakpoint}
        jumpPreviousBreakpoint={jumpPreviousBreakpoint}
        jumpToException={jumpToException}
      />
    </div>
  )
}

export default StepManager
