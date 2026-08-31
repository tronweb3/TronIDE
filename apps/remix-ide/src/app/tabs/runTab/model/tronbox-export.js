/*
 * Copyright © 2026 TronIDE
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Translate a recorded scenario (the recorder's getAll()/scenario.json shape)
 * into a TronBox project: a migrations script plus the scaffolding files of
 * the official `tronbox init` sample project. Pure string generation — no IDE
 * dependencies — so the translation is unit-testable in isolation.
 */

const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)

const TRONIDE_EXPORT_SCHEMA_VERSION = 1
const TRONIDE_EXPORT_KIND = 'tronide-tronbox-export'
const TRONBOX_COMPATIBILITY_BASELINE = Object.freeze({ package: 'tronbox', version: '4.8.0' })
const JS_SAFE_INTEGER_MAX = BigInt(Number.MAX_SAFE_INTEGER)

const normalizeSolcVersion = (value) => {
  const match = typeof value === 'string' ? /\d+\.\d+\.\d+/.exec(value) : null
  return match ? match[0] : '0.8.20'
}

const boundedText = (value, fallback, max = 200) => {
  const text = String(value == null ? '' : value).trim().slice(0, max)
  return text || fallback
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const RESERVED_IDENTIFIERS = new Set(['await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'return', 'static', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield'])

const safeIdentifier = (value, label) => {
  const identifier = String(value == null ? '' : value)
  if (!IDENTIFIER_RE.test(identifier) || RESERVED_IDENTIFIERS.has(identifier)) throw new TypeError(`Unsafe ${label || 'identifier'} in recorded scenario`)
  return identifier
}

const safeCommentText = (value, fallback) => String(value == null || value === '' ? (fallback || '') : value)
  .replace(/[\r\n\u2028\u2029]/g, ' ')
  .replace(/\*\//g, '* /')
  .slice(0, 200)

const safeNumericLiteral = (value, label = 'numeric value') => {
  if (value === undefined || value === null) return null
  const asString = String(value).trim()
  if (!/^(?:0x[0-9a-f]+|\d+)$/i.test(asString)) throw new TypeError(`Recorded ${label} must be a non-negative integer`)
  return BigInt(asString).toString(10)
}

const safeSunLiteral = (value) => {
  const normalized = safeNumericLiteral(value, 'callValue')
  if (normalized === null) return null
  return normalized === '0' ? null : normalized
}

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key)

const transactionOptions = (record, { constructorCall = false } = {}) => {
  const options = {}
  const unsupported = []
  const callValue = safeSunLiteral(hasOwn(record, 'callValue') ? record.callValue : record.value)
  if (callValue !== null) {
    // The generated migration is JavaScript and TronBox 4.8.0 does not have a
    // verified BigInt/string boundary for callValue. Emitting a bare literal
    // above 2^53 silently changes the approved SUN amount before TronWeb sees
    // it, so fence the step instead of producing a misleading migration.
    if (BigInt(callValue) > JS_SAFE_INTEGER_MAX) {
      unsupported.push(`callValue=${callValue} exceeds JavaScript safe-integer range`)
    } else {
      options.callValue = callValue
    }
  }

  const numericFields = ['feeLimit', 'userFeePercentage', 'originEnergyLimit']
  for (const field of numericFields) {
    if (!hasOwn(record, field) || record[field] === undefined || record[field] === null) continue
    const value = safeNumericLiteral(record[field], field)
    if (field === 'userFeePercentage' && BigInt(value) > BigInt(100)) throw new TypeError('Recorded userFeePercentage must be between 0 and 100')
    // The RunTab always serializes its UI defaults into VM/injected records.
    // They are already represented by TronBox's network configuration and
    // emitting them on every generated call makes a normal migration noisy
    // (and prevents consumers from matching the canonical deploy/call form).
    // Keep non-default, explicitly recorded values below.
    if ((field === 'userFeePercentage' && value === '100') ||
      (field === 'originEnergyLimit' && value === '10000000')) continue
    options[field] = value
  }

  // TronBox 4.8.0 forwards TRC10 fields for method calls, but its deploy
  // wrapper drops them before createSmartContract(). Never silently turn a
  // TRC10 deployment into a plain TRX deployment.
  for (const field of ['tokenId', 'tokenValue']) {
    if (!hasOwn(record, field) || record[field] === undefined || record[field] === null) continue
    const value = safeNumericLiteral(record[field], field)
    // VM/injected transaction records always include zero-valued TRC10
    // fields, even for an ordinary TRX deployment. Zero means "no token"
    // and is not unsupported metadata; only a non-zero token transfer needs
    // to be surfaced (constructor calls) or forwarded (function calls).
    if (value === '0') continue
    if (constructorCall) unsupported.push(`${field}=${value}`)
    else options[field] = value
  }

  // These fields describe wallet/runtime state that TronBox migrations cannot
  // reproduce safely. Fence the step instead of dropping the metadata.
  for (const field of ['permissionId', 'cancelState']) {
    if (hasOwn(record, field) && record[field] !== undefined && record[field] !== null) unsupported.push(`${field}=${safeCommentText(record[field])}`)
  }

  return { options, unsupported }
}

const normalizeScenarioPath = (value) => {
  const path = String(value == null ? '' : value).trim().replace(/\\/g, '/').replace(/^\/+/, '').slice(0, 500)
  if (!path || path.split('/').some((part) => !part || part === '.' || part === '..')) return null
  return path
}

const createTronideExportMetadata = ({
  tronideVersion = 'unknown',
  solcVersion,
  solcSource = 'fallback-default',
  network = {},
  scenarioSource = {}
} = {}) => {
  const sourceType = scenarioSource.type === 'workspace-file' ? 'workspace-file' : 'current-recording'
  const scenarioPath = sourceType === 'workspace-file' ? normalizeScenarioPath(scenarioSource.path) : null
  if (sourceType === 'workspace-file' && !scenarioPath) throw new TypeError('workspace-file scenarioSource requires a safe relative path')
  const scenarioSchemaVersion = Number.isInteger(scenarioSource.schemaVersion) && scenarioSource.schemaVersion > 0
    ? scenarioSource.schemaVersion
    : null
  const transactionCount = Number.isInteger(scenarioSource.transactionCount) && scenarioSource.transactionCount >= 0
    ? scenarioSource.transactionCount
    : 0
  const networkSource = ['scenario', 'current-environment', 'unknown'].includes(network.source) ? network.source : 'unknown'
  const normalizedSolcSource = ['last-compilation', 'scenario', 'fallback-default'].includes(solcSource) ? solcSource : 'fallback-default'
  return {
    schemaVersion: TRONIDE_EXPORT_SCHEMA_VERSION,
    kind: TRONIDE_EXPORT_KIND,
    generator: {
      name: 'TronIDE',
      version: boundedText(tronideVersion, 'unknown', 80)
    },
    solc: {
      version: normalizeSolcVersion(solcVersion),
      source: normalizedSolcSource
    },
    network: {
      source: networkSource,
      provider: boundedText(network.provider, 'unknown', 120),
      name: network.name == null ? null : boundedText(network.name, 'unknown', 160),
      id: network.id == null ? null : boundedText(network.id, 'unknown', 160)
    },
    scenarioSource: {
      type: sourceType,
      path: scenarioPath,
      schemaVersion: scenarioSchemaVersion,
      transactionCount
    },
    compatibility: {
      testedTronbox: { ...TRONBOX_COMPATIBILITY_BASELINE },
      apiBoundary: 'generated-project-files'
    }
  }
}

const validateTronideExportMetadata = (metadata) => {
  const errors = []
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
  if (!object(metadata)) return { ok: false, errors: ['metadata must be an object'] }
  if (metadata.schemaVersion !== TRONIDE_EXPORT_SCHEMA_VERSION) errors.push(`unsupported schemaVersion: ${metadata.schemaVersion}`)
  if (metadata.kind !== TRONIDE_EXPORT_KIND) errors.push('kind must be tronide-tronbox-export')
  if (!object(metadata.generator) || metadata.generator.name !== 'TronIDE' || typeof metadata.generator.version !== 'string' || !metadata.generator.version) errors.push('generator must identify a TronIDE version')
  if (!object(metadata.solc) || !/^\d+\.\d+\.\d+$/.test(metadata.solc.version) || !['last-compilation', 'scenario', 'fallback-default'].includes(metadata.solc.source)) errors.push('solc must contain a normalized version and source')
  if (!object(metadata.network) || !['scenario', 'current-environment', 'unknown'].includes(metadata.network.source) || typeof metadata.network.provider !== 'string' || !metadata.network.provider || !(metadata.network.name === null || typeof metadata.network.name === 'string') || !(metadata.network.id === null || typeof metadata.network.id === 'string')) errors.push('network must contain a source, provider, name and id')
  if (!object(metadata.scenarioSource) || !['current-recording', 'workspace-file'].includes(metadata.scenarioSource.type) || !Number.isInteger(metadata.scenarioSource.transactionCount) || metadata.scenarioSource.transactionCount < 0 || !(metadata.scenarioSource.schemaVersion === null || (Number.isInteger(metadata.scenarioSource.schemaVersion) && metadata.scenarioSource.schemaVersion > 0))) errors.push('scenarioSource must contain a supported type, schema version and transaction count')
  if (metadata.scenarioSource?.type === 'workspace-file' && normalizeScenarioPath(metadata.scenarioSource.path) !== metadata.scenarioSource.path) errors.push('workspace-file scenarioSource requires a safe relative path')
  if (metadata.scenarioSource?.type === 'current-recording' && metadata.scenarioSource.path !== null) errors.push('current-recording scenarioSource path must be null')
  if (!object(metadata.compatibility) || metadata.compatibility.apiBoundary !== 'generated-project-files' || metadata.compatibility.testedTronbox?.package !== 'tronbox' || !/^\d+\.\d+\.\d+$/.test(metadata.compatibility.testedTronbox?.version)) errors.push('compatibility must declare the public generated-files boundary and tested TronBox version')
  return { ok: errors.length === 0, errors }
}

/**
 * Build migrations/2_deploy_contracts.js from a scenario.
 *
 * Each recorded deploy becomes `deployer.deploy(...)` followed by a
 * `.deployed()` capture so later calls target the right instance even when
 * the same contract is deployed more than once. Recorded `created{ts}`
 * tokens (library links and address parameters) resolve to the variable of
 * the matching earlier deploy; anything that cannot be resolved becomes an
 * explicit TODO comment rather than silently dropped.
 *
 * @param {Object} scenario { transactions, abis, accounts, linkReferences }
 * @return {String} the migration source
 */
function scenarioToMigration (scenario) {
  const rawTransactions = (scenario && scenario.transactions) || []
  if (!Array.isArray(rawTransactions)) throw new TypeError('Scenario transactions must be an array')
  const txs = rawTransactions.slice().sort((a, b) => a.timestamp - b.timestamp)
  const requires = []
  const requiredSet = new Set()
  const byTimestamp = {}
  const varCount = {}
  // Artifact bindings are emitted as top-level consts. Reserve every
  // contract identifier before generating instance bindings so a later
  // lower-case contract name cannot collide with an earlier `storage` local.
  const artifactNames = new Set(['Contract'])
  for (const tx of txs) {
    if (tx && tx.record && tx.record.type === 'constructor') artifactNames.add(tx.record.contractName || 'Contract')
  }
  const usedVarNames = new Set(artifactNames)
  const deployedNames = new Set()
  const body = []

  const requireArtifact = (name) => {
    name = safeIdentifier(name, 'contract name')
    if (!requiredSet.has(name)) {
      requiredSet.add(name)
      requires.push(name)
    }
  }

  const encodeArgs = (parameters) => {
    if (parameters === undefined || parameters === null) return []
    if (!Array.isArray(parameters)) throw new TypeError('Recorded transaction parameters must be an array')
    return parameters.map((param) => {
      let encoded = JSON.stringify(param)
      if (encoded === undefined) encoded = 'undefined'
      // created{ts} tokens (also nested inside arrays) -> deployed instance address.
      // An unresolved reference (the deploy it points at was filtered out or
      // failed) must not ship as a bare created{ts} literal — that is not valid
      // code. Mark it explicitly, mirroring the to-target path below.
      return encoded.replace(/"created\{(\d+)\}"/g, (match, stamp) => {
        const dep = byTimestamp[stamp]
        return dep ? `${dep.varName}.address` : `/* TODO: unresolved reference to a deploy not in this flow (${match}) — fill in the address manually. */ undefined`
      })
    })
  }

  const fromAccounts = new Set(txs.map((tx) => tx.record.from).filter(Boolean))

  for (const tx of txs) {
    if (!tx || typeof tx !== 'object' || !tx.record || typeof tx.record !== 'object' || Array.isArray(tx.record)) throw new TypeError('Scenario contains a malformed transaction')
    const record = tx.record
    const safeType = safeCommentText(record.type, 'call')
    if (record.type === 'constructor') {
      const name = safeIdentifier(record.contractName || 'Contract', 'contract name')
      requireArtifact(name)
      const args = encodeArgs(record.parameters)
      const deployMetadata = transactionOptions(record, { constructorCall: true })
      const deployOptions = Object.keys(deployMetadata.options).length
        ? `{ ${Object.entries(deployMetadata.options).map(([key, value]) => `${key}: ${value}`).join(', ')} }`
        : ''
      const unsupported = deployMetadata.unsupported.length
        ? `TRON IDE recorded deployment metadata that TronBox 4.8.0 cannot reproduce (${deployMetadata.unsupported.join(', ')}). Deploy this step manually with the matching transaction options.`
        : ''
      // A reverted step ships as a commented copy of the SAME statements the
      // live path emits ('// ' prefix on one shared template) so the two
      // variants cannot drift, and the fence starts BEFORE the link lines —
      // a live deployer.link() for a fenced deploy would still run on-chain.
      const fence = record.failed || unsupported ? '// ' : ''
      if (record.failed) {
        body.push(`  // TODO: this recorded deployment of ${name} REVERTED when executed in the IDE — review before migrating:`)
      }
      if (record.linkReferences && Object.keys(record.linkReferences).length) {
        for (const file of Object.keys(record.linkReferences)) {
          for (const lib of Object.keys(record.linkReferences[file])) {
            const safeLib = safeIdentifier(lib, 'library name')
            if (deployedNames.has(lib)) {
              requireArtifact(safeLib)
              body.push(`  ${fence}await deployer.link(${safeLib}, ${name});`)
            } else {
              body.push(`  // TODO: ${name} links library ${safeLib}, which was not deployed in this flow — deploy and link it before this step.`)
            }
          }
        }
      }
      if (unsupported) body.push(`  // TODO: ${safeCommentText(unsupported)}`)
      const deployCall = `await deployer.deploy(${[name].concat(args, deployOptions ? [deployOptions] : []).join(', ')});`
      body.push(`  ${fence}${deployCall}`)
      if (record.failed || unsupported) {
        body.push('')
        continue
      }
      varCount[name] = (varCount[name] || 0) + 1
      let varBase = lowerFirst(name)
      if (RESERVED_IDENTIFIERS.has(varBase)) varBase = `instance${name}`
      let varName = `${varBase}${varCount[name] > 1 ? varCount[name] : ''}`
      let suffix = 2
      while (usedVarNames.has(varName)) varName = `${varBase}${suffix++}`
      usedVarNames.add(varName)
      byTimestamp[tx.timestamp] = { contractName: name, varName }
      deployedNames.add(name)
      body.push(`  const ${varName} = await ${name}.deployed();`)
      body.push('')
    } else {
      const stamp = /^created\{([^{}]+)\}$/.exec(record.to || '')
      const target = stamp && byTimestamp[stamp[1]]
      if (!target) {
        const safeName = record.name ? safeCommentText(record.name) : ''
        body.push(`  // TODO: a recorded ${safeType}${safeName ? ` to ${safeName}()` : ''} targeted an instance not deployed in this flow — replay it manually.`)
        body.push('')
        continue
      }
      if (record.type !== 'function') {
        body.push(`  // TODO: a recorded ${safeType} transaction to ${target.varName} is not auto-translated — send it manually if needed.`)
        body.push('')
        continue
      }
      const method = safeIdentifier(record.name, 'method name')
      const args = encodeArgs(record.parameters)
      const callMetadata = transactionOptions(record)
      const options = Object.keys(callMetadata.options).length
        ? `${args.length ? ', ' : ''}{ ${Object.entries(callMetadata.options).map(([key, value]) => `${key}: ${value}`).join(', ')} }`
        : ''
      // shared template, '// ' fence when the call reverted — a reverted call
      // replayed live would abort the whole migration on-chain
      const fence = record.failed ? '// ' : ''
      if (callMetadata.unsupported.length) {
        body.push(`  // TODO: ${safeCommentText(`TRON IDE recorded call metadata that TronBox cannot reproduce (${callMetadata.unsupported.join(', ')}). Replay this step manually with the matching transaction options.`)}`)
      }
      if (record.failed) {
        body.push(`  // TODO: this recorded call to ${method}() REVERTED when executed in the IDE — review before migrating:`)
      }
      const callFence = fence || callMetadata.unsupported.length ? '// ' : ''
      body.push(`  ${callFence}await ${target.varName}.${method}(${args.join(', ')}${options});`)
      body.push('')
    }
  }

  while (body.length && body[body.length - 1] === '') body.pop()

  const header = ['// Migration generated by TronIDE from a recorded deploy flow.',
    '// Review it, then run: tronbox migrate --network <nile|shasta|mainnet>']
  if (fromAccounts.size > 1) {
    header.push(`// NOTE: the recording used ${fromAccounts.size} different sender accounts; migrations run with the single account configured in tronbox-config.js.`)
  }

  const requireLines = requires.map((name) => `const ${name} = artifacts.require('${name}');`)
  return header.join('\n') + '\n\n' +
    (requireLines.length ? requireLines.join('\n') + '\n\n' : '') +
    'module.exports = async function (deployer) {\n' +
    (body.length ? body.join('\n') + '\n' : '') +
    '};\n'
}

/**
 * tronbox-config.js aligned with the official sample project, with the solc
 * version pinned to what the IDE compiled with.
 */
function tronboxConfig (solcVersion) {
  const version = normalizeSolcVersion(solcVersion)
  return `module.exports = {
  networks: {
    mainnet: {
      // Don't put your private key here, see sample-env:
      privateKey: process.env.PRIVATE_KEY_MAINNET,
      userFeePercentage: 100,
      feeLimit: 1000 * 1e6,
      fullHost: 'https://api.trongrid.io',
      network_id: '1'
    },
    shasta: {
      // Obtain test coin at https://shasta.tronex.io/
      privateKey: process.env.PRIVATE_KEY_SHASTA,
      userFeePercentage: 50,
      feeLimit: 1000 * 1e6,
      fullHost: 'https://api.shasta.trongrid.io',
      network_id: '2'
    },
    nile: {
      // Obtain test coin at https://nileex.io/join/getJoinPage
      privateKey: process.env.PRIVATE_KEY_NILE,
      userFeePercentage: 100,
      feeLimit: 1000 * 1e6,
      fullHost: 'https://nile.trongrid.io',
      network_id: '3'
    },
    development: {
      // For the tronbox/tre docker image, see https://hub.docker.com/r/tronbox/tre
      privateKey: '0000000000000000000000000000000000000000000000000000000000000001',
      userFeePercentage: 0,
      feeLimit: 1000 * 1e6,
      fullHost: 'http://127.0.0.1:9090',
      network_id: '9'
    }
  },
  compilers: {
    solc: {
      version: '${version}'
    }
  }
};
`
}

const INITIAL_MIGRATION = `const Migrations = artifacts.require('Migrations.sol');

module.exports = async function (deployer) {
  await deployer.deploy(Migrations);
};
`

const MIGRATIONS_SOL = `// SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.9.0;

contract Migrations {
  address public owner = msg.sender;
  uint public last_completed_migration;

  modifier restricted() {
    require(msg.sender == owner, "This function is restricted to the contract's owner");
    _;
  }

  function setCompleted(uint completed) public restricted {
    last_completed_migration = completed;
  }
}
`

const SAMPLE_ENV = `export PRIVATE_KEY_MAINNET=
export PRIVATE_KEY_SHASTA=
export PRIVATE_KEY_NILE=
`

const README = `# TronBox project exported from TronIDE

This project was generated from a deploy flow recorded in TronIDE
(Deploy & Run > Transactions recorded > Export to TronBox).

## Layout

- \`contracts/\` — the Solidity sources of your TronIDE workspace (plus TronBox's \`Migrations.sol\`)
- \`migrations/2_deploy_contracts.js\` — your recorded deploy flow, translated to a TronBox migration
- \`tronbox-config.js\` — Mainnet / Shasta / Nile / local network templates
- \`tronide-export.json\` — versioned public handoff metadata (solc, network, scenario source, tested TronBox baseline)

## Usage

\`\`\`shell
npm install -g tronbox@4.8.0
tronbox compile
\`\`\`

Put your private key in a gitignored \`.env\` file (see \`sample-env\`), then:

\`\`\`shell
source .env && tronbox migrate --network nile
\`\`\`

(Use \`--network shasta\` or \`--network mainnet\` accordingly.)

## Notes

- Review \`migrations/2_deploy_contracts.js\` before migrating: steps the
  exporter could not translate are marked with TODO comments.
- Sources imported from outside the workspace (e.g. GitHub/.deps imports)
  are not bundled; install or copy them before compiling.
`

module.exports = {
  scenarioToMigration,
  tronboxConfig,
  normalizeSolcVersion,
  createTronideExportMetadata,
  validateTronideExportMetadata,
  TRONIDE_EXPORT_SCHEMA_VERSION,
  TRONIDE_EXPORT_KIND,
  TRONBOX_COMPATIBILITY_BASELINE,
  INITIAL_MIGRATION,
  MIGRATIONS_SOL,
  SAMPLE_ENV,
  README
}
