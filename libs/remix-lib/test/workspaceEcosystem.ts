'use strict'
import tape from 'tape'
import { DEFAULT_REMOTE_PLUGIN_ALLOWLIST, isRemotePluginHostAllowed, summarizePluginPermissions, validateLocalPluginUrl } from '../src/workspace/pluginSecurity'
import { getTronTemplate, getTronTemplateFiles, TRON_TEMPLATES } from '../src/workspace/tronTemplates'
import { analyzeTronTransactionConfig } from '../src/workspace/tronStaticAnalysis'

tape('pluginSecurity validates local plugin URLs and permissions', function (t) {
  t.plan(18)

  t.equal(validateLocalPluginUrl('http://localhost:3000').ok, true)
  t.equal(validateLocalPluginUrl('http://example.com/plugin').ok, false)
  t.equal(validateLocalPluginUrl('ftp://localhost/plugin').ok, false)
  t.equal(validateLocalPluginUrl('https://localhost:3000').ok, true)
  t.equal(validateLocalPluginUrl('https://example.com/plugin').ok, false, 'remote HTTPS hosts are not supported')
  t.equal(validateLocalPluginUrl('https://sub.example.com/plugin').ok, false, 'remote HTTPS subdomains are not supported')
  t.equal(summarizePluginPermissions(['file.read'])[0], 'file.read: can access workspace files')
  // IPv6 loopback is localhost even though URL.hostname brackets it as "[::1]".
  t.equal(validateLocalPluginUrl('http://[::1]:8080/p.json').ok, true, 'IPv6 loopback over http allowed')
  t.equal(validateLocalPluginUrl('https://example.com.evil.com').ok, false, 'remote hosts are blocked')
  t.equal(validateLocalPluginUrl('https://example.com@evil.com/x').ok, false, 'remote hosts with userinfo are blocked')
  t.equal(validateLocalPluginUrl('ws://localhost:3000', 'ws').ok, true, 'loopback websocket allowed')
  t.equal(validateLocalPluginUrl('wss://127.0.0.1:8443', 'ws').ok, true, 'secure loopback websocket allowed')
  t.equal(validateLocalPluginUrl('ws://[::1]:8080', 'ws').ok, true, 'IPv6 loopback websocket allowed')
  t.equal(validateLocalPluginUrl('http://localhost:3000', 'ws').ok, false, 'websocket transport rejects http')
  t.equal(validateLocalPluginUrl('ws://localhost:3000', 'iframe').ok, false, 'iframe transport rejects ws')
  t.equal(validateLocalPluginUrl('wss://example.com/plugin', 'ws').ok, false, 'remote websocket blocked')
  t.deepEqual(DEFAULT_REMOTE_PLUGIN_ALLOWLIST, [], 'deprecated allowlist is empty')
  t.equal(isRemotePluginHostAllowed('plugins.tronide.io'), false, 'deprecated remote-host helper fails closed')
})

tape('tronTemplates exposes required v2.3.0 templates', function (t) {
  t.plan(8)

  t.equal(TRON_TEMPLATES.length >= 4, true)
  t.equal(getTronTemplate('simple-storage')?.path, 'contracts/SimpleStorage.sol')
  t.equal(getTronTemplate('trc20-minimal')?.content.includes('balanceOf'), true)
  t.equal(getTronTemplate('library-deploy')?.content.includes('library MathLib'), true)
  const compatibility = getTronTemplate('prague-osaka-compatibility')
  const files = compatibility ? getTronTemplateFiles(compatibility) : []
  t.equal(files.length, 4, 'compatibility template seeds a complete four-file workspace')
  t.equal(files.some((file) => file.path === 'contracts/PragueHistory.sol'), true, 'Prague example is included')
  t.equal(files.some((file) => file.path === 'tests/P256Verifier_test.sol'), true, 'P-256 smoke test is included')
  t.equal(files.find((file) => file.path === compatibility?.path)?.content, compatibility?.content, 'primary template content stays backward compatible')
})

tape('tronStaticAnalysis reports TRON transaction config findings', function (t) {
  t.plan(4)

  const findings = analyzeTronTransactionConfig({ feeLimit: '9007199254740993', tokenId: 0, tokenValue: 1, address: '0x123' })
  t.equal(findings.some((finding) => finding.ruleId === 'tron-fee-limit-safe-integer'), true)
  t.equal(findings.some((finding) => finding.ruleId === 'tron-trc10-argument-combination'), true)
  t.equal(findings.some((finding) => finding.ruleId === 'tron-address-format'), true)
  t.equal(analyzeTronTransactionConfig({ feeLimit: 100000000, tokenId: 1000001, tokenValue: 1, address: 'T' + 'A'.repeat(33) }).length, 0)
})
