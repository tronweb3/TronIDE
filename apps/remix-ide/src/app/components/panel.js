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

import { EventEmitter } from 'events'
import { HostPlugin } from '@remixproject/engine-web'
const csjs = require('csjs-inject')
const yo = require('yo-yo')

const css = csjs`
  .plugins        {
    height: 100%;
  }
  .plugItIn       {
    display        : none;
    height         : 100%;
  }
  .plugItIn > div {
    overflow-y     : auto;
    overflow-x     : hidden;
    height         : 100%;
    width          : 100%;
  }
  .plugItIn.active     {
    display        : block;
  }
  .pluginsContainer {
    height         : 100%;
    overflow-y     : hidden;
  }
`

/** Abstract class used for hosting the view of a plugin */
export class AbstractPanel extends HostPlugin {
  constructor (profile) {
    super(profile)
    this.events = new EventEmitter()
    this.contents = {}
    this.active = undefined

    // View where the plugin HTMLElement leaves
    this.view = yo`<div id="plugins" class="${css.plugins}"></div>`
  }

  /**
   * Add the plugin to the panel
   * @param {String} name the name of the plugin
   * @param {HTMLElement} content the HTMLContent of the plugin
   */
  add (view, name) {
    if (this.contents[name]) throw new Error(`Plugin ${name} already rendered`)
    view.style.height = '100%'
    view.style.width = '100%'
    view.style.border = '0'

    const isIframe = view.tagName === 'IFRAME'
    view.style.display = isIframe ? 'none' : 'block'
    const loading = isIframe ? yo`
      <div class="d-flex justify-content-center align-items-center">
        <div class="spinner-border" role="status">
          <span class="sr-only">Loading...</span>
        </div>
      </div>  
    ` : ''
    this.contents[name] = yo`<div class="${css.plugItIn}" >${view}${loading}</div>`

    if (view.tagName === 'IFRAME') {
      view.addEventListener('load', () => {
        if (this.contents[name].contains(loading)) {
          this.contents[name].removeChild(loading)
        }
        view.style.display = 'block'
      })
    }
    this.contents[name].style.display = 'none'
    this.view.appendChild(this.contents[name])
  }

  addView (profile, view) {
    this.add(view, profile.name)
  }

  removeView (profile) {
    this.remove(profile.name)
  }

  /**
   * Remove a plugin from the panel
   * @param {String} name The name of the plugin to remove
   */
  remove (name) {
    const el = this.contents[name]
    delete this.contents[name]
    if (el) el.parentElement.removeChild(el)
    if (name === this.active) this.active = undefined
  }

  /**
   * Display the content of this specific plugin
   * @param {String} name The name of the plugin to display the content
   */
  showContent (name) {
    if (!this.contents[name]) throw new Error(`Plugin ${name} is not yet activated`)
    // hiding the current view and display the `moduleName`
    if (this.active) {
      this.contents[this.active].style.display = 'none'
    }
    this.contents[name].style.display = 'flex'
    const view = this.contents[name].firstElementChild
    if (view && view.remixEnsureRendered) view.remixEnsureRendered()
    this.active = name
  }

  focus (name) {
    this.showContent(name)
  }
}
