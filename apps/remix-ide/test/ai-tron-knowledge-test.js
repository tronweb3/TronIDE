/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var test = require('tape')
var knowledgePromise = import('../../../libs/remix-code-reader/src/services/aiTronKnowledge.js')
var protocolPromise = import('../../../libs/remix-code-reader/src/services/aiTaskProtocol.js')
var toolsPromise = import('../../../libs/remix-code-reader/src/services/toolsApi.js')

test('built-in TRON knowledge pack is versioned, declarative, and complete', async function (t) {
  var knowledge = await knowledgePromise
  var pack = knowledge.BUILTIN_TRON_KNOWLEDGE_PACK
  var validation = knowledge.validateTronKnowledgePack(pack)
  var ids = pack.skills.concat(pack.checklists).map(function (item) { return item.id })

  t.equal(pack.schema, knowledge.TRON_KNOWLEDGE_SCHEMA_ID, 'pack uses the published schema id')
  t.equal(pack.schemaVersion, 1, 'pack schema is versioned')
  t.equal(pack.skills.length, 4, 'four P0 TRON Skills are built in')
  t.equal(pack.checklists.length, 2, 'two P0 audit/resource Checklists are built in')
  t.equal(new Set(ids).size, 6, 'knowledge ids are unique')
  t.ok(ids.includes('trc20-code-test'), 'TRC20 code/test Skill is present')
  t.ok(ids.includes('tronlink-nile-deploy'), 'TronLink/Nile Skill is present')
  t.ok(ids.includes('tronscan-verification'), 'TronScan verification Skill is present')
  t.ok(ids.includes('recorder-tronbox-handoff'), 'Recorder/TronBox handoff Skill is present')
  t.ok(ids.includes('tron-tvm-security-audit'), 'TRON/TVM security Checklist is present')
  t.ok(ids.includes('energy-bandwidth-optimization'), 'Energy/Bandwidth Checklist is present')
  t.ok(validation.ok, 'the built-in fixture passes the runtime schema validator')
  t.ok(Object.isFrozen(pack) && Object.isFrozen(pack.skills[0].steps), 'built-in knowledge is immutable at runtime')
  t.end()
})

test('TRON knowledge never replaces canonical approval and retry policy', async function (t) {
  var knowledge = await knowledgePromise
  var protocol = await protocolPromise
  var pack = knowledge.BUILTIN_TRON_KNOWLEDGE_PACK
  var sideEffects = []

  pack.skills.forEach(function (item) {
    knowledge.knowledgeToolPolicyEvidence(item.id).forEach(function (entry) {
      if (entry.riskLevel !== protocol.AI_RISK_LEVEL.READ_ONLY) sideEffects.push(entry)
    })
  })
  t.ok(sideEffects.length > 0, 'Skills may declare useful local, remote, and chain side effects')
  t.ok(sideEffects.every(function (entry) { return entry.requiresApproval === true }), 'every declared side effect still requires canonical approval')
  t.ok(sideEffects.every(function (entry) { return entry.automaticRetry === false }), 'no declared side effect can opt into automatic retry')

  pack.checklists.forEach(function (item) {
    var policies = knowledge.knowledgeToolPolicyEvidence(item.id)
    t.ok(policies.every(function (entry) { return entry.riskLevel === protocol.AI_RISK_LEVEL.READ_ONLY }), `${item.id} remains read-only`)
  })
  t.end()
})

test('TRON knowledge validator rejects executable, unknown-tool, and future-version packs', async function (t) {
  var knowledge = await knowledgePromise
  var base = JSON.parse(JSON.stringify(knowledge.BUILTIN_TRON_KNOWLEDGE_PACK))
  var executable = JSON.parse(JSON.stringify(base))
  var unknownTool = JSON.parse(JSON.stringify(base))
  var future = JSON.parse(JSON.stringify(base))
  var extra = JSON.parse(JSON.stringify(base))
  var writableChecklist = JSON.parse(JSON.stringify(base))
  executable.skills[0].script = 'bypass approval'
  unknownTool.skills[0].allowedTools.push('unsafe_remote_exec')
  future.schemaVersion = 2
  extra.remoteRegistry = 'https://untrusted.example/skills.json'
  writableChecklist.checklists[0].allowedTools.push('edit_file')

  t.notOk(knowledge.validateTronKnowledgePack(executable).ok, 'executable Skill fields fail closed')
  t.ok(knowledge.validateTronKnowledgePack(executable).errors.some(function (error) { return /declarative/.test(error) }), 'executable rejection explains the declarative boundary')
  t.notOk(knowledge.validateTronKnowledgePack(unknownTool).ok, 'unknown tools cannot enter a Skill allowlist')
  t.equal(knowledge.validateTronKnowledgePack(future).code, 'UNSUPPORTED_VERSION', 'future schemas degrade as incompatible')
  t.notOk(knowledge.validateTronKnowledgePack(extra).ok, 'unknown top-level remote registries are rejected')
  t.notOk(knowledge.validateTronKnowledgePack(writableChecklist).ok, 'a Checklist cannot smuggle in a side-effect tool')
  t.end()
})

test('trusted workspace knowledge loader degrades safely without affecting built-ins', async function (t) {
  var knowledge = await knowledgePromise
  var content = JSON.stringify(knowledge.BUILTIN_TRON_KNOWLEDGE_PACK)
  var readCount = 0
  var loaded = await knowledge.loadTrustedWorkspaceTronKnowledgePack({
    path: '.tronide/ai/team-pack.json',
    readFile: async function () { readCount++; return content }
  })
  var untrusted = await knowledge.loadTrustedWorkspaceTronKnowledgePack({
    path: '../team-pack.json',
    readFile: async function () { readCount++; return content }
  })
  var corrupt = await knowledge.loadTrustedWorkspaceTronKnowledgePack({
    path: '.tronide/ai/corrupt.json',
    readFile: async function () { return '{broken' }
  })
  var missing = await knowledge.loadTrustedWorkspaceTronKnowledgePack({
    path: '.tronide/ai/missing.json',
    readFile: async function () { throw new Error('not found') }
  })

  t.ok(loaded.ok, 'valid JSON loads only from the trusted workspace directory')
  t.equal(loaded.pack.skills.length, 4, 'loaded workspace pack is validated before use')
  t.equal(untrusted.code, 'UNTRUSTED_PATH', 'path traversal is rejected before reading')
  t.equal(readCount, 1, 'untrusted paths never reach the workspace reader')
  t.equal(corrupt.code, 'CORRUPT_PACK', 'corrupt JSON becomes a non-throwing unavailable result')
  t.equal(missing.code, 'PACK_MISSING', 'missing files become a non-throwing unavailable result')
  t.equal(knowledge.BUILTIN_TRON_KNOWLEDGE_PACK.skills.length, 4, 'workspace failure does not disable built-in knowledge or ordinary chat')
  t.end()
})

test('TRON checklist reports require traceable evidence and redact exports', async function (t) {
  var knowledge = await knowledgePromise
  var secret = ['sk', 'syntheticcredential12345'].join('-')
  var report = knowledge.createTronChecklistReport({
    checklistId: 'tron-tvm-security-audit',
    generatedAt: 1785140000000,
    findings: [
      {
        findingId: 'auth-1',
        ruleId: 'SEC-AUTH',
        status: 'finding',
        severity: 'high',
        location: 'contracts/Vault.sol:42',
        evidence: [{ tool: 'run_static_analysis', ref: 'analysis/SEC-AUTH-1', summary: `Authorization: Bearer ${secret}` }],
        remediation: 'Require the expected admin and add a negative authorization test.'
      },
      {
        findingId: 'precision-1',
        ruleId: 'SEC-PRECISION',
        status: 'passed',
        severity: 'medium',
        location: 'contracts/Vault.sol:80',
        evidence: []
      },
      {
        findingId: 'unknown-tool',
        ruleId: 'SEC-CALL',
        status: 'passed',
        evidence: [{ tool: 'remote_guess', ref: 'guess', summary: 'looks safe' }]
      }
    ]
  })
  var json = knowledge.exportTronChecklistReport(report, 'json')
  var markdown = knowledge.exportTronChecklistReport(report, 'markdown')
  var forged = JSON.parse(JSON.stringify(report))
  forged.findings[0].evidence[0].summary = `token=${secret}`
  var forgedJson = knowledge.exportTronChecklistReport(forged, 'json')

  t.equal(report.findings[0].status, 'finding', 'traceable evidence preserves a real finding')
  t.equal(report.findings[1].status, 'needs_review', 'a claimed pass without evidence is downgraded')
  t.equal(report.findings[2].status, 'needs_review', 'evidence from a non-allowlisted tool is rejected')
  t.equal(report.counts.finding, 1, 'report counts structured findings')
  t.equal(report.counts.needs_review, 2, 'report counts manual-review gaps')
  t.notOk(json.includes(secret), 'JSON export removes credentials from evidence summaries')
  t.notOk(markdown.includes(secret), 'Markdown export removes credentials from evidence summaries')
  t.notOk(forgedJson.includes(secret), 'export re-normalizes caller-supplied report objects before serialization')
  t.ok(markdown.includes('contracts/Vault.sol:42'), 'Markdown retains the source location')
  t.ok(markdown.includes('run_static_analysis'), 'Markdown retains the evidence-producing tool')
  t.ok(Object.isFrozen(report.findings), 'report output is immutable')
  t.end()
})

test('both vendor protocols receive the same declarative TRON knowledge prompt', async function (t) {
  var knowledge = await knowledgePromise
  var tools = await toolsPromise
  var anthropicRequest
  var openAIRequest
  await tools.anthropicChatWithTools({
    apiKey: 'test',
    model: 'mock',
    userContent: 'plan a Nile deploy',
    anthropicClient: { messages: { create: async function (request) { anthropicRequest = request; return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'planned' }] } } } },
    executeTool: async function () {}
  })
  await tools.openAICompatibleChatWithTools({
    apiKey: 'test',
    model: 'mock',
    aiModelVendor: 'OpenAI',
    userContent: 'plan a Nile deploy',
    openAIClient: { chat: { completions: { create: async function (request) { openAIRequest = request; return { choices: [{ message: { content: 'planned' } }] } } } } },
    executeTool: async function () {}
  })
  var anthropicSystem = anthropicRequest.system
  var openAISystem = openAIRequest.messages.find(function (message) { return message.role === 'system' }).content

  t.ok(anthropicSystem.includes('tronlink-nile-deploy'), 'Anthropic sees the Nile Skill')
  t.ok(openAISystem.includes('tronlink-nile-deploy'), 'OpenAI-compatible sees the same Nile Skill')
  t.ok(anthropicSystem.includes('step 1 prepare') && openAISystem.includes('step 1 prepare'), 'both protocols receive the ordered Skill recipe')
  t.ok(anthropicSystem.includes('rule SEC-AUTH (high)') && openAISystem.includes('rule SEC-AUTH (high)'), 'both protocols receive evidence rules and severity')
  t.ok(anthropicSystem.includes('needs_review') && openAISystem.includes('needs_review'), 'both protocols enforce evidence-aware checklist status')
  t.ok(anthropicSystem.includes('explicit workspace contract path') && openAISystem.includes('explicit workspace contract path'), 'both protocols accept an explicitly named contract without requiring it to be open')
  t.ok(anthropicSystem.includes('does NOT prove TronLink is disconnected') && openAISystem.includes('does NOT prove TronLink is disconnected'), 'both protocols distinguish the active Deploy & Run provider from TronLink state')
  t.ok(anthropicSystem.includes('Do not ask the user to unlock, reconnect, or change TronLink networks') && openAISystem.includes('Do not ask the user to unlock, reconnect, or change TronLink networks'), 'both protocols delay wallet troubleshooting until injected evidence exists')
  t.ok(anthropicSystem.includes('never assume 18 decimals') && openAISystem.includes('never assume 18 decimals'), 'both protocols require token precision evidence before converting raw units')
  t.ok(anthropicSystem.includes('Policy Gate') && openAISystem.includes('Policy Gate'), 'both protocols preserve the canonical policy boundary')
  t.equal(knowledge.buildTronKnowledgePrompt({ schemaVersion: 99 }), '', 'invalid knowledge fails closed without breaking ordinary chat')
  t.end()
})
