/*
 * Regression checks for the Home and top-header review fixes.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')

function readSource (relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', 'src', relativePath), 'utf8')
}

test('Home workspace exports stay scoped and fail closed', function (t) {
  const landingSource = readSource('app/ui/landing-page/landing-page.js')
  const downloadSource = landingSource.slice(landingSource.indexOf('const downloadFiles'), landingSource.indexOf('const uploadFile'))
  const headerSource = readSource('../../../libs/remix-ui/top-header/src/lib/top-header.js')

  t.ok(/workspaceProvider\.copyFolderToJson\('\/'/.test(downloadSource), 'Home export reads only the active workspace provider')
  t.notOk(/fileProviders\.browser\.copyFolderToJson/.test(downloadSource), 'Home export does not walk the browser root')
  t.ok(/fileManager\.mode === 'localhost'/.test(downloadSource), 'Home export rejects localhost mode')
  t.ok(/Backups are available only for an active browser workspace/.test(downloadSource), 'Home export gives a clear unavailable-workspace message')
  t.ok(/workspaceProvider\.copyFolderToJson\('\/'/.test(headerSource), 'Header backup reads only the workspace provider')
  t.notOk(/browserProvider\.copyFolderToJson/.test(headerSource), 'Header backup does not walk the browser root')
  t.ok(/activeWorkspace !== currentWorkspace/.test(headerSource), 'Header backup rejects stale workspace state')
  t.end()
})

test('Home GitHub flows bind the file and safely replace BFF sessions', function (t) {
  const source = readSource('app/ui/landing-page/landing-page.js')
  const commitSource = source.slice(source.indexOf('const commitCurrentFileToGithub'), source.indexOf('const readWorkspaceDirectory'))

  t.ok((commitSource.match(/captureWorkspaceMutationContext\(currentFile\)/g) || []).length >= 2, 'commit captures and rechecks the workspace context')
  t.ok(/selectedFile !== currentFile/.test(commitSource), 'commit rejects a changed editor selection')
  t.ok(/getOpenedFiles\(\)/.test(commitSource), 'commit rejects a closed file before reading it')
  t.ok(/const previousSession = githubAuth\.getSession\(\)/.test(source), 'OAuth snapshots the current BFF session before reconnecting')
  t.ok(/previousSession && previousSession !== session[\s\S]*revokeSession\(previousSession\)/.test(source), 'a successful reconnect revokes the replaced BFF session')
  t.ok(/failedReplacement && failedReplacement !== previousSession[\s\S]*revokeSession\(failedReplacement\)/.test(source), 'a failed replacement revokes only the newly issued BFF session')
  t.ok(/if \(previousSession\)\s*\{?\s*githubAuth\.setSession\(previousSession, previousLogin\)/.test(source), 'a failed reconnect preserves the still-valid previous session')
  t.notOk(/tokenSaved|clearGithubToken|getToken\(\)|setToken\(/.test(source), 'Home no longer manages GitHub tokens in the browser')
  t.end()
})

test('Home and header asynchronous UI work is teardown-safe', function (t) {
  const landingSource = readSource('app/ui/landing-page/landing-page.js')
  const headerSource = readSource('../../../libs/remix-ui/top-header/src/lib/top-header.js')

  t.ok(/this\._onGithubConnectionChanged/.test(landingSource), 'Home stores its GitHub connection listener')
  t.ok(/removeEventListener\('tronideGithubConnectionChanged', this\._onGithubConnectionChanged\)/.test(landingSource), 'Home removes the GitHub connection listener')
  t.ok(/this\._autoMigrateHandler/.test(landingSource), 'Home stores its migration listener')
  t.ok(/removeListener\('activate', this\._autoMigrateHandler\)/.test(landingSource), 'Home removes the migration listener')
  t.ok(/if \(!this\._landingActive\) return[\s\S]*for \(let i = 0; i < 25; i\+\+\)[\s\S]*if \(!this\._landingActive\) return/.test(landingSource), 'workspace creation aborts after Home deactivation')
  t.ok(/homeNavigationTimersRef = useRef\(\[\]\)/.test(headerSource), 'header tracks delayed Home navigation timers')
  t.ok(/homeNavigationTimersRef\.current\.forEach\(\(timerId\) => window\.clearTimeout\(timerId\)\)/.test(headerSource), 'header clears delayed Home navigation timers')
  t.ok(/removeListener\('aiPluginClosed', onAiPluginClosed\)/.test(headerSource), 'header removes the AI close listener')
  t.end()
})

test('Home controls expose keyboard activation and Solidity failures stay failed', function (t) {
  const landingSource = readSource('app/ui/landing-page/landing-page.js')
  const headerSource = readSource('../../../libs/remix-ui/top-header/src/lib/top-header.js')

  t.ok(/role="button" tabindex="0" onclick=\$\{\(event\) => runHomeAction\(event, `plugin-open:/.test(landingSource), 'plugin cards are keyboard-focusable controls')
  t.ok(/event\.key !== 'Enter' && event\.key !== ' '/.test(landingSource), 'Home custom controls handle Enter and Space')
  t.ok(/landingExploreAllPluginsButton[\s\S]*onkeydown=/.test(landingSource), 'Explore all plugins handles keyboard events')
  t.ok(/tooltip\(error\.message \|\| error\)\n\s*return\n\s*}\n\s*this\.verticalIcons\.select\('solidity'\)/.test(landingSource), 'Solidity activation does not claim success after failure')
  t.ok(/className='homeIcon' role='button' tabIndex=\{0\}/.test(headerSource), 'Header Home icon is keyboard accessible')
  t.ok(/role='button' tabIndex=\{0\} aria-label='Show TRON IDE AI Assistant'/.test(headerSource), 'AI show control is keyboard accessible')
  t.end()
})
