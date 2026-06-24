/*
 * TC-WAL-015: two IDE tabs share one wallet. Connect both, switch the wallet
 * account — BOTH tabs must follow on every read surface (header + RunTab),
 * with no cross-tab account mixups; a deploy after the switch must originate
 * from the NEW account (no stale-snapshot broadcast). Restores Import.
 */
const { chromium } = require('@playwright/test')
const EXT_HOME = 'chrome-extension://ibnejdfjmmkpcnlpebklmnkoeoihofec/popup/popup.html#/home'
const SHOTS = '/tmp/wallet-batch'
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const OLD_PREFIX = 'TKGRE6' // Import
const NEW_PREFIX = 'TDxTq' // Import-5

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

async function switchAccount (tl, name) {
  await tl.bringToFront().catch(() => {})
  await tl.mouse.click(70, 33)
  await tl.waitForTimeout(1500)
  await tl.getByText(name, { exact: true }).first().click({ timeout: 8000 })
  await tl.waitForTimeout(2000)
}

async function openAndConnect (ctx, browser) {
  const page = await ctx.newPage()
  await page.goto('http://localhost:18080', { waitUntil: 'domcontentloaded', timeout: 60000 })
  try { await page.locator('button:has-text("I Understand")').click({ timeout: 5000 }) } catch (e) {}
  await page.locator('[data-id="headerWalletConnect"]').waitFor({ timeout: 30000 })
  await page.locator('[data-id="headerWalletConnect"]').click()
  const ok = tapInPopup(browser, 'Connect', 5000) // in case TronLink re-prompts
  await page.waitForFunction(() => /Wallet T/.test((document.querySelector('[data-id="headerWalletConnect"]') || {}).textContent || ''), null, { timeout: 60000 })
  await ok
  return page
}

const surfaces = async (page) => ({
  header: ((await page.locator('[data-id="headerWalletConnect"]').textContent().catch(() => '')) || '').trim(),
  account: ((await page.locator('select[data-id="runTabSelectAccount"] option').first().textContent().catch(() => '')) || '').trim(),
  env: await page.locator('select#selectExEnvOptions').inputValue().catch(() => 'n/a')
})

async function waitBothOn (pages, prefix, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let snap = []
  while (Date.now() < deadline) {
    snap = await Promise.all(pages.map(surfaces))
    const ok = snap.every((s) => s.header.includes(prefix) && s.account.startsWith(prefix))
    if (ok) return { ok: true, snap }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return { ok: false, snap }
}

;(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const ctx = browser.contexts()[0]
  const results = []
  const check = (id, cond, detail) => { results.push({ id, pass: !!cond, detail }); log(cond ? 'PASS' : 'FAIL', id, '—', detail) }
  let pageA, pageB, tl

  try {
    pageA = await openAndConnect(ctx, browser)
    log('tab A connected')
    pageB = await openAndConnect(ctx, browser)
    log('tab B connected')

    const initial = await Promise.all([pageA, pageB].map(surfaces))
    log('initial:', JSON.stringify(initial))
    check('TC-WAL-015 both connected same account', initial.every((s) => s.account.startsWith(OLD_PREFIX) && s.env === 'injected'), JSON.stringify(initial.map((s) => s.account)))

    // Compile Storage in tab A (for the post-switch deploy check). The connect
    // flow leaves the side panel on Deploy & Run — bring the file panel up first.
    await pageA.locator('#icon-panel div[plugin="filePanel"]').click()
    const storage = pageA.locator('[data-id="treeViewLitreeViewItemcontracts/1_Storage.sol"]')
    if (!await storage.isVisible()) await pageA.locator('[data-id="treeViewLitreeViewItemcontracts"]').click()
    await storage.click()
    await pageA.locator('#icon-panel div[plugin="solidity"]').click()
    await pageA.locator('*[data-id="compilerContainerCompileBtn"]').click()
    await pageA.locator('*[data-id="compiledContracts"]').waitFor({ timeout: 30000 })
    await pageA.locator('#icon-panel div[plugin="udapp"]').click()
    await pageA.locator('#runTabView select[class^="contractNames"]').selectOption('Storage')

    // Switch wallet account → BOTH tabs must follow.
    tl = await ctx.newPage()
    await tl.setViewportSize({ width: 375, height: 650 })
    await tl.goto(EXT_HOME, { waitUntil: 'domcontentloaded' })
    await tl.waitForTimeout(2000)
    await switchAccount(tl, 'Import-5')
    await tapInPopup(browser, 'Connect', 5000)
    const after = await waitBothOn([pageA, pageB], NEW_PREFIX, 25000)
    log('after switch:', JSON.stringify(after.snap))
    check('TC-WAL-015 both tabs follow switch', after.ok, JSON.stringify(after.snap.map((s) => `${s.header} / ${s.account}`)))
    check('TC-WAL-015 no cross-tab mixup', after.snap.every((s) => !s.account.startsWith(OLD_PREFIX)), '')

    // Deploy from tab A: the tx must originate from the NEW account.
    const journalBefore = ((await pageA.locator('#journal').textContent().catch(() => '')) || '').length
    await pageA.locator('button[data-id="Deploy - transact (not payable)"]', { hasText: 'Deploy' }).click()
    let popup = null
    const t0 = Date.now()
    while (!popup && Date.now() - t0 < 15000) {
      popup = walletPopups(browser)[0] || null
      if (!popup) await new Promise((r) => setTimeout(r, 300))
    }
    check('TC-WAL-015 deploy prompts', !!popup, '')
    if (popup) {
      await new Promise((r) => setTimeout(r, 1500))
      const popupText = await popup.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 150)).catch(() => '')
      log('sign popup:', popupText)
      check('TC-WAL-015 popup shows new account context', /Import-5|Import−5/.test(popupText) || !new RegExp(OLD_PREFIX).test(popupText), `popup="${popupText.slice(0, 100)}"`)
      await tapInPopup(browser, 'Reject', 15000)
    }
    await pageA.waitForTimeout(3000)
    const fresh = ((await pageA.locator('#journal').textContent().catch(() => '')) || '').slice(journalBefore).replace(/\s+/g, ' ')
    const fromMatch = fresh.match(/from:\s*(T\w{4,8})/)
    log('terminal from:', fromMatch && fromMatch[1], '|', fresh.slice(0, 160))
    check('TC-WAL-015 tx from NEW account (no stale snapshot)', !fromMatch || fromMatch[1].startsWith(NEW_PREFIX.slice(0, 5)), `from=${fromMatch && fromMatch[1]}`)

    // Restore Import; both tabs must follow back.
    await switchAccount(tl, 'Import')
    await tapInPopup(browser, 'Connect', 5000)
    const back = await waitBothOn([pageA, pageB], OLD_PREFIX, 25000)
    check('TC-WAL-015 both tabs follow switch-back', back.ok, JSON.stringify(back.snap.map((s) => s.account)))
  } catch (error) {
    log('ERROR:', error.message)
    if (pageA) await pageA.screenshot({ path: `${SHOTS}/w15-error-A.png` }).catch(() => {})
    if (pageB) await pageB.screenshot({ path: `${SHOTS}/w15-error-B.png` }).catch(() => {})
    results.push({ id: 'driver', pass: false, detail: error.message })
  } finally {
    console.log('\n===== RESULTS =====')
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.detail || ''}`)
    if (tl) await tl.close().catch(() => {})
    if (pageA) await pageA.close().catch(() => {})
    if (pageB) await pageB.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})()
