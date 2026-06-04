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

import React, { useState, useReducer, useEffect, useCallback } from 'react' // eslint-disable-line
import { CopyToClipboard } from '@remix-ui/clipboard' // eslint-disable-line

import { enablePersonalModeText, ethereunVMText, generateContractMetadataText, gitAccessTokenLink, gitAccessTokenText, gitAccessTokenText2, gitAccessTokenTitle, matomoAnalytics, textDark, textSecondary, warnText, wordWrapText } from './constants'

import './remix-ui-settings.css'
import { ethereumVM, generateContractMetadat, personal, textWrapEventAction, useMatomoAnalytics, saveTokenToast, removeTokenToast } from './settingsAction'
import { initialState, toastInitialState, toastReducer, settingReducer } from './settingsReducer'
import { Toaster } from '@remix-ui/toaster'// eslint-disable-line

/* eslint-disable-next-line */
export interface RemixUiSettingsProps {
  config: any,
  editor: any,
   _deps: any,
   useMatomoAnalytics: boolean
}

export const RemixUiSettings = (props: RemixUiSettingsProps) => {
  const [, dispatch] = useReducer(settingReducer, initialState)
  const [state, dispatchToast] = useReducer(toastReducer, toastInitialState)
  const [tokenValue, setTokenValue] = useState('')
  const [themeName, setThemeName] = useState('')

  useEffect(() => {
    props._deps.themeModule.switchTheme()
    const token = props.config.get('settings/gist-access-token')
    if (token === undefined) {
      props.config.set('settings/generate-contract-metadata', true)
      dispatch({ type: 'contractMetadata', payload: { name: 'contractMetadata', isChecked: true, textClass: textDark } })
    }
    if (token) {
      setTokenValue(token)
    }
  }, [themeName, state.message])

  useEffect(() => {
    if (props.useMatomoAnalytics !== null) useMatomoAnalytics(props.config, props.useMatomoAnalytics, dispatch)
  }, [props.useMatomoAnalytics])

  useEffect(() => {
    const javascriptVM = props.config.get('settings/always-use-vm')

    if ((javascriptVM === null) || (javascriptVM === undefined)) ethereumVM(props.config, true, dispatch)
  }, [props.config])

  const onchangeGenerateContractMetadata = (event) => {
    generateContractMetadat(props.config, event.target.checked, dispatch)
  }

  const onchangeOption = (event) => {
    ethereumVM(props.config, event.target.checked, dispatch)
  }

  const textWrapEvent = (event) => {
    textWrapEventAction(props.config, props.editor, event.target.checked, dispatch)
  }

  const onchangePersonal = event => {
    personal(props.config, event.target.checked, dispatch)
  }

  const onchangeMatomoAnalytics = event => {
    useMatomoAnalytics(props.config, event.target.checked, dispatch)
  }

  const onswitchTheme = (event, name) => {
    props._deps.themeModule.switchTheme(name)
    setThemeName(name)
  }

  const getTextClass = (key) => {
    if (props.config.get(key)) {
      return textDark
    } else {
      return textSecondary
    }
  }

  const generalConfig = () => {
    const isMetadataChecked = props.config.get('settings/generate-contract-metadata') || false
    const isEthereumVMChecked = props.config.get('settings/always-use-vm') || false
    const isEditorWrapChecked = props.config.get('settings/text-wrap') || false
    const isPersonalChecked = props.config.get('settings/personal-mode') || false
    const isMatomoChecked = props.config.get('settings/matomo-analytics') || false

    return (
      <div className="$border-top">
        <div className="card-body pt-3 pb-2">
          <h6 className="card-title">General settings</h6>
          <div className="mt-2 custom-control custom-checkbox mb-1">
            <input onChange={onchangeGenerateContractMetadata} id="generatecontractmetadata" data-id="settingsTabGenerateContractMetadata" type="checkbox" className="custom-control-input" name="contractMetadata" checked = { isMetadataChecked }/>
            <label className={`form-check-label custom-control-label align-middle ${getTextClass('settings/generate-contract-metadata')}`} data-id="settingsTabGenerateContractMetadataLabel" htmlFor="generatecontractmetadata">{generateContractMetadataText}</label>
          </div>
          <div className="fmt-2 custom-control custom-checkbox mb-1">
            <input onChange={onchangeOption} className="custom-control-input" id="alwaysUseVM" data-id="settingsTabAlwaysUseVM" type="checkbox" name="ethereumVM" checked={ isEthereumVMChecked }/>
            <label className={`form-check-label custom-control-label align-middle ${getTextClass('settings/always-use-vm')}`} htmlFor="alwaysUseVM">{ethereunVMText}</label>
          </div>
          <div className="mt-2 custom-control custom-checkbox mb-1">
            <input id="editorWrap" className="custom-control-input" type="checkbox" onChange={textWrapEvent} checked = { isEditorWrapChecked }/>
            <label className={`form-check-label custom-control-label align-middle ${getTextClass('settings/text-wrap')}`} htmlFor="editorWrap">{wordWrapText}</label>
          </div>
        </div>
      </div>
    )
  }

  const saveToken = () => {
    saveTokenToast(props.config, dispatchToast, tokenValue)
  }

  const removeToken = () => {
    setTokenValue('')
    removeTokenToast(props.config, dispatchToast)
  }

  const handleSaveTokenState = useCallback(
    (event) => {
      setTokenValue(event.target.value)
    },
    [tokenValue]
  )

  const gistToken = () => (
    <div className="border-top">
      <div className="card-body pt-3 pb-2">
        <h6 className="card-title">{ gitAccessTokenTitle }</h6>
        <p className="mb-1">{ gitAccessTokenText }</p>
        <p className="">{ gitAccessTokenText2 }</p>
        <p className="mb-1"><a className="text-primary" target="_blank" rel="noopener noreferrer" href="https://github.com/settings/tokens">{ gitAccessTokenLink }</a></p>
        <div className=""><label>TOKEN:</label>
          <div className="text-secondary mb-0 h6">
            <input id="gistaccesstoken" data-id="settingsTabGistAccessToken" type="password" className="form-control" onChange={handleSaveTokenState} value={ tokenValue } />
            <div className="d-flex justify-content-end pt-2">
              <CopyToClipboard content={tokenValue} data-id='copyToClipboardCopyIcon' />
              <input className="btn btn-sm btn-primary ml-2" id="savegisttoken" data-id="settingsTabSaveGistToken" onClick={() => saveToken()} value="Save" type="button" disabled={tokenValue === ''}></input>
              <button className="btn btn-sm btn-secondary ml-2" id="removegisttoken" data-id="settingsTabRemoveGistToken" title="Delete Github access token" onClick={() => removeToken()}>Remove</button>
            </div>
          </div></div>
      </div>
    </div>
  )

  const themes = () => {
    const themes = props._deps.themeModule.getThemes()
    if (themes) {
      return themes.map((aTheme, index) => (
        <div className="radio custom-control custom-radio mb-1 form-check" key={index}>
          <input type="radio" onChange={event => { onswitchTheme(event, aTheme.name) }} className="align-middle custom-control-input" name='theme' id={aTheme.name} data-id={`settingsTabTheme${aTheme.name}`} checked = {props._deps.themeModule.active === aTheme.name }/>
          <label className="form-check-label custom-control-label" data-id={`settingsTabThemeLabel${aTheme.name}`} htmlFor={aTheme.name}>{aTheme.name} ({aTheme.quality})</label>
        </div>
      )
      )
    }
  }

  return (
    <div>
      {state.message ? <Toaster message= {state.message}/> : null}
      {generalConfig()}
      <div className="border-top">
        <div className="card-body pt-3 pb-2">
          <h6 className="card-title">Theme</h6>
          <div className="card-text themes-container" data-id="settingsTabThemePanel">
            {themes()}
          </div>
        </div>
      </div>
      {gistToken()}
    </div>
  )
}
