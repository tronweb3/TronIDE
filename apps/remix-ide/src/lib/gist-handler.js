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

'use strict'
var modalDialogCustom
if (typeof window !== 'undefined') {
  modalDialogCustom = require('../app/ui/modal-dialog-custom')
}
var githubGistSecurity = loadGithubGistSecurity()

// Only same-origin (api.github.com) HTTPS gist URLs are ever fetched. The gist id is constrained to
// hex characters by `getGistId`, so this fetch cannot be redirected to attacker-controlled origins
// even on a future browser without strict redirect semantics; the IDE's CSP would also block it.
function fetchGist (gistId) {
  return window.fetch('https://api.github.com/gists/' + encodeURIComponent(gistId), {
    method: 'GET',
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'tron-remix' },
    redirect: 'error'
  }).then(function (response) {
    return response.text().then(function (text) {
      var payload = {}
      try { payload = text ? JSON.parse(text) : {} } catch (parseError) {
        return Promise.reject(new Error('Gist response was not JSON (HTTP ' + response.status + ')'))
      }
      if (!response.ok) {
        return Promise.reject(new Error(payload.message || 'GitHub request failed (HTTP ' + response.status + ')'))
      }
      return payload
    })
  })
}

// Allowing window to be overriden for testing
function GistHandler (_window) {
  if (_window !== undefined) {
    modalDialogCustom = _window
  }

  this.handleLoad = function (params, cb) {
    if (!cb) cb = () => {}
    var loadingFromGist = false
    var gistId
    if (params.gist === '') {
      loadingFromGist = true
      modalDialogCustom.prompt('Load a Gist', 'Enter the ID of the Gist or URL you would like to load.', null, (target) => {
        if (target !== '') {
          gistId = getGistId(target)
          if (gistId) {
            cb(gistId)
          } else {
            modalDialogCustom.alert('Gist load error', 'Error while loading gist. Please provide a valid Gist ID or URL.')
          }
        }
      })
      return loadingFromGist
    } else {
      gistId = params.gist
      loadingFromGist = !!gistId
    }
    if (loadingFromGist) {
      cb(gistId)
    }
    return loadingFromGist
  }

  function getGistId (str) {
    const redactedInput = githubGistSecurity.redactGitHubSecrets(str)
    var idr = /[0-9A-Fa-f]{8,}/
    var match = idr.exec(redactedInput)
    return match ? match[0] : null
  }

  this.loadFromGist = (params, fileManager) => {
    const self = this
    return self.handleLoad(params, function (gistId) {
      fetchGist(gistId).then((data) => {
        if (!data || !data.files) {
          const safeError = githubGistSecurity.redactGitHubSecrets(String(data && data.message ? data.message : 'Gist response did not contain files'))
          modalDialogCustom.alert('Gist load error', safeError)
          return
        }
        const obj = {}
        Object.keys(data.files).forEach((element) => {
          const path = element.replace(/\.\.\./g, '/')

          obj['/' + 'gist-' + gistId + '/' + path] = data.files[element]
        })
        fileManager.setBatchFiles(obj, 'workspace', true, (errorLoadingFile) => {
          if (!errorLoadingFile) {
            const provider = fileManager.getProvider('workspace')
            provider.lastLoadedGistId = gistId
          } else {
            modalDialogCustom.alert('Gist load error', errorLoadingFile.message || errorLoadingFile)
          }
        })
      }).catch((error) => {
        const safeError = githubGistSecurity.redactGitHubSecrets(String(error && error.message ? error.message : error))
        modalDialogCustom.alert('Gist load error', safeError)
      })
    })
  }
}

function loadGithubGistSecurity () {
  try {
    const remixLib = require('@remix-project/remix-lib')
    if (remixLib.workspace && remixLib.workspace.githubGistSecurity) return remixLib.workspace.githubGistSecurity
  } catch (error) {
    console.debug('[gistHandler] remix-lib githubGistSecurity unavailable; using local fallback', error)
  }
  return {
    redactGitHubSecrets: function (value) {
      return String(value)
        .replace(/ghp_[A-Za-z0-9_]{20,}/g, '[github-token-redacted]')
        .replace(/github_pat_[A-Za-z0-9_]{20,}/g, '[github-token-redacted]')
        .replace(/token=([A-Za-z0-9_\-.]{20,})/g, 'token=[github-token-redacted]')
    }
  }
}

module.exports = GistHandler
