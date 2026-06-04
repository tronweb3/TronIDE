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

import { PluginClient } from '@remixproject/plugin';
import { createClient } from '@remixproject/plugin-webview';
import {
  IDebuggerApi,
  RawLocation,
  Sources,
  Asts,
  LineColumnLocation,
  onBreakpointClearedListener,
  onBreakpointAddedListener,
  onEditorContentChanged,
  TransactionReceipt,
  DebuggerApiMixin,
  CompilerAbstract
} from '@remix-ui/debugger-ui';

export class DebuggerClientApi extends DebuggerApiMixin(PluginClient) {
  constructor() {
    super();
    createClient(this as any);
    this.initDebuggerApi();
  }

  offsetToLineColumnConverter: IDebuggerApi['offsetToLineColumnConverter'];
  debugHash: string;
  debugHashRequest: number;
  removeHighlights: boolean;
  onBreakpointCleared: (listener: onBreakpointClearedListener) => void;
  onBreakpointAdded: (listener: onBreakpointAddedListener) => void;
  onEditorContentChanged: (listener: onEditorContentChanged) => void;
  discardHighlight: () => Promise<void>;
  highlight: (lineColumnPos: LineColumnLocation, path: string) => Promise<void>;
  fetchContractAndCompile: (
    address: string,
    currentReceipt: TransactionReceipt
  ) => Promise<CompilerAbstract>;
  getFile: (path: string) => Promise<string>;
  setFile: (path: string, content: string) => Promise<void>;
  getDebugWeb3: () => any; // returns an instance of web3.js
}
