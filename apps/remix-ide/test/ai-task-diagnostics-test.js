/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var test = require('tape')
var diagnosticsPromise = import('../../../libs/remix-code-reader/src/services/aiTaskDiagnostics.js')

var secretKey = 'sk-synthetic-secret-value-123456'
var githubToken = 'ghp_SyntheticDiagnosticToken123456789'
var privateKey = 'a'.repeat(64)
var transactionHash = 'b'.repeat(64)
var source = 'contract DiagnosticSecret { string constant KEY = "never-export-this-source"; }'

function recordFixture () {
  return {
    schemaVersion: 1,
    task: {
      taskId: 'task/synthetic diagnostic',
      goal: `Please compile ${source} with apiKey=${secretKey}`,
      source: 'chat',
      workspace: 'diagnostic-workspace',
      branch: 'release/v2.3.3',
      status: 'failed',
      createdAt: 1785139200000,
      updatedAt: 1785139202500
    },
    steps: [{
      stepId: 'compile-1',
      toolName: 'compile_contract',
      status: 'failed',
      riskLevel: 'R0',
      sideEffect: 'none',
      startedAt: 1785139200100,
      updatedAt: 1785139202100,
      input: { source, constructorArgs: ['private-constructor-argument'] },
      result: {
        ok: false,
        code: 'NETWORK_UNAVAILABLE',
        summary: `Raw failure included ${secretKey} and ${source}`,
        error: `Authorization: Bearer ${githubToken}`,
        userAction: `Retry with private_key=${privateKey}`,
        retryable: true,
        uncertainty: 'Provider response not verified',
        artifacts: [{
          type: 'transaction',
          label: `Nile transaction api_key=${secretKey}`,
          ref: `https://user:pass@nile.tronscan.org/#/transaction/${transactionHash}?token=${githubToken}&context=${encodeURIComponent(secretKey)}`
        }]
      }
    }],
    artifacts: [{
      type: 'transaction',
      label: 'Nile transaction',
      ref: `https://nile.tronscan.org/#/transaction/${transactionHash}?authorization=Bearer-${githubToken}`
    }, {
      type: 'transaction',
      label: 'Raw transaction identifier',
      ref: transactionHash
    }, {
      type: 'contract',
      label: 'Deployed contract',
      ref: `T${'A'.repeat(33)}`
    }, {
      type: 'file',
      label: 'Ambiguous value',
      ref: privateKey
    }],
    workflowResult: {
      workflowId: 'wf-code-test',
      status: 'incomplete',
      completion: { passed: 1, required: 5 },
      summary: `Do not export ${source}`
    },
    events: [{
      type: 'step.failed',
      at: 1785139202100,
      stepId: 'compile-1',
      toolName: 'compile_contract',
      status: 'failed',
      result: {
        ok: false,
        code: 'NETWORK_UNAVAILABLE',
        summary: `Provider leaked ${secretKey}`,
        error: source
      },
      rawProviderPayload: { apiKey: secretKey, source },
      contractArguments: ['private-constructor-argument'],
      errorCode: 'MODEL_DID_NOT_CALL_TOOL'
    }]
  }
}

function assertSensitiveTextAbsent (t, text, label) {
  t.notOk(text.includes(secretKey), `${label} excludes API keys`)
  t.notOk(text.includes(githubToken), `${label} excludes access tokens`)
  t.notOk(text.includes(privateKey), `${label} excludes private keys`)
  t.notOk(text.includes(source), `${label} excludes source code`)
  t.notOk(text.includes('private-constructor-argument'), `${label} excludes contract arguments`)
  t.notOk(text.includes('Raw failure included'), `${label} excludes raw result summaries`)
  t.notOk(text.includes('Provider leaked'), `${label} excludes raw event summaries`)
}

test('AI task diagnostic exposes bounded issue fields and excludes sensitive data by default', async function (t) {
  var diagnostics = await diagnosticsPromise
  var sourceRecord = recordFixture()
  var snapshot = JSON.stringify(sourceRecord)
  var report = diagnostics.createAITaskDiagnostic(sourceRecord, {
    appVersion: '2.3.3',
    generatedAt: 1785139300000
  })
  var json = diagnostics.serializeAITaskDiagnostic(report, 'json')

  t.equal(report.schemaVersion, 1, 'diagnostic schema is versioned')
  t.equal(report.appVersion, '2.3.3', 'app version is included')
  t.equal(report.task.status, 'failed', 'task status is included')
  t.equal(report.task.durationMs, 2500, 'task duration is derived')
  t.equal(report.steps[0].durationMs, 2000, 'step duration is derived')
  t.equal(report.steps[0].result.code, 'NETWORK_UNAVAILABLE', 'stable error code is included')
  t.deepEqual(report.errorCodes, ['NETWORK_UNAVAILABLE', 'MODEL_DID_NOT_CALL_TOOL'], 'tool and task error codes are summarized')
  t.equal(report.environment.workspace, 'diagnostic-workspace', 'workspace summary is included')
  t.equal(report.environment.branch, 'release/v2.3.3', 'branch summary is included')
  t.notOk(Object.prototype.hasOwnProperty.call(report, 'events'), 'event log is absent without explicit opt-in')
  t.equal(report.privacy.eventLogIncluded, false, 'privacy metadata records the default')
  t.ok(json.includes(`/transaction/${transactionHash}`), 'public transaction hash is preserved in an artifact URL')
  t.equal(report.artifacts[0].label, 'Transaction artifact', 'untrusted artifact labels are replaced with derived text')
  t.equal(report.artifacts[1].ref, transactionHash, 'a transaction artifact preserves its typed public hash')
  t.equal(report.artifacts[2].ref, `T${'A'.repeat(33)}`, 'a contract artifact preserves its typed public address')
  t.equal(report.artifacts[3].ref, '[32-byte value redacted]', 'an ambiguous 32-byte value still fails closed')
  t.notOk(json.includes('user:pass@'), 'URL credentials are removed')
  t.ok(json.includes('%5Bredacted%5D') || json.includes('[redacted]'), 'secret URL parameters are visibly redacted')
  assertSensitiveTextAbsent(t, json, 'JSON diagnostic')
  t.equal(JSON.stringify(sourceRecord), snapshot, 'report generation does not mutate local task history')

  sourceRecord.steps[0].result.code = source
  var malformedCodeReport = diagnostics.createAITaskDiagnostic(sourceRecord)
  t.equal(malformedCodeReport.steps[0].result.code, 'INTERNAL_ERROR', 'non-identifier result codes fail closed')
  t.notOk(JSON.stringify(malformedCodeReport).includes(source), 'a malformed result code cannot smuggle source into the report')
  t.end()
})

test('explicit event-log export is whitelisted and both formats remain privacy-safe', async function (t) {
  var diagnostics = await diagnosticsPromise
  var sourceRecord = recordFixture()
  sourceRecord.events = Array.from({ length: 104 }, function (_, index) {
    return { type: `task.event.${index}`, at: 1785139201000 + index, status: 'running' }
  }).concat(sourceRecord.events)
  var report = diagnostics.createAITaskDiagnostic(sourceRecord, {
    appVersion: '2.3.3',
    generatedAt: 1785139300000,
    includeEventLog: true
  })
  var json = diagnostics.serializeAITaskDiagnostic(report, 'json')
  var markdown = diagnostics.serializeAITaskDiagnostic(report, 'markdown')

  t.equal(report.events.length, 100, 'explicit opt-in includes at most the latest 100 events')
  t.deepEqual(report.eventLog, { totalEvents: 105, exportedEvents: 100, maxEvents: 100, truncated: true }, 'event-log metadata makes truncation explicit')
  t.equal(report.events[0].type, 'task.event.5', 'oldest events are discarded first')
  t.deepEqual(Object.keys(report.events[0]).sort(), ['approved', 'at', 'errorCode', 'outcome', 'resultCode', 'riskLevel', 'sideEffect', 'status', 'stepId', 'toolName', 'type'].sort(), 'events use a fixed safe-field allowlist')
  t.equal(report.events[99].resultCode, 'NETWORK_UNAVAILABLE', 'events retain the stable result code')
  t.ok(markdown.includes('# TronIDE AI Task Diagnostic'), 'Markdown is ready for an issue attachment')
  t.ok(markdown.includes('## Redacted event log'), 'Markdown labels the opt-in log clearly')
  t.ok(markdown.includes('Latest 100 of 105 events (truncated).'), 'Markdown discloses the event-log bound')
  t.ok(markdown.includes('compile_contract'), 'Markdown contains the execution step')
  t.ok(markdown.includes('NETWORK_UNAVAILABLE'), 'Markdown contains the error code')
  t.ok(markdown.includes(`/transaction/${transactionHash}`), 'Markdown keeps the public artifact reference')
  assertSensitiveTextAbsent(t, json, 'opt-in JSON diagnostic')
  assertSensitiveTextAbsent(t, markdown, 'Markdown diagnostic')
  t.equal(diagnostics.aiTaskDiagnosticFilename(report, 'json'), 'tronide-ai-task-task-synthetic-diagnostic-20260727.json', 'JSON filename is safe and deterministic')
  t.equal(diagnostics.aiTaskDiagnosticFilename(report, 'markdown'), 'tronide-ai-task-task-synthetic-diagnostic-20260727.md', 'Markdown filename uses the md extension')
  t.end()
})

test('AI task diagnostic rejects invalid inputs and output formats', async function (t) {
  var diagnostics = await diagnosticsPromise
  t.throws(function () { diagnostics.createAITaskDiagnostic(null) }, /requires a task record/, 'missing task record is rejected')
  t.throws(function () { diagnostics.serializeAITaskDiagnostic({}, 'json') }, /Invalid AI task diagnostic/, 'foreign report is rejected')
  var report = diagnostics.createAITaskDiagnostic(recordFixture())
  var nonBooleanOptIn = diagnostics.createAITaskDiagnostic(recordFixture(), { includeEventLog: 'true' })
  t.notOk(Object.prototype.hasOwnProperty.call(nonBooleanOptIn, 'events'), 'only an explicit boolean opt-in can include events')
  t.throws(function () { diagnostics.serializeAITaskDiagnostic(report, 'html') }, /Unsupported AI task diagnostic format/, 'unsupported format is rejected')
  t.end()
})
