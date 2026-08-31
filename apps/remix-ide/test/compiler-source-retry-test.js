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
 */

'use strict'

var test = require('tape')
var withBoundedRetries = require('../../../libs/remix-ui/solidity-compiler/src/lib/compiler-source-retry').withBoundedRetries

var noWait = function () { return Promise.resolve() }

test('compiler source retry succeeds after one transient failure', function (t) {
  t.plan(3)
  var attempts = 0

  return withBoundedRetries(function () {
    attempts++
    if (attempts === 1) return Promise.reject(new Error('temporary network failure'))
    return Promise.resolve('manifest')
  }, 1, function () { return true }, noWait).then(function (result) {
    t.equal(result, 'manifest', 'returns the successful retry result')
    t.equal(attempts, 2, 'performs one configured retry')
    t.pass('transient failure is recovered')
  }).catch(t.fail)
})

test('compiler source retry remains bounded when every attempt fails', function (t) {
  t.plan(3)
  var attempts = 0
  var expected = new Error('still unavailable')

  return withBoundedRetries(function () {
    attempts++
    return Promise.reject(expected)
  }, 1, function () { return true }, noWait).then(function () {
    t.fail('the operation must reject')
  }).catch(function (error) {
    t.equal(error, expected, 'preserves the final request error')
    t.equal(attempts, 2, 'stops after the initial attempt and one retry')
    t.pass('unavailable source fails closed')
  })
})

test('compiler source retry does not retry timeout errors', function (t) {
  t.plan(2)
  var attempts = 0
  var timeout = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })

  return withBoundedRetries(function () {
    attempts++
    return Promise.reject(timeout)
  }, 1, function (error) { return error.code !== 'ECONNABORTED' }, noWait).then(function () {
    t.fail('the operation must reject')
  }).catch(function (error) {
    t.equal(error, timeout, 'returns the timeout without masking it')
    t.equal(attempts, 1, 'does not extend the configured network timeout')
  })
})
