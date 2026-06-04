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
import { SolidityCompilerProps } from './types'
import { CompilerContainer } from './compiler-container' // eslint-disable-line
import { ContractSelection } from './contract-selection' // eslint-disable-line
import { Toaster } from '@remix-ui/toaster' // eslint-disable-line
import { ModalDialog } from '@remix-ui/modal-dialog' // eslint-disable-line
import { Renderer } from '@remix-ui/renderer' // eslint-disable-line

import './css/style.css'

export const SolidityCompiler = (props: SolidityCompilerProps) => {
  const { plugin, plugin: { editor, config, queryParams, compileTabLogic, currentFile, fileProvider, fileManager, contractsDetails, contractMap, compileErrors, isHardHatProject, setHardHatCompilation, configurationSettings } } = props
  const [state, setState] = useState({
    contractsDetails: {},
    eventHandlers: {},
    loading: false,
    compileTabLogic: null,
    compiler: null,
    toasterMsg: '',
    modal: {
      hide: true,
      title: '',
      message: null,
      okLabel: '',
      okFn: () => {},
      cancelLabel: '',
      cancelFn: () => {},
      handleHide: null
    }
  })
  const [currentVersion, setCurrentVersion] = useState('')

  const toast = (message: string) => {
    setState(prevState => {
      return { ...prevState, toasterMsg: message }
    })
  }

  const updateCurrentVersion = (value) => {
    setCurrentVersion(value)
    plugin.setSelectedVersion(value)
  }

  const modal = async (title: string, message: string | JSX.Element, okLabel: string, okFn: () => void, cancelLabel?: string, cancelFn?: () => void) => {
    await setState(prevState => {
      return {
        ...prevState,
        modal: {
          ...prevState.modal,
          hide: false,
          message,
          title,
          okLabel,
          okFn,
          cancelLabel,
          cancelFn
        }
      }
    })
  }

  const handleHideModal = () => {
    setState(prevState => {
      return { ...prevState, modal: { ...state.modal, hide: true, message: null } }
    })
  }

  const panicMessage = (message: string) => (
    <div>
      <i className="fas fa-exclamation-circle remixui_panicError" aria-hidden="true"></i>
      The compiler returned with the following internal error: <br /> <b>{message}.<br />
      The compiler might be in a non-sane state, please be careful and do not use further compilation data to deploy to mainnet.
      It is heavily recommended to use another browser not affected by this issue (Firefox is known to not be affected).</b><br />
    </div>
  )

  useEffect(() => {
    if (compileErrors.error && compileErrors.error.mode === 'panic') {
      modal('Error', panicMessage(compileErrors.error.formattedMessage), 'Close', null)
    }
  }, [compileErrors.error && compileErrors.error.mode, compileErrors.error && compileErrors.error.formattedMessage])

  return (
    <>
      <div className="compileTabContent">
        <CompilerContainer editor={editor} config={config} queryParams={queryParams} compileTabLogic={compileTabLogic} tooltip={toast} modal={modal} compiledFileName={currentFile} setHardHatCompilation={setHardHatCompilation.bind(plugin)} updateCurrentVersion={updateCurrentVersion} isHardHatProject={isHardHatProject} configurationSettings={configurationSettings} />
        <ContractSelection contractMap={contractMap} fileProvider={fileProvider} fileManager={fileManager} contractsDetails={contractsDetails} modal={modal} />
        <div className="remixui_errorBlobs p-4" data-id="compiledErrors">
          <span data-id={`compilationFinishedWith_${currentVersion}`}></span>
          { compileErrors.error && <Renderer message={compileErrors.error.formattedMessage || compileErrors.error} plugin={plugin} opt={{ type: compileErrors.error.severity || 'error', errorType: compileErrors.error.type }} config={config} editor={editor} fileManager={fileManager} /> }
          { compileErrors.errors && compileErrors.errors.length && compileErrors.errors.map((err, index) => {
            if (config.get('hideWarnings')) {
              if (err.severity !== 'warning') {
                return <Renderer key={index} message={err.formattedMessage} plugin={plugin} opt={{ type: err.severity, errorType: err.type }} config={config} editor={editor} fileManager={fileManager} />
              }
            } else {
              return <Renderer key={index} message={err.formattedMessage} plugin={plugin} opt={{ type: err.severity, errorType: err.type }} config={config} editor={editor} fileManager={fileManager} />
            }
          }) }
        </div>
      </div>
      <Toaster message={state.toasterMsg} />
      <ModalDialog
        id='workspacesModalDialog'
        title={ state.modal.title }
        message={ state.modal.message }
        hide={ state.modal.hide }
        okLabel={ state.modal.okLabel }
        okFn={ state.modal.okFn }
        cancelLabel={ state.modal.cancelLabel }
        cancelFn={ state.modal.cancelFn }
        handleHide={ handleHideModal }>
        { (typeof state.modal.message !== 'string') && state.modal.message }
      </ModalDialog>
    </>
  )
}

export default SolidityCompiler
