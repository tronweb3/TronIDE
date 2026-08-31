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

// pnpm links workspace packages to their TypeScript source directories. The
// remix-lib package.json intentionally points at the JavaScript emitted for a
// published package, which does not exist in a fresh source checkout. Resolve
// that one workspace import to its TS entry for Node-only tests instead of
// relying on stale in-place build artifacts from a developer machine.
require('ts-node/register/transpile-only')
var Module = require('module')
var path = require('path')
var originalResolveFilename = Module._resolveFilename
var remixLibSourceEntry = path.resolve(__dirname, '../../../libs/remix-lib/src/index.ts')
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === '@remix-project/remix-lib') return remixLibSourceEntry
  return originalResolveFilename.call(this, request, parent, isMain, options)
}

require('./compiler-test')
require('./compiler-source-retry-test')
require('./compiler-worker-csp-test')
require('./gist-handler-test')
require('./helper-test')
require('./local-plugin-test')
require('./secure-iframe-plugin-test')
require('./playwright-config-test')
require('./webpack-config-security-test')
require('./production-artifact-hygiene-test')
require('./build-pipeline-test')
require('./initial-bundle-boundaries-test')
require('./solidity-unit-workspace-lifecycle-test')
require('./ai-run-tests-timeout-test')
require('./query-params-test')
require('./url-base64-test')
require('./uups-proxy-test')
require('./normalize-gist-id-test')
require('./url-param-security-test')
require('./search/workspace-search-test')
require('./timer-listener-teardown-test')
require('./terminal-enter-test')
require('./ui-review-regression-test')
require('./remix-engine-timeout-test')
require('./ai-task-protocol-test')
require('./ai-task-runtime-test')
require('./ai-tool-execution-result-test')
require('./ai-task-storage-test')
require('./ai-task-metrics-test')
require('./bank-of-ai-provider-test')
require('./ai-task-diagnostics-test')
require('./ai-transaction-intelligence-test')
require('./ai-write-lock-test')
require('./ai-tool-protocol-adapters-test')
require('./ai-approval-integrity-test')
require('./ai-tron-knowledge-test')
require('./ai-task-entry-test')
require('./home-action-gate-test')
require('./home-review-regression-test')
require('./ai-golden-workflows-test')
require('./tronbox-handoff-test')
require('./recorder-ui-tronbox-test')
require('./recorder-safety-test')
require('./release-ci-playwright-test')
require('./release-notes-v233-test')
require('./audit-20260520-remediation-test')
require('./audit-20260527-remediation-test')
require('./audit-20260602-remediation-test')
require('./audit-20260622-remediation-test')
require('./audit-20260721-remediation-test')
require('./audit-20260811-remediation-test')
require('./audit-20260811-less-integration-test')
require('./tronide-138-140-regression-test')
require('./plugin-permission-hardening-test')
require('./permission-authorization-regression-test')
require('./permission-target-gates-test')
require('./app-permission-wiring-test')
require('./plugin-profile-clone-test')
require('./plugin-event-permission-test')
require('./transaction-network-security-test')
require('./blockchain-commit-network-guard-test')
require('./udapp-ai-network-security-test')
require('./replay-network-provenance-test')
require('./remix-220-home-parity-test')
require('./solidity-uml-test')
