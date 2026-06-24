/*
 * Phase 3c — TC-WAL-006 (S0): start a deploy, and while the TronLink signing
 * window is pending, switch the wallet account; then try to confirm.
 * Oracle: the broadcast MUST be blocked (by IDE guard or wallet) and the user
 * must see an account-change warning — never a silent wrong-account tx.
 * Heavy logging + screenshots; ends restoring the "Import" account.
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
  await tl.bringToFront().catch(() => {})
  await tl.mouse.click(70, 33)
  await tl.waitForTimeout(1500)
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

  try {
    await page.goto('http://localhost:18080', { waitUntil: 'domcontentloaded', timeout: 60000 })
    try { await page.locator('button:has-text("I Understand")').click({ timeout: 5000 }) } catch (e) {}
    await page.locator('[data-id="headerWalletConnect"]').waitFor({ timeout: 30000 })

    const storage = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await storage.isVisible()) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await storage.click()
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await page.locator('*[data-id="compiledContracts"]').waitFor({ timeout: 30000 })

    await page.locator('[data-id="headerWalletConnect"]').click()
    await page.waitForFunction(() => /Wallet T/.test((document.querySelector('[data-id="headerWalletConnect"]') || {}).textContent || ''), null, { timeout: 90000 })
    const fromAccount = ((await page.locator('select[data-id="runTabSelectAccount"] option').first().textContent()) || '').trim()
    log('connected, deploying from:', fromAccount)
    await page.locator('#runTabView select[class^="contractNames"]').selectOption('Storage')

    await tl.setViewportSize({ width: 375, height: 650 })
    await tl.goto(EXT_HOME, { waitUntil: 'domcontentloaded' })
    await tl.waitForTimeout(2000)

    // ---- deploy → pending ----
    const journalBefore = ((await page.locator('#journal').textContent().catch(() => '')) || '').length
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    let pending = null
    const t0 = Date.now()
    while (!pending && Date.now() - t0 < 20000) {
      pending = walletPopups(browser)[0] || null
      if (!pending) await new Promise((r) => setTimeout(r, 200))
    }
    check('TC-WAL-006 popup pending', !!pending, '')
    if (!pending) throw new Error('no signing popup')
    await new Promise((r) => setTimeout(r, 2000))

    // ---- switch account WHILE pending ----
    log('switching account to Import-5 while signature is pending…')
    await switchAccount(tl, 'Import-5')
    const popupsAfterSwitch = walletPopups(browser)
    log('popups alive after switch:', popupsAfterSwitch.map((p) => p.url().split('#')[1] || p.url()))
    for (let i = 0; i < popupsAfterSwitch.length; i++) {
      await popupsAfterSwitch[i].screenshot({ path: `${SHOTS}/3c-after-switch-${i}.png` }).catch(() => {})
    }

    let signed = false
    if (popupsAfterSwitch.length) {
      // Try to confirm the stale request (the dangerous action under test).
      signed = await tapInPopup(browser, 'Sign', 8000)
      log(signed ? 'clicked Sign on the stale pending request' : 'Sign not clickable / popup gone')
    } else {
      log('TronLink closed the pending request on account switch (wallet-level block)')
    }

    await page.waitForTimeout(6000)
    const fresh = ((await page.locator('#journal').textContent().catch(() => '')) || '').slice(journalBefore).replace(/\s+/g, ' ')
    log('terminal:', fresh.slice(0, 400))
    await page.screenshot({ path: `${SHOTS}/3c-ide-after.png` }).catch(() => {})

    const broadcast = /\[block:\d+/.test(fresh)
    const errored = /errored|declined|reject|account|cancel/i.test(fresh)
    check('TC-WAL-006 no broadcast', !broadcast, broadcast ? 'TX WAS BROADCAST — S0 FAIL' : 'no block marker in terminal')
    check('TC-WAL-006 user feedback', errored || !popupsAfterSwitch.length, `terminal≈"${fresh.slice(0, 200)}"`)
    check('TC-WAL-006 no instance', (await page.locator('.instance').count()) === 0, '')

    // ---- cleanup: reject leftovers, restore account ----
    await tapInPopup(browser, 'Reject', 4000)
    await switchAccount(tl, 'Import')
    await tapInPopup(browser, 'Connect', 5000)
    log('restored Import account')
  } catch (error) {
    log('ERROR:', error.message)
    await page.screenshot({ path: `${SHOTS}/3c-error.png` }).catch(() => {})
    results.push({ id: 'driver', pass: false, detail: error.message })
  } finally {
    console.log('\n===== RESULTS =====')
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.detail || ''}`)
    await tl.close().catch(() => {})
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})()
