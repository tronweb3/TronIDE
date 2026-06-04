#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const projectPath = path.join(root, 'apps/remix-ide/project.json')
const webpackPath = path.join(root, 'apps/remix-ide/webpack.config.js')

const normalizeEntry = (entryPath) => {
  if (!entryPath || typeof entryPath !== 'string') return ''
  const withoutRelativePrefix = entryPath.replace(/^\.\//, '')
  const withAppPrefix = withoutRelativePrefix.startsWith('apps/remix-ide/')
    ? withoutRelativePrefix
    : path.posix.join('apps/remix-ide', withoutRelativePrefix)
  return withAppPrefix.replace(/\\/g, '/')
}

const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'))
const webpackConfig = fs.readFileSync(webpackPath, 'utf8')

const nxMain = normalizeEntry(project?.targets?.build?.options?.main)
const webpackEntryMatch = webpackConfig.match(/entry\s*:\s*['"]([^'"]+)['"]/) || webpackConfig.match(/entry\s*=\s*['"]([^'"]+)['"]/)

if (!nxMain) {
  console.error('Cannot find targets.build.options.main in apps/remix-ide/project.json')
  process.exit(1)
}

if (!webpackEntryMatch) {
  console.error('Cannot find entry in apps/remix-ide/webpack.config.js')
  process.exit(1)
}

const webpackEntry = normalizeEntry(webpackEntryMatch[1])

if (nxMain !== webpackEntry) {
  const message = [
    'Remix IDE entry mismatch detected:',
    `  apps/remix-ide/project.json targets.build.options.main: ${nxMain}`,
    `  apps/remix-ide/webpack.config.js entry:              ${webpackEntry}`,
    'Use one canonical entry in both files; release builds no longer allow entry mismatch exceptions.'
  ].join('\n')

  console.error(message)
  process.exit(1)
}

console.log(`Remix IDE entry check passed: ${nxMain}`)
