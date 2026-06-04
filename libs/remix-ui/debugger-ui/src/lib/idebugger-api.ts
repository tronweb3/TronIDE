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

import type { CompilationResult, CompilationSource } from '@remix-project/remix-solidity-ts' // eslint-disable-line

export interface DebuggerUIProps {
    debuggerAPI: IDebuggerApi
}

export interface LineColumnLocation {
    start: {
        line: number, column: number
    },
    end: {
        line: number, column: number
    }
}

export interface RawLocation {
    start: number, length: number
}

export interface Sources {
    [fileName: string] : {content: string}
}

export interface CompilationOutput {
    source: { sources: Sources, target: string }
    data: CompilationResult
    getSourceName: (id: number) => string
}

export interface Asts {
    [fileName: string] : CompilationSource // ast
}

export interface TransactionReceipt {
    blockHash: string
    blockNumber: number
    transactionHash: string
    transactionIndex: number
    from: string
    to: string
    contractAddress: string | null
  }

export type onBreakpointClearedListener = (params: string, row: number) => void
export type onBreakpointAddedListener = (params: string, row: number) => void
export type onEditorContentChanged = () => void
export type onDebugRequested = (hash: string) => void

export interface IDebuggerApi {
    offsetToLineColumnConverter: { offsetToLineColumn: (sourceLocation: RawLocation, file: number, contents: Sources, asts: Asts) => Promise<LineColumnLocation> }
    debugHash: string
    debugHashRequest: number
    removeHighlights: boolean
    onRemoveHighlights: (listener: VoidFunction) => void
    onDebugRequested: (listener: onDebugRequested) => void
    onBreakpointCleared: (listener: onBreakpointClearedListener) => void
    onBreakpointAdded: (listener: onBreakpointAddedListener) => void
    onEditorContentChanged: (listener: onEditorContentChanged) => void
    discardHighlight: () => Promise<void>
    highlight: (lineColumnPos: LineColumnLocation, path: string) => Promise<void>
    fetchContractAndCompile: (address: string, currentReceipt: TransactionReceipt) => Promise<CompilationOutput>
    getFile: (path: string) => Promise<string>
    setFile: (path: string, content: string) => Promise<void>
    getDebugWeb3: () => any // returns an instance of web3.js
    showMessage (title: string, message: string): void
}
