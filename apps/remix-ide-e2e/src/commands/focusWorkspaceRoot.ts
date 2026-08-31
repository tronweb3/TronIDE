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

class FocusWorkspaceRoot extends EventEmitter {
  command (this: NightwatchBrowser): NightwatchBrowser {
    this.api.perform((done) => {
      focusWorkspaceRoot(this.api, () => {
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

function focusWorkspaceRoot (browser: NightwatchBrowser, done: VoidFunction) {
  browser
    .waitForElementVisible('*[data-id="treeViewDivtreeViewItem"]', 60000)
    .execute(function () {
      const rootLabel = document.querySelector('*[data-id="treeViewDivtreeViewItem"] > span > div') as HTMLElement
      if (!rootLabel) return false
      rootLabel.click()
      return true
    }, [], function (result) {
      browser.assert.equal(result.value, true, 'workspace root is explicitly focused')
    })
    // React commits focusElement asynchronously after the root click.
    .pause(100)
    .perform(done)
}

module.exports = FocusWorkspaceRoot
