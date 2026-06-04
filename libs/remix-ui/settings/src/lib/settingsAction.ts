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

import { textDark, textSecondary } from './constants'

declare global {
  interface Window {
    _paq: any
  }
}

const _paq = window._paq = window._paq || [] //eslint-disable-line

export const generateContractMetadat = (config, checked, dispatch) => {
  config.set('settings/generate-contract-metadata', checked)
  dispatch({ type: 'contractMetadata', payload: { isChecked: checked, textClass: checked ? textDark : textSecondary } })
}

export const ethereumVM = (config, checked: boolean, dispatch) => {
  config.set('settings/always-use-vm', checked)
  dispatch({ type: 'ethereumVM', payload: { isChecked: checked, textClass: checked ? textDark : textSecondary } })
}

export const textWrapEventAction = (config, editor, checked, dispatch) => {
  config.set('settings/text-wrap', checked)
  editor.resize(checked)
  dispatch({ type: 'textWrap', payload: { isChecked: checked, textClass: checked ? textDark : textSecondary } })
}

export const personal = (config, checked, dispatch) => {
  config.set('settings/personal-mode', checked)
  dispatch({ type: 'personal', payload: { isChecked: checked, textClass: checked ? textDark : textSecondary } })
}

export const useMatomoAnalytics = (config, checked, dispatch) => {
  config.set('settings/matomo-analytics', checked)
  dispatch({ type: 'useMatomoAnalytics', payload: { isChecked: checked, textClass: checked ? textDark : textSecondary } })
  if (checked) {
    _paq.push(['forgetUserOptOut'])
    // @TODO remove next line when https://github.com/matomo-org/matomo/commit/9e10a150585522ca30ecdd275007a882a70c6df5 is used
    document.cookie = 'mtm_consent_removed=; expires=Thu, 01 Jan 1970 00:00:01 GMT;'
  } else {
    _paq.push(['optUserOut'])
  }
}

export const saveTokenToast = (config, dispatch, tokenValue) => {
  config.set('settings/gist-access-token', tokenValue)
  dispatch({ type: 'save', payload: { message: 'Access token has been saved' } })
}

export const removeTokenToast = (config, dispatch) => {
  config.set('settings/gist-access-token', '')
  dispatch({ type: 'removed', payload: { message: 'Access token removed' } })
}
