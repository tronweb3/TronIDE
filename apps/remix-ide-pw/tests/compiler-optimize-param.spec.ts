/** REGRESSION: the `optimize` URL-hash param is read case-insensitively.
 *  Previously only the exact lowercase "true" enabled optimization, so a shared
 *  link like #optimize=TRUE or #optimize=1 silently shipped an unoptimized
 *  build (and rewrote the hash to optimize=false). parseOptimizeParam now
 *  accepts the usual truthy/falsy tokens. Asserts the checkbox state, which
 *  needs no compile. */
import { test, expect, Page } from '@playwright/test'

test.setTimeout(90_000)

async function openCompilerWithHash (page: Page, hash: string) {
  await page.goto('/' + hash)
  const understand = page.getByRole('button', { name: 'I Understand' })
  if (await understand.first().isVisible().catch(() => false)) await understand.first().click().catch(() => {})
  await page.locator('#icon-panel').waitFor({ timeout: 45_000 })
  if (!(await page.locator('#optimize').first().isVisible().catch(() => false))) {
    await page.locator('#icon-panel div[plugin="solidity"]').click().catch(() => {})
  }
  await page.locator('#optimize').first().waitFor({ timeout: 15_000 })
}

const CASES: Array<[string, boolean]> = [
  ['#optimize=TRUE', true],   // upper-case truthy (the reported bug)
  ['#optimize=1', true],      // numeric truthy
  ['#optimize=true', true],   // canonical still works
  ['#optimize=false', false], // explicit false
  ['#optimize=0', false]      // numeric falsy
]

for (const [hash, expected] of CASES) {
  test(`optimize from URL "${hash}" sets the checkbox to ${expected}`, async ({ page }) => {
    await openCompilerWithHash(page, hash)
    expect(await page.locator('#optimize').first().isChecked()).toBe(expected)
  })
}
