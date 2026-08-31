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
import CodeReader, { getAITaskEntry, getAITaskEntryReadinessIssue } from '@remix-code-reader'
import React from 'react'  // eslint-disable-line
import ReactDOM from 'react-dom'

const EventEmitter = require('events')
const yo = require('yo-yo')
const csjs = require('csjs-inject')
const NARROW_PANEL_QUERY = '(max-width: 768px)'

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
  methods: ['addView', 'removeView', 'hide', 'conceal', 'ask', 'startTask', 'getTaskReadiness', 'explainError', 'explainContract', 'aiComplete', 'hasAiKey'],
  events: ['aiPluginClosed', 'focusChanged']
}

export class AiPanel extends AbstractPanel {
  constructor (appManager, config) {
    super(profile)
    this.appManager = appManager
    this.config = config
    this.init()
    this.events = new EventEmitter()
    this.reconcileNarrowLayout = this.reconcileNarrowLayout.bind(this)
    window.addEventListener('resize', this.reconcileNarrowLayout)
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

  // Ensure the AI panel is visible (mirrors the "show" half of hide()'s toggle)
  // without flipping it closed when it is already open. Re-renders CodeReader so
  // the Chat component is mounted before we inject a prompt.
  reveal () {
    const el = document.getElementById('ai-panel')
    if (!el) return
    const isHidden = el.style.display === 'none' || el.style.width === '0px'
    if (isHidden) this.setPanelVisibility(true)
    else this.focusAiPanelOnNarrowLayout()
  }

  isNarrowLayout () {
    return typeof window.matchMedia === 'function' && window.matchMedia(NARROW_PANEL_QUERY).matches
  }

  isPanelVisible () {
    const el = document.getElementById('ai-panel')
    return Boolean(el && el.style.display !== 'none' && el.style.width !== '0px')
  }

  focusAiPanelOnNarrowLayout () {
    if (!this.isNarrowLayout()) return
    const sidePanel = document.getElementById('side-panel')
    if (!sidePanel || sidePanel.style.display === 'none') return
    sidePanel.style.display = 'none'
    const resizeHandle = sidePanel.nextElementSibling
    if (resizeHandle) resizeHandle.style.display = 'none'
  }

  reconcileNarrowLayout () {
    if (this.isPanelVisible()) this.focusAiPanelOnNarrowLayout()
  }

  setPanelVisibility (shouldShow) {
    const el = document.getElementById('ai-panel')
    if (!el) return
    if (shouldShow) {
      this.focusAiPanelOnNarrowLayout()
    } else {
      el.dataset.previousWidth = el.style.width || `${el.getBoundingClientRect().width}px` || '340px'
    }
    el.style.display = shouldShow ? 'flex' : 'none'
    el.style.minWidth = shouldShow ? '340px' : '0px'
    el.style.width = shouldShow ? (el.dataset.previousWidth || '340px') : '0px'
    const previousSibling = el.previousElementSibling
    if (previousSibling) previousSibling.style.display = shouldShow ? 'block' : 'none'
    this.aiPanelvisible = shouldShow
    if (this.aiPanelEl) {
      ReactDOM.render(
        <CodeReader
          plugin={this}
          aiPanelvisible={this.aiPanelvisible}
        />,
        this.aiPanelEl
      )
    }
    this.emit('aiPluginClosed', !shouldShow)
  }

  async conceal () {
    if (this.isPanelVisible()) this.setPanelVisibility(false)
  }

  // Reveal the panel and push a ready-made prompt into the chat. We wait a tick
  // so a just-mounted Chat has subscribed to 'injectPrompt' before we emit. The
  // chat handles the unset-key / in-flight cases itself, so this never throws.
  async ask (prompt) {
    if (!prompt) return
    this.reveal()
    setTimeout(() => {
      this.events.emit('injectPrompt', { prompt })
    }, 150)
  }

  async getTaskReadiness () {
    if (typeof this._getAITaskReadinessFn !== 'function') {
      return {
        hasKey: false,
        hasModel: false,
        aiModelVendor: '',
        workspaceActionsEnabled: false,
        toolProtocolSupported: false,
        panelReady: false
      }
    }
    return { ...this._getAITaskReadinessFn(), panelReady: true }
  }

  // Home and Deploy pass only a registry id plus bounded context. Chat rebuilds
  // the canonical prompt and enters its normal Task Controller; this method
  // never calls a model or executes a tool by itself.
  async startTask ({ entryId, source = 'home', context = {}, runtimeContext = {} } = {}) {
    const entry = getAITaskEntry(entryId)
    if (!entry) return { ok: false, code: 'INVALID_ENTRY', summary: 'This AI task entry is unavailable.', userAction: 'Reload TronIDE and choose a supported task card.' }
    this.reveal()
    if (typeof this._getAITaskReadinessFn !== 'function') await new Promise((resolve) => setTimeout(resolve, 160))
    const readiness = await this.getTaskReadiness()
    const issue = getAITaskEntryReadinessIssue(entry, readiness, runtimeContext)
    if (issue) {
      if (typeof this._showAiSettingsFn === 'function') this._showAiSettingsFn(`${issue.summary} ${issue.userAction}`)
      return issue
    }
    setTimeout(() => {
      this.events.emit('injectTask', { entryId: entry.id, source, context, runtimeContext })
    }, 0)
    return { ok: true, code: 'OK', entryId: entry.id, title: entry.title }
  }

  async explainError ({ message, file, line, code } = {}) {
    const location = file ? `${file}${line ? `:${line}` : ''}` : ''
    let prompt = 'Explain this Solidity compiler error and how to fix it'
    if (location) prompt += ` (at ${location})`
    prompt += `:\n\n${message || ''}`
    if (code) prompt += `\n\nRelevant code:\n${code}`
    return this.ask(prompt)
  }

  // Run an AI completion INSIDE the panel and return only the text. The key
  // never crosses the plugin RPC boundary (the mounted Chat holds it and does
  // the request via _aiCompleteFn). Returns '' when the panel was never opened
  // or no key is set. The editor's completer / inline-`//` use this.
  async aiComplete ({ prefix, suffix, maxTokens } = {}) {
    if (typeof this._aiCompleteFn === 'function') return this._aiCompleteFn({ prefix, suffix, maxTokens })
    return ''
  }

  // Non-secret: whether a key is set, so callers can show a "set a key" hint.
  async hasAiKey () {
    return typeof this._hasAiKeyFn === 'function' ? !!this._hasAiKeyFn() : false
  }

  async explainContract ({ code, file } = {}) {
    if (!code) return
    const header = file ? `Explain the following Solidity contract (${file}). ` : 'Explain the following Solidity contract. '
    const prompt = `${header}Describe what it does, its main functions, and call out any obvious risks:\n\n${code}`
    return this.ask(prompt)
  }

  async hide () {
    this.setPanelVisibility(!this.isPanelVisible())
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
    window.requestAnimationFrame(this.reconcileNarrowLayout)
    return el
  }
}
