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

const workspaceJestConfig = require('../../jest.config')

module.exports = {
    preset: '../../jest.config.js',
    verbose: true,
    silent: false, // Silent console messages, specially the 'remix-simulator' ones
    transform: {
      '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
      // @tvmjs/util's production CJS build requires @noble v2, which is
      // ESM-only. Jest 28's CJS runtime cannot execute it without converting
      // the module syntax first; keep that conversion narrowly scoped below.
      '^.+\\.jsx?$': ['babel-jest', {
        configFile: false,
        presets: [['@babel/preset-env', { targets: { node: 'current' } }]]
      }]
    },
    transformIgnorePatterns: [
      // pnpm resolves packages through node_modules/.pnpm. Both expressions
      // are needed: one for the real pnpm path and one for regular/symlinked
      // node_modules paths. Everything except the two ESM-only packages stays
      // ignored, so Jest does not transpile the whole dependency tree.
      'node_modules/.pnpm/(?!(?:@noble\\+curves|@noble\\+hashes)@)',
      'node_modules/(?!\\.pnpm|@noble/(?:curves|hashes))',
      '\\.pnp\\.[^\\/]+$'
    ],
    moduleNameMapper: {
      ...workspaceJestConfig.moduleNameMapper,
      // Nx's TypeScript-aware resolver prefers @tvmjs/util's source export.
      // Unit tests should exercise the same CommonJS entry used by the built
      // remix libraries; require.resolve honors the package's "require" export.
      '^@tvmjs/util$': require.resolve('@tvmjs/util')
    },
    rootDir: "./",
    testTimeout: 40000,
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'html', 'json'],
    // Coverage
    collectCoverage: true,
    coverageReporters: ['text', 'text-summary'],
    collectCoverageFrom: [
      "**/*.ts",
      "!**/sol/**",
      "!src/types.ts",
      "!src/logger.ts"
    ],
    coverageDirectory: '../../coverage/libs/remix-tests'
  };
