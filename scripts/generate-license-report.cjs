#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const format = readArg('--format') || 'text'
const output = readArg('--output')
const report = collectPackages().sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))
const content = format === 'json' ? JSON.stringify(report, null, 2) + '\n' : renderText(report)

if (output) {
  fs.writeFileSync(path.resolve(repoRoot, output), content)
} else {
  process.stdout.write(content)
}

function readArg (name) {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

function collectPackages () {
  const pnpmRoot = path.join(repoRoot, 'node_modules', '.pnpm')
  const packages = new Map()
  if (!fs.existsSync(pnpmRoot)) return []

  for (const entry of fs.readdirSync(pnpmRoot)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const entryNodeModules = path.join(pnpmRoot, entry, 'node_modules')
    if (!fs.existsSync(entryNodeModules)) continue
    for (const packageJson of findPackageJsonFiles(entryNodeModules, 2)) {
      const pkg = readPackage(packageJson)
      if (!pkg || !pkg.name || !pkg.version) continue
      const key = `${pkg.name}@${pkg.version}`
      if (packages.has(key)) continue
      packages.set(key, {
        name: pkg.name,
        version: pkg.version,
        license: normalizeLicense(pkg),
        repository: normalizeRepository(pkg.repository),
        homepage: pkg.homepage || '',
        path: path.relative(repoRoot, path.dirname(packageJson))
      })
    }
  }

  return Array.from(packages.values())
}

function findPackageJsonFiles (directory, maxDepth, depth = 0) {
  const found = []
  if (depth > maxDepth) return found
  let entries = []
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    return found
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const current = path.join(directory, entry.name)
    const packageJson = path.join(current, 'package.json')
    if (fs.existsSync(packageJson)) found.push(packageJson)
    if (entry.name.startsWith('@') || depth === 0) found.push(...findPackageJsonFiles(current, maxDepth, depth + 1))
  }
  return found
}

function readPackage (packageJson) {
  try {
    return JSON.parse(fs.readFileSync(packageJson, 'utf8'))
  } catch (error) {
    return undefined
  }
}

function normalizeLicense (pkg) {
  if (typeof pkg.license === 'string' && pkg.license.trim()) return pkg.license.trim()
  if (Array.isArray(pkg.licenses)) {
    const licenses = pkg.licenses.map((item) => typeof item === 'string' ? item : item && item.type).filter(Boolean)
    if (licenses.length) return licenses.join(' OR ')
  }
  return 'UNKNOWN'
}

function normalizeRepository (repository) {
  if (!repository) return ''
  if (typeof repository === 'string') return repository
  return repository.url || ''
}

function renderText (packages) {
  const lines = [
    'Third-party dependency license report',
    `Generated from node_modules/.pnpm package metadata. Total packages: ${packages.length}`,
    '',
    'Package\tLicense\tRepository/Homepage\tPath'
  ]
  for (const pkg of packages) {
    lines.push(`${pkg.name}@${pkg.version}\t${pkg.license}\t${pkg.repository || pkg.homepage || '-'}\t${pkg.path}`)
  }
  return lines.join('\n') + '\n'
}
