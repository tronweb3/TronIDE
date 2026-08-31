'use strict'

const test = require('tape')
const { normalizeGithubRemoteUrl, redactRemoteUrl } = require('../src/lib/git-url-security')

test('Git remote URL policy accepts canonical GitHub HTTPS repositories only', function (t) {
  t.equal(normalizeGithubRemoteUrl(' https://github.com/tronprotocol/tronide.git/ '), 'https://github.com/tronprotocol/tronide.git', 'trailing slash is normalized')
  t.equal(normalizeGithubRemoteUrl('https://github.com/owner/repo'), 'https://github.com/owner/repo', 'a repository without .git is accepted')
  ;[
    'http://github.com/owner/repo',
    'https://evil.example/owner/repo',
    'https://github.com/owner/repo?token=secret',
    'https://user:secret@github.com/owner/repo',
    'https://github.com/owner/repo/../../other',
    'git@github.com:owner/repo.git',
    'https://github.com/owner'
  ].forEach(function (url) {
    t.throws(function () { normalizeGithubRemoteUrl(url) }, /GitHub|https|repository/i, url + ' is rejected')
  })
  t.equal(redactRemoteUrl('https://user:secret@github.com/owner/repo.git'), 'https://github.com/owner/repo.git', 'display URL strips credentials')
  t.end()
})
