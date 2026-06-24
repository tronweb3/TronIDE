/*
 * TC-WAL-010: reject a deploy signature in TronLink → IDE shows a normalized
 * error, recovers, and does not double-submit. Safe case: nothing broadcasts.
 */
const { chromium } = require('@playwright/test')

const IDE_URL = 'http://localhost:18080'
const CDP_URL = 'http://localhost:9223'
const SHOTS = '/tmp/wallet-batch'
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

function walletPopups (browser) {
  const popups = []
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      const url = p.url()
      if (url.startsWith('chrome-extension://') && /secondary_popup|notification|confirm/i.test(url)) popups.push(p)
    }
  }
  return popups
}

async function waitForSigningPopup (browser, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const popups = walletPopups(browser)
    if (popups.length) return popups[0]
    await new Promise((r) => setTimeout(r, 300))
  }
  return null
}

// TronLink recreates its popup target while rendering — re-resolve the page
// on every attempt and swallow "target closed" races until the click sticks.
async function clickInPopup (browser, namePattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const popup of walletPopups(browser)) {
      try {
        const btn = popup.getByRole('button', { name: namePattern }).last()
        await btn.click({ timeout: 2000 })
        return true
      } catch (e) { /* retry with a fresh target */ }
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

async function connectViaHeader (page) {
  await page.locator('[data-id="headerWalletConnect"]').click()
  await page.waitForFunction(() => /Wallet T/.test((document.querySelector('[data-id="headerWalletConnect"]') || {}).textContent || ''), null, { timeout: 30000 })
}

;(async () => {
  const browser = await chromium.connectOverCDP(CDP_URL)
  const ctx = browser.contexts()[0]
  const page = await ctx.newPage()
  const results = []
  const check = (id, cond, detail) => { results.push({ id, pass: !!cond, detail }); log(cond ? 'PASS' : 'FAIL', id, '—', detail) }

  try {
    await page.goto(IDE_URL, { waitUntil: 'domcontentloaded' })
    try { await page.locator('button:has-text("I Understand")').click({ timeout: 5000 }) } catch (e) {}
    await page.locator('[data-id="headerWalletConnect"]').waitFor({ timeout: 30000 })

    // Compile Storage first (VM-independent).
    const storage = page.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await storage.isVisible()) await page.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await storage.click()
    await page.locator('#icon-panel div[plugin="solidity"]').click()
    await page.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await page.locator('*[data-id="compiledContracts"]').waitFor({ timeout: 30000 })
    log('compiled Storage')

    await connectViaHeader(page)
    log('wallet connected (injected env active)')
    await page.locator('#runTabView select[class^="contractNames"]').selectOption('Storage')

    // Deploy → TronLink signing window appears.
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    const popup = await waitForSigningPopup(browser, 20000)
    check('TC-WAL-010 signing popup', !!popup, popup ? popup.url() : 'no popup within 20s')
    if (popup) {
      await popup.screenshot({ path: `${SHOTS}/10-sign-popup.png` }).catch(() => {})
      const rejected = await clickInPopup(browser, /^(拒绝|取消|Reject|Cancel|Decline)$/, 15000)
      check('TC-WAL-010 reject clicked', rejected, rejected ? 'clicked Reject' : 'could not click Reject')
    }

    // IDE must surface a normalized rejection and recover.
    await page.waitForTimeout(3000)
    const journal = (await page.locator('#journal').textContent().catch(() => '')) || ''
    const tail = journal.slice(-600).replace(/\s+/g, ' ')
    log('terminal tail:', tail.slice(-300))
    check('TC-WAL-010 normalized error', /reject|denied|cancel|拒绝/i.test(tail), `tail≈"${tail.slice(-160)}"`)
    check('TC-WAL-010 no instance', (await page.locator('.instance').count()) === 0, 'no deployed instance after reject')

    // No duplicate submission: no second signing popup lingering.
    await page.waitForTimeout(2000)
    check('TC-WAL-010 no duplicate popup', walletPopups(browser).length === 0, 'no further signing window')

    // Recovery: a second deploy attempt brings a fresh popup; reject it again to stay clean.
    await page.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    const popup2 = await waitForSigningPopup(browser, 20000)
    check('TC-WAL-011-lite recoverable', !!popup2, popup2 ? 'second attempt prompts again' : 'no popup on retry')
    if (popup2) {
      await clickInPopup(browser, /^(拒绝|取消|Reject|Cancel|Decline)$/, 15000)
      log('rejected second attempt (cleanup)')
    }

    // Leave disconnected.
    await page.locator('[data-id="headerWalletConnect"]').click()
    await page.locator('[data-id="headerWalletDisconnect"]').click({ timeout: 5000 }).catch(() => {})
  } catch (error) {
    log('ERROR:', error.message)
    await page.screenshot({ path: `${SHOTS}/19-error.png` }).catch(() => {})
    results.push({ id: 'driver', pass: false, detail: error.message })
  } finally {
    console.log('\n===== RESULTS =====')
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.detail || ''}`)
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})()
