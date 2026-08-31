/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

// Required release validation intentionally covers only the P0/P1 contracts
// that can stop a safe v2.3.3 release. Broader legacy and library regression
// remains available in the manual/scheduled full_e2e job.
require('./url-param-security-test')
require('./url-base64-test')
require('./uups-proxy-test')
require('./secure-iframe-plugin-test')
require('./ai-task-protocol-test')
require('./ai-task-runtime-test')
require('./ai-task-storage-test')
require('./ai-task-metrics-test')
require('./bank-of-ai-provider-test')
require('./ai-model-catalog-test')
require('./ai-task-diagnostics-test')
require('./ai-transaction-intelligence-test')
require('./ai-write-lock-test')
require('./ai-tool-protocol-adapters-test')
require('./ai-approval-integrity-test')
require('./ai-tron-knowledge-test')
require('./ai-task-entry-test')
require('./home-action-gate-test')
require('./ai-golden-workflows-test')
require('./tronbox-handoff-test')
require('./recorder-ui-tronbox-test')
require('./recorder-safety-test')
require('./release-ci-playwright-test')
require('./release-notes-v233-test')
require('./audit-20260721-remediation-test')
require('./audit-20260811-remediation-test')
require('./audit-20260817-remediation-test')
require('./production-artifact-hygiene-test')
require('./build-pipeline-test')
require('./github-app-integration-test')
require('./compiler-worker-csp-test')
require('./initial-bundle-boundaries-test')
require('./initial-loading-light-theme-test')
require('./ai-run-tests-timeout-test')
require('./workspace-storage-durable-mirror-test')
require('./workspace-storage-migration-test')
require('./workspace-storage-bootstrap-test')
require('./workspace-storage-write-barrier-test')
