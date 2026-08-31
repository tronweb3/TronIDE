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

const { decodeUrlParameter } = require('./url-param-security')

// Extract a bare gist id from a raw param that may be a canonical gist.github.com
// URL or a plain id. Do not search for an id-shaped substring: doing so lets
// attacker-controlled prefixes/suffixes and query values pass validation.
//
// Three-way return — callers rely on the '' vs null distinction:
//   ''   -> no gist param at all (absent/empty)            => do nothing
//   null -> a gist param was given but holds no valid id   => warn (invalid id)
//   id   -> the matched bare gist id
function normalizeGistId (raw) {
  if (raw === undefined || raw === null || raw === '') return ''
  const decoded = decodeUrlParameter(String(raw), 4096)
  if (decoded === null) return null
  const value = decoded.trim()
  const idPattern = /^[0-9A-Fa-f]{20,40}$/
  if (idPattern.test(value)) return value

  let parsed
  try { parsed = new URL(value) } catch (e) { return null }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'gist.github.com' ||
      parsed.username || parsed.password || parsed.port || parsed.search) return null
  const parts = parsed.pathname.split('/').filter(Boolean)
  if (parts.length !== 1 && parts.length !== 2) return null
  const id = parts[parts.length - 1]
  return idPattern.test(id) ? id : null
}

module.exports = normalizeGistId
