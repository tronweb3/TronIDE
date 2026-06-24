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

// Extract a bare gist id from a raw param that may be a full gist URL or a plain
// id. Mirrors gist-handler's own `getGistId` (16-40 hex chars) so a normalized id
// can be compared like-for-like against `provider.lastLoadedGistId` (the bare id
// gist-handler records after a successful load).
//
// Three-way return — callers rely on the '' vs null distinction:
//   ''   -> no gist param at all (absent/empty)            => do nothing
//   null -> a gist param was given but holds no valid id   => warn (invalid id)
//   id   -> the matched bare gist id
function normalizeGistId (raw) {
  if (raw === undefined || raw === null || raw === '') return ''
  const match = /[0-9A-Fa-f]{16,40}/.exec(String(raw))
  return match ? match[0] : null
}

module.exports = normalizeGistId
