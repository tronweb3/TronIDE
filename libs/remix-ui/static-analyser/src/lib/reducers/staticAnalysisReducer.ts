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

export const initialState = {
  file: null,
  source: null,
  languageVersion: null,
  data: null
}

export const analysisReducer = (state, action) => {
  switch (action.type) {
    case 'compilationFinished':
      return {
        ...state,
        file: action.payload.file,
        source: action.payload.source,
        languageVersion: action.payload.languageVersion,
        data: action.payload.data
      }
    default:
      return initialState
  }
}
