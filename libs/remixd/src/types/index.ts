/*
 * Original work Copyright © 2018-2021 Remix Team
 * Licensed under the Apache License, Version 2.0.
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

import * as ServiceList from '../serviceList'
import * as Websocket from 'ws'

export interface OutputStandard {
    description: string
    title: string
    confidence: string
    severity: string
    sourceMap: any
    category?: string
    reference?: string
    example?: any
    [key: string]: any
}

type ServiceListKeys = keyof typeof ServiceList;

export type Service = typeof ServiceList[ServiceListKeys]

export type ServiceClient = InstanceType<typeof ServiceList[ServiceListKeys]>

export type WebsocketOpt = {
    remixIdeUrl: string
}

export type FolderArgs = {
    path: string
}

export type KeyPairString = {
    [key: string]: string
}

export type ResolveDirectory = {
    [key: string]: {
        isDirectory: boolean
    }
}

export type FileContent = {
    content: string
    readonly: boolean
}

export type TrackDownStreamUpdate = KeyPairString

export type SharedFolderArgs = FolderArgs & KeyPairString

export type WS = typeof Websocket

export type Filelist = KeyPairString
