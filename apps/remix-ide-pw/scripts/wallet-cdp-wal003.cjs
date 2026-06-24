/*
 * TC-WAL-003: wallet unlocked but site NOT authorized — user rejects the
 * connect request. The IDE must show a normalized message, must not enter the
 * connected state, and a retry must still be possible.
 * Uses http://127.0.0.1:18080 — a hostname TronLink has never authorized —
 * so the existing localhost authorization stays untouched.
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

async function waitForPopup (browser, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const p = walletPopups(browser)[0]
    if (p) return p
    await new Promise((r) => setTimeout(r, 200))
  }
  return null
}

async function tapInPopup (browser, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const popup of walletPopups(browser)) {
      try { await popup.getByText(label, { exact: true }).last().click({ timeout: 1500 }); return true } catch (e) {}
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

;(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const ctx = browser.contexts()[0]
  const page = await ctx.newPage()
  const results = []
  const check = (id, cond, detail) => { results.push({ id, pass: !!cond, detail }); log(cond ? 'PASS' : 'FAIL', id, '—', detail) }
  const headerText = () => page.locator('[data-id="headerWalletConnect"]').textContent().then((t) => (t || '').trim())

  try {
    await page.goto('http://127.0.0.1:18080', { waitUntil: 'domcontentloaded', timeout: 60000 })
    try { await page.locator('button:has-text("I Understand")').click({ timeout: 5000 }) } catch (e) {}
    await page.locator('[data-id="headerWalletConnect"]').waitFor({ timeout: 30000 })

    // Connect from the unauthorized origin → the choose-account popup appears.
    await page.locator('[data-id="headerWalletConnect"]').click()
    const popup = await waitForPopup(browser, 15000)
    check('TC-WAL-003 auth popup appears', !!popup, popup ? 'unauthorized origin prompts' : 'NO popup — origin unexpectedly authorized')
    if (popup) {
      await new Promise((r) => setTimeout(r, 1500))
      await popup.screenshot({ path: `${SHOTS}/w3-auth-popup.png` }).catch(() => {})
      const rejected = await tapInPopup(browser, 'Reject', 15000)
      check('TC-WAL-003 reject clicked', rejected, '')
    }

    // The IDE must settle in a NOT-connected state with a normalized message.
    await page.waitForTimeout(5000)
    const header = await headerText()
    log('header after reject:', header)
    await page.screenshot({ path: `${SHOTS}/w3-after-reject.png` }).catch(() => {})
    check('TC-WAL-003 not connected', !/Wallet T/.test(header), `header="${header}"`)
    check('TC-WAL-003 normalized message', /Connect Wallet/.test(header), `header carries a user-readable state: "${header}"`)
    const envValue = await page.locator('select#selectExEnvOptions').inputValue().catch(() => 'n/a')
    const accCount = await page.locator('select[data-id="runTabSelectAccount"] option').count().catch(() => -1)
    const acc0 = accCount > 0 ? (await page.locator('select[data-id="runTabSelectAccount"] option').first().textContent()) : ''
    log('runtab env:', envValue, '| accounts:', accCount, acc0)
    check('TC-WAL-003 no wallet account leaked', !/^TKGRE6|^TDxTq/.test((acc0 || '').trim()), `account0="${acc0}"`)

    // Retry path: clicking connect again must prompt again (state not wedged).
    await page.locator('[data-id="headerWalletConnect"]').click()
    const popup2 = await waitForPopup(browser, 15000)
    check('TC-WAL-003 retry prompts again', !!popup2, '')
    if (popup2) {
      await new Promise((r) => setTimeout(r, 1200))
      await tapInPopup(browser, 'Reject', 15000)
      log('rejected retry (leave 127.0.0.1 unauthorized)')
    }
  } catch (error) {
    log('ERROR:', error.message)
    await page.screenshot({ path: `${SHOTS}/w3-error.png` }).catch(() => {})
    results.push({ id: 'driver', pass: false, detail: error.message })
  } finally {
    console.log('\n===== RESULTS =====')
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.detail || ''}`)
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})()
