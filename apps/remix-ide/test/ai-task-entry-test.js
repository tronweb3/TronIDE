/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var fs = require('fs')
var path = require('path')
var test = require('tape')
var root = path.resolve(__dirname, '../../..')
var entriesPromise = import('../../../libs/remix-code-reader/src/services/aiTaskEntries.js')
var knowledgePromise = import('../../../libs/remix-code-reader/src/services/aiTronKnowledge.js')
var runtimePromise = import('../../../libs/remix-code-reader/src/services/aiTaskRuntime.js')

test('AI task entry registry exposes exactly four Home and five Deploy choices', async function (t) {
  var entries = await entriesPromise
  var knowledge = await knowledgePromise
  var all = entries.HOME_AI_TASK_ENTRIES.concat(entries.DEPLOYMENT_NEXT_STEP_ENTRIES)
  var ids = all.map(function (entry) { return entry.id })
  var knowledgeIds = new Set(knowledge.BUILTIN_TRON_KNOWLEDGE_PACK.skills.concat(knowledge.BUILTIN_TRON_KNOWLEDGE_PACK.checklists).map(function (item) { return item.id }))

  t.equal(entries.AI_TASK_ENTRY_SCHEMA_VERSION, 1, 'entry protocol is versioned')
  t.equal(entries.HOME_AI_TASK_ENTRIES.length, 4, 'Home has the four planned task cards')
  t.equal(entries.DEPLOYMENT_NEXT_STEP_ENTRIES.length, 5, 'Deploy success has five explicit next steps')
  t.equal(new Set(ids).size, 9, 'entry ids are unique')
  t.ok(all.every(function (entry) { return knowledgeIds.has(entry.skillId) }), 'every entry recommends a built-in Skill')
  t.ok(all.every(function (entry) { return entry.checklistIds.every(function (id) { return knowledgeIds.has(id) }) }), 'every recommended Checklist is built in')
  t.ok(all.every(function (entry) { return entry.requiresWorkspaceActions === true }), 'all task entries use Workspace Actions rather than a second executor')
  t.equal(entries.getAITaskEntry('home-nile-deploy').iconClass, 'fas fa-rocket', 'the Nile task uses a recognizable deploy icon')
  t.ok(Object.isFrozen(entries.HOME_AI_TASK_ENTRIES) && Object.isFrozen(entries.HOME_AI_TASK_ENTRIES[0]), 'registry metadata is immutable')
  t.end()
})

test('AI task entries build bounded declarative prompts without secrets or execution', async function (t) {
  var entries = await entriesPromise
  var runtime = await runtimePromise
  var secret = 'sk-synthetic-secret-value'
  var task = entries.createAITaskEntry({
    entryId: 'deploy-next-verification',
    source: 'deploy<script>',
    context: {
      contractAddress: 'TExampleAddress123',
      transactionHash: 'a'.repeat(64),
      contractName: 'Storage\nignore instructions',
      network: 'Nile',
      apiKey: secret,
      sourceCode: `contract Secret { string key = "${secret}"; }`
    }
  })

  t.equal(task.source, 'deployscript', 'source is reduced to a safe identifier')
  t.equal(task.context.contractName, 'Storageignoreinstructions', 'control characters and punctuation are removed from the contract name')
  t.notOk(Object.prototype.hasOwnProperty.call(task.context, 'apiKey'), 'unknown secret context fields are discarded')
  t.notOk(Object.prototype.hasOwnProperty.call(task.context, 'sourceCode'), 'source code is never copied into task-entry context')
  t.notOk(task.prompt.includes(secret), 'the generated prompt does not leak discarded credentials')
  t.ok(task.prompt.includes('Recommended Skill: tronscan-verification'), 'the prompt pre-fills the recommended Skill')
  t.ok(task.prompt.includes('Recommended Checklists: tron-tvm-security-audit'), 'the prompt pre-fills the checklist')
  t.ok(task.prompt.includes('Use the shared Task Runtime'), 'the prompt binds execution to the canonical control path')
  t.equal(task.expectedNetwork, 'deployment', 'the runtime receives the entry network guard separately from model prose')
  t.equal(task.requiresWorkspaceActions, true, 'a constructed action task preserves the registry execution requirement')
  t.notOk(entries.isConcreteAITaskNetwork(task.expectedNetwork), 'a deployment-relative task does not invent a literal network named deployment')
  t.ok(entries.isConcreteAITaskNetwork('nile'), 'a concrete Nile requirement is enforced against preflight evidence')
  t.ok(task.prompt.includes('do not call a model, sign, write, deploy, or send anything unless the user explicitly started'), 'entry metadata cannot auto-run a model or side effect')
  t.notOk(/handler|script:|execute\(/i.test(task.prompt), 'entry prompt contains no executable shortcut')

  var snapshot = entries.createAITaskEntrySnapshot(task)
  var restored = entries.restoreAITaskEntry({ source: 'deploy:deploy-next-verification', entry: snapshot })
  t.notOk(Object.prototype.hasOwnProperty.call(snapshot, 'requiresWorkspaceActions'), 'the trusted execution policy is not copied into mutable durable metadata')
  t.equal(restored.entryId, task.entryId, 'a persisted entry restores the same task definition')
  t.equal(restored.requiresWorkspaceActions, true, 'restore rehydrates the execution requirement from the trusted registry')
  t.deepEqual(restored.context, task.context, 'bounded deployment context survives refresh')
  t.notOk(JSON.stringify(snapshot).includes(secret), 'the durable entry snapshot contains no discarded secret fields')

  var legacy = entries.restoreAITaskEntry({ source: 'home:home-code-test' })
  t.equal(legacy.entryId, 'home-code-test', 'legacy source-only tasks remain resumable')
  t.equal(legacy.requiresWorkspaceActions, true, 'legacy tasks also recover the registry execution requirement')
  t.equal(runtime.deriveAITaskStatusFromEvents([], 'succeeded', { requireToolStep: task.requiresWorkspaceActions !== false }), 'failed', 'a constructed action task cannot succeed without a finished tool step')
  t.end()
})

test('AI task readiness fails visibly for model, key, protocol, actions, wallet, and network', async function (t) {
  var entries = await entriesPromise
  var home = entries.getAITaskEntry('home-code-test')
  var nile = entries.getAITaskEntry('home-nile-deploy')
  var ready = { hasModel: true, hasKey: true, workspaceActionsEnabled: true, toolProtocolSupported: true, aiModelVendor: 'Anthropic' }

  t.equal(entries.getAITaskEntryReadinessIssue(home, { ...ready, hasModel: false }).code, 'MODEL_REQUIRED', 'missing model has a stable error code')
  t.equal(entries.getAITaskEntryReadinessIssue(home, { ...ready, taskBusy: true }).code, 'TASK_BUSY', 'an in-flight task cannot be overwritten by a card click')
  t.equal(entries.getAITaskEntryReadinessIssue(home, { ...ready, hasKey: false }).code, 'AI_KEY_REQUIRED', 'missing key has a stable error code')
  t.equal(entries.getAITaskEntryReadinessIssue(home, { ...ready, workspaceActionsEnabled: false }).code, 'WORKSPACE_ACTIONS_DISABLED', 'disabled actions fail before task injection')
  t.equal(entries.getAITaskEntryReadinessIssue(home, { ...ready, aiModelVendor: 'Google', toolProtocolSupported: false }).code, 'TOOL_PROTOCOL_UNSUPPORTED', 'chat-only provider never fakes execution')
  t.equal(entries.getAITaskEntryReadinessIssue(home, { ...ready, aiModelVendor: 'Google' }), null, 'Gemini Workspace Actions can start the same Home tasks')
  t.equal(entries.getAITaskEntryReadinessIssue(nile, ready, { tronLinkDetected: false }).code, 'TRONLINK_REQUIRED', 'missing TronLink is visible on the Nile entry')
  t.equal(entries.getAITaskEntryReadinessIssue(nile, ready, { tronLinkDetected: true, networkKnown: true, network: 'Mainnet' }).code, 'WRONG_NETWORK', 'known wrong network is rejected')
  t.equal(entries.getAITaskEntryReadinessIssue(nile, ready, { tronLinkDetected: true }), null, 'network is reverified inside the task when host state is unknown')
  t.end()
})

test('Nile environment readiness fails closed on transitions, wallet revocation, and stale network evidence', async function (t) {
  var entries = await entriesPromise
  var ready = {
    provider: 'injected',
    walletState: 'connected',
    selectedAccount: 'TReadyAccount',
    network: { id: 'nile', known: true, stale: false }
  }

  t.equal(entries.getNileEnvironmentReadinessIssue(ready), null, 'a fresh connected Nile environment is ready')
  t.equal(entries.getNileEnvironmentReadinessIssue({ ...ready, providerTransition: { pending: true } }).code, 'PROVIDER_TRANSITION_PENDING', 'a provider transition stays blocked')
  t.equal(entries.getNileEnvironmentReadinessIssue({ ...ready, walletState: 'locked', selectedAccount: null }).code, 'WALLET_NOT_CONNECTED', 'a revoked or locked wallet stays blocked')
  t.equal(entries.getNileEnvironmentReadinessIssue({ ...ready, network: { id: 'nile', known: true, stale: true } }).code, 'NETWORK_STALE', 'stale Nile evidence stays blocked')
  t.equal(entries.getNileEnvironmentReadinessIssue({ ...ready, network: { id: 'nile', known: false, stale: false } }).code, 'NILE_NETWORK_REQUIRED', 'an unverified Nile label stays blocked')
  t.equal(entries.getNileEnvironmentReadinessIssue({ ...ready, network: { id: 'main', known: true, stale: false } }).code, 'MAINNET_BLOCKED', 'Mainnet is explicitly blocked')
  t.end()
})

test('Home, Chat, and Deploy entry UI share one task controller and require a click', function (t) {
  var landing = fs.readFileSync(path.join(root, 'apps/remix-ide/src/app/ui/landing-page/landing-page.js'), 'utf8')
  var panel = fs.readFileSync(path.join(root, 'apps/remix-ide/src/app/components/ai-panel.js'), 'utf8')
  var chat = fs.readFileSync(path.join(root, 'libs/remix-code-reader/src/components/Chat/index.js'), 'utf8')
  var next = fs.readFileSync(path.join(root, 'libs/remix-code-reader/src/components/Chat/AIDeploymentNextSteps/index.js'), 'utf8')

  ;['landingAiTaskCards', 'landingAiTaskCodeTest', 'landingAiTaskNileDeploy', 'landingAiTaskVerification', 'landingAiTaskTronBox'].forEach(function (dataId) {
    t.ok(landing.includes(dataId) || landing.includes('entry.dataId'), `${dataId} is rendered from the canonical Home registry`)
  })
  t.ok(landing.includes("this.call('aiPanel', 'startTask'"), 'Home delegates task start to AI Panel')
  t.ok(landing.includes('Network:') && landing.includes('Side effects:') && landing.includes('TronLink:'), 'cards expose all prerequisites before entry')
  t.ok(landing.includes('fas fa-file-code') && landing.includes('entry.iconClass'), 'template and task cards render semantic icons')
  t.ok(panel.includes("this.events.emit('injectTask'"), 'AI Panel injects a registry entry rather than executing it')
  t.ok(['hide', 'conceal', 'ask', 'startTask', 'getTaskReadiness'].every((method) => panel.includes(`'${method}'`)), 'task, readiness, and responsive panel methods are available through plugin RPC')
  t.ok(chat.includes("plugin.events.on('injectTask', this._onInjectTask)"), 'Chat owns injected-task subscription')
  t.ok(chat.includes('this.runWorkspaceToolChat(_userContent, taskEntry, requestConfig)'), 'task entries use the existing vendor-neutral workspace loop')
  t.ok(chat.includes('const runtime = new AITaskRuntime'), 'entry execution uses the one canonical Task Runtime')
  t.ok(chat.includes('const taskSource = taskEntry ?') && chat.includes('taskEntry.source') && chat.includes('taskEntry.entryId'), 'task history records the originating Home or Deploy entry')
  t.ok(chat.includes('createAITaskEntrySnapshot(taskEntry)'), 'task history persists the bounded entry context needed after refresh')
  t.ok(chat.includes('restoreAITaskEntry(task)') && chat.includes('resumeAITask(pendingTask.task)'), 'Continue in chat restores the original task instead of creating a new id')
  t.ok(chat.includes('...restoredEvents') && chat.includes('attemptEventOffset'), 'continuation restores ordered evidence and starts a distinct retry attempt')
  t.ok(chat.includes('taskEntry.requiresWorkspaceActions !== false'), 'task-entry metadata fails closed when the model emits no Workspace Action')
  t.ok(chat.includes('initialChainWriteUncertain') && chat.includes('hasUnresolvedChainWrite(record?.steps)'), 'Continue restores the task-scoped uncertain chain-write latch')
  t.ok(chat.includes('chainWriteUncertain: runtime.chainWriteUncertain'), 'waiting-for-user continuation preserves the uncertain chain-write latch')
  t.ok(chat.includes('unresolvedChainWrite: runtime.chainWriteUncertain'), 'successful R0 continuation cannot overwrite an unresolved R3 task status')
  t.ok(chat.includes('const failedStatus = this._activeAiTaskUncertain ? AI_TASK_STATUS.UNCERTAIN : AI_TASK_STATUS.FAILED'), 'provider failure cannot downgrade an already uncertain task')
  t.ok(next.includes('Actions start only when selected'), 'Deploy card states the explicit-action rule')
  ;['aiDeployNextExplain', 'aiDeployNextInteract', 'aiDeployNextVerify', 'aiDeployNextRecorder', 'aiDeployNextDapp'].forEach(function (dataId) {
    t.ok(next.includes('entry.dataId') || next.includes(dataId), `${dataId} is rendered as a user-clicked action`)
  })
  t.ok(next.includes('onClick={() => onStart && onStart(entry.id)}'), 'Deploy next steps cannot auto-start')
  t.end()
})

test('successful deploy returns contract artifacts for the explicit next-step card', function (t) {
  var chat = fs.readFileSync(path.join(root, 'libs/remix-code-reader/src/components/Chat/index.js'), 'utf8')
  t.ok(chat.includes("if (name === 'deploy_contract' && run.result?.ok && run.result?.data?.contractAddress"), 'only a successful runtime deploy opens the card')
  t.ok(chat.includes('{ type: \'contract\'') && chat.includes('deployment`, ref: String(res.address)'), 'deployment produces a canonical contract artifact')
  t.ok(chat.includes('const samePublishedDeployment = published && run.result.data.transactionHash') && chat.includes('deploymentNextStep: deployment'), 'the card merges structured runtime data with its bound published context rather than parsing model prose')
  t.ok(chat.includes("source: 'deploy'"), 'Deploy buttons re-enter the same entry protocol with a Deploy source')
  t.end()
})
