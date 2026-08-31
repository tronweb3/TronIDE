/*
 * Static regression checks for the v2.3.3 remixd hardening.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')

function readRoot (relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', relativePath), 'utf8')
}

test('all built-in remixd websocket services use daemon-issued tokens', function (t) {
  var helper = readRoot('apps/remix-ide/src/app/components/secure-websocket-plugin.js')
  var handles = [
    'remixd-handle.js',
    'hardhat-handle.js',
    'slither-handle.js',
    'git-handle.js'
  ].map(function (name) { return readRoot('apps/remix-ide/src/app/files/' + name) })
  t.ok(/requestLocalSessionUrl/.test(helper), 'local URL helper fetches a daemon token')
  t.ok(/target\.searchParams\.set\('remixdToken'/.test(helper), 'local URL helper binds the token to the websocket URL')
  handles.forEach(function (source, index) {
    t.ok(/SecureWebsocketPlugin/.test(source), 'built-in handle ' + index + ' uses the bounded connector')
    t.ok(/requestLocalSessionUrl/.test(source), 'built-in handle ' + index + ' requests a daemon token')
  })
  t.end()
})

test('remixd daemon and filesystem boundary fail closed', function (t) {
  var websocket = readRoot('libs/remixd/src/websocket.ts')
  var daemon = readRoot('libs/remixd/src/bin/remixd.ts')
  var app = readRoot('apps/remix-ide/src/app.js')
  var filePanel = readRoot('apps/remix-ide/src/app/panels/file-panel.js')
  var utils = readRoot('libs/remixd/src/utils.ts')
  var client = readRoot('libs/remixd/src/services/remixdClient.ts')
  t.ok(/crypto\.randomBytes\(16\)/.test(websocket), 'daemon token uses the Node secure random source')
  t.ok(/verifyClient/.test(websocket) && /safeTokenEqual/.test(websocket), 'websocket rejects missing or mismatched tokens')
  t.ok(/assertNoSymlinkComponents/.test(utils) && /lstatSync/.test(utils), 'path checks inspect every existing component for symlinks')
  t.ok(/async set/.test(client) && /await this\.createDir/.test(client), 'writes validate parent directories before creating files')
  t.ok(/async createDir/.test(client) && /Symbolic links are not allowed/.test(client), 'directory creation rejects symlink components')
  t.ok(/errorHandler\(error, 'folder'\)/.test(daemon), 'folder startup errors identify the folder service')
  t.ok(/activatePlugin\('remixd'\)\.catch/.test(app), 'optional Electron remixd activation handles daemon failures')
  t.ok(/caller !== 'remixd'[\s\S]*await this\.call\('manager', 'activatePlugin', 'remixd'\)/.test(filePanel), 'remixd workspace callbacks do not recursively activate the plugin')
  t.ok(/caller !== 'remixd' && !this\._deps\.fileProviders\.localhost\.isConnected\(\)/.test(filePanel), 'a connected daemon does not re-enter activation while publishing localhost')
  t.end()
})

test('remixd command services do not invoke a shell with untrusted input', function (t) {
  var git = readRoot('libs/remixd/src/services/gitClient.ts')
  var hardhat = readRoot('libs/remixd/src/services/hardhatClient.ts')
  var slither = readRoot('libs/remixd/src/services/slitherClient.ts')
  t.notOk(/shell:\s*true/.test(git + hardhat + slither), 'service commands never enable shell interpretation')
  t.ok(/spawn\('git', args/.test(git), 'git receives parsed argv rather than a command string')
  t.ok(/execFileSync/.test(slither) && /spawn\('slither', slitherArgs/.test(slither), 'slither uses argv-based child processes')
  t.ok(/assertSafeRelativePath/.test(hardhat + slither), 'analysis paths are constrained to the shared folder')
  t.end()
})

test('remixd Nx serve exports the library dependency path for the built CLI', function (t) {
  var project = JSON.parse(readRoot('libs/remixd/project.json'))
  var command = project.targets.serve.options.command
  t.ok(/REMIXD_NODE_MODULES/.test(command), 'serve computes the workspace remixd dependency directory')
  t.ok(/export NODE_PATH=/.test(command), 'serve exports NODE_PATH before starting the built daemon')
  t.ok(/build\/libs\/remixd\/src\/bin\/remixd\.js/.test(command), 'serve starts the built CLI entrypoint')
  t.end()
})
