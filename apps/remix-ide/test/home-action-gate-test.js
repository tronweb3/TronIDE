/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

var test = require('tape')
var actionGatePromise = import('../src/app/ui/landing-page/home-action-gate.js')

function wait (milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function fakeButton () {
  return {
    disabled: false,
    attributes: {},
    setAttribute: function (name, value) { this.attributes[name] = value },
    removeAttribute: function (name) { delete this.attributes[name] }
  }
}

test('HomeActionGate coalesces rapid clicks while an action is pending', async function (t) {
  var HomeActionGate = (await actionGatePromise).HomeActionGate
  var gate = new HomeActionGate({ cooldownMs: 20 })
  var button = fakeButton()
  var calls = 0
  var finish
  var pending = new Promise((resolve) => { finish = resolve })

  var first = gate.run('wallet-connect', function () { calls++; return pending }, button)
  var duplicate = gate.run('wallet-connect', function () { calls++; return 'duplicate' }, button)

  t.equal(calls, 1, 'the duplicate click does not run the action again')
  t.equal(duplicate, first, 'the duplicate click shares the in-flight result')
  t.equal(button.disabled, true, 'the clicked button is disabled while busy')
  t.equal(button.attributes['aria-busy'], 'true', 'busy state is exposed to assistive technology')

  finish('connected')
  t.equal(await first, 'connected', 'the first action result is preserved')
  await wait(30)
  t.equal(button.disabled, false, 'the button is restored after settlement and cooldown')
  t.notOk(button.attributes['aria-busy'], 'the busy state is cleared')

  gate.run('wallet-connect', function () { calls++; return 'connected again' }, button)
  t.equal(calls, 2, 'a later intentional click still runs')
  gate.clear()
  t.end()
})

test('HomeActionGate keeps unrelated Home actions independent', async function (t) {
  var HomeActionGate = (await actionGatePromise).HomeActionGate
  var gate = new HomeActionGate({ cooldownMs: 20 })
  var calls = []

  gate.run('create-contract', function () { calls.push('contract') })
  gate.run('workspace-search', function () { calls.push('search') })

  t.deepEqual(calls, ['contract', 'search'], 'different action keys can run without blocking each other')
  gate.clear()
  t.end()
})
