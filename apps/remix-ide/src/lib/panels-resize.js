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

const yo = require('yo-yo')
const csjs = require('csjs-inject')

const css = csjs`
  .dragbar            {
    width             : 2px;
    height            : 100%;
    cursor            : col-resize;
    z-index           : 999;
  }
  .ghostbar           {
    width             : 3px;
    background-color  : var(--primary);
    opacity           : 0.5;
    position          : absolute;
    cursor            : col-resize;
    z-index           : 9999;
    top               : 0;
    bottom            : 0;
  }
`

export default class PanelsResize {
  constructor (panel, type) {
    this.panel = panel
    const string = panel.style.minWidth
    this.minWidth = string.length > 2 ? parseInt(string.substring(0, string.length - 2)) : 0
    this.type = type || 'left'
  }

  render () {
    this.ghostbar = yo`<div class=${css.ghostbar}></div>`

    const mousedown = (event) => {
      event.preventDefault()
      if (event.which === 1) {
        moveGhostbar(event)
        document.body.appendChild(this.ghostbar)
        document.addEventListener('mousemove', moveGhostbar)
        document.addEventListener('mouseup', removeGhostbar)
        document.addEventListener('keydown', cancelGhostbar)
      }
    }

    const cancelGhostbar = (event) => {
      if (event.keyCode === 27) {
        document.body.removeChild(this.ghostbar)
        document.removeEventListener('mousemove', moveGhostbar)
        document.removeEventListener('mouseup', removeGhostbar)
        document.removeEventListener('keydown', cancelGhostbar)
      }
    }

    const moveGhostbar = (event) => {
      this.ghostbar.style.left = event.x + 'px'
    }

    const removeGhostbar = (event) => {
      document.body.removeChild(this.ghostbar)
      document.removeEventListener('mousemove', moveGhostbar)
      document.removeEventListener('mouseup', removeGhostbar)
      document.removeEventListener('keydown', cancelGhostbar)
      this.setPosition(event)
    }

    return yo`<div onmousedown=${mousedown} class=${css.dragbar}></div>`
  }

  calculatePanelWidth (event) {
    if (this.type === 'right') {
      return (this.panel.offsetLeft - event.x) + this.panel.offsetWidth
    }
    return event.x - this.panel.offsetLeft
  }

  setPosition (event) {
    const panelWidth = this.calculatePanelWidth(event)
    // close the panel if the width is less than a minWidth
    if (panelWidth > this.minWidth - 10 || this.panel.style.display === 'none') {
      this.panel.style.width = panelWidth + 'px'
      this.showPanel()
    } else this.hidePanel()
  }

  hidePanel () {
    if (this.type !== 'right') {
      this.panel.style.display = 'none'
    }
  }

  showPanel () {
    this.panel.style.display = 'flex'
  }
}
