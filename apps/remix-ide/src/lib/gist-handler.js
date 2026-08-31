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
// Authenticated gist reads go through the BFF. The browser has only an opaque
// TronIDE session handle; GitHub's credential remains encrypted server-side.
var githubAuth = require('./github-auth')
var githubBff = require('./github-bff')
var githubGistSecurity = loadGithubGistSecurity()
var normalizeGistId = require('./normalize-gist-id')

function fetchGist (gistId) {
  var request = githubAuth.isConnected()
    ? githubBff.githubRequest('/gists/' + encodeURIComponent(gistId), { method: 'GET' })
    : window.fetch('https://api.github.com/gists/' + encodeURIComponent(gistId), {
      method: 'GET',
      headers: { Accept: 'application/vnd.github+json' },
      redirect: 'error'
    })
  return request.then(function (response) {
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

// Fetch the full text of a gist file from its `raw_url`. GitHub truncates a
// file's inline `content` in the gist API response once it gets large (and omits
// it past a higher cap), so without this a big contract loads empty/partial. Only
// GitHub's own raw host is ever fetched — a crafted raw_url to another origin is
// refused — and redirects are errored, mirroring fetchGist's SSRF hardening.
//
// IMPORTANT: do NOT attach the gist access token here. `gist.githubusercontent.com`
// (the raw host) serves public gists anonymously and returns `access-control-allow-origin: *`
// only for *simple* cross-origin requests. An `Authorization` header is not CORS
// safelisted, so adding it forces a preflight the raw host doesn't answer — every
// truncated-file backfill then fails with a CORS error (0 bytes), which surfaced as
// "Could not load the content ... a rate limit applies" even with a token configured.
// The BFF authenticates the metadata call; raw content remains anonymous.
function fetchGistRawContent (rawUrl) {
  var parsed
  try { parsed = new URL(rawUrl) } catch (error) { return Promise.reject(new Error('invalid raw gist url')) }
  if (parsed.protocol !== 'https:' || !/(^|\.)githubusercontent\.com$/.test(parsed.hostname)) {
    return Promise.reject(new Error('refusing to fetch non-github raw gist url'))
  }
  // Keep this a CORS-simple GET (no Authorization, no custom headers) so no preflight is required.
  return window.fetch(parsed.href, { method: 'GET', redirect: 'error' }).then(function (response) {
    if (!response.ok) return Promise.reject(new Error('raw gist content HTTP ' + response.status))
    return response.text()
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
      gistId = getGistId(params.gist)
      loadingFromGist = !!gistId
    }
    if (loadingFromGist) {
      cb(gistId)
    }
    return loadingFromGist
  }

  // Accept only a bare id or a canonical gist.github.com URL. Secret redaction
  // happens first so token-like input can never be reinterpreted as a gist id.
  function getGistId (str) {
    const redactedInput = githubGistSecurity.redactGitHubSecrets(str)
    return normalizeGistId(redactedInput)
  }

  this.loadFromGist = (params, fileManager) => {
    const self = this
    return self.handleLoad(params, function (gistId) {
      // Bind the import before starting either the gist API request or any raw
      // content backfill. A checkout/workspace switch increments the provider
      // generation, so the original context will reject a late batch write
      // instead of materialising source-branch files in the new branch.
      let mutationContext
      let capturedContext
      try {
        if (typeof fileManager.captureWorkspaceMutationContext === 'function') {
          capturedContext = fileManager.captureWorkspaceMutationContext('/')
        } else {
          const provider = fileManager.getProvider && fileManager.getProvider('workspace')
          if (!provider || typeof provider.captureMutationContext !== 'function') {
            throw new Error('The active workspace could not be bound to the gist import.')
          }
          capturedContext = provider.captureMutationContext()
        }
      } catch (error) {
        const safeError = githubGistSecurity.redactGitHubSecrets(String(error && error.message ? error.message : error))
        modalDialogCustom.alert('Gist load error', safeError)
        return
      }

      Promise.resolve(capturedContext).then((context) => {
        if (!context) throw new Error('The active workspace could not be bound to the gist import.')
        mutationContext = context
        return fetchGist(gistId)
      }).then((data) => {
        if (!data || !data.files) {
          const safeError = githubGistSecurity.redactGitHubSecrets(String(data && data.message ? data.message : 'Gist response did not contain files'))
          modalDialogCustom.alert('Gist load error', safeError)
          return
        }
        // Never materialise the resolved dependency cache (.deps/npm/...) from a
        // gist. The import resolver prefers an existing workspace file over a fresh
        // fetch, so a stale cached file written from the gist (e.g. utils/Arrays.sol)
        // shadows the version a newer contract expects and breaks compilation with a
        // version-skew error ("Declaration ... not found"). Deps are re-resolved on
        // compile anyway. New gists no longer pack .deps (see file-explorer packageFiles);
        // this also strips it from older gists that already baked it in. Done before the
        // raw backfill so we don't fetch — or falsely report as unresolved — deps files.
        const isDepsPath = (element) => {
          const p = String(element).replace(/\.\.\./g, '/')
          return p === '.deps' || p.indexOf('.deps/') === 0 || p.indexOf('/.deps/') !== -1
        }
        const elements = Object.keys(data.files).filter((element) => !isDepsPath(element))
        // Backfill the full text for any file GitHub truncated (or whose inline
        // content came back empty) from its raw_url, so large contracts don't
        // load blank. Files that already carry their content are left untouched.
        // A file whose content we cannot recover is recorded in `unresolved` so we
        // don't silently write a blank file into the workspace (which previously
        // showed up as "the file is in the tree but opens empty").
        const unresolved = []
        return Promise.all(elements.map((element) => {
          const file = data.files[element]
          if (file && file.raw_url && (file.truncated || !file.content)) {
            return fetchGistRawContent(file.raw_url).then((text) => {
              if (typeof text === 'string') file.content = text
              if (!file.content) unresolved.push(element)
            }).catch((error) => {
              console.debug('[gistHandler] could not fetch full content for gist file', element, error)
              unresolved.push(element)
            })
          }
          // No raw_url to recover from and no inline content => unrecoverable.
          if (file && !file.content) unresolved.push(element)
          return undefined
        })).then(() => {
          // If GitHub gave us files but we couldn't materialise the content for
          // some of them, surface that instead of importing empty files. The
          // import is still attempted for the files we did resolve.
          if (unresolved.length) {
            modalDialogCustom.alert(
              'Gist load error',
              'Could not load the content of the following gist file(s): ' + unresolved.join(', ') +
              '. They may be too large, or GitHub could not be reached (anonymous requests are rate-limited — connect GitHub to raise the limit).'
            )
          }
          const obj = {}
          elements.forEach((element) => {
            // Skip files we couldn't resolve so we never create a blank file in the
            // workspace that opens empty; the alert above already reported them.
            if (unresolved.indexOf(element) !== -1) return
            const path = element.replace(/\.\.\./g, '/')

            obj['/' + 'gist-' + gistId + '/' + path] = data.files[element]
          })
          return obj
        })
      }).then((obj) => {
        if (!obj) return
        fileManager.setBatchFiles(obj, 'workspace', true, (errorLoadingFile) => {
          if (!errorLoadingFile) {
            const provider = fileManager.getProvider('workspace')
            provider.lastLoadedGistId = gistId
          } else {
            modalDialogCustom.alert('Gist load error', errorLoadingFile.message || errorLoadingFile)
          }
        }, mutationContext)
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
