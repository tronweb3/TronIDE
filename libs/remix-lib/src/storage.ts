/*
 * Original work Copyright © 2018-2021 Remix Team
 * Licensed under the Apache License, Version 2.0.
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

'use strict'

export class Storage {
  prefix

  constructor (prefix) {
    this.prefix = prefix

    // on startup, upgrade the old storage layout
    if (typeof window !== 'undefined') {
      this.safeKeys().forEach(function (name) {
        if (name.indexOf('sol-cache-file-', 0) === 0) {
          var content = window.localStorage.getItem(name)
          window.localStorage.setItem(name.replace(/^sol-cache-file-/, 'sol:'), content)
          window.localStorage.removeItem(name)
        }
      })
    }

    // remove obsolete key
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('editor-size-cache')
    }
  }

  exists (name) {
    if (typeof window !== 'undefined') {
      return this.get(name) !== null
    }
  }

  get (name) {
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem(this.prefix + name)
    }
  }

  set (name, content) {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(this.prefix + name, content)
      }
    } catch (exception) {
      return false
    }
    return true
  }

  remove (name) {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(this.prefix + name)
    }
    return true
  }

  rename (originalName, newName) {
    const content = this.get(originalName)
    if (!this.set(newName, content)) {
      return false
    }
    this.remove(originalName)
    return true
  }

  safeKeys () {
    // NOTE: this is a workaround for some browsers
    if (typeof window !== 'undefined') {
      return Object.keys(window.localStorage).filter(function (item) { return item !== null && item !== undefined })
    }
    return []
  }

  keys () {
    return this.safeKeys()
      // filter any names not including the prefix
      .filter(item => item.indexOf(this.prefix, 0) === 0)
      // remove prefix from filename and add the 'browser' path
      .map(item => item.substr(this.prefix.length))
  }
}
