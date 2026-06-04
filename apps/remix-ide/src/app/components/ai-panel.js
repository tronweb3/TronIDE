/*
 * Copyright 2022 [TronIDE]
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

import { AbstractPanel } from './panel'
import * as packageJson from '../../../../../package.json'
import CodeReader from '@remix-code-reader'
import React from 'react'  // eslint-disable-line
import ReactDOM from 'react-dom'

const EventEmitter = require('events')
const yo = require('yo-yo')
const csjs = require('csjs-inject')

const css = csjs`
  .pluginsContainer {
    width: 100%;
    height: 100%;
    display: flex;
    overflow-y: hidden;
  }
`

const profile = {
  name: 'aiPanel',
  displayName: 'Ai Panel',
  description: '',
  version: packageJson.version,
  methods: ['addView', 'removeView', 'hide']
}

export class AiPanel extends AbstractPanel {
  constructor (appManager, config) {
    super(profile)
    this.appManager = appManager
    this.config = config
    this.init()
    this.events = new EventEmitter()
  }

  focus (name) {
    this.emit('focusChanged', name)
    super.focus(name)
  }

  async showContent (name) {
    super.showContent(name)
  }

  init () {
    this.appManager.event.on('activate', ({ name, location, displayName, icon }) => {
      if (location === 'aiPanel') {
        this.showContent(name)
      }
    })
  }

  async hide () {
    const el = document.getElementById('ai-panel')
    if (el) {
      const shouldShow = el.style.display === 'none'
      if (!shouldShow) el.dataset.previousWidth = el.style.width || `${el.getBoundingClientRect().width}px` || '340px'
      el.style.display = shouldShow ? 'flex' : 'none'
      el.style.minWidth = shouldShow ? '340px' : '0px'
      el.style.width = shouldShow ? (el.dataset.previousWidth || '340px') : '0px'
      const previousSibling = el.previousElementSibling
      if (previousSibling) previousSibling.style.display = shouldShow ? 'block' : 'none'
      this.aiPanelvisible = shouldShow
      ReactDOM.render(
        <CodeReader
          plugin={this}
          aiPanelvisible={this.aiPanelvisible}
        />,
        this.aiPanelEl
      )
      // this.events?.emit('aiPluginClosed', !this.aiPanelvisible)
      this.emit('aiPluginClosed', !shouldShow)
    }
  }

  render () {
    const el = yo`
      <div class=${css.pluginsContainer} data-id="aiPanelPluginsContainer">
        ${this.view}
      </div>`
    ReactDOM.render(
      <CodeReader
        plugin={this}
      />,
      el
    )
    this.aiPanelEl = el
    return el
  }
}
