/*
 * Copyright © 2026 TronIDE
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

const remixLib = require('@remix-project/remix-lib')
const {
  UUPS_PROXY_ABI,
  UUPS_PROXY_BYTECODE_V4,
  UUPS_PROXY_BYTECODE_V5,
  UUPS_PROXY_DEPLOYED_BYTECODE_V4,
  UUPS_PROXY_DEPLOYED_BYTECODE_V5
} = require('./uups-proxy-constants')

const txFormat = remixLib.execution.txFormat
const txHelper = remixLib.execution.txHelper
const UUPS_SYMBOL = 'UUPSUpgradeable'

function isEnabledURLFlag (value) {
  if (value === undefined || value === null) return false
  let decoded = String(value)
  try { decoded = decodeURIComponent(decoded) } catch (e) {}
  return ['1', 'true', 'yes', 'on'].includes(decoded.trim().toLowerCase())
}

function sourceUnitAST (compiler, file) {
  const sources = compiler && typeof compiler.getAsts === 'function' ? compiler.getAsts() : null
  return sources && sources[file] && sources[file].ast
}

function uupsSymbolIds (compiler) {
  const sources = compiler && typeof compiler.getAsts === 'function' ? compiler.getAsts() : null
  if (!sources) return []
  const ids = []
  Object.keys(sources).forEach((file) => {
    const exported = sources[file] && sources[file].ast && sources[file].ast.exportedSymbols
    const symbols = exported && exported[UUPS_SYMBOL]
    if (Array.isArray(symbols)) ids.push(...symbols)
  })
  return ids
}

function isUUPSContract (selectedContract) {
  if (!selectedContract || !selectedContract.contract || !selectedContract.compiler) return false
  const ast = sourceUnitAST(selectedContract.compiler, selectedContract.contract.file)
  if (!ast || !Array.isArray(ast.nodes)) return false
  const symbols = new Set(uupsSymbolIds(selectedContract.compiler))
  if (symbols.size === 0) return false

  return ast.nodes.some((node) => node && node.nodeType === 'ContractDefinition' &&
    node.name === selectedContract.name &&
    Array.isArray(node.linearizedBaseContracts) &&
    node.linearizedBaseContracts.some((id) => symbols.has(id)))
}

function getInitializers (abi) {
  return (Array.isArray(abi) ? abi : []).filter((entry) => entry && entry.type === 'function' && entry.name === 'initialize')
}

function abiSignature (abi) {
  const inputs = (abi && Array.isArray(abi.inputs)) ? abi.inputs : []
  return `${abi && abi.name ? abi.name : ''}(${inputs.map((input) => input.type).join(',')})`
}

function parseAndValidateArguments (value, abi, label) {
  const input = typeof value === 'string' ? value.trim() : ''
  const args = input ? txFormat.parseFunctionParams(input) : []
  const expected = Array.isArray(abi && abi.inputs) ? abi.inputs.length : 0
  if (args.length !== expected) {
    throw new Error(`${label} expects ${expected} argument(s), received ${args.length}.`)
  }
  // Encode before either transaction is sent. This prevents a valid
  // implementation deployment being stranded by invalid initializer input.
  txHelper.encodeParams(abi, args.slice())
  return args
}

function encodeInitializerCall (initializerABI, value) {
  if (!initializerABI) throw new Error('Cannot deploy proxy: missing initialize ABI.')
  const args = parseAndValidateArguments(value, initializerABI, abiSignature(initializerABI))
  const encoded = txHelper.encodeParams(initializerABI, args.slice())
  return txHelper.encodeFunctionId(initializerABI) + encoded.replace(/^0x/, '')
}

function validateConstructorArguments (selectedContract, value) {
  const constructorABI = selectedContract.getConstructorInterface()
  parseAndValidateArguments(value, constructorABI, `${selectedContract.name} constructor`)
}

function normalizeContractAddress (address) {
  let value = address
  if (value && typeof value !== 'string') value = Buffer.from(value).toString('hex')
  value = String(value || '').trim()
  if (/^[0-9a-fA-F]{40}$/.test(value)) value = '0x' + value
  if (/^41[0-9a-fA-F]{40}$/.test(value)) value = value.replace(/^41/, '0x')
  let normalized
  try { normalized = remixLib.util.addressToHex(value) } catch (e) {
    throw new Error('Implementation deployment returned an invalid TRON address.')
  }
  if (!/^0x[0-9a-f]{40}$/.test(normalized || '')) throw new Error('Implementation deployment returned an invalid TRON address.')
  return normalized
}

function usesModernProxy (implementationABI) {
  return (Array.isArray(implementationABI) ? implementationABI : [])
    .some((entry) => entry && entry.type === 'function' && entry.name === 'UPGRADE_INTERFACE_VERSION')
}

function createProxyContract (implementationContract) {
  const modern = usesModernProxy(implementationContract.abi)
  const bytecode = modern ? UUPS_PROXY_BYTECODE_V5 : UUPS_PROXY_BYTECODE_V4
  const deployedBytecode = modern ? UUPS_PROXY_DEPLOYED_BYTECODE_V5 : UUPS_PROXY_DEPLOYED_BYTECODE_V4
  const object = {
    abi: UUPS_PROXY_ABI,
    evm: {
      bytecode: { object: bytecode, linkReferences: {} },
      deployedBytecode: { object: deployedBytecode }
    }
  }

  return {
    name: 'ERC1967Proxy',
    contract: implementationContract.contract,
    compiler: implementationContract.compiler,
    abi: UUPS_PROXY_ABI,
    bytecodeObject: bytecode,
    bytecodeLinkReferences: {},
    object,
    deployedBytecode: object.evm.deployedBytecode,
    getConstructorInterface: () => txHelper.getConstructorInterface(UUPS_PROXY_ABI),
    getConstructorInputs: () => txHelper.inputParametersDeclarationToString(UUPS_PROXY_ABI[0].inputs),
    isOverSizeLimit: () => deployedBytecode.length / 2 > 24576,
    proxyVersion: modern ? '5.x' : '4.x'
  }
}

function proxyConstructorArguments (implementationAddress, initializerData) {
  return `${JSON.stringify(normalizeContractAddress(implementationAddress))},${JSON.stringify(initializerData)}`
}

module.exports = {
  UUPS_SYMBOL,
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
}
