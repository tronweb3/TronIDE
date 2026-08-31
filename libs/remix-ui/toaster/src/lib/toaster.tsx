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

import React, { useEffect, useRef, useState } from 'react' // eslint-disable-line
import { ModalDialog } from '@remix-ui/modal-dialog' // eslint-disable-line

import './toaster.css'

/* eslint-disable-next-line */
export interface ToasterProps {
  message: string
  timeOut?: number
}

export const Toaster = (props: ToasterProps) => {
  const autoHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finishHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const messageGeneration = useRef(0)
  const [state, setState] = useState({
    message: '',
    hide: true,
    hiding: false,
    timeOutId: null,
    timeOut: props.timeOut || 7000,
    showModal: false
  })

  const clearAutoHideTimer = () => {
    if (autoHideTimer.current) clearTimeout(autoHideTimer.current)
    autoHideTimer.current = null
  }

  const clearFinishHideTimer = () => {
    if (finishHideTimer.current) clearTimeout(finishHideTimer.current)
    finishHideTimer.current = null
  }

  const closeTheToaster = () => {
    clearAutoHideTimer()
    clearFinishHideTimer()
    setState(prevState => {
      return { ...prevState, message: '', hide: true, hiding: false, timeOutId: null, showModal: false }
    })
  }

  useEffect(() => {
    clearAutoHideTimer()
    clearFinishHideTimer()
    const generation = ++messageGeneration.current
    if (!props.message) {
      setState(prevState => {
        return { ...prevState, message: '', hide: true, hiding: false, timeOutId: null, showModal: false }
      })
      return
    }

    const shortTooltipText = props.message.length > 201 ? props.message.substring(0, 200) + '...' : props.message
    const timeOutId = setTimeout(() => {
      if (generation !== messageGeneration.current) return
      autoHideTimer.current = null
      setState(prevState => {
        return { ...prevState, hiding: true }
      })
    }, props.timeOut || 7000)
    autoHideTimer.current = timeOutId

    setState(prevState => {
      return { ...prevState, hide: false, hiding: false, timeOutId, message: shortTooltipText }
    })

    return () => {
      clearAutoHideTimer()
      clearFinishHideTimer()
    }
  }, [props.message, props.timeOut])

  useEffect(() => {
    clearFinishHideTimer()
    if (!state.hiding) return
    const generation = messageGeneration.current
    finishHideTimer.current = setTimeout(() => {
      if (generation !== messageGeneration.current) return
      finishHideTimer.current = null
      closeTheToaster()
    }, 1800)
    return clearFinishHideTimer
  }, [state.hiding])

  useEffect(() => () => {
    clearAutoHideTimer()
    clearFinishHideTimer()
  }, [])

  const showFullMessage = () => {
    setState(prevState => {
      return { ...prevState, showModal: true }
    })
  }

  const hideFullMessage = () => { //eslint-disable-line
    setState(prevState => {
      return { ...prevState, showModal: false }
    })
  }

  const handleMouseEnter = () => {
    clearAutoHideTimer()
    setState(prevState => {
      return { ...prevState, timeOutId: null }
    })
  }

  const handleMouseLeave = () => {
    if (!autoHideTimer.current) {
      const generation = messageGeneration.current
      const timeOutId = setTimeout(() => {
        if (generation !== messageGeneration.current) return
        autoHideTimer.current = null
        setState(prevState => {
          return { ...prevState, hiding: true }
        })
      }, props.timeOut || 7000)
      autoHideTimer.current = timeOutId

      setState(prevState => {
        return { ...prevState, timeOutId }
      })
    }
  }

  return (
    <>
      <ModalDialog
        message={props.message}
        cancelLabel='Close'
        cancelFn={() => {}}
        hide={!state.showModal}
        handleHide={hideFullMessage}
      />
      { !state.hide &&
        <div data-shared="tooltipPopup" className={`remixui_tooltip alert alert-info p-2 ${state.hiding ? 'remixui_animateTop' : 'remixui_animateBottom'}`} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
          <span className="px-2">
            { state.message }
            { (props.message.length > 201) && <button className="btn btn-secondary btn-sm mx-3" style={{ whiteSpace: 'nowrap' }} onClick={showFullMessage}>Show full message</button> }
          </span>
          <span style={{ alignSelf: 'baseline' }}>
            <button data-id="tooltipCloseButton" className="fas fa-times btn-info mx-1 p-0" onClick={closeTheToaster}></button>
          </span>
        </div>
      }
    </>
  )
}

export default Toaster
