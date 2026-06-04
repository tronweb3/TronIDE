import { NightwatchBrowser } from 'nightwatch'
import init from '../helpers/init'

module.exports = {
  before: function (browser: NightwatchBrowser, done: VoidFunction) {
    init(browser, done, undefined, false)
  },

  'Print console logs': function (browser: NightwatchBrowser) {
    browser
      .pause(10000)
      .getLog('browser', function (logEntries) {
        console.log('--- BROWSER CONSOLE LOGS ---')
        console.log(JSON.stringify(logEntries, null, 2))
      })
      .end()
  }
}
