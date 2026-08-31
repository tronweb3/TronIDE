import * as tape from 'tape'
import compilerInput from '../src/compiler/compiler-input'
import { parseRemappings } from '../src/compiler/remappings'

const source = {
  'Test.sol': {
    content: 'pragma solidity ^0.8.0; contract Test {}'
  }
}

tape('compilerInput does not pass logical tron target variants to solc', (t) => {
  for (const evmVersion of ['tron', 'TRON', ' Tron ']) {
    const input = JSON.parse(compilerInput(source, {
      optimize: false,
      runs: 200,
      evmVersion: evmVersion as any
    }))
    t.notOk(Object.prototype.hasOwnProperty.call(input.settings, 'evmVersion'), `${JSON.stringify(evmVersion)} is omitted from Standard JSON settings`)
  }

  const standardTarget = JSON.parse(compilerInput(source, {
    optimize: false,
    runs: 200,
    evmVersion: 'istanbul' as any
  }))
  t.equal(standardTarget.settings.evmVersion, 'istanbul', 'a standard solc EVM version is preserved')
  t.end()
})

tape('compilerInput includes parsed Solidity remappings', (t) => {
  const remappings = parseRemappings([
    '@openzeppelin/tron-contracts/=@openzeppelin/tron-contracts@5.6.0-rc.2/',
    '',
    '  @scope/pkg/=vendor/pkg/  ',
    ''
  ].join('\r\n'))
  const input = JSON.parse(compilerInput(source, {
    optimize: false,
    runs: 200,
    remappings
  }))

  t.deepEqual(input.settings.remappings, [
    '@openzeppelin/tron-contracts/=@openzeppelin/tron-contracts@5.6.0-rc.2/',
    '@scope/pkg/=vendor/pkg/'
  ], 'blank lines and CRLF are normalized without reordering mappings')

  const withoutRemappings = JSON.parse(compilerInput(source, {
    optimize: false,
    runs: 200,
    remappings: []
  }))
  t.notOk(Object.prototype.hasOwnProperty.call(withoutRemappings.settings, 'remappings'), 'empty mappings preserve the prior compiler input')
  t.end()
})
