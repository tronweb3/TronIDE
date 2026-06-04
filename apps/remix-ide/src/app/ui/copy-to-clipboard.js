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

const css = require('../tabs/styles/run-tab-styles')

var yo = require('yo-yo')
// -------------- copyToClipboard ----------------------
const copy = require('copy-to-clipboard')
var addTooltip = require('./tooltip')
module.exports = function copyToClipboard (getContent, tip = '', icon = 'fa-copy') {
  var copyIcon = yo`<i title="${tip}" class="${css.copyIcon} far ${icon} p-2 tooltip-above ta-copy" data-id="copyToClipboardCopyIcon" aria-hidden="true" data-title="Copy account"></i>`
  copyIcon.onclick = (event) => {
    event.stopPropagation()
    var copiableContent
    try {
      copiableContent = getContent()
    } catch (e) {
      addTooltip(e.message)
      return
    }
    if (copiableContent) { // module `copy` keeps last copied thing in the memory, so don't show tooltip if nothing is copied, because nothing was added to memory
      try {
        if (typeof copiableContent !== 'string') {
          copiableContent = JSON.stringify(copiableContent, null, '\t')
        }
      } catch (e) { console.warn('[copy-to-clipboard] failed to stringify content', e) }
      copy(copiableContent)
      addTooltip('Copied value to clipboard.')
    } else {
      addTooltip('Cannot copy empty content!')
    }
  }
  return copyIcon
}
