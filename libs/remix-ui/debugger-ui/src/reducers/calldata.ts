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
    payload: { [key: string]: any };
}

export const initialState = {
  calldata: {},
  isRequesting: false,
  isSuccessful: false,
  hasError: null
}

export const reducer = (state = initialState, action: Action) => {
  switch (action.type) {
    case 'FETCH_CALLDATA_REQUEST':
      return {
        ...state,
        isRequesting: true,
        isSuccessful: false,
        hasError: null
      }
    case 'FETCH_CALLDATA_SUCCESS':
      return {
        calldata: action.payload,
        isRequesting: false,
        isSuccessful: true,
        hasError: null
      }
    case 'FETCH_CALLDATA_ERROR':
      return {
        ...state,
        isRequesting: false,
        isSuccessful: false,
        hasError: action.payload
      }
    case 'UPDATE_CALLDATA_REQUEST':
      return {
        ...state,
        isRequesting: true,
        isSuccessful: false,
        hasError: null
      }
    case 'UPDATE_CALLDATA_SUCCESS':
      return {
        calldata: mergeLocals(action.payload, state.calldata),
        isRequesting: false,
        isSuccessful: true,
        hasError: null
      }
    case 'UPDATE_CALLDATA_ERROR':
      return {
        ...state,
        isRequesting: false,
        isSuccessful: false,
        hasError: action.payload
      }
    default:
      throw new Error()
  }
}

function mergeLocals (locals1, locals2) {
  Object.keys(locals2).map(item => {
    if (locals2[item].cursor && (parseInt(locals2[item].cursor) < parseInt(locals1[item].cursor))) {
      locals2[item] = {
        ...locals1[item],
        value: [...locals2[item].value, ...locals1[item].value]
      }
    }
  })
  return locals2
}
