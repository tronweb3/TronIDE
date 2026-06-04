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

export interface SolidityCompilerProps {
  plugin: {
    contractMap: {
      file: string
    } | Record<string, any>
    compileErrors: any,
    isHardHatProject: boolean,
    queryParams: any,
    compileTabLogic: any,
    currentFile: string,
    contractsDetails: Record<string, any>,
    editor: any,
    config: any,
    fileProvider: any,
    fileManager: any,
    contentImport: any,
    call: (...args) => void
    on: (...args) => void,
    setHardHatCompilation: (value: boolean) => void,
    setSelectedVersion: (value: string) => void,
    configurationSettings: ConfigurationSettings
  },
}

export interface CompilerContainerProps {
  editor: any,
  config: any,
  queryParams: any,
  compileTabLogic: any,
  tooltip: (message: string | JSX.Element) => void,
  modal: (title: string, message: string | JSX.Element, okLabel: string, okFn: () => void, cancelLabel?: string, cancelFn?: () => void) => void,
  compiledFileName: string,
  setHardHatCompilation: (value: boolean) => void,
  updateCurrentVersion: any,
  isHardHatProject: boolean,
  configurationSettings: ConfigurationSettings
}
export interface ContractSelectionProps {
  contractMap: {
    file: string
  } | Record<string, any>,
  fileManager: any,
  fileProvider: any,
  modal: (title: string, message: string | JSX.Element, okLabel: string, okFn: () => void, cancelLabel?: string, cancelFn?: () => void) => void,
  contractsDetails: Record<string, any>
}

export interface ConfigurationSettings {
  version: string,
  evmVersion: string,
  language: string,
  optimize: boolean,
  runs: string
}

declare global {
  interface Window {
    gtag: (
      command: 'event' | 'config',
      name: string,
      params?: Record<string, any>
    ) => void;
  }
}
