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

import React, { useRef, useState, useEffect } from 'react' // eslint-disable-line
import { ModalDialogProps } from './types' // eslint-disable-line

import './remix-ui-modal-dialog.css'

export const ModalDialog = (props: ModalDialogProps) => {
  const [state, setState] = useState({
    toggleBtn: true
  })
  const modal = useRef(null)
  const handleHide = () => {
    props.handleHide()
  }

  useEffect(() => {
    modal.current.focus()
  }, [props.hide])

  useEffect(() => {
    function handleBlur (e) {
      if (!e.currentTarget.contains(e.relatedTarget)) {
        e.stopPropagation()
        if (document.activeElement !== this) {
          handleHide()
        }
      }
    }
    if (modal.current) {
      modal.current.addEventListener('blur', handleBlur)
    }
    return () => {
      modal.current && modal.current.removeEventListener('blur', handleBlur)
    }
  }, [modal.current])

  const modalKeyEvent = (keyCode) => {
    if (keyCode === 27) { // Esc
      if (props.cancelFn) props.cancelFn()
      handleHide()
    } else if (keyCode === 13) { // Enter
      enterHandler()
    } else if (keyCode === 37) {
      // todo && footerIsActive) { // Arrow Left
      setState((prevState) => { return { ...prevState, toggleBtn: true } })
    } else if (keyCode === 39) {
      // todo && footerIsActive) { // Arrow Right
      setState((prevState) => { return { ...prevState, toggleBtn: false } })
    }
  }

  const enterHandler = () => {
    if (state.toggleBtn) {
      if (props.okFn) props.okFn()
    } else {
      if (props.cancelFn) props.cancelFn()
    }
    handleHide()
  }

  return (
    <div
      data-id={`${props.id}ModalDialogContainer-react`}
      data-backdrop="static"
      data-keyboard="false"
      className='modal'
      style={{ display: props.hide ? 'none' : 'block' }}
      role="dialog"
    >
      <div className="modal-dialog" role="document">
        <div
          ref={modal}
          tabIndex={-1}
          className={'modal-content remixModalContent ' + (props.modalClass ? props.modalClass : '')}
          onKeyDown={({ keyCode }) => { modalKeyEvent(keyCode) }}
        >
          <div className="modal-header">
            <h6 className="modal-title" data-id={`${props.id}ModalDialogModalTitle-react`}>
              {props.title && props.title}
            </h6>
            {!props.showCancelIcon &&
            <span className="modal-close" onClick={() => handleHide()}>
              <i title="Close" className="fas fa-times" aria-hidden="true"></i>
            </span>
            }
          </div>
          <div className="modal-body text-break remixModalBody" data-id={`${props.id}ModalDialogModalBody-react`}>
            { props.children ? props.children : props.message }
          </div>
          <div className="modal-footer" data-id={`${props.id}ModalDialogModalFooter-react`}>
            {/* todo add autofocus ^^ */}
            { props.okLabel &&
              <span
                data-id={`${props.id}-modal-footer-ok-react`}
                className={'modal-ok btn btn-sm ' + (state.toggleBtn ? 'btn-dark' : 'btn-light')}
                onClick={() => {
                  if (props.okFn) props.okFn()
                  handleHide()
                }}
              >
                { props.okLabel ? props.okLabel : 'OK' }
              </span>
            }
            { props.cancelLabel &&
              <span
                data-id={`${props.id}-modal-footer-cancel-react`}
                className={'modal-cancel btn btn-sm ' + (state.toggleBtn ? 'btn-light' : 'btn-dark')}
                data-dismiss="modal"
                onClick={() => {
                  if (props.cancelFn) props.cancelFn()
                  handleHide()
                }}
              >
                { props.cancelLabel ? props.cancelLabel : 'Cancel' }
              </span>
            }
          </div>
        </div>
      </div>
    </div>
  )
}

export default ModalDialog
