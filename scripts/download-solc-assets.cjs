#!/usr/bin/env node

'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const SOLC_URL = 'https://binaries.soliditylang.org/wasm/soljson-v0.8.20+commit.a1b79de6.js'
const SOLC_SHA256 = '5c509f760dc110a695c8b39bbc21e08c17dee431aa14d606f59e623d7c3cc657'
const OUTPUT_PATH = path.resolve(__dirname, '../apps/remix-ide/src/assets/js/soljson.js')
const REQUEST_TIMEOUT_MS = 120000
const MAX_ATTEMPTS = 3

async function download () {
  let lastError
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(SOLC_URL, {
        signal: controller.signal,
        redirect: 'error'
      })
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
      const body = Buffer.from(await response.arrayBuffer())
      if (body.length === 0) throw new Error('the downloaded compiler is empty')
      return body
    } catch (error) {
      lastError = error
      if (attempt < MAX_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, attempt * 1000))
    } finally {
      clearTimeout(timeout)
    }
  }
  throw new Error(`failed to download ${SOLC_URL}: ${lastError && lastError.message}`)
}

async function main () {
  const body = await download()
  const digest = crypto.createHash('sha256').update(body).digest('hex')
  if (digest !== SOLC_SHA256) {
    throw new Error(`compiler SHA-256 mismatch: expected ${SOLC_SHA256}, received ${digest}`)
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
  const temporaryPath = `${OUTPUT_PATH}.tmp-${process.pid}`
  try {
    fs.writeFileSync(temporaryPath, body, { mode: 0o644, flag: 'wx' })
    fs.renameSync(temporaryPath, OUTPUT_PATH)
  } catch (error) {
    try { fs.unlinkSync(temporaryPath) } catch (_) {}
    throw error
  }
  console.log(`Downloaded and verified Solidity compiler (${digest}) -> ${OUTPUT_PATH}`)
}

module.exports = { SOLC_URL, SOLC_SHA256, OUTPUT_PATH }

if (require.main === module) {
  main().catch(error => {
    console.error(`[download-solc-assets] ${error.message}`)
    process.exitCode = 1
  })
}
