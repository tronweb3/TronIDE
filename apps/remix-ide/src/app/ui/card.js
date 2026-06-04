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

var yo = require('yo-yo')
var csjs = require('csjs-inject')
var EventManager = require('../../lib/events')

module.exports = class Card {
  constructor (api, events, opts) {
    const self = this
    self._api = api
    self._events = events
    self._opts = opts
    self._view = {}
    self.event = new EventManager()
  }

  render () {
    const self = this
    if (self._view.el) return self._view.el

    self._view.cardBody = yo`<div></div>`
    self._view.arrow = yo`<i class="${css.arrow} fas fa-angle-down" onclick="${() => trigger(this)}"></i>`

    self._view.expandCollapseButton = yo`
    <div>${self._view.arrow}</div>`

    self._view.statusBar = yo`<div>${self._opts.collapsedView}</div>`
    self._view.cardHeader = yo`
    <div class="d-flex justify-content-between align-items-center" onclick=${() => trigger(self._view.arrow)}>
      <div class="pr-1 d-flex flex-row">
        <div>${self._opts.title}</div>
        ${self._view.statusBar}
      </div>
      <div>${self._view.expandCollapseButton}</div>
    </div>`

    function trigger (el) {
      var body = self._view.cardBody
      var status = self._view.statusBar
      if (el.classList) {
        el.classList.toggle('fa-angle-up')
        var arrow = el.classList.toggle('fa-angle-down') ? 'up' : 'down'
        self.event.trigger('expandCollapseCard', [arrow, body, status])
      }
    }

    // HTML
    self._view.el = yo`
      <div class="${css.cardContainer} list-group-item border-0">
        ${self._view.cardHeader}
        ${self._view.cardBody}
      </div>`

    return self._view.el
  }
}

const css = csjs`
  .cardContainer {
    padding             : 0 24px 16px;
    margin              : 0;
    background          : none;
  }
  .arrow {
    font-weight         : bold;
    cursor              : pointer;
    font-size           : 14px;
  }
  .arrow:hover {
  }

`
