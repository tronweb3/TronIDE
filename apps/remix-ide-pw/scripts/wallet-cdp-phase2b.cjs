/*
 * Phase 2b: after clearing TronLink connection data —
 * 1. reconnect (inspect the connect popup for any auto-sign/whitelist option,
 *    approve WITHOUT enabling anything extra)
 * 2. deploy → the signing popup must now stay pending (no auto-sign)
 * 3. TC-WAL-010: click Reject → IDE surfaces a normalized error, no instance
 */
const { chromium } = require('@playwright/test')
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

async function waitForPopup (browser, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const popups = walletPopups(browser)
    if (popups.length) return popups[0]
    await new Promise((r) => setTimeout(r, 300))
  }
  return null
}

async function clickInPopup (browser, namePattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const popup of walletPopups(browser)) {
      try {
        await popup.getByRole('button', { name: namePattern }).last().click({ timeout: 2000 })
        return true
      } catch (e) { /* retry */ }
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

;(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const ctx = browser.contexts()[0]
  const page = await ctx.newPage()
  const results = []
  const check = (id, cond, detail) => { results.push({ id, pass: !!cond, detail }); log(cond ? 'PASS' : 'FAIL', id, '—', detail) }

  try {
    await page.goto('http://localhost:18080', { waitUntil: 'domcontentloaded' })
    try { await page.locator('button:has-text("I Understand")').click({ timeout: 5000 }) } catch (e) {}
    await page.locator('[data-id="headerWalletConnect"]').waitFor({ timeout: 30000 })

    // Compile Storage.
    const storage = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await storage.isVisible()) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await storage.click()
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await page.locator('*[data-id="compiledContracts"]').waitFor({ timeout: 30000 })

    // Connect: authorization was cleared, so the choose-account popup must come back.
    await page.locator('[data-id="headerWalletConnect"]').click()
    const connectPopup = await waitForPopup(browser, 15000)
    check('reauth popup appears', !!connectPopup, connectPopup ? connectPopup.url() : 'no popup — connection data not cleared?')
    if (connectPopup) {
      await new Promise((r) => setTimeout(r, 1500))
      const text = await connectPopup.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 600)).catch(() => '')
      log('connect popup text:', text)
      const checkboxes = await connectPopup.evaluate(() => [...document.querySelectorAll('input[type="checkbox"]')].map((c) => ({ checked: c.checked, label: (c.closest('label') || c.parentElement || {}).textContent || '' }))).catch(() => [])
      log('checkboxes:', JSON.stringify(checkboxes))
      await connectPopup.screenshot({ path: `${SHOTS}/20-reauth-popup.png` }).catch(() => {})
      const ok = await clickInPopup(browser, /^(连接|Connect)$/, 15000)
      check('approve connect', ok, 'clicked Connect')
    }
    await page.waitForFunction(() => /Wallet T/.test((document.querySelector('[data-id="headerWalletConnect"]') || {}).textContent || ''), null, { timeout: 30000 })
    log('connected')
    await page.locator('#runTabView select[class^="contractNames"]').selectOption('Storage')

    // Deploy → popup must now STAY pending (observe 15s without clicking).
    const journalBefore = ((await page.locator('#journal').textContent().catch(() => '')) || '').length
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    const signPopup = await waitForPopup(browser, 20000)
    check('signing popup appears', !!signPopup, signPopup ? signPopup.url() : 'none')
    let stayedPending = false
    if (signPopup) {
      const t0 = Date.now()
      while (Date.now() - t0 < 15000) {
        if (!walletPopups(browser).length) break
        await new Promise((r) => setTimeout(r, 500))
      }
      stayedPending = walletPopups(browser).length > 0
      check('no auto-sign', stayedPending, stayedPending ? 'popup still pending after 15s' : `popup closed by itself after ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    }

    if (stayedPending) {
      // TC-WAL-010: reject.
      await walletPopups(browser)[0].screenshot({ path: `${SHOTS}/21-sign-pending.png` }).catch(() => {})
      const rejected = await clickInPopup(browser, /^(拒绝|取消|Reject|Cancel)$/, 15000)
      check('TC-WAL-010 reject clicked', rejected, '')
      await page.waitForTimeout(4000)
      const journal = ((await page.locator('#journal').textContent().catch(() => '')) || '')
      const fresh = journal.slice(journalBefore).replace(/\s+/g, ' ')
      log('new terminal output:', fresh.slice(0, 300))
      check('TC-WAL-010 normalized error', /reject|denied|cancel|declined|拒绝/i.test(fresh), `out≈"${fresh.slice(0, 160)}"`)
      check('TC-WAL-010 no instance', (await page.locator('.instance').count()) === 0, 'no instance after reject')
      check('TC-WAL-010 no stray popup', walletPopups(browser).length === 0, '')
    }

    // Leave connected for the next phase (account-switch tests).
  } catch (error) {
    log('ERROR:', error.message)
    await page.screenshot({ path: `${SHOTS}/29-error.png` }).catch(() => {})
    results.push({ id: 'driver', pass: false, detail: error.message })
  } finally {
    console.log('\n===== RESULTS =====')
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.detail || ''}`)
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})()
