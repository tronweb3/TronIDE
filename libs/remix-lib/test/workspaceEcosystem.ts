'use strict'
import tape from 'tape'
import { isRemotePluginHostAllowed, summarizePluginPermissions, validateLocalPluginUrl } from '../src/workspace/pluginSecurity'
import { getTronTemplate, TRON_TEMPLATES } from '../src/workspace/tronTemplates'
import { analyzeTronTransactionConfig } from '../src/workspace/tronStaticAnalysis'

tape('pluginSecurity validates local plugin URLs and permissions', function (t) {
  t.plan(10)

  t.equal(validateLocalPluginUrl('http://localhost:3000').ok, true)
  t.equal(validateLocalPluginUrl('http://example.com/plugin').ok, false)
  t.equal(validateLocalPluginUrl('ftp://localhost/plugin').ok, false)
  t.equal(validateLocalPluginUrl('https://plugins.tronide.io').warnings.length, 1)
  t.equal(validateLocalPluginUrl('https://review.plugins.tronide.io').ok, true)
  t.equal(isRemotePluginHostAllowed('eviltronide.io'), false)
  t.equal(summarizePluginPermissions(['file.read'])[0], 'file.read: can access workspace files')
  // IPv6 loopback is localhost even though URL.hostname brackets it as "[::1]".
  t.equal(validateLocalPluginUrl('http://[::1]:8080/p.json').ok, true, 'IPv6 loopback over http allowed')
  // Suffix/prefix host-confusion must stay blocked.
  t.equal(validateLocalPluginUrl('https://plugins.tronide.io.evil.com').ok, false, 'suffix trick blocked')
  t.equal(validateLocalPluginUrl('https://plugins.tronide.io@evil.com/x').ok, false, 'userinfo trick blocked')
})

tape('tronTemplates exposes required v2.3.0 templates', function (t) {
  t.plan(4)

  t.equal(TRON_TEMPLATES.length >= 4, true)
  t.equal(getTronTemplate('simple-storage')?.path, 'contracts/SimpleStorage.sol')
  t.equal(getTronTemplate('trc20-minimal')?.content.includes('balanceOf'), true)
  t.equal(getTronTemplate('library-deploy')?.content.includes('library MathLib'), true)
})

tape('tronStaticAnalysis reports TRON transaction config findings', function (t) {
  t.plan(4)

  const findings = analyzeTronTransactionConfig({ feeLimit: '9007199254740993', tokenId: 0, tokenValue: 1, address: '0x123' })
  t.equal(findings.some((finding) => finding.ruleId === 'tron-fee-limit-safe-integer'), true)
  t.equal(findings.some((finding) => finding.ruleId === 'tron-trc10-argument-combination'), true)
  t.equal(findings.some((finding) => finding.ruleId === 'tron-address-format'), true)
  t.equal(analyzeTronTransactionConfig({ feeLimit: 100000000, tokenId: 1000001, tokenValue: 1, address: 'T' + 'A'.repeat(33) }).length, 0)
})
