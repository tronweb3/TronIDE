/*
 * Static integration contracts for the organization-owned GitHub App rollout.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')
var root = path.join(__dirname, '..', '..', '..')

function read (relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('GitHub App frontend keeps tokens server-side and exposes repository setup actions', function (t) {
  var bffClient = read('apps/remix-ide/src/lib/github-bff.js')
  var oauthClient = read('apps/remix-ide/src/lib/github-oauth.js')
  var landing = read('apps/remix-ide/src/app/ui/landing-page/landing-page.js')
  var gitProvider = read('apps/remix-ide/src/app/files/dgitProvider.js')

  t.ok(bffClient.indexOf("['oauth_app', 'github_app'].includes(capabilities.authProvider)") !== -1, 'frontend accepts only the staged server providers')
  t.ok(bffClient.indexOf("request('/installations'") !== -1, 'installation discovery stays behind the BFF')
  t.ok(bffClient.indexOf("request(path, { method: 'GET' })") !== -1 && bffClient.indexOf("'/repository-access?'") !== -1, 'repository diagnosis uses the restricted BFF endpoint')
  t.ok(bffClient.indexOf("target.hostname !== 'github.com'") !== -1, 'installation navigation is pinned to github.com')
  t.notOk(/Authorization\s*:|Bearer\s/.test(bffClient + oauthClient), 'browser integration never builds GitHub credentials')
  t.ok(landing.indexOf('landingGithubAppInstall') !== -1, 'Home exposes repository access setup')
  t.ok(landing.indexOf('Grant repository access') !== -1, 'Home explains first-time repository access without implying a local installation')
  t.ok(landing.indexOf('Manage repository access') !== -1, 'Home distinguishes initial access from later configuration')
  t.notOk(/Install(?: the TronIDE)? GitHub App/.test(landing + bffClient + gitProvider), 'user-facing copy does not describe repository authorization as software installation')
  t.ok(landing.indexOf('refreshGithubInstallation()') !== -1, 'restored sessions hydrate GitHub App installation state')
  t.ok(landing.indexOf('failed unstored GitHub replacement session revocation failed') !== -1, 'failed reconnect setup revokes a replacement session even if local persistence failed')
  t.ok(gitProvider.indexOf('getGithubRepositoryAccess(target.owner, target.repo)') !== -1, 'Git operations diagnose the exact failed repository')
  t.ok(gitProvider.indexOf('repository may not be selected for the TronIDE GitHub App') !== -1, 'Git operations explain selected-repository failures')
  t.notOk(/githubAuth\.clearSession\(\)[\s\S]{0,100}return \{ cancel: true \}/.test(gitProvider), 'repository-specific auth failures do not disconnect a valid user session')
  t.end()
})

test('GitHub App server uses user tokens, installation checks, and staged rollback', function (t) {
  var server = read('services/github-oauth/main.ts')

  t.ok(server.indexOf('GITHUB_AUTH_PROVIDER') !== -1, 'provider switch is explicit')
  t.ok(server.indexOf('GITHUB_APP_CLIENT_ID') !== -1 && server.indexOf('GITHUB_APP_CLIENT_SECRET') !== -1, 'organization App credentials are server configuration')
  t.ok(server.indexOf('if (authProvider === "oauth_app")') !== -1 && server.indexOf('authorizeParams.set("scope", githubScope)') !== -1, 'only the rollback OAuth App requests scopes')
  t.ok(server.indexOf('token.startsWith("ghu_")') !== -1, 'GitHub App mode accepts only user access tokens')
  t.ok(server.indexOf('githubTokenExpiresAt - 60_000') !== -1, 'BFF session expires before the upstream token')
  t.ok(server.indexOf('https://api.github.com/user/installations') !== -1, 'installations are verified with the server-held user token')
  t.ok(server.indexOf('url.pathname === "/repository-access"') !== -1, 'one-repository access diagnosis is implemented')
  t.ok(server.indexOf('basicAuth("x-access-token", authenticated.token)') !== -1, 'GitHub App Git HTTP uses the token as password')
  t.end()
})
