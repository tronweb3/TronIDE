/*
 * Static regression pins for the 2026-07-21 v2.3.2 security assessment.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')
var root = path.join(__dirname, '..', '..', '..')

function read (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('URL fragments cannot dispatch arbitrary native plugin operations', function (t) {
  var app = read('apps/remix-ide/src/app.js')
  var manager = read('apps/remix-ide/src/remixAppManager.js')
  var security = read('apps/remix-ide/src/lib/url-param-security.js')

  t.ok(app.indexOf('parseUrlPluginCall(params.call)') !== -1, 'app routes #call through the strict parser')
  t.equal(app.indexOf("params.call.split('//')"), -1, 'app no longer expands arbitrary URL arguments into appManager.call')
  t.ok(security.indexOf("fileManager: new Set(['open'])") !== -1, 'only the non-mutating open-file deep link remains')
  t.ok(manager.indexOf('return filterUrlPluginNames(activate)') !== -1, '#activate is filtered through a fixed panel allowlist')
  t.equal(manager.indexOf("['ethdoc'].includes(from.name)"), -1, 'the ethdoc activation bypass is removed')
  t.ok(manager.indexOf('if (await this.canDeactivatePlugin(from, to))') !== -1, 'async deactivation authorization is awaited')
  t.end()
})

test('URL imports, wallet events, OAuth messages, and AI staging keep their security gates', function (t) {
  var filePanel = read('apps/remix-ide/src/app/panels/file-panel.js')
  var wallet = read('libs/remix-ui/top-header/src/lib/top-header.js')
  var oauth = read('apps/remix-ide/src/lib/github-oauth.js')
  var githubBff = read('apps/remix-ide/src/lib/github-bff.js')
  var bff = read('services/github-oauth/main.ts')
  var chat = read('libs/remix-code-reader/src/components/Chat/index.js')

  t.ok(filePanel.indexOf('normalizeUrlImport(params.url)') !== -1, '#url is allow-listed before contentImport.resolve')
  t.ok(wallet.indexOf('event.source !== window || event.origin !== window.location.origin') !== -1, 'wallet postMessage requires the same window and origin')
  t.ok(oauth.indexOf('event.source !== popup') !== -1, 'OAuth completion must come from the popup that was opened')
  t.ok(bff.indexOf('prompt: "select_account"') !== -1, 'server-owned OAuth request must let users choose the GitHub account explicitly')
  t.ok(bff.indexOf('code_challenge_method: "S256"') !== -1, 'server-owned OAuth request must use PKCE')
  t.equal(oauth.indexOf('access_token'), -1, 'frontend OAuth code must never receive a GitHub access token')
  t.ok(oauth.indexOf('assertBffReady()') !== -1 && githubBff.indexOf("authMode !== 'bff-v1'") !== -1 && githubBff.indexOf("['oauth_app', 'github_app'].includes(capabilities.authProvider)") !== -1, 'frontend fails closed instead of falling back to an unknown or token-returning proxy')
  t.ok(githubBff.indexOf('if (!GITHUB_BFF.baseUrl || !GITHUB_BFF.messageOrigin)') !== -1, 'frontend fails closed when the organization BFF base URL is missing or invalid')
  t.ok(githubBff.indexOf('return new URL(baseUrl).origin') !== -1 && oauth.indexOf('proxyOrigin: GITHUB_BFF.messageOrigin') !== -1, 'OAuth postMessage compares the URL origin without its reverse-proxy path')
  t.ok(oauth.indexOf("GITHUB_BFF.baseUrl + '/oauth/start'") !== -1, 'OAuth start keeps the configured reverse-proxy path')
  t.ok(githubBff.indexOf("process.env.TRONIDE_GITHUB_BFF_ORIGIN || ''") !== -1, 'frontend has no hard-coded Deno deployment fallback')
  t.ok(bff.indexOf('Deno.env.get("REDIRECT_URI") ?? ""') !== -1, 'BFF has no hard-coded callback fallback')
  t.ok(bff.indexOf('Deno.env.get("ALLOWED_ORIGINS") ?? ""') !== -1, 'BFF has no implicit production-origin allowlist')
  t.ok(chat.indexOf("title: 'AI wants to stage all workspace changes'") !== -1, 'git_stage_all asks for confirmation')
  t.ok(chat.indexOf("title: 'AI wants to stage workspace files'") !== -1, 'git_stage asks for confirmation')
  t.end()
})
