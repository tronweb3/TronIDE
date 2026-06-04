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

// const moduleID = require('./module-id.js')

module.exports = class registry {
  constructor () {
    this.state = {}
  }

  put ({ api, name }) {
    // const serveruid = moduleID() + '.' + (name || '')
    if (this.state[name]) return this.state[name]
    const server = {
      // uid: serveruid,
      api
    }
    this.state[name] = { server }
    return server
  }

  get (name) {
    // const clientuid = moduleID()
    const state = this.state[name]
    if (!state) return
    const server = state.server
    return server
  }
}
