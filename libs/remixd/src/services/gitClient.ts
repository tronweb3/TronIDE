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

import * as WS from 'ws' // eslint-disable-line
import { PluginClient } from '@remixproject/plugin'
const { spawn } = require('child_process')

export class GitClient extends PluginClient {
  methods: Array<string>
  websocket: WS
  currentSharedFolder: string

  constructor (private readOnly = false) {
    super()
    this.methods = ['execute']
  }

  setWebSocket (websocket: WS): void {
    this.websocket = websocket
  }

  sharedFolder (currentSharedFolder: string): void {
    this.currentSharedFolder = currentSharedFolder
  }

  execute (cmd: string) {
    assertCommand(cmd)
    const options = { cwd: this.currentSharedFolder, shell: true }
    const child = spawn(cmd, options)
    let result = ''
    let error = ''
    return new Promise((resolve, reject) => {
      child.stdout.on('data', (data) => {
        result += data.toString()
      })
      child.stderr.on('data', (err) => {
        error += err.toString()
      })
      child.on('close', () => {
        if (error) reject(error)
        else resolve(result)
      })
    })
  }
}

/**
 * Validate that command can be run by service
 * @param cmd
 */
function assertCommand (cmd) {
  const regex = '^git\\s[^&|;]*$'
  if (!RegExp(regex).test(cmd)) { // git then space and then everything else
    throw new Error('Invalid command for service!')
  }
}
