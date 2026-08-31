#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const compilerUtilsPath = path.join(root, 'libs/remix-solidity/src/compiler/compiler-utils.ts')
const remixTestsRunPath = path.join(root, 'libs/remix-tests/src/run.ts')

const compilerUtils = fs.readFileSync(compilerUtilsPath, 'utf8')
const remixTestsRun = fs.readFileSync(remixTestsRunPath, 'utf8')

const providerBaseURLMatch = compilerUtils.match(/baseURL\s*:\s*['"]([^'"]+)['"]/)
const baseURLMatch = compilerUtils.match(/^export\s+const\s+baseURLTron\s*=\s*['"]([^'"]+)['"]/m)
if (!baseURLMatch) {
  if (!providerBaseURLMatch || !compilerUtils.includes('export const baseURLTron = tronCompilerSourceProvider.baseURL')) {
    console.error('Cannot find exported baseURLTron or tronCompilerSourceProvider baseURL in libs/remix-solidity/src/compiler/compiler-utils.ts')
    process.exit(1)
  }
}

const baseURLTron = (baseURLMatch ? baseURLMatch[1] : providerBaseURLMatch[1]).replace(/\/+$/, '')
const oldCompilerSources = [
  'https://tronsuper.github.io/tron-solc-bin/bin',
  'https://tronsuper.github.io/tron-solc-bin/bin/'
]
const currentSourcePattern = /const\s+baseURL\s*=\s*['"]([^'"]+)['"]/
const currentSourceMatch = remixTestsRun.match(currentSourcePattern)

for (const oldSource of oldCompilerSources) {
  if (remixTestsRun.includes(oldSource)) {
    console.error(`Compiler source mismatch: libs/remix-tests/src/run.ts still uses ${oldSource}`)
    console.error(`Expected source should be aligned with baseURLTron: ${baseURLTron}`)
    console.error('Fix suggestion: import or mirror the same Tron compiler source used by libs/remix-solidity.')
    process.exit(1)
  }
}

if (currentSourceMatch) {
  const currentSource = currentSourceMatch[1].replace(/\/+$/, '')
  if (currentSource !== baseURLTron) {
    console.error(`Compiler source mismatch: libs/remix-tests/src/run.ts uses ${currentSource}`)
    console.error(`Expected source should be aligned with baseURLTron: ${baseURLTron}`)
    process.exit(1)
  }
}

// ---- builtin compiler version consistency -----------------------------------
// The bundled fallback's version is declared once in remix-solidity and
// mirrored in remix-code-reader (which must not depend on remix-solidity).
// The labels/notes must use the constant, never a hardcoded x.y.z: the asset
// was swapped 0.8.6 -> 0.8.20 once and every hardcoded label went stale.
const toolsApiPath = path.join(root, 'libs/remix-code-reader/src/services/toolsApi.js')
const containerPath = path.join(root, 'libs/remix-ui/solidity-compiler/src/lib/compiler-container.tsx')
const chatPath = path.join(root, 'libs/remix-code-reader/src/components/Chat/index.js')
const toolsApi = fs.readFileSync(toolsApiPath, 'utf8')
const container = fs.readFileSync(containerPath, 'utf8')
const chat = fs.readFileSync(chatPath, 'utf8')

const builtinDeclRe = /export\s+const\s+BUILTIN_SOLC_VERSION\s*=\s*['"]([0-9.]+)['"]/
const builtinPrimary = compilerUtils.match(builtinDeclRe)
const builtinMirror = toolsApi.match(builtinDeclRe)
if (!builtinPrimary) {
  console.error('BUILTIN_SOLC_VERSION missing from libs/remix-solidity/src/compiler/compiler-utils.ts')
  process.exit(1)
}
if (!builtinMirror) {
  console.error('BUILTIN_SOLC_VERSION mirror missing from libs/remix-code-reader/src/services/toolsApi.js')
  process.exit(1)
}
if (builtinPrimary[1] !== builtinMirror[1]) {
  console.error(`BUILTIN_SOLC_VERSION drift: remix-solidity says ${builtinPrimary[1]}, remix-code-reader mirror says ${builtinMirror[1]}`)
  process.exit(1)
}
const staleBuiltinLiterals = [
  [containerPath, container, /latest local version - \d/],
  [containerPath, container, /Built-in compiler \(local\) - \d/],
  [containerPath, container, /built-in compiler \(\d/],
  [chatPath, chat, /bundled fallback \d/],
  [chatPath, chat, /current compiler is 0\\?\.8\\?\.6/]
]
for (const [p, src, re] of staleBuiltinLiterals) {
  if (re.test(src)) {
    console.error(`Hardcoded builtin version literal in ${p} (pattern ${re}) — use BUILTIN_SOLC_VERSION`)
    process.exit(1)
  }
}
if (!container.includes('BUILTIN_SOLC_VERSION') || !chat.includes('BUILTIN_SOLC_VERSION')) {
  console.error('compiler-container.tsx and Chat/index.js must reference BUILTIN_SOLC_VERSION for builtin labels/notes')
  process.exit(1)
}

// The AI panel mirrors the version-list URL too (set_compiler_version
// validates against the live list) — it must stay the provider's list URL.
const listUrlMirror = toolsApi.match(/export\s+const\s+TRON_SOLC_LIST_URL\s*=\s*['"]([^'"]+)['"]/)
if (!listUrlMirror) {
  console.error('TRON_SOLC_LIST_URL mirror missing from libs/remix-code-reader/src/services/toolsApi.js')
  process.exit(1)
}
if (listUrlMirror[1].replace(/\/+$/, '') !== `${baseURLTron}/list.json`) {
  console.error(`TRON_SOLC_LIST_URL drift: toolsApi says ${listUrlMirror[1]}, provider list is ${baseURLTron}/list.json`)
  process.exit(1)
}

// The browser must never statically require the full `solc` package. Doing so
// duplicates soljson in the initial main.js even though compiler binaries are
// already loaded on demand from assets/js/soljson.js or the selected version.
const compilerImplementationPath = path.join(root, 'libs/remix-solidity/src/compiler/compiler.ts')
const compilerImplementation = fs.readFileSync(compilerImplementationPath, 'utf8')
if (/\brequire\(\s*['"]solc['"]\s*\)/.test(compilerImplementation)) {
  console.error('Browser bundle regression: compiler.ts statically requires the full solc package')
  process.exit(1)
}
if (!compilerImplementation.includes("import(/* webpackChunkName: \"solc-node\" */ 'solc')") ||
    !compilerImplementation.includes("import(/* webpackChunkName: \"solc-wrapper\" */ 'solc/wrapper')")) {
  console.error('Compiler loading must retain separate async solc-node and solc-wrapper boundaries')
  process.exit(1)
}

console.log(`Compiler source check passed: ${baseURLTron}`)
console.log(`Builtin version constant consistent: ${builtinPrimary[1]}`)
