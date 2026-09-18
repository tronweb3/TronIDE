import * as tape from 'tape'
import compilerInput from '../src/compiler/compiler-input'
import { parseRemappings } from '../src/compiler/remappings'

const source = { 'Test.sol': { content: 'pragma solidity ^0.8.0; contract Test {}' } }

tape('remappings are normalized and forwarded to Standard JSON input', (t) => {
  const remappings = parseRemappings([
    '@openzeppelin/tron-contracts/=@openzeppelin/tron-contracts@5.6.0-rc.2/',
    '',
    '  @scope/pkg/=vendor/pkg/  '
  ].join('\r\n'))
  const input = JSON.parse(compilerInput(source, { optimize: false, runs: 200, remappings }))

  t.deepEqual(input.settings.remappings, [
    '@openzeppelin/tron-contracts/=@openzeppelin/tron-contracts@5.6.0-rc.2/',
    '@scope/pkg/=vendor/pkg/'
  ])

  const withoutRemappings = JSON.parse(compilerInput(source, { optimize: false, runs: 200, remappings: [] }))
  t.notOk(Object.prototype.hasOwnProperty.call(withoutRemappings.settings, 'remappings'))
  t.end()
})
