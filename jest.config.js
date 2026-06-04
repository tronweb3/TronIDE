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

module.exports = {
  testMatch: ['**/+(*.)+(spec|test).+(ts|js)?(x)'],
  transform: {
    '^.+\\.(ts|js|html)$': 'ts-jest'
  },
  resolver: '@nrwl/jest/plugins/resolver',
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageReporters: ['html'],
  moduleNameMapper:{
    "@remix-project/remix-analyzer": "<rootDir>/../../build/libs/remix-analyzer/src/index.js",
    "@remix-project/remix-astwalker": "<rootDir>/../../build/libs/remix-astwalker/src/index.js",
    "@remix-project/remix-debug": "<rootDir>/../../build/libs/remix-debug/src/index.js",
    "@remix-project/remix-lib": "<rootDir>/../../build/libs/remix-lib/src/index.js",
    "@remix-project/remix-simulator": "<rootDir>/../../build/libs/remix-simulator/src/index.js",
    "@remix-project/remix-solidity": "<rootDir>/../../build/libs/remix-solidity/src/index.js",
    "@remix-project/remix-tests": "<rootDir>/../../build/libs/remix-tests/src/index.js",
    "@remix-project/remix-url-resolver": 
      "<rootDir>/../../build/libs/remix-url-resolver/src/index.js"
    ,
    "@remix-project/remixd": "<rootDir>/../../build/libs/remixd/src/index.js"
  }
};
