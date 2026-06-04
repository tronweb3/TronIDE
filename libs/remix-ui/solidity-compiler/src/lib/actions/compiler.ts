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

import React from 'react'

export const setEditorMode = (mode: string) => {
  return {
    type: 'SET_EDITOR_MODE',
    payload: mode
  }
}

export const resetEditorMode = () => (dispatch: React.Dispatch<any>) => {
  dispatch({
    type: 'RESET_EDITOR_MODE'
  })
}

export const setCompilerMode = (mode: string, ...args) => {
  return {
    type: 'SET_COMPILER_MODE',
    payload: { mode, args }
  }
}

export const resetCompilerMode = () => (dispatch: React.Dispatch<any>) => {
  dispatch({
    type: 'RESET_COMPILER_MODE'
  })
}

export const listenToEvents = (editor, compileTabLogic) => (dispatch: React.Dispatch<any>) => {
  editor.event.register('sessionSwitched', () => {
    dispatch(setEditorMode('sessionSwitched'))
  })

  compileTabLogic.event.on('startingCompilation', () => {
    dispatch(setCompilerMode('startingCompilation'))
  })

  compileTabLogic.compiler.event.register('compilationDuration', (speed) => {
    dispatch(setCompilerMode('compilationDuration', speed))
  })

  editor.event.register('contentChanged', () => {
    dispatch(setEditorMode('contentChanged'))
  })

  compileTabLogic.compiler.event.register('loadingCompiler', () => {
    dispatch(setCompilerMode('loadingCompiler'))
  })

  compileTabLogic.compiler.event.register('compilerLoaded', () => {
    dispatch(setCompilerMode('compilerLoaded'))
  })

  compileTabLogic.compiler.event.register('compilerLoadFailed', (message) => {
    dispatch(setCompilerMode('compilationFinished', false, { error: { formattedMessage: message, severity: 'error' } }, {}))
  })

  compileTabLogic.compiler.event.register('compilationFinished', (success, data, source) => {
    dispatch(setCompilerMode('compilationFinished', success, data, source))
  })
}
