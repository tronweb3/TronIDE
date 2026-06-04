import { default as test } from 'tape'
import StaticAnalysisRunner from '../../src/solidity-analyzer'
import tronTransactionConfig from '../../src/solidity-analyzer/modules/tronTransactionConfig'

const objectExpression = (properties) => ({
  nodeType: 'ObjectExpression',
  properties
})

const property = (name, value) => ({
  key: { name },
  value: { nodeType: 'Literal', value }
})

test('tronTransactionConfig is registered in static analyzer module list', function (t) {
  t.plan(2)

  const runner = new StaticAnalysisRunner()
  const moduleNames = runner.modules().map((Module) => new Module().name)

  t.equal(moduleNames.includes('TRON transaction config: '), true)
  t.equal(new tronTransactionConfig().category.id, 'TRON')
})

test('tronTransactionConfig reports unsafe TRON config object values', function (t) {
  t.plan(4)

  const module = new tronTransactionConfig()
  module.visit(objectExpression([
    property('feeLimit', '9007199254740993'),
    property('tokenId', 0),
    property('tokenValue', 1),
    property('address', '0x123')
  ]))

  const report = module.report({ contracts: {}, sources: {} })
  t.equal(report.length, 3)
  t.equal(report.some((item) => item.more === 'TRON rule: tron-fee-limit-safe-integer'), true)
  t.equal(report.some((item) => item.more === 'TRON rule: tron-trc10-argument-combination'), true)
  t.equal(report.some((item) => item.more === 'TRON rule: tron-address-format'), true)
})

test('tronTransactionConfig reports ambiguous TRX and TRC10 value transfer mode', function (t) {
  t.plan(5)

  const module = new tronTransactionConfig()
  module.visit(objectExpression([
    property('callValue', 100),
    property('tokenId', 1000001),
    property('tokenValue', 1),
    property('address', 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7')
  ]))

  const report = module.report({ contracts: {}, sources: {} })
  const finding = report.find((item) => item.more === 'TRON rule: tron-value-transfer-mode')

  t.equal(report.length, 1)
  t.ok(finding)
  t.equal(finding.warning, 'callValue and tokenValue should not both be greater than 0; choose TRX or TRC10 transfer mode explicitly.')
  t.equal(finding.location, '0:0:0')
  t.equal(new tronTransactionConfig().category.id, 'TRON')
})

test('tronTransactionConfig accepts explicit TRX-only and TRC10-only transfer modes', function (t) {
  t.plan(2)

  const trxOnly = new tronTransactionConfig()
  trxOnly.visit(objectExpression([
    property('callValue', 100),
    property('tokenId', 0),
    property('tokenValue', 0),
    property('address', 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7')
  ]))

  const trc10Only = new tronTransactionConfig()
  trc10Only.visit(objectExpression([
    property('callValue', 0),
    property('tokenId', 1000001),
    property('tokenValue', 1),
    property('address', '410000000000000000000000000000000000000000')
  ]))

  t.equal(trxOnly.report({ contracts: {}, sources: {} }).length, 0)
  t.equal(trc10Only.report({ contracts: {}, sources: {} }).length, 0)
})
