/*
 * Original work Copyright © 2018-2021 Remix Team
 * Licensed under the MIT License.
 *
 * Modifications Copyright © 2022 TronIDE
 *
 * Licensed under the Apache License, Version 2.0.
 */

import EventEmitter from 'events'
import { NightwatchBrowser } from 'nightwatch'

class SelectWorkspace extends EventEmitter {
  command (this: NightwatchBrowser, name: string): NightwatchBrowser {
    const api = this.api
    this.api
      .waitForElementVisible('*[data-id="workspacesSelect"]:not([disabled])', 60000)
      .execute(function (workspaceName) {
        const select = document.querySelector('*[data-id="workspacesSelect"]') as HTMLSelectElement
        if (!select) return { found: false, optionFound: false }
        const optionFound = Array.from(select.options).some((option) => option.value === workspaceName)
        if (!optionFound) return { found: true, optionFound: false }
        select.value = workspaceName
        select.dispatchEvent(new Event('change', { bubbles: true }))
        return { found: true, optionFound: true }
      }, [name], (result) => {
        const value = result.value as { found: boolean, optionFound: boolean }
        api.assert.equal(value.found, true, 'workspace selector is available')
        api.assert.equal(value.optionFound, true, `workspace selector offers ${name}`)
      })
      .waitUntil(function () {
        return new Promise((resolve) => {
          api.execute(function (workspaceName) {
            const select = document.querySelector('*[data-id="workspacesSelect"]') as HTMLSelectElement
            return Boolean(select && !select.disabled && select.value === workspaceName)
          }, [name], (result) => resolve(Boolean(result && result.value)))
        })
      }, 60000, 100)
      .perform(() => {
        api.assert.ok(true, `workspace switched to ${name}`)
        this.emit('complete')
      })
    return this
  }
}

module.exports = SelectWorkspace
