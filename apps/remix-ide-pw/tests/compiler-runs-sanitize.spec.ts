/** REGRESSION: optimizer "runs" coming from the URL hash is sanitised before
 *  it can reach the runs field / solc. Previously:
 *   - invalid values (#runs=-1, #runs=99999999999999999999) rendered raw and
 *     made every compile fail with the bare solc error "The 'runs' setting
 *     must be an unsigned number";
 *   - parseInt silently mangled values (#runs=1e3 became 1, not 1000).
 *  normalizeRuns (libs/remix-solidity/src/compiler/runs.ts) now clamps to a
 *  positive integer in [1, 4294967295] and parses with Number(), so the field
 *  shows — and solc receives — a sane value. This asserts the field display,
 *  which is the cheap, deterministic surface of the fix. */
import { test, expect, Page } from '@playwright/test'

test.setTimeout(90_000)

async function openCompilerWithHash (page: Page, hash: string) {
  await page.goto('/' + hash)
  const understand = page.getByRole('button', { name: 'I Understand' })
  if (await understand.first().isVisible().catch(() => false)) await understand.first().click().catch(() => {})
  await page.locator('#icon-panel').waitFor({ timeout: 45_000 })
  if (!(await page.locator('#runs').first().isVisible().catch(() => false))) {
    await page.locator('#icon-panel div[plugin="solidity"]').click().catch(() => {})
  }
  await page.locator('#runs').first().waitFor({ timeout: 15_000 })
}

const CASES: Array<[string, string]> = [
  ['#optimize=true&runs=-1', '1'],                       // negative -> clamped to min
  ['#optimize=true&runs=0', '1'],                        // zero -> clamped to min
  ['#optimize=true&runs=99999999999999999999', '4294967295'], // huge -> clamped to max
  ['#optimize=true&runs=1e3', '1000'],                  // Number() parse, not parseInt -> 1000 (was 1)
  ['#optimize=true&runs=abc', '200'],                   // non-numeric -> default
  ['#optimize=true&runs=300', '300']                    // valid passes through unchanged
]

for (const [hash, expected] of CASES) {
  test(`runs from URL "${hash}" normalises the field to ${expected}`, async ({ page }) => {
    await openCompilerWithHash(page, hash)
    await expect(page.locator('#runs').first()).toHaveValue(expected, { timeout: 10_000 })
  })
}
