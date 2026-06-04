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

// Allowing window to be overriden for testing
function QueryParams (_window) {
  if (_window === undefined) _window = window

  this.get = function () {
    var qs = _window.location.hash.substr(1)

    if (_window.location.search.length > 0) {
      // use legacy query params instead of hash
      _window.location.hash = _window.location.search.substr(1)
      _window.location.search = ''
    }

    var params = {}
    var parts = qs.split('&')
    for (var x in parts) {
      var keyValue = parts[x].split('=')
      if (keyValue[0] !== '') {
        params[keyValue[0]] = keyValue[1]
      }
    }
    return params
  }

  this.update = function (params) {
    var currentParams = this.get()
    var keys = Object.keys(params)
    for (var x in keys) {
      currentParams[keys[x]] = params[keys[x]]
    }
    var queryString = '#'
    var updatedKeys = Object.keys(currentParams)
    for (var y in updatedKeys) {
      queryString += updatedKeys[y] + '=' + currentParams[updatedKeys[y]] + '&'
    }
    _window.location.hash = queryString.slice(0, -1)
  }
}

module.exports = QueryParams
