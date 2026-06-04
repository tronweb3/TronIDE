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

// Extend fs
import path from 'path'
const fs: any = require('fs')

// https://github.com/mikeal/node-utils/blob/master/file/lib/main.js
fs.walkSync = function (start: string, callback) {
  fs.readdirSync(start).forEach((name: string) => {
    if (name === 'node_modules') {
      return // hack
    }
    const abspath = path.join(start, name)
    if (fs.statSync(abspath).isDirectory()) {
      fs.walkSync(abspath, callback)
    } else {
      callback(abspath)
    }
  })
}

export default fs
