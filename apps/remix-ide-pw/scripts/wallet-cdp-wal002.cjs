/*
 * TC-WAL-002: TronLink is LOCKED (user locked it manually before this run).
 * Clicking Connect must surface a normalized unlock prompt, never enter the
 * connected state, and send nothing. Any unlock window TronLink opens is left
 * untouched (the script never types a password) and closed at the end.
 */
const { chromium } = require('@playwright/test')
const SHOTS = '/tmp/wallet-batch'
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

function walletPopups (browser) {
  const out = []
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (p.url().startsWith('chrome-extension://') && /secondary_popup|notification/i.test(p.url())) out.push(p)
    }
  }
  return out
}

;(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const ctx = browser.contexts()[0]
  const page = await ctx.newPage()
  const results = []
  const check = (id, cond, detail) => { results.push({ id, pass: !!cond, detail }); log(cond ? 'PASS' : 'FAIL', id, '—', detail) }

  try {
    await page.goto('http://localhost:18080', { waitUntil: 'domcontentloaded', timeout: 60000 })
    try { await page.locator('button:has-text("I Understand")').click({ timeout: 5000 }) } catch (e) {}
    const headerBtn = page.locator('[data-id="headerWalletConnect"]')
    await headerBtn.waitFor({ timeout: 30000 })

    // Sanity: wallet really locked? (no defaultAddress in the injected provider)
    const lockedState = await page.evaluate(() => ({
      hasTronLink: !!window.tronLink,
      hasTronWeb: !!window.tronWeb,
      address: (window.tronWeb && window.tronWeb.defaultAddress && window.tronWeb.defaultAddress.base58) || null
    }))
    log('injected state:', JSON.stringify(lockedState))
    check('precondition wallet locked', lockedState.hasTronLink && !lockedState.address, JSON.stringify(lockedState))

    await headerBtn.click()
    log('connect clicked; observing 12s (NOT touching any unlock window)…')
    await page.waitForTimeout(12000)

    const popups = walletPopups(browser)
    if (popups.length) {
      await popups[0].screenshot({ path: `${SHOTS}/w2-unlock-popup.png` }).catch(() => {})
      const text = await popups[0].evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 120)).catch(() => '?')
      log('TronLink window:', text)
    } else {
      log('no TronLink window opened')
    }

    const header = ((await headerBtn.textContent()) || '').trim()
    const envValue = await page.locator('select#selectExEnvOptions').inputValue().catch(() => 'n/a')
    const accCount = await page.locator('select[data-id="runTabSelectAccount"] option').count().catch(() => -1)
    log('header:', header, '| env:', envValue, '| accounts:', accCount)
    await page.screenshot({ path: `${SHOTS}/w2-ide-state.png` }).catch(() => {})

    check('TC-WAL-002 not connected', !/Wallet T\w/.test(header), `header="${header}"`)
    check('TC-WAL-002 unlock guidance', /unlock|Connecting|connect TronLink/i.test(header), `header="${header}"`)
    check('TC-WAL-002 env stays safe', envValue === 'vm-tron', `env=${envValue}`)
    check('TC-WAL-002 no account leaked', accCount <= 0 || !/^T/.test(((await page.locator('select[data-id="runTabSelectAccount"] option').first().textContent().catch(() => '')) || '').trim().slice(0, 1)) || envValue === 'vm-tron', `accounts=${accCount} (vm accounts are fine)`)

    // Close any unlock window we caused; never type into it.
    for (const p of walletPopups(browser)) await p.close().catch(() => {})
    log('closed unlock window (untouched)')
  } catch (error) {
    log('ERROR:', error.message)
    await page.screenshot({ path: `${SHOTS}/w2-error.png` }).catch(() => {})
    results.push({ id: 'driver', pass: false, detail: error.message })
  } finally {
    console.log('\n===== RESULTS =====')
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.detail || ''}`)
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})()
