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

import { Plugin } from '@remixproject/engine'
import { EventEmitter } from 'events'
import QueryParams from '../../lib/query-params'
import * as packageJson from '../../../../../package.json'
import yo from 'yo-yo'
const _paq = window._paq = window._paq || []

const themes = [
  { name: 'Dark', quality: 'dark', url: 'assets/css/themes/remix-dark_tvx1s2.css' },
  { name: 'Light', quality: 'light', url: 'assets/css/themes/remix-light_powaqg.css' },
  { name: 'Midcentury', quality: 'light', url: 'assets/css/themes/remix-midcentury_hrzph3.css' },
  { name: 'Black', quality: 'dark', url: 'assets/css/themes/remix-black_undtds.css' },

  { name: 'Cerulean', quality: 'light', url: 'assets/css/themes/bootstrap-cerulean.min.css' },
  { name: 'Flatly', quality: 'light', url: 'assets/css/themes/bootstrap-flatly.min.css' },
  { name: 'Spacelab', quality: 'light', url: 'assets/css/themes/bootstrap-spacelab.min.css' },
  { name: 'Cyborg', quality: 'dark', url: 'assets/css/themes/bootstrap-cyborg.min.css' }
]

const profile = {
  name: 'theme',
  events: ['themeChanged'],
  methods: ['switchTheme', 'getThemes', 'currentTheme'],
  version: packageJson.version,
  kind: 'theme'
}

export class ThemeModule extends Plugin {
  constructor (registry) {
    super(profile)
    this.events = new EventEmitter()
    this._deps = {
      config: registry.get('config').api
    }
    this.themes = themes.reduce((acc, theme) => {
      theme.url = window.location.origin + window.location.pathname + theme.url
      return { ...acc, [theme.name]: theme }
    }, {})
    let queryTheme = (new QueryParams()).get().theme
    queryTheme = this.themes[queryTheme] ? queryTheme : null
    let currentTheme = this._deps.config.get('settings/theme')
    currentTheme = this.themes[currentTheme] ? currentTheme : null
    this.active = queryTheme || currentTheme || 'Dark'
    this.forced = !!queryTheme
  }

  /** Return the active theme */
  currentTheme () {
    return this.themes[this.active]
  }

  /** Returns all themes as an array */
  getThemes () {
    return Object.keys(this.themes).map(key => this.themes[key])
  }

  /**
   * Init the theme
   */
  initTheme (callback) {
    if (this.active) {
      const nextTheme = this.themes[this.active] // Theme
      document.documentElement.style.setProperty('--theme', nextTheme.quality)
      const theme = yo`<link rel="stylesheet" href="${nextTheme.url}" id="theme-link"/>`
      theme.addEventListener('load', () => {
        if (callback) callback()
      })
      document.head.insertBefore(theme, document.head.firstChild)
    }
  }

  /**
   * Change the current theme
   * @param {string} [themeName] - The name of the theme
   */
  switchTheme (themeName) {
    if (themeName && !Object.keys(this.themes).includes(themeName)) {
      throw new Error(`Theme ${themeName} doesn't exist`)
    }
    const next = themeName || this.active // Name
    _paq.push(['trackEvent', 'themeModule', 'switchTo', next])
    const nextTheme = this.themes[next] // Theme
    if (!this.forced) this._deps.config.set('settings/theme', next)

    // Keep `this.active` and the `--theme` flag in sync up-front so that any
    // consumer reading `currentTheme()` while the new stylesheet is loading
    // already sees the target theme.
    if (themeName) this.active = themeName
    document.documentElement.style.setProperty('--theme', nextTheme.quality)

    // The rest of the UI is re-styled by swapping the `<link>` stylesheet,
    // which the browser fetches/parses asynchronously. The Monaco/Ace editor
    // instead reacts to `themeChanged` by injecting bundled inline CSS, which
    // repaints immediately. Emitting `themeChanged` right after setting `href`
    // therefore made the editor flip ~1s before the rest of the UI (the time
    // it takes the new stylesheet to load). To keep both in sync we defer the
    // `themeChanged` notification until the new stylesheet has actually been
    // applied, so the editor and the surrounding UI repaint together.
    this._applyThemeStylesheet(nextTheme, () => {
      // TODO: Only keep `this.emit` (issue#2210)
      this.emit('themeChanged', nextTheme)
      this.events.emit('themeChanged', nextTheme)
    })
  }

  /**
   * Swap the active theme stylesheet and invoke `onApplied` once the browser
   * has loaded/parsed it (i.e. once the new styles are actually painted).
   * Falls back to a synchronous notification when the `<link>` is missing or
   * the href is unchanged, and guards against the `load` event never firing.
   * @param {Theme} nextTheme - the theme being activated
   * @param {Function} onApplied - called exactly once when the theme is applied
   */
  _applyThemeStylesheet (nextTheme, onApplied) {
    const themeLink = document.getElementById('theme-link')
    if (!themeLink) {
      onApplied()
      return
    }
    // Already on this stylesheet: no load event would fire, notify right away.
    if (themeLink.getAttribute('href') === nextTheme.url) {
      onApplied()
      return
    }

    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      themeLink.removeEventListener('load', settle)
      themeLink.removeEventListener('error', settle)
      onApplied()
    }

    themeLink.addEventListener('load', settle)
    themeLink.addEventListener('error', settle)
    themeLink.setAttribute('href', nextTheme.url)

    // Safety net: cached stylesheets normally still fire `load`, but never let
    // a missed event leave the editor and UI permanently out of sync.
    setTimeout(settle, 1000)
  }

  /**
   * fixes the invertion for images since this should be adjusted when we switch between dark/light qualified themes
   * @param {element} [image] - the dom element which invert should be fixed to increase visibility
   */
  fixInvert (image) {
    const invert = this.currentTheme().quality === 'dark' ? 1 : 0
    if (image) {
      image.style.filter = `invert(${invert})`
    }
  }
}
