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

export interface ExtractData {
    children?: Array<{key: number | string, value: ExtractData}>
    self?: string | number,
    isNode?: boolean,
    isLeaf?: boolean,
    isArray?: boolean,
    isStruct?: boolean,
    isMapping?: boolean,
    type?: string,
    isProperty?: boolean,
    hasNext?: boolean,
    cursor?: number
}

export type ExtractFunc = (json: any, parent?: any) => ExtractData

export interface DropdownPanelProps {
    dropdownName: string,
    dropdownMessage?: string,
    calldata?: {
        [key: string]: string
    },
    header?: string,
    loading?: boolean,
    extractFunc?: ExtractFunc,
    formatSelfFunc?: FormatSelfFunc,
    registerEvent?: Function,
    triggerEvent?: Function,
    loadMoreEvent?: string,
    loadMoreCompletedEvent?: string,
    bodyStyle?: React.CSSProperties,
    headStyle?: React.CSSProperties,
    hexHighlight?: boolean // highlight non zero value of hex value
}

export type FormatSelfFunc = (key: string | number, data: ExtractData) => JSX.Element
declare global {
  interface Window {
    gtag: (
      command: 'event' | 'config',
      name: string,
      params?: Record<string, any>
    ) => void;
  }
}
