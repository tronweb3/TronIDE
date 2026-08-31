/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

const CAPABILITY_STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  UNKNOWN: 'unknown',
  UNSUPPORTED: 'unsupported',
  CHECKING: 'checking'
})

const FEATURE_DEFINITIONS = Object.freeze({
  clz: Object.freeze({
    id: 'clz',
    label: 'CLZ opcode',
    upgrade: 'osaka',
    blocking: true
  }),
  p256: Object.freeze({
    id: 'p256',
    label: 'P-256 precompile (0x100)',
    upgrade: 'osaka',
    blocking: true
  }),
  history: Object.freeze({
    id: 'history',
    label: 'Prague history contract',
    upgrade: 'prague',
    blocking: true
  }),
  modexp: Object.freeze({
    id: 'modexp',
    label: 'MODEXP precompile (0x05)',
    upgrade: 'osaka',
    blocking: false
  })
})

const HISTORY_CONTRACT = BigInt('0x0000F90827F1C53a10cb7A02335B175320002935')
const P256_PRECOMPILE = BigInt('0x100')
const MODEXP_PRECOMPILE = BigInt('0x05')

function capability (key, status, value, reason) {
  return { key, status, value: value === undefined ? null : value, reason: reason || null }
}

function createCheckingProtocolCapabilitySnapshot ({ provider, network, checkedAt, contextEpoch, endpoint } = {}) {
  return {
    provider: provider || null,
    network: network || null,
    checkedAt: checkedAt || null,
    contextEpoch: Number.isSafeInteger(contextEpoch) ? contextEpoch : null,
    endpoint: endpoint || null,
    prague: capability('getAllowTvmPrague', CAPABILITY_STATUS.CHECKING),
    osaka: capability('getAllowTvmOsaka', CAPABILITY_STATUS.CHECKING)
  }
}

function createProtocolCapabilitySnapshot ({ provider, network, chainParameters, error, checkedAt, contextEpoch, endpoint } = {}) {
  const snapshot = createCheckingProtocolCapabilitySnapshot({ provider, network, checkedAt: checkedAt || Date.now(), contextEpoch, endpoint })
  if (provider === 'vm') {
    const reason = 'JavaScript VM does not advertise TRON chain upgrade parameters.'
    snapshot.prague = capability('getAllowTvmPrague', CAPABILITY_STATUS.UNSUPPORTED, null, reason)
    snapshot.osaka = capability('getAllowTvmOsaka', CAPABILITY_STATUS.UNSUPPORTED, null, reason)
    return snapshot
  }

  if (chainParameters && !Array.isArray(chainParameters) && Array.isArray(chainParameters.chainParameter)) {
    chainParameters = chainParameters.chainParameter
  }
  if (error || !Array.isArray(chainParameters)) {
    const reason = error && error.message ? error.message : 'Chain parameters were not returned by the provider.'
    snapshot.prague = capability('getAllowTvmPrague', CAPABILITY_STATUS.UNKNOWN, null, reason)
    snapshot.osaka = capability('getAllowTvmOsaka', CAPABILITY_STATUS.UNKNOWN, null, reason)
    return snapshot
  }

  const byKey = new Map()
  chainParameters.forEach((entry) => {
    if (entry && typeof entry.key === 'string') byKey.set(entry.key, entry)
  })
  const fromParameter = (key) => {
    if (!byKey.has(key)) return capability(key, CAPABILITY_STATUS.UNSUPPORTED, null, `${key} is not exposed by this node.`)
    const entry = byKey.get(key)
    const value = entry.value === undefined || entry.value === null ? 0 : Number(entry.value)
    if (!Number.isFinite(value)) return capability(key, CAPABILITY_STATUS.UNKNOWN, null, `${key} returned an invalid value.`)
    return capability(key, value === 1 ? CAPABILITY_STATUS.ACTIVE : CAPABILITY_STATUS.INACTIVE, value)
  }

  snapshot.prague = fromParameter('getAllowTvmPrague')
  snapshot.osaka = fromParameter('getAllowTvmOsaka')
  return snapshot
}

function extractBytecodeObject (bytecode) {
  if (typeof bytecode === 'string') return bytecode
  if (bytecode && typeof bytecode.object === 'string') return bytecode.object
  return ''
}

function normalizeHexBytecode (bytecode) {
  let value = extractBytecodeObject(bytecode).trim().replace(/^0x/i, '')
  // Solidity uses a fixed-width 40-character placeholder until a library is
  // linked. Replacing only the canonical modern form preserves byte offsets
  // without treating arbitrary malformed input as executable bytecode.
  value = value.replace(/__\$[0-9a-fA-F]{34}\$__/g, '0'.repeat(40))
  if (value.length % 2 !== 0 || (value && !/^[0-9a-fA-F]+$/.test(value))) {
    return { valid: false, bytes: [], reason: 'Bytecode is not complete hexadecimal data.' }
  }
  const bytes = []
  for (let index = 0; index < value.length; index += 2) bytes.push(parseInt(value.slice(index, index + 2), 16))
  return { valid: true, bytes, reason: null }
}

function stripSolidityMetadata (bytes) {
  if (bytes.length < 4) return { bytes, stripped: false }
  const metadataLength = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1]
  const metadataStart = bytes.length - metadataLength - 2
  const firstMetadataByte = bytes[metadataStart]
  const hasCborMapPrefix = firstMetadataByte >= 0xa0 && firstMetadataByte <= 0xbf
  const hasInvalidDelimiter = metadataStart > 0 && bytes[metadataStart - 1] === 0xfe
  if (metadataLength <= 0 || metadataStart <= 0 || !hasCborMapPrefix || !hasInvalidDelimiter) {
    return { bytes, stripped: false }
  }
  return { bytes: bytes.slice(0, metadataStart), stripped: true }
}

function parseInstructions (bytes) {
  const instructions = []
  for (let pc = 0; pc < bytes.length;) {
    const opcode = bytes[pc]
    const pushLength = opcode >= 0x60 && opcode <= 0x7f ? opcode - 0x5f : 0
    const pushData = bytes.slice(pc + 1, Math.min(bytes.length, pc + 1 + pushLength))
    instructions.push({ pc, opcode, pushData })
    pc += 1 + pushLength
  }
  return instructions
}

function constantFromBytes (bytes) {
  let result = BigInt(0)
  bytes.forEach((byte) => { result = (result << BigInt(8)) + BigInt(byte) })
  return result
}

function popValues (stack, count) {
  for (let index = 0; index < count; index++) stack.pop()
}

function applyUnknownOperation (stack, pops, pushes) {
  popValues(stack, pops)
  for (let index = 0; index < pushes; index++) stack.push(null)
}

function stackEffect (opcode) {
  if (opcode >= 0x01 && opcode <= 0x07) return [2, 1]
  if (opcode === 0x08 || opcode === 0x09) return [3, 1]
  if (opcode === 0x0a || opcode === 0x0b) return [2, 1]
  if (opcode >= 0x10 && opcode <= 0x14) return [2, 1]
  if (opcode === 0x15) return [1, 1]
  if (opcode >= 0x16 && opcode <= 0x1d) return [opcode === 0x19 ? 1 : 2, 1]
  if (opcode === 0x1e) return [1, 1]
  if (opcode === 0x20) return [2, 1]
  if ([0x30, 0x32, 0x33, 0x34, 0x36, 0x38, 0x3a, 0x3d, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x4a, 0x58, 0x59, 0x5a].includes(opcode)) return [0, 1]
  if ([0x31, 0x35, 0x3b, 0x3f, 0x40, 0x49, 0x51, 0x54, 0x5c].includes(opcode)) return [1, 1]
  if ([0x37, 0x39, 0x3e, 0x5e].includes(opcode)) return [3, 0]
  if (opcode === 0x3c) return [4, 0]
  if (opcode === 0x50) return [1, 0]
  if ([0x52, 0x53, 0x55, 0x5d].includes(opcode)) return [2, 0]
  if (opcode >= 0xa0 && opcode <= 0xa4) return [2 + opcode - 0xa0, 0]
  if (opcode === 0xf0) return [3, 1]
  if (opcode === 0xf5) return [4, 1]
  return null
}

function callFeatureForTarget (target) {
  if (target === P256_PRECOMPILE) return FEATURE_DEFINITIONS.p256
  if (target === HISTORY_CONTRACT) return FEATURE_DEFINITIONS.history
  if (target === MODEXP_PRECOMPILE) return FEATURE_DEFINITIONS.modexp
  return null
}

function maskedAddressCandidates (instructions) {
  const candidates = []
  for (let index = 0; index + 2 < instructions.length; index++) {
    const targetPush = instructions[index]
    const maskPush = instructions[index + 1]
    const andInstruction = instructions[index + 2]
    if (targetPush.opcode < 0x60 || targetPush.opcode > 0x7f) continue
    if (maskPush.opcode !== 0x73 || maskPush.pushData.some((byte) => byte !== 0xff) || andInstruction.opcode !== 0x16) continue
    const target = constantFromBytes(targetPush.pushData)
    if (callFeatureForTarget(target)) candidates.push({ target, sourcePc: targetPush.pc })
  }
  return candidates
}

function scanBytecode (bytecode, scope = 'creation') {
  const normalized = normalizeHexBytecode(bytecode)
  if (!normalized.valid) {
    return { scope, valid: false, byteLength: 0, strippedMetadata: false, matches: [], reason: normalized.reason }
  }
  const metadata = stripSolidityMetadata(normalized.bytes)
  const instructions = parseInstructions(metadata.bytes)
  const addressCandidates = maskedAddressCandidates(instructions)
  const matches = []
  const stack = []

  instructions.forEach((instruction) => {
    const { opcode, pushData, pc } = instruction
    if (opcode === 0x1e) matches.push({ feature: 'clz', upgrade: 'osaka', scope, pc, opcode: 'CLZ' })

    if (opcode >= 0x60 && opcode <= 0x7f) {
      stack.push({ constant: constantFromBytes(pushData), sourcePc: pc })
      return
    }
    if (opcode === 0x5f) {
      stack.push({ constant: BigInt(0), sourcePc: pc })
      return
    }
    if (opcode >= 0x80 && opcode <= 0x8f) {
      const depth = opcode - 0x7f
      stack.push(stack.length >= depth ? stack[stack.length - depth] : null)
      return
    }
    if (opcode >= 0x90 && opcode <= 0x9f) {
      const depth = opcode - 0x8f
      const top = stack.length - 1
      const other = stack.length - 1 - depth
      if (other < 0) {
        stack.length = 0
      } else {
        const value = stack[top]
        stack[top] = stack[other]
        stack[other] = value
      }
      return
    }

    if ([0xf1, 0xf2, 0xf4, 0xfa].includes(opcode)) {
      let targetValue = stack.length >= 2 && stack[stack.length - 2]
      let target = targetValue && targetValue.constant
      let feature = target !== null && target !== undefined ? callFeatureForTarget(target) : null
      if (!feature) {
        // Solidity lowers typed address constants to PUSHn <address>, PUSH20
        // <mask>, AND, then may jump through ABI-encoding helpers before the
        // actual CALL. Those internal jumps prevent a safe single-pass stack
        // simulation, so associate only the nearest strongly typed address
        // literal in a tight window. Numeric constants such as 256 are not
        // candidates and therefore cannot masquerade as the P-256 address.
        const candidate = addressCandidates
          .filter((item) => item.sourcePc < pc && pc - item.sourcePc <= 256)
          .sort((left, right) => right.sourcePc - left.sourcePc)[0]
        if (candidate) {
          targetValue = { constant: candidate.target, sourcePc: candidate.sourcePc }
          target = candidate.target
          feature = callFeatureForTarget(target)
        }
      }
      if (feature) {
        matches.push({
          feature: feature.id,
          upgrade: feature.upgrade,
          scope,
          pc,
          opcode: { 0xf1: 'CALL', 0xf2: 'CALLCODE', 0xf4: 'DELEGATECALL', 0xfa: 'STATICCALL' }[opcode],
          target: '0x' + target.toString(16),
          targetSourcePc: targetValue.sourcePc
        })
      }
      applyUnknownOperation(stack, opcode === 0xf1 || opcode === 0xf2 ? 7 : 6, 1)
      return
    }

    if ([0x00, 0x56, 0x57, 0x5b, 0xf3, 0xfd, 0xfe, 0xff].includes(opcode)) {
      stack.length = 0
      return
    }

    const effect = stackEffect(opcode)
    if (effect) applyUnknownOperation(stack, effect[0], effect[1])
    else stack.length = 0
    if (stack.length > 1024) stack.splice(0, stack.length - 1024)
  })

  return {
    scope,
    valid: true,
    byteLength: normalized.bytes.length,
    strippedMetadata: metadata.stripped,
    matches,
    reason: null
  }
}

function scanCompilationArtifacts ({ creationBytecode, runtimeBytecode } = {}) {
  const scans = [
    scanBytecode(creationBytecode, 'creation'),
    scanBytecode(runtimeBytecode, 'runtime')
  ]
  const dependencyMap = new Map()
  scans.forEach((scan) => {
    scan.matches.forEach((match) => {
      const definition = FEATURE_DEFINITIONS[match.feature]
      if (!dependencyMap.has(match.feature)) {
        dependencyMap.set(match.feature, { ...definition, scopes: [], matches: [] })
      }
      const dependency = dependencyMap.get(match.feature)
      if (!dependency.scopes.includes(match.scope)) dependency.scopes.push(match.scope)
      dependency.matches.push(match)
    })
  })
  return {
    scans,
    dependencies: Object.keys(FEATURE_DEFINITIONS).filter((id) => dependencyMap.has(id)).map((id) => dependencyMap.get(id)),
    limitations: ['Dynamic call targets are not detected.']
  }
}

function evaluateDeploymentCompatibility (scan, snapshot) {
  const dependencies = scan && Array.isArray(scan.dependencies) ? scan.dependencies : []
  const blockers = []
  const warnings = []
  dependencies.forEach((dependency) => {
    const capabilityState = snapshot && snapshot[dependency.upgrade]
    const status = capabilityState ? capabilityState.status : CAPABILITY_STATUS.UNKNOWN
    if (status === CAPABILITY_STATUS.ACTIVE) return
    const item = {
      feature: dependency.id,
      label: dependency.label,
      upgrade: dependency.upgrade,
      status,
      message: `${dependency.label} requires ${dependency.upgrade.toUpperCase()}, but the current environment reports ${status}.`
    }
    if (dependency.blocking) blockers.push(item)
    else warnings.push(item)
  })
  return { compatible: blockers.length === 0, blockers, warnings }
}

function formatDeploymentCompatibilityMessage (evaluation) {
  if (!evaluation || !evaluation.blockers || !evaluation.blockers.length) return ''
  return 'Deployment blocked: ' + evaluation.blockers.map((blocker) => blocker.message).join(' ')
}

module.exports = {
  CAPABILITY_STATUS,
  FEATURE_DEFINITIONS,
  createCheckingProtocolCapabilitySnapshot,
  createProtocolCapabilitySnapshot,
  evaluateDeploymentCompatibility,
  extractBytecodeObject,
  formatDeploymentCompatibilityMessage,
  scanBytecode,
  scanCompilationArtifacts
}
