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

require('./compiler-test')
require('./gist-handler-test')
require('./local-plugin-test')
require('./secure-iframe-plugin-test')
require('./playwright-config-test')
require('./query-params-test')
require('./search/workspace-search-test')
require('./timer-listener-teardown-test')
// Internal remediation suites are stripped from the public (open-source)
// build; load any that ship with this checkout.
require('fs')
  .readdirSync(__dirname)
  .filter((f) => /^audit-.*-remediation-test\.js$/.test(f))
  .sort()
  .forEach((f) => require(`./${f}`))

require('./remix-220-home-parity-test')
