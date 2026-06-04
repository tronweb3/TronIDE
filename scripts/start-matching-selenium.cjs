#!/usr/bin/env node

const childProcess = require('child_process')
const https = require('https')
const selenium = require('selenium-standalone')

const mode = process.argv[2] || 'start'
const chromeVersion = process.env.CHROME_VERSION || detectChromeVersion()
const majorVersion = chromeVersion.split('.')[0]
const platform = resolvePlatform()

if (!platform) {
  console.error(`Unsupported ChromeDriver platform for this helper: ${process.platform}/${process.arch}`)
  process.exit(1)
}

// Map the host to a chrome-for-testing platform key (macOS dev + Linux CI).
function resolvePlatform () {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'linux-arm64' : 'linux64'
  if (process.platform === 'win32') return 'win64'
  return undefined
}

async function main () {
  const chromeDriverVersion = process.env.CHROMEDRIVER_VERSION || await resolveChromeDriverVersion(chromeVersion)
  const fullURL = `https://storage.googleapis.com/chrome-for-testing-public/${chromeDriverVersion}/${platform}/chromedriver-${platform}.zip`
  const driver = {
    version: chromeDriverVersion,
    fullURL,
    baseURL: 'https://storage.googleapis.com/chrome-for-testing-public'
  }

  console.log(`Using Chrome ${chromeVersion}; starting ChromeDriver ${chromeDriverVersion}`)
  await selenium.install({ drivers: { chrome: driver } })
  if (mode === 'install') return
  await selenium.start({ drivers: { chrome: driver } })
}

async function resolveChromeDriverVersion (version) {
  const url = 'https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json'
  const response = await fetchJSON(url)
  const exactMatch = response.versions.find((item) => item.version === version && item.downloads && item.downloads.chromedriver)
  if (exactMatch) return exactMatch.version

  const candidates = response.versions
    .filter((item) => item.version.startsWith(`${majorVersion}.`) && item.downloads && item.downloads.chromedriver)
    .sort((left, right) => left.version.localeCompare(right.version, undefined, { numeric: true, sensitivity: 'base' }))

  if (!candidates.length) {
    throw new Error(`No ChromeDriver found for Chrome major version ${majorVersion}`)
  }

  return candidates[candidates.length - 1].version
}

function fetchJSON (url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 10000 }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(`GET ${url} failed with status ${response.statusCode}`))
        }
        try {
          resolve(JSON.parse(body))
        } catch (error) {
          reject(error)
        }
      })
    })

    request.on('timeout', () => request.destroy(new Error(`GET ${url} timed out`)))
    request.on('error', reject)
  })
}

function detectChromeVersion () {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : process.platform === 'win32'
      ? ['chrome', 'chrome.exe']
      : ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium']

  for (const binary of candidates) {
    try {
      const output = childProcess.execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim()
      const match = output.match(/(\d+\.\d+\.\d+\.\d+)/)
      if (match) return match[1]
    } catch (error) {
      // Try the next candidate binary.
    }
  }

  console.error('Unable to detect Chrome version; set CHROME_VERSION or CHROMEDRIVER_VERSION explicitly.')
  process.exit(1)
}

main().catch((error) => {
  if (majorVersion && error && error.message && error.message.includes('No ChromeDriver found')) {
    console.error(`Try setting CHROMEDRIVER_VERSION to an available ${majorVersion}.x patch.`)
  }
  console.error(error)
  process.exit(1)
})
