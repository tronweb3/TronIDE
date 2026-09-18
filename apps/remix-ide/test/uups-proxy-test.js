/* eslint-env node */
'use strict'

require('ts-node/register')
require('../../../libs/remix-lib/node_modules/tsconfig-paths/register')

const test = require('tape')
const {
  abiSignature,
  createProxyContract,
  encodeInitializerCall,
  getInitializers,
  isEnabledURLFlag,
  isUUPSContract,
  normalizeContractAddress,
  proxyConstructorArguments,
  usesModernProxy,
  validateConstructorArguments
} = require('../src/app/tabs/runTab/model/uups-proxy')

const initializer = {
  inputs: [{ internalType: 'uint256', name: 'initialValue', type: 'uint256' }],
  name: 'initialize',
  outputs: [],
  stateMutability: 'nonpayable',
  type: 'function'
}

const compiler = {
  getAsts: () => ({
    'Token.sol': {
      ast: {
        exportedSymbols: { UUPSUpgradeable: [100] },
        nodes: [
          { nodeType: 'ContractDefinition', name: 'Token', linearizedBaseContracts: [200, 100] },
          { nodeType: 'ContractDefinition', name: 'Plain', linearizedBaseContracts: [300] }
        ]
      }
    }
  })
}

const selectedContract = (name = 'Token', abi = [initializer]) => ({
  name,
  abi,
  compiler,
  contract: { file: 'Token.sol' },
  getConstructorInterface: () => ({ inputs: [], type: 'constructor' })
})

test('UUPS proxy helpers detect only contracts inheriting UUPSUpgradeable', (t) => {
  t.equal(isUUPSContract(selectedContract('Token')), true, 'linearized UUPS inheritance is detected')
  t.equal(isUUPSContract(selectedContract('Plain')), false, 'an unrelated contract in the same source is not detected')
  t.equal(isUUPSContract({ ...selectedContract('Token'), compiler: { getAsts: () => ({}) } }), false, 'missing AST data fails closed')
  t.end()
})

test('deployProxy flags and initializer overloads are normalized', (t) => {
  t.equal(isEnabledURLFlag('true'), true, 'true enables proxy mode')
  t.equal(isEnabledURLFlag('%31'), true, 'percent-encoded 1 enables proxy mode')
  t.equal(isEnabledURLFlag('YES'), true, 'truthy flags are case insensitive')
  t.equal(isEnabledURLFlag('false'), false, 'false leaves normal deployment selected')
  const overload = { ...initializer, inputs: [{ name: 'owner', type: 'address' }] }
  t.deepEqual(getInitializers([initializer, overload, { type: 'function', name: 'other' }]), [initializer, overload], 'every initialize overload remains selectable')
  t.equal(abiSignature(initializer), 'initialize(uint256)', 'initializer signature includes its parameter types')
  t.end()
})

test('initializer arguments are encoded before deployment', (t) => {
  const data = encodeInitializerCall(initializer, '42')
  t.equal(data.slice(0, 10), '0xfe4b84df', 'initialize(uint256) selector is included')
  t.equal(data.length, 10 + 64, 'one uint256 argument is ABI encoded')
  t.throws(() => encodeInitializerCall(initializer, ''), /expects 1 argument/, 'missing initializer input fails before either transaction')
  t.doesNotThrow(() => validateConstructorArguments(selectedContract(), ''), 'an empty implementation constructor validates')
  t.end()
})

test('proxy artifacts select the matching OpenZeppelin generation', (t) => {
  const legacy = createProxyContract(selectedContract())
  const modernABI = [initializer, { inputs: [], name: 'UPGRADE_INTERFACE_VERSION', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' }]
  const modern = createProxyContract(selectedContract('Token', modernABI))

  t.equal(usesModernProxy(modernABI), true, 'UPGRADE_INTERFACE_VERSION selects OpenZeppelin 5.x')
  t.equal(legacy.proxyVersion, '4.x', 'legacy implementations use the 4.x proxy')
  t.equal(modern.proxyVersion, '5.x', 'modern implementations use the 5.x proxy')
  t.ok(legacy.bytecodeObject.length > modern.bytecodeObject.length, 'both precompiled proxy artifacts are present and distinct')
  t.equal(modern.getConstructorInterface().inputs.length, 2, 'proxy constructor accepts implementation and initializer data')
  t.end()
})

test('TRON address forms are normalized for proxy constructor encoding', (t) => {
  const address = '0x1111111111111111111111111111111111111111'
  t.equal(normalizeContractAddress(address.toUpperCase().replace('0X', '0x')), address, 'hex addresses are normalized')
  t.equal(normalizeContractAddress('41' + address.slice(2)), address, 'TRON 41-prefixed addresses are normalized')
  t.equal(proxyConstructorArguments(address, '0x1234'), `"${address}","0x1234"`, 'proxy constructor arguments remain exact strings')
  t.throws(() => normalizeContractAddress('not-an-address'), /invalid|address/i, 'invalid deployment addresses are rejected')
  t.end()
})
