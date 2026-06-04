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

import React, { useEffect, useState } from 'react' // eslint-disable-line
import { ModalDialog } from '@remix-ui/modal-dialog' // eslint-disable-line

import './toaster.css'

/* eslint-disable-next-line */
export interface ToasterProps {
  message: string
  timeOut?: number
}

export const Toaster = (props: ToasterProps) => {
  const [state, setState] = useState({
    message: '',
    hide: true,
    hiding: false,
    timeOutId: null,
    timeOut: props.timeOut || 7000,
    showModal: false
  })

  useEffect(() => {
    if (props.message) {
      const timeOutId = setTimeout(() => {
        setState(prevState => {
          return { ...prevState, hiding: true }
        })
      }, state.timeOut)

      setState(prevState => {
        const shortTooltipText = props.message.length > 201 ? props.message.substring(0, 200) + '...' : props.message

        return { ...prevState, hide: false, hiding: false, timeOutId, message: shortTooltipText }
      })
    }
  }, [props.message])

  useEffect(() => {
    if (state.hiding) {
      setTimeout(() => {
        closeTheToaster()
      }, 1800)
    }
  }, [state.hiding])

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

  const closeTheToaster = () => {
    if (state.timeOutId) {
      clearTimeout(state.timeOutId)
    }
    setState(prevState => {
      return { ...prevState, message: '', hide: true, hiding: false, timeOutId: null, showModal: false }
    })
  }

  const handleMouseEnter = () => {
    if (state.timeOutId) {
      clearTimeout(state.timeOutId)
    }
    setState(prevState => {
      return { ...prevState, timeOutId: null }
    })
  }

  const handleMouseLeave = () => {
    if (!state.timeOutId) {
      const timeOutId = setTimeout(() => {
        setState(prevState => {
          return { ...prevState, hiding: true }
        })
      }, state.timeOut)

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
