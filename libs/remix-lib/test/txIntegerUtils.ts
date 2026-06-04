'use strict'
import tape from 'tape'
import { BN } from 'ethereumjs-util'
import { parseSafeInteger, validateTrc10Inputs, formatSafeIntegerRangeError, extractTrc10Balance } from '../src/execution/txIntegerUtils'

tape('parseSafeInteger validates integer safety across execution contexts', function (t) {
  t.plan(8)

  t.equal(parseSafeInteger('0x2a', 16, 'Fee limit'), 42)
  t.equal(parseSafeInteger('12345', 10, 'Transaction value'), 12345)

  t.throws(
    () => parseSafeInteger('123abc', 10, 'Transaction value'),
    /Invalid Transaction value/
  )

  t.throws(
    () => parseSafeInteger('1e3', 10, 'Transaction value'),
    /Invalid Transaction value/
  )

  t.throws(
    () => parseSafeInteger('0x1g', 16, 'Token ID'),
    /Invalid Token ID/
  )

  t.throws(
    () => parseSafeInteger('9007199254740992', 10, 'Transaction value'),
    /exceeds safe integer range/
  )

  t.throws(
    () => parseSafeInteger('invalid', 10, 'Fee limit'),
    /Invalid Fee limit/
  )

  t.throws(
    () => parseSafeInteger(-1, 10, 'Fee limit'),
    /Invalid Fee limit/
  )
})

tape('validateTrc10Inputs enforces TRC10 argument combinations', function (t) {
  t.plan(5)

  t.equal(validateTrc10Inputs(0, 0), null)
  t.equal(validateTrc10Inputs(0, 100), 'invalid argument')
  t.equal(validateTrc10Inputs(1000000, 0), 'invalid argument')
  t.equal(validateTrc10Inputs(1000001, 0), 'No asset', 'valid tokenId with zero tokenValue should be rejected')
  t.equal(validateTrc10Inputs(1000001, 100), null)
})

tape('validateTrc10Inputs rejects malformed input without throwing', function (t) {
  t.plan(8)

  // Regression: these used to throw BN "Invalid character" up the tx-runner stack.
  t.equal(validateTrc10Inputs('0xGG', '10'), 'invalid argument', 'non-hex hex string')
  t.equal(validateTrc10Inputs('-0x5', '10'), 'invalid argument', 'negative hex')
  t.equal(validateTrc10Inputs('1e3', '10'), 'invalid argument', 'scientific notation')
  t.equal(validateTrc10Inputs('1.5', '10'), 'invalid argument', 'decimal')
  t.equal(validateTrc10Inputs('1000001', 'abc'), 'invalid argument', 'non-numeric tokenValue')
  t.equal(validateTrc10Inputs(NaN as any, 0), 'invalid argument', 'NaN from Number("abc")')
  // Legacy 0-equivalents must still be treated as valid zero.
  t.equal(validateTrc10Inputs('0x', '0x'), null, 'empty hex == 0')
  t.equal(validateTrc10Inputs('', ''), null, 'empty string == 0')
})

tape('formatSafeIntegerRangeError uses canonical safe integer wording', function (t) {
  t.plan(1)

  t.equal(
    formatSafeIntegerRangeError('_initialValue'),
    '_initialValue exceeds safe integer range (2^53-1). Please use a smaller value.'
  )
})

tape('extractTrc10Balance supports VM and provider account layouts', function (t) {
  t.plan(5)

  t.equal(extractTrc10Balance({ asset: { 1000001: new BN('10', 10) } }, 1000001).toString(10), '10')
  t.equal(extractTrc10Balance({ assetV2: { 1000001: '12' } }, '1000001').toString(10), '12')
  t.equal(extractTrc10Balance({ asset: [{ key: '1000001', value: '7' }] }, '1000001').toString(10), '7')
  t.equal(extractTrc10Balance(null, '1000001').toString(10), '0')
  // Regression: corrupt on-chain asset value must degrade to 0, not throw.
  t.equal(extractTrc10Balance({ asset: { 1000001: 'abc' } }, '1000001').toString(10), '0')
})
