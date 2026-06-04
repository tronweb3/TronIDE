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

import Web3 from 'web3'
const version = require('../../package.json').version

export function methods () {
  return {
    web3_clientVersion: web3_clientVersion.bind(this),
    eth_protocolVersion: eth_protocolVersion.bind(this),
    eth_syncing: eth_syncing.bind(this),
    eth_mining: eth_mining.bind(this),
    eth_hashrate: eth_hashrate.bind(this),
    web3_sha3: web3_sha3.bind(this),
    eth_getCompilers: eth_getCompilers.bind(this),
    eth_compileSolidity: eth_compileSolidity.bind(this),
    eth_compileLLL: eth_compileLLL.bind(this),
    eth_compileSerpent: eth_compileSerpent.bind(this)
  }
}

export function web3_clientVersion (payload, cb) {
  cb(null, 'Remix Simulator/' + version)
}

export function eth_protocolVersion (payload, cb) {
  cb(null, '0x3f')
}

export function eth_syncing (payload, cb) {
  cb(null, false)
}

export function eth_mining (payload, cb) {
  // TODO: should depend on the state
  cb(null, false)
}

export function eth_hashrate (payload, cb) {
  cb(null, '0x0')
}

export function web3_sha3 (payload, cb) {
  const str: string = payload.params[0]
  cb(null, Web3.utils.sha3(str))
}

export function eth_getCompilers (payload, cb) {
  cb(null, [])
}

export function eth_compileSolidity (payload, cb) {
  cb(null, 'unsupported')
}

export function eth_compileLLL (payload, cb) {
  cb(null, 'unsupported')
}

export function eth_compileSerpent (payload, cb) {
  cb(null, 'unsupported')
}
