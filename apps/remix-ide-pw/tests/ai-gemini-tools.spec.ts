import { test, expect } from '@playwright/test'
import { gotoHome } from './helpers'

test.describe('Gemini Workspace Actions', () => {
  test('TC-AI-GEMINI-001: native function calls use the shared task runtime and return ordered results', { tag: '@gate' }, async ({ page }) => {
    const gateway = 'https://tron-pw-gemini.mock'
    const requestBodies: string[] = []
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
      requestBodies.push(request.postData() || '')
      const content = calls === 1
        ? { role: 'model', parts: [{ functionCall: { id: 'gemini-call-1', name: 'git_status', args: {} } }] }
        : { role: 'model', parts: [{ text: 'GEMINI-TOOL-DONE' }] }
      await route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({
          candidates: [{ content, finishReason: 'STOP', index: 0 }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
        })
      })
    })

    await gotoHome(page)
    await page.locator('.ai-model-vendor-wrap .ant-select-selector').click()
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: /^Google$/ }).click()
    await expect(page.locator('[data-id="aiWorkspaceActionsToggle"]')).toBeVisible()
    await expect(page.locator('[data-id="aiWorkspaceActionsToggle"]')).toBeChecked()

    await page.locator('.gpt-model-wrap .ant-select-selector').click()
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: /^Gemini 2.5 Flash$/ }).click()
    await page.locator('[data-id="aiBaseUrlInput"]').fill(gateway)
    await page.locator('[data-id="aiApiKeyInput"]').fill('gemini-gateway-key')
    await page.locator('.textarea-wrapper textarea').fill('show git status')
    await page.locator('.textarea-wrapper textarea').press('Enter')

    await expect(page.getByText('GEMINI-TOOL-DONE').first()).toBeVisible({ timeout: 15_000 })
    expect(calls).toBe(2)
    expect(requestBodies[0]).toContain('functionDeclarations')
    expect(requestBodies[0]).toContain('git_status')

    const secondRequest = JSON.parse(requestBodies[1])
    const parts = secondRequest.contents.flatMap((content: any) => content.parts || [])
    const functionResponse = parts.find((part: any) => part.functionResponse)?.functionResponse
    expect(functionResponse?.id).toBe('gemini-call-1')
    expect(functionResponse?.name).toBe('git_status')
    expect(functionResponse?.response?.output?.boundary?.type).toBe('tronide_untrusted_tool_output')
    expect(functionResponse?.response?.output?.result?.ok).toBe(true)
    expect(functionResponse?.response?.output?.result?.summary).toBeTruthy()
  })
})
