import { test, expect } from '@playwright/test'
import { gotoHome } from './helpers'

test.describe('Privacy-safe local AI metrics', () => {
  test('TC-AI-METRICS-001: aggregates stay local and an opt-out clears and disables them', { tag: '@gate' }, async ({ page }) => {
    const gateway = 'https://tron-pw-metrics.mock'
    let calls = 0
    await page.route(gateway + '/**', async (route) => {
      const request = route.request()
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': '*'
      }
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      calls++
      const common = { id: `metrics-${calls}`, type: 'message', role: 'assistant', model: 'claude-opus-4-8', usage: { input_tokens: 1, output_tokens: 1 } }
      const response = calls === 1
        ? { ...common, content: [{ type: 'tool_use', id: 'metrics-tool-1', name: 'git_status', input: {} }], stop_reason: 'tool_use' }
        : { ...common, content: [{ type: 'text', text: 'LOCAL-METRICS-DONE' }], stop_reason: 'end_turn' }
      await route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(response) })
    })

    await gotoHome(page)
    const toggle = page.locator('[data-id="aiLocalMetricsToggle"]')
    const summary = page.locator('[data-id="aiLocalMetricsSummary"]')
    await expect(toggle).toBeChecked()
    await expect(page.locator('[data-id="aiLocalMetricsPanel"]')).toContainText('On-device counts only; never uploaded')
    await expect(page.locator('[data-id="aiLocalMetricsDetails"]')).toHaveJSProperty('open', false)

    await page.locator('[data-id="aiBaseUrlInput"]').fill(gateway)
    await page.locator('[data-id="aiApiKeyInput"]').fill('metrics-gateway-key')
    await page.locator('.textarea-wrapper textarea').fill('show status')
    await page.locator('.textarea-wrapper textarea').press('Enter')
    await expect(page.getByText('LOCAL-METRICS-DONE').first()).toBeVisible({ timeout: 15_000 })

    // Sending a prompt collapses settings. Re-open them before exercising the
    // user-facing clear/opt-out controls, rather than racing the collapse
    // animation with a hidden checkbox.
    await page.locator('.ai-topset-wrapper .ant-collapse-header').click()
    await expect(toggle).toBeVisible()
    await expect(summary).toContainText('Tasks 1 · completed 1 · failed 0')

    await page.locator('[data-id="aiLocalMetricsDetails"] summary').click()
    await expect(page.locator('[data-id="aiLocalMetricsDetails"]')).toContainText('No prompts, source code, addresses, transaction arguments, API keys or wallet data.')
    await page.locator('[data-id="aiLocalMetricsClear"]').click()
    await expect(summary).toContainText('Tasks 0 · completed 0')

    await toggle.click({ force: true })
    await expect(toggle).not.toBeChecked()
    await expect(summary).toContainText('no task stats are saved')
    await expect.poll(() => page.evaluate(() => localStorage.getItem('tronide.ai.metrics.enabled'))).toBe('false')

    await page.reload()
    await expect(page.locator('[data-id="landingWorkspaceStatus"]')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-id="aiLocalMetricsToggle"]')).not.toBeChecked()
    await expect(page.locator('[data-id="aiLocalMetricsSummary"]')).toContainText('no task stats are saved')
  })
})
