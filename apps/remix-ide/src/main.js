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

// Register before anything else so injected wallet extensions (MetaMask, …)
// that throw their own uncaught errors don't surface in the runtime-error
// overlay and get filed as IDE bugs. See suppress-extension-errors.js.
const { installExtensionErrorSuppressor } = require('./lib/suppress-extension-errors')
installExtensionErrorSuppressor(window)

window.onload = () => {
  BrowserFS.install(window)
  BrowserFS.configure({
    fs: 'LocalStorage'
  }, function (e) {
    if (e) console.log(e)
    window.remixFileSystem = BrowserFS.BFSRequire('fs')
    require('./index')
  })
}
