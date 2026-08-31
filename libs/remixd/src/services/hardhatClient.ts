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
import * as path from 'path'
import * as utils from '../utils'
const { spawn } = require('child_process')

export class HardhatClient extends PluginClient {
  methods: Array<string>
  websocket: WS
  currentSharedFolder: string

  constructor (private readOnly = false) {
    super()
    this.methods = ['compile']
  }

  setWebSocket (websocket: WS): void {
    this.websocket = websocket
  }

  sharedFolder (currentSharedFolder: string): void {
    this.currentSharedFolder = currentSharedFolder
  }

  compile (configPath: string) {
    return new Promise((resolve, reject) => {
      if (this.readOnly) {
        const errMsg = '[Hardhat Compilation]: Cannot compile in read-only mode'
        return reject(new Error(errMsg))
      }
      const safeConfigPath = assertSafeRelativePath(configPath)
      const configAbsolutePath = utils.absolutePath(safeConfigPath, this.currentSharedFolder)
      const options = { cwd: this.currentSharedFolder, shell: false }
      const child = spawn('npx', ['hardhat', 'compile', '--config', configAbsolutePath], options)
      let result = ''
      let error = ''
      child.stdout.on('data', (data) => {
        const msg = `[Hardhat Compilation]: ${data.toString()}`
        console.log('\x1b[32m%s\x1b[0m', msg)
        result += msg + '\n'
      })
      child.stderr.on('data', (err) => {
        error += `[Hardhat Compilation]: ${err.toString()}`
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code !== 0 || error) reject(error || new Error(`Hardhat exited with code ${code}.`))
        else resolve(result)
      })
    })
  }
}

function assertSafeRelativePath (value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.indexOf('\0') !== -1 || path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
    throw new Error('Hardhat config path must stay inside the shared folder.')
  }
  return value
}
