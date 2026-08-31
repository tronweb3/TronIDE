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
const StaticAnalysisRunner = require('@remix-project/remix-analyzer').CodeAnalysis
var Renderer = require('../ui/renderer')

var EventManager = require('../../lib/events')

// Mirrors the panel's library heuristic (remix-ui-static-analyser isLibraryFile):
// findings in imported dependencies are noise the user didn't write.
const isLibraryFile = (fileName) => !!fileName && (
  fileName.startsWith('@') ||
  /(^|\/)(\.deps|node_modules|installed_contracts)\//.test(fileName) ||
  /^(https?|github|ipfs|swarm|bzz-raw):/i.test(String(fileName))
)

const profile = {
  name: 'solidityStaticAnalysis',
  displayName: 'Solidity static analysis',
  // `analyze` runs the Remix static-analysis modules over the last compilation
  // and returns a compact findings list (used by the AI assistant's
  // run_static_analysis tool). Read-only; no editor/UI side effects.
  methods: ['analyze'],
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

  /**
   * Run the Remix static-analysis modules over the most recent compilation and
   * return a compact, machine-readable findings list. Read-only: it does not
   * touch the editor or the panel UI. Library findings (imported deps) are
   * excluded by default, matching the panel's default toggle.
   * @param {{ includeLibraries?: boolean }} [opts]
   */
  async analyze (opts = {}) {
    const includeLibraries = !!opts.includeLibraries
    let last
    try { last = await this.call('compilerArtefacts', 'get', '__last') } catch (e) { last = null }
    if (!last || typeof last.getData !== 'function') {
      return { ok: false, message: 'No compilation result yet — compile a contract first, then analyze.' }
    }
    const compilationResult = last.getData()
    const compilationSource = last.getSourceCode ? last.getSourceCode() : { sources: (compilationResult && compilationResult.sources) || {} }
    if (!compilationResult || !compilationResult.sources) {
      return { ok: false, message: 'The last compilation produced no AST to analyze.' }
    }
    const runner = new StaticAnalysisRunner()
    const moduleCount = runner.modules().length
    const toRun = Array.from({ length: moduleCount }, (_, i) => i)
    const sourceKeys = Object.keys(compilationResult.sources)

    let reports
    try {
      reports = await new Promise((resolve, reject) => {
        try { runner.run(compilationResult, toRun, resolve) } catch (e) { reject(e) }
      })
    } catch (e) {
      return { ok: false, message: `Static analysis failed: ${e instanceof Error ? e.message : String(e)}` }
    }

    const moduleErrors = reports.filter((result) => result && result.error)
    if (moduleErrors.length) {
      return {
        ok: false,
        message: `Static analysis failed in ${moduleErrors.length} module${moduleErrors.length === 1 ? '' : 's'}.`,
        errors: moduleErrors.map((result) => ({ module: result.name, message: result.error }))
      }
    }

    const findings = []
    let hidden = 0
    for (const result of reports) {
      for (const item of (result.report || [])) {
        let fileName = sourceKeys[0] || ''
        let locationString = ''
        if (item.location) {
          const split = String(item.location).split(':')
          const fileIndex = parseInt(split[2], 10)
          fileName = sourceKeys[fileIndex] || fileName
          try {
            const loc = this._deps.offsetToLineColumnConverter.offsetToLineColumn(
              { start: parseInt(split[0], 10), length: parseInt(split[1], 10) },
              fileIndex, compilationSource.sources, compilationResult.sources)
            locationString = (loc.start.line + 1) + ':' + loc.start.column
          } catch (e) { locationString = '' }
        }
        if (!includeLibraries && isLibraryFile(fileName)) { hidden++; continue }
        findings.push({
          type: result.name,
          file: fileName,
          location: locationString,
          warning: String(item.warning || '').replace(/<[^>]*>/g, '').trim().slice(0, 400)
        })
      }
    }
    return { ok: true, findings, count: findings.length, hiddenLibraryFindings: hidden }
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
