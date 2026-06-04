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

import * as packageJson from '../../../../../package.json'
import { TopHeader } from '@remix-ui/top-header'
import React from 'react'
import ReactDOM from 'react-dom/client'

var yo = require('yo-yo')
var csjs = require('csjs-inject')
const { Plugin } = require('@remixproject/engine')
const EventEmitter = require('events')
const globalRegistry = require('../../global/registry')

const profile = {
  name: 'headerPanel',
  displayName: 'Header Panel',
  description: '',
  version: packageJson.version,
  methods: ['']
}

export class HeaderPanel extends Plugin {
  constructor (appManager, mainview) {
    super(profile)
    this.events = new EventEmitter()
    this.appManager = appManager
    this._deps = {
      themeModule: globalRegistry.get('themeModule').api,
      fileProviders: globalRegistry.get('fileproviders').api,
      mainview
    }
  }

  onActivation () {
    this.on('aiPanel', 'aiPluginClosed', (profile) => {
      this.events.emit('aiPluginClosed', profile)
    })
    this.on('filePanel', 'setWorkspace', (workspace) => {
      this.events.emit('workspaceChanged', workspace)
      this.events.emit('workspaceListChanged')
    })
    this.on('filePanel', 'createWorkspace', () => {
      this.events.emit('workspaceListChanged')
    })
    this.on('filePanel', 'renameWorkspace', () => {
      this.events.emit('workspaceListChanged')
    })
    this.on('filePanel', 'deleteWorkspace', () => {
      this.events.emit('workspaceListChanged')
    })
  }

  async getLatestVersion () {
    try {
      const response = await fetch(`assets/version.json?t=${Date.now()}`, { cache: 'no-store' })
      if (response.ok) {
        const { version } = await response.json()
        if (version) return version
      }
    } catch (e) {
      console.debug('[headerPanel] failed to load assets/version.json; falling back to package version', e)
    }
    return packageJson.version
  }

  render () {
    this.view = yo`<div></div>`

    const reactBox = ReactDOM.createRoot(
      this.view
    )
    reactBox.render(
      <TopHeader plugin={this} _deps={this._deps} />
    )
    return this.view
  }
}

const css = csjs`
  
`
