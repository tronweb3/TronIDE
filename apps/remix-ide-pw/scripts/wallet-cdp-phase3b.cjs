/*
 * Phase 3b — TC-WAL-005: switch the TronLink account while connected and
 * verify every IDE read surface follows (header label + RunTab account list).
 * Drives the TronLink popup.html UI in a separate tab. Ends back on "Import".
 */
const { chromium } = require('@playwright/test')
const EXT_HOME = 'chrome-extension://ibnejdfjmmkpcnlpebklmnkoeoihofec/popup/popup.html#/home'
const SHOTS = '/tmp/wallet-batch'
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

function walletPopups (browser) {
  const popups = []
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (p.url().startsWith('chrome-extension://') && /secondary_popup|notification/i.test(p.url())) popups.push(p)
    }
  }
  return popups
}

async function tapInPopup (browser, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const popup of walletPopups(browser)) {
      try {
        await popup.getByText(label, { exact: true }).last().click({ timeout: 1500 })
        return true
      } catch (e) { /* retry */ }
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

async function switchAccount (tl, name) {
  // Top-left account selector ("Import ⌄") opens the account sheet.
  await tl.bringToFront().catch(() => {})
  await tl.mouse.click(70, 33)
  await tl.waitForTimeout(1500)
  await tl.screenshot({ path: `${SHOTS}/3b-account-sheet.png` }).catch(() => {})
  await tl.getByText(name, { exact: true }).first().click({ timeout: 8000 })
  await tl.waitForTimeout(2000)
}

;(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const ctx = browser.contexts()[0]
  const page = await ctx.newPage()
  const tl = await ctx.newPage()
  const results = []
  const check = (id, cond, detail) => { results.push({ id, pass: !!cond, detail }); log(cond ? 'PASS' : 'FAIL', id, '—', detail) }

  const headerText = () => page.locator('[data-id="headerWalletConnect"]').textContent().then((t) => (t || '').trim())
  const runtabAccount = () => page.locator('select[data-id="runTabSelectAccount"] option').first().textContent().catch(() => '')

  try {
    await page.goto('http://localhost:18080', { waitUntil: 'domcontentloaded', timeout: 60000 })
    try { await page.locator('button:has-text("I Understand")').click({ timeout: 5000 }) } catch (e) {}
    await page.locator('[data-id="headerWalletConnect"]').waitFor({ timeout: 30000 })
    await page.locator('[data-id="headerWalletConnect"]').click()
    await page.waitForFunction(() => /Wallet T/.test((document.querySelector('[data-id="headerWalletConnect"]') || {}).textContent || ''), null, { timeout: 90000 })
    log('connected:', await headerText(), '| runtab:', await runtabAccount())

    await tl.setViewportSize({ width: 375, height: 650 })
    await tl.goto(EXT_HOME, { waitUntil: 'domcontentloaded' })
    await tl.waitForTimeout(2500)

    // ---- switch Import → Import-5 ----
    await switchAccount(tl, 'Import-5')
    log('TronLink switched to Import-5')

    // A connect prompt may appear for the not-yet-authorized account → script approves.
    const approved = await tapInPopup(browser, 'Connect', 6000)
    if (approved) log('approved connect for Import-5')

    // IDE surfaces must follow (header poll ≈8s, RunTab poll 1s → allow 20s).
    await page.bringToFront().catch(() => {})
    let headerNow = ''
    let accNow = ''
    const deadline = Date.now() + 25000
    while (Date.now() < deadline) {
      headerNow = await headerText()
      accNow = (await runtabAccount() || '').trim()
      if (/TDxTq/.test(headerNow) && /^TDxTq/.test(accNow)) break
      await new Promise((r) => setTimeout(r, 1000))
    }
    log('after switch → header:', headerNow, '| runtab:', accNow)
    await page.screenshot({ path: `${SHOTS}/3b-after-switch.png` }).catch(() => {})
    check('TC-WAL-005 header follows', /TDxTq/.test(headerNow), `header="${headerNow}"`)
    check('TC-WAL-005 runtab follows', /^TDxTq/.test(accNow), `runtab="${accNow}"`)
    check('TC-WAL-005 no stale old account', !/TKGRE6/.test(headerNow) && !/^TKGRE6/.test(accNow), '')

    // ---- switch back Import-5 → Import (also re-checks the sync inverse) ----
    await switchAccount(tl, 'Import')
    await tapInPopup(browser, 'Connect', 6000)
    await page.bringToFront().catch(() => {})
    let headerBack = ''
    let accBack = ''
    const deadline2 = Date.now() + 25000
    while (Date.now() < deadline2) {
      headerBack = await headerText()
      accBack = (await runtabAccount() || '').trim()
      if (/TKGRE6/.test(headerBack) && /^TKGRE6/.test(accBack)) break
      await new Promise((r) => setTimeout(r, 1000))
    }
    log('after switch-back → header:', headerBack, '| runtab:', accBack)
    check('TC-WAL-005 switch-back syncs', /TKGRE6/.test(headerBack) && /^TKGRE6/.test(accBack), `header="${headerBack}" runtab="${accBack}"`)
  } catch (error) {
    log('ERROR:', error.message)
    await tl.screenshot({ path: `${SHOTS}/3b-error-tl.png` }).catch(() => {})
    await page.screenshot({ path: `${SHOTS}/3b-error-ide.png` }).catch(() => {})
    results.push({ id: 'driver', pass: false, detail: error.message })
  } finally {
    console.log('\n===== RESULTS =====')
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.detail || ''}`)
    await tl.close().catch(() => {})
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})()
