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

'use strict'
import { Plugin } from '@remixproject/engine'
import { RemixURLResolver } from '@remix-project/remix-url-resolver'
const remixTests = require('@remix-project/remix-tests')
const async = require('async')

const profile = {
  name: 'contentImport',
  displayName: 'content import',
  version: '0.0.1',
  methods: ['resolve', 'resolveAndSave', 'isExternalUrl']
}

/**
 * Solc calls the import callback with the literal path from the fetched
 * source. GitHub Solidity files commonly use relative imports (`./IERC20`),
 * but the callback has no parent URL to resolve against. Convert only those
 * relative GitHub imports to explicit blob URLs while the parent URL is still
 * known. This keeps arbitrary URLs untouched and lets the normal allowlist,
 * resolver cache, and workspace dependency boundary handle every follow-up
 * request.
 */
function absolutizeGithubImports (content: any, sourceUrl: string): any {
  if (typeof content !== 'string' || typeof sourceUrl !== 'string') return content

  let parsed: URL
  try { parsed = new URL(sourceUrl) } catch (error) { return content }
  if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') return content

  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length < 3) return content
  const owner = segments[0]
  const repository = segments[1]
  let reference = 'master'
  let fileStart = 2
  if (segments[2] === 'blob' && segments.length >= 5) {
    reference = segments[3]
    fileStart = 4
  }
  const filePath = segments.slice(fileStart).join('/')
  if (!filePath) return content

  const parentUrl = `https://github.com/${owner}/${repository}/blob/${reference}/${filePath}`
  const baseUrl = parentUrl.slice(0, parentUrl.lastIndexOf('/') + 1)
  return content.replace(/(\bimport\s+(?:[^"'\n]*?\s+from\s+)?["'])(\.\.?\/[^"']+)(["'])/g, (match, prefix, relativePath, suffix) => {
    try {
      return prefix + new URL(relativePath, baseUrl).href + suffix
    } catch (error) {
      return match
    }
  })
}

export class CompilerImports extends Plugin {
  previouslyHandled: {}
  urlResolver: any
  constructor () {
    super(profile)
    this.urlResolver = new RemixURLResolver()
    this.previouslyHandled = {} // cache import so we don't make the request at each compilation.
  }

  isRelativeImport (url) {
    return /^([^/]+)/.exec(url)
  }

  isExternalUrl (url) {
    const handlers = this.urlResolver.getHandlers()
    return handlers.some(handler => handler.match(url))
  }

  /**
    * resolve the content of @arg url. This only resolves external URLs.
    *
    * @param {String} url  - external URL of the content. can be basically anything like raw HTTP, ipfs URL, github address etc...
    * @returns {Promise} - { content, cleanUrl, type, url }
    */
  resolve (url) {
    return new Promise((resolve, reject) => {
      this.import(url, null, (error, content, cleanUrl, type, url) => {
        if (error) return reject(error)
        resolve({ content, cleanUrl, type, url })
      }, null)
    })
  }

  async import (url, force, loadingCb, cb) {
    if (typeof force !== 'boolean') {
      const temp = loadingCb
      loadingCb = force
      cb = temp
      force = false
    }
    if (!loadingCb) loadingCb = () => {}
    if (!cb) cb = () => {}

    var self = this
    if (force) delete this.previouslyHandled[url]
    var imported = this.previouslyHandled[url]
    if (imported) {
      return cb(null, imported.content, imported.cleanUrl, imported.type, url)
    }

    let resolved
    try {
      // Compilation imports are fetched anonymously: the resolver's github
      // handler hits raw.githubusercontent.com with no credentials, so no
      // token (Settings PAT or the in-memory connect token) is wired in here.
      // The Settings PAT only backs gist load/publish fallbacks elsewhere.
      resolved = await this.urlResolver.resolve(url)
      console.log(resolved)
      const { cleanUrl, type } = resolved
      const content = type === 'github' ? absolutizeGithubImports(resolved.content, url) : resolved.content
      self.previouslyHandled[url] = {
        content,
        cleanUrl,
        type
      }
      cb(null, content, cleanUrl, type, url)
    } catch (e) {
      console.log(e)
      return cb(new Error('not found ' + url))
    }
  }

  async importExternal (url, targetPath, cb) {
    let provider
    let mutationContext
    try {
      // Resolve and bind the destination provider before starting the network
      // import. WorkspaceFileProvider generations change on checkout/workspace
      // switch, so the same context can reject a late dependency write.
      provider = await this.call('fileManager', 'getProviderOf', null)
      if (provider && typeof provider.captureMutationContext === 'function') {
        mutationContext = await provider.captureMutationContext()
      }
    } catch (error) {
      // Preserve compilation when no writable provider is available. The
      // dependency can still be returned to solc; it simply must not be cached
      // without a bound mutation context.
      console.debug('[contentImport] could not bind dependency cache write', error)
      provider = null
      mutationContext = undefined
    }

    this.import(url,
      // TODO: handle this event
      (loadingMsg) => { this.emit('message', loadingMsg) },
      (error, content, cleanUrl, type, url) => {
        if (error) return cb(error)
        try {
          // FileManager strips the virtual `browser/` provider prefix before
          // workspace writes. Do the same for this direct-provider path.
          const path = String(targetPath || type + '/' + cleanUrl).replace(/^\/?browser(?:\/|$)/, '')
          if (provider) {
            const accepted = provider.addExternal('.deps/' + path, content, url, mutationContext)
            if (accepted === false) return cb(new Error('The workspace changed before the imported dependency could be written.'))
          }
        } catch (err) {
          return cb(err)
        }
        cb(null, content)
      }, null)
  }

  /**
    * import the content of @arg url.
    * first look in the browser localstorage (browser explorer) or locahost explorer. if the url start with `browser/*` or  `localhost/*`
    * then check if the @arg url is located in the localhost, in the node_modules or installed_contracts folder
    * then check if the @arg url match any external url
    *
    * @param {String} url - URL of the content. can be basically anything like file located in the browser explorer, in the localhost explorer, raw HTTP, github address etc...
    * @param {String} targetPath - (optional) internal path where the content should be saved to
    * @returns {Promise} - string content
    */
  resolveAndSave (url, targetPath) {
    return new Promise((resolve, reject) => {
      if (url.indexOf('remix_tests.sol') !== -1) resolve(remixTests.assertLibCode)
      this.call('fileManager', 'getProviderOf', url).then((provider) => {
        if (provider) {
          if (provider.type === 'localhost' && !provider.isConnected()) {
            return reject(new Error(`file provider ${provider.type} not available while trying to resolve ${url}`))
          }
          provider.exists(url).then(exist => {
            /*
              if the path is absolute and the file does not exist, we can stop here
              Doesn't make sense to try to resolve "localhost/node_modules/localhost/node_modules/<path>" and we'll end in an infinite loop.
            */
            if (!exist && url.startsWith('browser/')) return reject(new Error(`not found ${url}`))
            if (!exist && url.startsWith('localhost/')) return reject(new Error(`not found ${url}`))

            if (exist) {
              return provider.get(url, (error, content) => {
                if (error) return reject(error)
                resolve(content)
              })
            }

            // try to resolve localhost modules (aka truffle imports) - e.g from the node_modules folder
            this.call('fileManager', 'getProviderByName', 'localhost').then((localhostProvider) => {
              if (localhostProvider.isConnected()) {
                var splitted = /([^/]+)\/(.*)$/g.exec(url)
                return async.tryEach([
                  (cb) => { this.resolveAndSave('localhost/installed_contracts/' + url, null).then((result) => cb(null, result)).catch((error) => cb(error.message)) },
                  // eslint-disable-next-line standard/no-callback-literal
                  (cb) => { if (!splitted) { cb('URL not parseable: ' + url) } else { this.resolveAndSave('localhost/installed_contracts/' + splitted[1] + '/contracts/' + splitted[2], null).then((result) => cb(null, result)).catch((error) => cb(error.message)) } },
                  (cb) => { this.resolveAndSave('localhost/node_modules/' + url, null).then((result) => cb(null, result)).catch((error) => cb(error.message)) },
                  // eslint-disable-next-line standard/no-callback-literal
                  (cb) => { if (!splitted) { cb('URL not parseable: ' + url) } else { this.resolveAndSave('localhost/node_modules/' + splitted[1] + '/contracts/' + splitted[2], null).then((result) => cb(null, result)).catch((error) => cb(error.message)) } }],
                (error, result) => {
                  if (error) {
                    return this.importExternal(url, targetPath, (error, content) => {
                      if (error) return reject(error)
                      resolve(content)
                    })
                  }
                  resolve(result)
                })
              }
              this.importExternal(url, targetPath, (error, content) => {
                if (error) return reject(error)
                resolve(content)
              })
            })
          }).catch(error => {
            return reject(error)
          })
        }
      }).catch(() => {
        // fallback to just resolving the file, it won't be saved in file manager
        return this.importExternal(url, targetPath, (error, content) => {
          if (error) return reject(error)
          resolve(content)
        })
      })
    })
  }
}
