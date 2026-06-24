/*
 * Generic TronLink popup UI driver: opens popup.html in a tab, performs a
 * sequence of actions given on the CLI, screenshots after each step.
 * Usage: node tronlink-ui.cjs shot                      → screenshot home
 *        node tronlink-ui.cjs click "Settings" shot     → click by text, shot
 *        node tronlink-ui.cjs dump                      → dump clickable texts
 */
const { chromium } = require('@playwright/test')
const EXT = 'chrome-extension://ibnejdfjmmkpcnlpebklmnkoeoihofec/popup/popup.html#/home'
const SHOTS = '/tmp/wallet-batch'
const log = (...a) => console.log(...a)

;(async () => {
  const fs = require('fs')
  fs.mkdirSync(SHOTS, { recursive: true })
  const browser = await chromium.connectOverCDP('http://localhost:9223')
  const ctx = browser.contexts()[0]
  const page = await ctx.newPage()
  let shotIdx = 0
  try {
    await page.setViewportSize({ width: 375, height: 650 })
    await page.goto(EXT, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)

    const args = process.argv.slice(2)
    for (let i = 0; i < args.length; i++) {
      const cmd = args[i]
      if (cmd === 'shot') {
        const p = `${SHOTS}/ui-${String(++shotIdx).padStart(2, '0')}.png`
        await page.screenshot({ path: p })
        log('shot →', p)
      } else if (cmd === 'dump') {
        const texts = await page.evaluate(() => {
          const els = [...document.querySelectorAll('button, [role="button"], a, [class*="clickable"], [class*="item"], [class*="menu"], [class*="setting"], img, svg, i')]
          const out = []
          for (const el of els) {
            const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)
            const cls = (el.className || '').toString().slice(0, 50)
            if (t || /icon|set|gear|menu/i.test(cls)) out.push(`<${el.tagName.toLowerCase()} class="${cls}"> "${t}"`)
          }
          return [...new Set(out)].slice(0, 80)
        })
        log(texts.join('\n'))
      } else if (cmd === 'click') {
        const target = args[++i]
        const loc = page.locator(`text="${target}"`).first()
        await loc.click({ timeout: 8000 })
        await page.waitForTimeout(1500)
        log('clicked:', target)
      } else if (cmd === 'clicksel') {
        const sel = args[++i]
        await page.locator(sel).first().click({ timeout: 8000 })
        await page.waitForTimeout(1500)
        log('clicked selector:', sel)
      } else if (cmd === 'xy') {
        const [x, y] = args[++i].split(',').map(Number)
        await page.mouse.click(x, y)
        await page.waitForTimeout(1500)
        log('clicked at', x, y)
      } else if (cmd === 'scroll') {
        await page.mouse.move(187, 400)
        await page.mouse.wheel(0, Number(args[++i]) || 400)
        await page.waitForTimeout(800)
      } else if (cmd === 'wait') {
        await page.waitForTimeout(Number(args[++i]) || 1000)
      }
    }
  } catch (error) {
    log('ERROR:', error.message)
    await page.screenshot({ path: `${SHOTS}/ui-error.png` }).catch(() => {})
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})()
