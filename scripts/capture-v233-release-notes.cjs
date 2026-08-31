#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const http = require('http')
const crypto = require('crypto')
const { spawn, spawnSync, execFileSync } = require('child_process')
const { chromium } = require('@playwright/test')

const root = path.resolve(__dirname, '..')
const version = require(path.join(root, 'package.json')).version
const buildDir = path.join(root, 'build/apps/remix-ide')
const assetsDir = path.join(root, 'apps/remix-ide/src/assets/img/release-notes/v2.3.3')
const names = [
  'home-ai-task-cards',
  'bank-of-ai-provider',
  'task-timeline-history',
  'tron-skill-result',
  'approval-write-lock',
  'deploy-next-steps'
]
const port = Number(process.env.TRONIDE_RELEASE_CAPTURE_PORT || 18084)
const baseUrl = `http://127.0.0.1:${port}`

if (version !== '2.3.3') throw new Error(`Release screenshot capture requires package version 2.3.3, found ${version}.`)
if (!fs.existsSync(path.join(buildDir, 'index.html')) || !fs.existsSync(path.join(buildDir, 'main.js'))) {
  throw new Error('Production build is missing. Run pnpm nx build remix-ide --configuration=production --skip-nx-cache first.')
}
fs.mkdirSync(assetsDir, { recursive: true })

const server = spawn(process.execPath, [require.resolve('http-server/bin/http-server'), buildDir, '-p', String(port), '-c-1'], {
  cwd: root,
  stdio: ['ignore', 'ignore', 'inherit']
})

function waitForServer (attempt = 0) {
  return new Promise((resolve, reject) => {
    const request = http.get(baseUrl, (response) => {
      response.resume()
      if (response.statusCode && response.statusCode < 500) resolve()
      else reject(new Error(`Release capture server returned HTTP ${response.statusCode}.`))
    })
    request.on('error', () => {
      if (attempt >= 80) reject(new Error('Release capture server did not become ready.'))
      else setTimeout(() => waitForServer(attempt + 1).then(resolve, reject), 250)
    })
  })
}

async function main () {
  try {
    await waitForServer()
    const run = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', 'apps/remix-ide-pw/playwright.config.ts', 'release-notes-v233-capture.spec.ts', '--workers=1', '--retries=0'], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        TRONIDE_CAPTURE_RELEASE_NOTES: '1',
        TRONIDE_PW_BASE_URL: baseUrl,
        TRONIDE_PW_REUSE_SERVER: '1'
      }
    })
    if (run.status !== 0) process.exitCode = run.status || 1
    if (process.exitCode) return

    const converter = await chromium.launch({ headless: true })
    try {
      const page = await converter.newPage()
      for (const name of names) {
        const png = path.join(assetsDir, `${name}.png`)
        const webp = path.join(assetsDir, `${name}.webp`)
        if (!fs.existsSync(png)) throw new Error(`Capture did not create ${png}.`)
        const pngBase64 = fs.readFileSync(png).toString('base64')
        const webpBase64 = await page.evaluate(async (source) => {
          const image = new Image()
          image.src = `data:image/png;base64,${source}`
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.naturalWidth
          canvas.height = image.naturalHeight
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Canvas 2D is unavailable')
          context.drawImage(image, 0, 0)
          const encoded = canvas.toDataURL('image/webp', 0.82)
          if (!encoded.startsWith('data:image/webp;base64,')) throw new Error('Chromium could not encode WebP')
          return encoded.slice('data:image/webp;base64,'.length)
        }, pngBase64)
        fs.writeFileSync(webp, Buffer.from(webpBase64, 'base64'))
      }
    } finally {
      await converter.close()
    }
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    const buildArtifactSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(buildDir, 'main.js'))).digest('hex')
    fs.writeFileSync(path.join(assetsDir, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      release: '2.3.3',
      sourceCommit: commit,
      source: 'one local production build',
      buildArtifactSha256,
      captureSpec: 'apps/remix-ide-pw/tests/release-notes-v233-capture.spec.ts',
      generatedAt: new Date().toISOString(),
      images: names.map((name) => ({ id: name, png: `${name}.png`, webp: `${name}.webp` }))
    }, null, 2) + '\n')
    const builtAssetsDir = path.join(buildDir, 'assets/img/release-notes/v2.3.3')
    fs.mkdirSync(builtAssetsDir, { recursive: true })
    for (const file of [...names.flatMap((name) => [`${name}.png`, `${name}.webp`]), 'manifest.json']) {
      fs.copyFileSync(path.join(assetsDir, file), path.join(builtAssetsDir, file))
    }
    console.log(`Captured ${names.length} v2.3.3 release-note scenes from ${commit} (build ${buildArtifactSha256.slice(0, 12)}).`)
  } finally {
    server.kill('SIGTERM')
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error)
  process.exitCode = 1
})
