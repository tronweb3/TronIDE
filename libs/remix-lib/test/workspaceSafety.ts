'use strict'
import tape from 'tape'
import { createGistPublishPlan, createGitHubImportPlan, redactGitHubSecrets, validateGitHubAuthPolicy } from '../src/workspace/githubGistSecurity'
import { applySearchReplacePlan, createSearchReplacePlan } from '../src/workspace/searchReplaceSafety'

tape('githubGistSecurity redacts tokens and validates scopes', function (t) {
  t.plan(8)

  const urlToken = 'ghp_' + '1'.repeat(30)
  const patToken = 'github_pat_' + '2'.repeat(30)
  t.equal(
    redactGitHubSecrets(`https://x.test?a=1&token=${urlToken}`),
    'https://x.test?a=1&token=[github-token-redacted]'
  )
  t.equal(
    redactGitHubSecrets(`Authorization: Bearer ${patToken}`),
    'Authorization: Bearer [github-token-redacted]'
  )
  // Regression: bare token at non-zero offset must not leak the match offset into the output.
  t.equal(
    redactGitHubSecrets(`see ${urlToken} in log`),
    'see [github-token-redacted] in log',
    'bare token mid-string redacts cleanly (no offset digits)'
  )
  t.equal(
    redactGitHubSecrets(`a=${urlToken} b=gho_${'3'.repeat(30)}`),
    'a=[github-token-redacted] b=[github-token-redacted]',
    'multiple bare tokens redact cleanly'
  )

  const policy = validateGitHubAuthPolicy({ scopes: ['gist'], allowPrivateRepos: true, allowGistPublish: true })
  t.equal(policy.ok, false)
  t.deepEqual(policy.missingScopes, ['repo'])

  const importPlan = createGitHubImportPlan({ owner: 'tron', repo: 'demo', isPrivate: true })
  t.equal(importPlan.requiresOAuth, true)

  const gistPlan = createGistPublishPlan(['contracts/A.sol'], true)
  t.equal(gistPlan.requiresConfirmation, true)
})

tape('searchReplaceSafety creates preview, updates and undo plan', function (t) {
  t.plan(10)

  const files = [
    { path: 'contracts/A.sol', content: 'contract A {}\ncontract A2 {}', version: 1 },
    { path: 'node_modules/B.sol', content: 'contract B {}', version: 1 },
    { path: 'readonly.sol', content: 'contract R {}', readonly: true }
  ]

  const plan = createSearchReplacePlan(files, 'contract', 'library', { excludedPathPattern: /node_modules/ })
  t.equal(plan.canApply, true)
  t.equal(plan.matches.length, 2)
  t.deepEqual(plan.changedFiles, ['contracts/A.sol'])
  t.equal(plan.skippedFiles.length, 2)

  const result = applySearchReplacePlan([files[0]], /contract/g, 'library', { 'contracts/A.sol': 1 })
  t.equal(result.updates[0].content, 'library A {}\nlibrary A2 {}')
  t.equal(result.undo[0].content, files[0].content)

  const stringResult = applySearchReplacePlan([files[0]], 'contract', 'library', { 'contracts/A.sol': 1 })
  t.equal(stringResult.updates[0].content, 'library A {}\nlibrary A2 {}')

  const capturePlan = createSearchReplacePlan([files[0]], /contract\s+(A\d*)/g, 'library $1Mock')
  t.equal(capturePlan.matches[0].after, 'library AMock {}')

  const captureResult = applySearchReplacePlan([files[0]], /contract\s+(A\d*)/g, 'library $1Mock', { 'contracts/A.sol': 1 })
  t.equal(captureResult.updates[0].content, 'library AMock {}\nlibrary A2Mock {}')

  const conflict = applySearchReplacePlan([files[0]], 'contract', 'library', { 'contracts/A.sol': 2 })
  t.equal(conflict.conflicts[0].reason, 'version changed')
})

tape('searchReplaceSafety literal-mode preview matches apply (multi-hit and $ sequences)', function (t) {
  t.plan(2)

  // Multiple occurrences on one line: preview must show all replaced, not just the first.
  const multi = [{ path: 'm.sol', content: 'foo foo foo', version: 1 }]
  const multiPlan = createSearchReplacePlan(multi, 'foo', 'BAR')
  const multiApplied = applySearchReplacePlan(multi, 'foo', 'BAR', { 'm.sol': 1 }).updates[0].content
  t.equal(multiPlan.matches[multiPlan.matches.length - 1].after, multiApplied, 'literal multi-hit preview == apply')

  // Replacement containing $-sequences must be inserted literally in both preview and apply.
  const dollar = [{ path: 'd.sol', content: 'foo bar', version: 1 }]
  const dollarPlan = createSearchReplacePlan(dollar, 'foo', 'x$&y')
  const dollarApplied = applySearchReplacePlan(dollar, 'foo', 'x$&y', { 'd.sol': 1 }).updates[0].content
  t.equal(dollarPlan.matches[0].after, dollarApplied, 'literal $-sequence preview == apply')
})
