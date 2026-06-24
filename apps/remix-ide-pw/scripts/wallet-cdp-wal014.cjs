/*
 * TC-WAL-014: Sign message via the RunTab account row. Flow: sign icon →
 * message prompt → in-app confirmation (provider/network/account/hash) →
 * TronLink signMessageV2 popup → result modal with hash + signature.
 * Asserts hash/signature formats and that the displayed hash matches the
 * pre-computed personal-message hash shown in the confirmation step.
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

async function tapInPopup (browser, labelRe, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const popup of walletPopups(browser)) {
      try { await popup.getByText(labelRe, { exact: true }).last().click({ timeout: 1500 }); return true } catch (e) {}
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
    await page.locator('[data-id="headerWalletConnect"]').click()
    await page.waitForFunction(() => /Wallet T/.test((document.querySelector('[data-id="headerWalletConnect"]') || {}).textContent || ''), null, { timeout: 90000 })
    await page.waitForFunction(() => {
      const sel = document.querySelector('select[data-id="runTabSelectAccount"]')
      return sel && sel.options.length > 0
    }, null, { timeout: 20000 })
    log('connected')

    // Sign icon → message prompt.
    await page.locator('[data-id="settingsRemixRunSignMsg"]').click()
    const textarea = page.locator('[data-id="modalDialogCustomPromptText"]')
    await textarea.waitFor({ state: 'visible', timeout: 10000 })
    const MESSAGE = 'TronIDE TC-WAL-014 sign message check'
    await textarea.fill(MESSAGE)
    await page.locator('#modal-footer-ok').click()

    // In-app confirmation modal shows context + expected hash; grab the hash.
    const confirmBody = page.locator('.modal-body, [class*="modalBody"]').last()
    await page.getByText('Confirm message signature').waitFor({ timeout: 10000 })
    const confirmText = ((await confirmBody.textContent().catch(() => '')) || '').replace(/\s+/g, ' ')
    const expectedHash = (confirmText.match(/0x[0-9a-fA-F]{64}/) || [])[0]
    log('confirmation shows:', confirmText.slice(0, 220))
    check('TC-WAL-014 confirmation context', /Provider/.test(confirmText) && /Account/.test(confirmText) && !!expectedHash, `hash=${expectedHash}`)
    await page.screenshot({ path: `${SHOTS}/w14-confirm.png` }).catch(() => {})
    await page.locator('#modal-footer-ok').click() // 'Sign'

    // TronLink message-signature popup → approve.
    const approved = await tapInPopup(browser, /^(Sign|签名|确认|Confirm)$/, 20000)
    check('TC-WAL-014 wallet prompt + approve', approved, '')

    // Result modal: hash + signature.
    const hashEl = page.locator('[data-id="settingsRemixRunSignMsgHash"]')
    await hashEl.waitFor({ timeout: 20000 })
    const hash = ((await hashEl.textContent()) || '').trim()
    const signature = ((await page.locator('[data-id="settingsRemixRunSignMsgSignature"]').textContent()) || '').trim()
    log('hash:', hash)
    log('signature:', signature.slice(0, 70) + '…')
    await page.screenshot({ path: `${SHOTS}/w14-result.png` }).catch(() => {})

    check('TC-WAL-014 hash format', /^0x[0-9a-fA-F]{64}$/.test(hash), hash)
    check('TC-WAL-014 hash matches confirmation', !expectedHash || hash.toLowerCase() === expectedHash.toLowerCase(), '')
    check('TC-WAL-014 signature format', /^0x[0-9a-fA-F]{130}$/.test(signature), `len=${signature.length}`)

    // Cryptographic round-trip: the signature must recover to the signing
    // account under TronLink's V2 message scheme.
    const recovered = await page.evaluate(async ({ msg, sig }) => {
      try { return await window.tronWeb.trx.verifyMessageV2(msg, sig) } catch (e) { return `verify-error: ${e.message || e}` }
    }, { msg: MESSAGE, sig: signature })
    const account = ((await page.locator('select[data-id="runTabSelectAccount"] option').first().textContent()) || '').trim()
    log('recovered:', recovered, '| account:', account)
    check('TC-WAL-014 signature recovers to account', recovered === account, `recovered=${recovered}`)
    await page.locator('#modal-footer-ok').click().catch(() => {})
  } catch (error) {
    log('ERROR:', error.message)
    await page.screenshot({ path: `${SHOTS}/w14-error.png` }).catch(() => {})
    results.push({ id: 'driver', pass: false, detail: error.message })
  } finally {
    await tapInPopup(browser, /^(拒绝|取消|Reject|Cancel)$/, 2000)
    console.log('\n===== RESULTS =====')
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.detail || ''}`)
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})()
