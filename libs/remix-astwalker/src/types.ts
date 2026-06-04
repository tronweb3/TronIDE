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

// FIXME: should this be renamed to indicate its offset/length orientation?
// Add "reaadonly property"?
export interface Location {
  start: number;
  length: number;
  file: number; // Would it be clearer to call this a file index?
}

// This is intended to be compatibile with VScode's Position.
// However it is pretty common with other things too.
// Note: File index is missing here
export interface LineColPosition {
  readonly line: number;
  readonly character: number;
}

// This is intended to be compatibile with vscode's Range
// However it is pretty common with other things too.
// Note: File index is missing here
export interface LineColRange {
  readonly start: LineColPosition;
  readonly end: LineColPosition;
}

export interface Node {
  ast?: AstNode;
  source?: string;
  id?: number;
}

export interface AstNode {
  /* The following fields are essential, and indicates an that object
     is an AST node. */
  id: number; // This is unique across all nodes in an AST tree
  nodeType: string;
  src: string;

  absolutePath?: string;
  exportedSymbols?: Record<string, unknown>;
  nodes?: Array<AstNode>;
  literals?: Array<string>;
  file?: string;
  scope?: number;
  sourceUnit?: number;
  symbolAliases?: Array<string>;
  [x: string]: any;
}

export interface AstNodeAtt {
  operator?: string;
  string?: null;
  type?: string;
  value?: string;
  constant?: boolean;
  name?: string;
  public?: boolean;
  exportedSymbols?: Record<string, unknown>;
  argumentTypes?: null;
  absolutePath?: string;
  [x: string]: any;
}
