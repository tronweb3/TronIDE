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

console.log(`Compiler source check passed: ${baseURLTron}`)
