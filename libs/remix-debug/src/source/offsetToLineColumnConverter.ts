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

'use strict'
import { getLinebreakPositions, convertOffsetToLineColumn } from './sourceMappingDecoder'

export class OffsetToColumnConverter {
  lineBreakPositionsByContent
  sourceMappingDecoder

  constructor (compilerEvent) {
    this.lineBreakPositionsByContent = {}
    if (compilerEvent) {
      compilerEvent.register('compilationFinished', (success, data, source) => {
        this.clear()
      })
    }
  }

  offsetToLineColumn (rawLocation, file, sources, asts) {
    if (!this.lineBreakPositionsByContent[file]) {
      for (const filename in asts) {
        const source = asts[filename]
        // source id was string before. in newer versions it has been changed to an integer so we need to check the type here
        if (typeof source.id === 'string') source.id = parseInt(source.id, 10)
        if (source.id === file) {
          this.lineBreakPositionsByContent[file] = getLinebreakPositions(sources[filename].content)
          break
        }
      }
    }
    return convertOffsetToLineColumn(rawLocation, this.lineBreakPositionsByContent[file])
  }

  clear () {
    this.lineBreakPositionsByContent = {}
  }
}
