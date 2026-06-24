/*
 * TC-WAL-011: a signature request left unconfirmed for a long time. The IDE
 * has no active timeout of its own (WALLET_SIGN_TIMEOUT only normalizes
 * wallet-side timeout errors), so the oracle is: nothing wedges while the
 * request pends (UI stays responsive), and after the request finally resolves
 * (rejected here) the state recovers and a new attempt prompts again.
 * Observation window: 120s untouched.
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
    await page.locator('#runTabView select[class^="contractNames"]').selectOption('Storage')

    const journalBefore = ((await page.locator('#journal').textContent().catch(() => '')) || '').length
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    const t0 = Date.now()
    while (!walletPopups(browser).length && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 300))
    check('TC-WAL-011 popup pending', walletPopups(browser).length > 0, '')

    // 120s untouched. Every 10s: is the popup still pending? is the IDE alive?
    log('leaving the signature request pending for 120s…')
    let popupVanishedAt = 0
    let uiAliveThroughout = true
    for (let i = 1; i <= 12; i++) {
      await page.waitForTimeout(10000)
      const pendingNow = walletPopups(browser).length > 0
      if (!pendingNow && !popupVanishedAt) popupVanishedAt = i * 10
      const alive = await page.evaluate(() => document.querySelector('[data-id="headerWalletConnect"]') !== null && 1 + 1 === 2).catch(() => false)
      if (!alive) uiAliveThroughout = false
      log(`t+${i * 10}s pending=${pendingNow} ideAlive=${alive}`)
    }
    check('TC-WAL-011 UI alive during long pend', uiAliveThroughout, '')
    if (popupVanishedAt) {
      // Wallet-side auto-timeout happened — the IDE must have surfaced an error.
      const fresh = ((await page.locator('#journal').textContent().catch(() => '')) || '').slice(journalBefore).replace(/\s+/g, ' ')
      log(`popup self-resolved at ~t+${popupVanishedAt}s; terminal:`, fresh.slice(0, 200))
      check('TC-WAL-011 wallet timeout surfaced', /errored|timed out|timeout|declined/i.test(fresh), `terminal≈"${fresh.slice(0, 150)}"`)
    } else {
      log('no wallet-side auto-timeout within 120s (request stays pending) — resolving by reject')
      const rejected = await tapInPopup(browser, 'Reject', 15000)
      check('TC-WAL-011 still resolvable after 120s', rejected, '')
      await page.waitForTimeout(4000)
      const fresh = ((await page.locator('#journal').textContent().catch(() => '')) || '').slice(journalBefore).replace(/\s+/g, ' ')
      check('TC-WAL-011 normalized resolution', /declined|reject|errored/i.test(fresh), `terminal≈"${fresh.slice(0, 150)}"`)
    }
    check('TC-WAL-011 no instance', (await page.locator('.instance').count()) === 0, '')

    // Recovery: a fresh attempt must prompt again.
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    const t1 = Date.now()
    while (!walletPopups(browser).length && Date.now() - t1 < 20000) await new Promise((r) => setTimeout(r, 300))
    check('TC-WAL-011 re-initiation prompts', walletPopups(browser).length > 0, '')
    await tapInPopup(browser, 'Reject', 15000)
    log('cleanup reject done')
  } catch (error) {
    log('ERROR:', error.message)
    await page.screenshot({ path: `${SHOTS}/w11-error.png` }).catch(() => {})
    results.push({ id: 'driver', pass: false, detail: error.message })
  } finally {
    console.log('\n===== RESULTS =====')
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.detail || ''}`)
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})()
