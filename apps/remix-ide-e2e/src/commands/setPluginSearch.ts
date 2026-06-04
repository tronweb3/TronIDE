import EventEmitter from 'events'
import { NightwatchBrowser } from 'nightwatch'

class SetPluginSearch extends EventEmitter {
  command (this: NightwatchBrowser, value: string): NightwatchBrowser {
    this.api.perform((done) => {
      this.api.execute(function (value) {
        const input = document.querySelector('[data-id="pluginManagerComponentSearchInput"]') as HTMLInputElement
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, value)
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }))
      }, [value], () => {
        done()
        this.emit('complete')
      })
    })
    return this
  }
}

module.exports = SetPluginSearch
