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

const READ_ONLY_COMMANDS = new Set(['status', 'log', 'diff', 'show', 'branch', 'remote', 'rev-parse', 'ls-files', 'cat-file'])
const SUPPORTED_COMMANDS = new Set([...READ_ONLY_COMMANDS, 'add', 'commit', 'checkout', 'switch', 'reset', 'rm', 'mv', 'merge', 'pull', 'push', 'fetch', 'init'])
const FORBIDDEN_OPTIONS = /^(?:-C|--git-dir(?:=|$)|--work-tree(?:=|$)|--exec-path(?:=|$)|-c|--config(?:=|$)|--upload-pack(?:=|$)|--receive-pack(?:=|$)|--git-upload-pack(?:=|$)|--git-receive-pack(?:=|$)|--output(?:=|$)|-o(?:=|$))/i
const OUTSIDE_WORKSPACE_PATH = /^(?:[A-Za-z]:[\\/]|[\\/])|(?:^|[\\/])\.\.(?:[\\/]|$)/

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
    const args = assertCommand(cmd)
    if (!this.currentSharedFolder) throw new Error('Shared folder is not configured.')
    if (this.readOnly && !isReadOnlyCommand(args)) throw new Error(`Git command "${args[0]}" is not available in read-only mode.`)
    const options = { cwd: this.currentSharedFolder, shell: false }
    const child = spawn('git', args, options)
    let result = ''
    let error = ''
    return new Promise((resolve, reject) => {
      child.stdout.on('data', (data) => {
        result += data.toString()
      })
      child.stderr.on('data', (err) => {
        error += err.toString()
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code !== 0) reject(error || new Error(`Git exited with code ${code}.`))
        else resolve(result)
      })
    })
  }
}

/**
 * Validate that command can be run by service
 * @param cmd
 */
export function assertCommand (cmd): string[] {
  if (typeof cmd !== 'string' || !/^git(?:\s+.+)$/.test(cmd) || /[`$<>;&|\\\r\n]/.test(cmd)) {
    throw new Error('Invalid command for service!')
  }
  const parts = cmd.match(/'[^']*'|"[^"]*"|\S+/g)
  if (!parts || parts[0] !== 'git' || parts.some((part) => part.length > 1 && ((part.startsWith("'") && !part.endsWith("'")) || (part.startsWith('"') && !part.endsWith('"'))))) {
    throw new Error('Invalid command for service!')
  }
  const args = parts.slice(1).map((part) => {
    if ((part.startsWith("'") && part.endsWith("'")) || (part.startsWith('"') && part.endsWith('"'))) return part.slice(1, -1)
    return part
  })
  const command = args[0]
  if (!command || !SUPPORTED_COMMANDS.has(command) || command.startsWith('-')) throw new Error('Unsupported git command for service!')
  if (args.some((part) => FORBIDDEN_OPTIONS.test(part) || OUTSIDE_WORKSPACE_PATH.test(part))) {
    throw new Error('Git command may not override the shared workspace or process configuration!')
  }
  return args
}

function isReadOnlyCommand (args: string[]): boolean {
  if (!READ_ONLY_COMMANDS.has(args[0])) return false
  if (args[0] === 'branch') {
    // A positional branch name is a create/delete target. Read-only callers may
    // pass listing/query flags, but never a mutating branch operation.
    return args.slice(1).every((arg) => arg.startsWith('-'))
  }
  if (args[0] === 'remote') {
    return args[1] === '-v' || args[1] === '--verbose' || args[1] === 'show' || args[1] === 'get-url' || args[1] === 'get-branches'
  }
  return true
}
