import { test, expect, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import { dismissWelcomeModal } from './helpers'

const secret = 'sk-diagnostic-playwright-secret-123456'
const source = 'contract DiagnosticLeak { string private value = "never-export-this-source"; }'
const transactionHash = 'c'.repeat(64)

async function openHome (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
}

async function setChatState (page: Page, state: unknown) {
  await page.evaluate(async (nextState) => {
    const input = document.querySelector('.textarea-wrapper textarea') as any
    const reactKey = input && Object.keys(input).find((key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'))
    let fiber = reactKey ? input[reactKey] : null
    for (let depth = 0; fiber && depth < 100; depth++, fiber = fiber.return) {
      if (fiber.stateNode && typeof fiber.stateNode.executeAiTool === 'function') {
        await new Promise<void>((resolve) => fiber.stateNode.setState(nextState, resolve))
        return
      }
    }
    throw new Error('Unable to locate the Chat component instance')
  }, state)
}

async function downloadedText (page: Page, click: () => Promise<void>) {
  const downloadPromise = page.waitForEvent('download')
  await click()
  const download = await downloadPromise
  const filePath = await download.path()
  if (!filePath) throw new Error('Downloaded diagnostic file has no local path')
  return { download, text: await fs.readFile(filePath, 'utf8') }
}

test('TC-AI-DIAG-001: task history exports privacy-safe JSON and opt-in redacted Markdown', { tag: '@gate' }, async ({ page }) => {
  await openHome(page)
  const now = 1785139200000
  const record = {
    schemaVersion: 1,
    task: {
      schemaVersion: 1,
      taskId: 'diag-e2e',
      goal: `Compile this private prompt: ${source}; api_key=${secret}`,
      source: 'chat',
      workspace: 'diagnostic-e2e',
      branch: 'release/v2.3.3',
      status: 'failed',
      createdAt: now,
      updatedAt: now + 2500
    },
    steps: [{
      stepId: 'compile-1',
      toolName: 'compile_contract',
      status: 'failed',
      riskLevel: 'R0',
      sideEffect: 'none',
      startedAt: now + 100,
      updatedAt: now + 2100,
      input: { source, constructorArgs: ['private-argument'] },
      result: {
        ok: false,
        code: 'NETWORK_UNAVAILABLE',
        summary: `Raw provider error: ${secret}; ${source}`,
        retryable: true
      }
    }],
    artifacts: [{
      type: 'transaction',
      label: 'Nile transaction',
      ref: `https://nile.tronscan.org/#/transaction/${transactionHash}`
    }],
    workflowResult: null,
    events: [{
      type: 'step.failed',
      at: now + 2100,
      stepId: 'compile-1',
      toolName: 'compile_contract',
      status: 'failed',
      result: { ok: false, code: 'NETWORK_UNAVAILABLE', summary: `Do not export ${secret}` },
      source,
      contractArguments: ['private-argument']
    }],
    updatedAt: now + 2500
  }

  await setChatState(page, { aiTaskHistory: [record], activeKey: [] })
  const details = page.locator('[data-id="aiTaskTimeline"] details')
  await details.locator('summary').click()
  await expect(details.locator('[data-id="aiTaskDiagnosticExport"]')).toContainText('Prompts, source code, contract arguments and credentials are never exported.')

  const jsonDownload = await downloadedText(page, () => details.locator('[data-id="aiTaskExportJson"]').click())
  expect(jsonDownload.download.suggestedFilename()).toMatch(/^tronide-ai-task-diag-e2e-\d{8}\.json$/)
  const json = JSON.parse(jsonDownload.text)
  expect(json).toMatchObject({
    schemaVersion: 1,
    reportType: 'tronide-ai-task-diagnostic',
    appVersion: '2.3.3',
    task: { taskId: 'diag-e2e', status: 'failed', durationMs: 2500 },
    environment: { workspace: 'diagnostic-e2e', branch: 'release/v2.3.3' },
    errorCodes: ['NETWORK_UNAVAILABLE'],
    privacy: {
      promptIncluded: false,
      sourceCodeIncluded: false,
      contractArgumentsIncluded: false,
      credentialsIncluded: false,
      eventLogIncluded: false
    }
  })
  expect(json.steps[0]).toMatchObject({ toolName: 'compile_contract', durationMs: 2000, result: { code: 'NETWORK_UNAVAILABLE' } })
  expect(json.events).toBeUndefined()
  expect(jsonDownload.text).toContain(`/transaction/${transactionHash}`)
  expect(jsonDownload.text).not.toContain(secret)
  expect(jsonDownload.text).not.toContain(source)
  expect(jsonDownload.text).not.toContain('private-argument')
  expect(jsonDownload.text).not.toContain('Raw provider error')

  await details.locator('[data-id="aiTaskIncludeEventLog"]').check()
  const markdownDownload = await downloadedText(page, () => details.locator('[data-id="aiTaskExportMarkdown"]').click())
  expect(markdownDownload.download.suggestedFilename()).toMatch(/^tronide-ai-task-diag-e2e-\d{8}\.md$/)
  expect(markdownDownload.text).toContain('# TronIDE AI Task Diagnostic')
  expect(markdownDownload.text).toContain('## Redacted event log')
  expect(markdownDownload.text).toContain('step.failed')
  expect(markdownDownload.text).toContain('NETWORK_UNAVAILABLE')
  expect(markdownDownload.text).toContain(`/transaction/${transactionHash}`)
  expect(markdownDownload.text).not.toContain(secret)
  expect(markdownDownload.text).not.toContain(source)
  expect(markdownDownload.text).not.toContain('private-argument')
})
