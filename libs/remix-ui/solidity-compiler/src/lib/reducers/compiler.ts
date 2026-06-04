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

interface Action {
  type: string;
  payload: Record<string, any>;
}

export const compilerInitialState = {
  compiler: {
    mode: '',
    args: null,
    seq: 0
  },
  editor: {
    mode: ''
  }
}

export const compilerReducer = (state = compilerInitialState, action: Action) => {
  switch (action.type) {
    case 'SET_COMPILER_MODE': {
      return {
        ...state,
        compiler: {
          ...state.compiler,
          mode: action.payload.mode,
          args: action.payload.args || null,
          seq: state.compiler.seq + 1
        }
      }
    }

    case 'RESET_COMPILER_MODE': {
      return {
        ...state,
        compiler: {
          ...state.compiler,
          mode: '',
          args: null,
          seq: state.compiler.seq + 1
        }
      }
    }

    case 'SET_EDITOR_MODE': {
      return {
        ...state,
        editor: {
          ...state.editor,
          mode: action.payload
        }
      }
    }

    case 'RESET_EDITOR_MODE': {
      return {
        ...state,
        editor: {
          ...state.editor,
          mode: ''
        }
      }
    }

    default:
      throw new Error()
  }
}
