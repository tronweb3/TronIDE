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

import React from 'react' // eslint-disable-line
import { ViewPlugin } from '@remixproject/engine-web'
import ReactDOM from 'react-dom'
import { EventEmitter } from 'events'
import {RemixUiStaticAnalyser} from '@remix-ui/static-analyser' // eslint-disable-line
import * as packageJson from '../../../../../package.json'
var Renderer = require('../ui/renderer')

var EventManager = require('../../lib/events')

const profile = {
  name: 'solidityStaticAnalysis',
  displayName: 'Solidity static analysis',
  methods: [],
  events: [],
  icon: 'assets/img/staticAnalysis.webp',
  description: 'Checks the contract code for security vulnerabilities and bad practices.',
  kind: 'analysis',
  location: 'sidePanel',
  documentation: 'https://developers.tron.network/docs/tron-ide',
  version: packageJson.version
}

class AnalysisTab extends ViewPlugin {
  constructor (registry) {
    super(profile)
    this.event = new EventManager()
    this.events = new EventEmitter()
    this.registry = registry
    this.element = document.createElement('div')
    this.element.setAttribute('id', 'staticAnalyserView')
    this._components = {
      renderer: new Renderer(this)
    }
    this._components.registry = this.registry
    this._deps = {
      offsetToLineColumnConverter: this.registry.get(
        'offsettolinecolumnconverter').api
    }
  }

  onActivation () {
    this.renderComponent()
  }

  render () {
    return this.element
  }

  renderComponent () {
    ReactDOM.render(
      <RemixUiStaticAnalyser
        registry={this.registry}
        analysisModule={this}
        event={this.event}
      />,
      this.element,
      () => {
        this.event.register('staticAnaysisWarning', (count) => {
          if (count > 0) {
            this.emit('statusChanged', { key: count, title: `${count} warning${count === 1 ? '' : 's'}`, type: 'warning' })
          } else if (count === 0) {
            this.emit('statusChanged', { key: 'succeed', title: 'no warning', type: 'success' })
          } else {
            // count ==-1 no compilation result
            this.emit('statusChanged', { key: 'none' })
          }
        })
      }
    )
  }
}

module.exports = AnalysisTab
