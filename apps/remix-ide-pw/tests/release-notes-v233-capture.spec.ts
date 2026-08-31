import { test, expect, Page, Locator } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs/promises'
import { dismissWelcomeModal } from './helpers'

// This spec is an opt-in release artifact generator, not a normal regression
// test. `pnpm capture:release-notes-v233` serves one production build, enables
// this file, and converts the resulting high-resolution PNGs to WebP.
test.skip(process.env.TRONIDE_CAPTURE_RELEASE_NOTES !== '1', 'Run through pnpm capture:release-notes-v233')
test.describe.configure({ mode: 'serial' })
test.use({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 })

const GW = 'https://tron-release-notes.mock'
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const outputDir = path.resolve(process.cwd(), 'apps/remix-ide/src/assets/img/release-notes/v2.3.3')

async function openHome (page: Page) {
  await page.goto('/')
  await dismissWelcomeModal(page)
  await page.locator('[data-id="landingWorkspaceStatus"]').waitFor({ timeout: 30_000 })
}

async function save (locator: Locator, name: string) {
  await fs.mkdir(outputDir, { recursive: true })
  await locator.screenshot({ path: path.join(outputDir, `${name}.png`), animations: 'disabled' })
}

async function getChatState (page: Page, state: unknown) {
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

async function setKeyAndGateway (page: Page) {
  await page.locator('[data-id="aiBaseUrlInput"]').fill(GW)
  // URL edits are origin-bound: changing the destination clears any key that
  // was entered for the previous origin. Set the gateway first, then bind the
  // fixture key to that exact endpoint.
  await page.locator('[data-id="aiApiKeyInput"]').fill('release-fixture-key')
}

async function ask (page: Page, prompt: string) {
  const input = page.locator('.textarea-wrapper textarea')
  await input.fill(prompt)
  await input.press('Enter')
}

const baseTask = (status: string, updatedAt: number) => ({
  schemaVersion: 1,
  taskId: `release-demo-${status}`,
  goal: status === 'succeeded' ? 'Review Storage, compile it, and run focused tests' : 'Prepare a reviewed Storage contract change',
  source: 'home',
  workspace: 'release_demo',
  branch: 'release/v2.3.3',
  status,
  createdAt: updatedAt - 5000,
  updatedAt
})

const workflowResult = {
  schemaVersion: 1,
  workflowId: 'wf-code-test',
  number: 'WF-1',
  title: 'Edit, compile, and test',
  status: 'completed',
  summary: 'WF-1 completed with ordered evidence for all 5 required phases.',
  completion: { passed: 5, required: 5 },
  resultFields: ['changed files', 'compiler version', 'test result'],
  evidence: [
    ['inspect', 'Understand and inspect the workspace', 'search_workspace', 'Inspected contracts/1_Storage.sol and its focused tests.'],
    ['change', 'Apply a reviewed minimal change', 'edit_file', 'One approved local edit remains undoable.'],
    ['diff', 'Show the resulting diff', 'git_diff', 'Reviewed one changed file with no unrelated edits.'],
    ['compile', 'Compile with an explicit compiler', 'compile_contract', 'Compiled Storage with solc 0.8.20.'],
    ['test', 'Run focused tests', 'run_tests', 'Focused Storage tests passed.']
  ].map(([phaseId, title, toolName, summary]) => ({ phaseId, title, optional: false, status: 'passed', toolName, summary, userAction: '' })),
  artifacts: [{ type: 'file', label: 'Storage.sol diff', ref: 'contracts/1_Storage.sol' }],
  nextAction: 'Review the result fields and artifacts before handing off the task.'
}

test('capture Home AI task cards', async ({ page }) => {
  await openHome(page)
  await expect(page.locator('[data-id="landingHeroTitle"]')).toContainText('TRON Native')
  await save(page.locator('[data-id="landingAiTaskCards"]'), 'home-ai-task-cards')
})

test('capture Bank of AI default provider settings', async ({ page }) => {
  await openHome(page)
  await expect(page.locator('[data-id="aiModelVendorSelect"]')).toContainText('Bank of AI')
  await expect(page.locator('[data-id="bankOfAIEndpointTypeSelect"]')).toContainText('Anthropic-compatible')
  await save(page.locator('.chat-set-content'), 'bank-of-ai-provider')
})

test('capture task timeline and local history', async ({ page }) => {
  await openHome(page)
  const now = 1785139200000
  const completed = {
    schemaVersion: 1,
    task: baseTask('succeeded', now - 10000),
    steps: [
      { stepId: 'inspect', toolName: 'search_workspace', status: 'succeeded', riskLevel: 'R0', result: { summary: 'Located Storage and its focused test.', ok: true } },
      { stepId: 'compile', toolName: 'compile_contract', status: 'succeeded', riskLevel: 'R0', result: { summary: 'Compiled with solc 0.8.20.', ok: true } },
      { stepId: 'test', toolName: 'run_tests', status: 'succeeded', riskLevel: 'R0', result: { summary: 'Focused tests passed.', ok: true } }
    ],
    artifacts: [{ type: 'file', label: 'Storage.sol', ref: 'contracts/1_Storage.sol' }],
    workflowResult: null,
    events: [],
    updatedAt: now - 10000
  }
  const waiting = {
    schemaVersion: 1,
    task: baseTask('waiting_for_user', now),
    steps: [
      { stepId: 'inspect', toolName: 'read_file', status: 'succeeded', riskLevel: 'R0', result: { summary: 'Read the selected contract.', ok: true } },
      { stepId: 'edit', toolName: 'edit_file', status: 'waiting_for_user', riskLevel: 'R1', result: null }
    ],
    artifacts: [],
    workflowResult: null,
    events: [],
    updatedAt: now
  }
  await getChatState(page, { aiTaskHistory: [completed, waiting], activeKey: [] })
  const timeline = page.locator('[data-id="aiTaskTimeline"]')
  await expect(timeline).toContainText('Task history (2 local)')
  await save(timeline, 'task-timeline-history')
})

test('capture structured TRON Skill result', async ({ page }) => {
  await openHome(page)
  const now = 1785139200000
  const record = {
    schemaVersion: 1,
    task: baseTask('succeeded', now),
    steps: workflowResult.evidence.map((item, index) => ({ stepId: `step-${index}`, toolName: item.toolName, status: 'succeeded', riskLevel: index === 1 ? 'R1' : 'R0', result: { ok: true, summary: item.summary } })),
    artifacts: workflowResult.artifacts,
    workflowResult,
    events: [],
    updatedAt: now
  }
  await getChatState(page, { aiTaskHistory: [record], activeKey: [] })
  const details = page.locator('[data-id="aiTaskTimeline"] details')
  await expect(details).toHaveCount(1)
  await details.locator('summary').click()
  const result = page.locator('[data-id="aiTaskResultCard"]')
  await expect(result).toContainText('WF-1 completed')
  await save(result, 'tron-skill-result')
})

test('capture R1 approval and workspace write lock', async ({ page }) => {
  let calls = 0
  await page.route(GW + '/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    calls++
    const common = { id: `release-${calls}`, type: 'message', role: 'assistant', model: 'claude-opus-4-8', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
    if (calls === 1) {
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({
        ...common,
        content: [{ type: 'tool_use', id: 'release-write', name: 'create_file', input: { path: 'contracts/ReleaseDemo.sol', content: '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\ncontract ReleaseDemo {}\n' } }],
        stop_reason: 'tool_use'
      }) })
    }
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ...common, content: [{ type: 'text', text: 'The rejected preview was not applied.' }], stop_reason: 'end_turn' }) })
  })
  await openHome(page)
  await setKeyAndGateway(page)
  await ask(page, 'Prepare one reviewed demo contract file.')
  const modal = page.locator('.ant-modal-confirm')
  await expect(modal).toContainText('Workspace/branch write lock: held by this task', { timeout: 20_000 })
  const heldLock = await page.evaluate(() => {
    const raw = localStorage.getItem('tronide.ai.write-lock.v1')
    return raw ? JSON.parse(raw) : null
  })
  expect(heldLock?.taskId).toMatch(/^task-/)
  expect(heldLock?.toolName).toBe('create_file')
  await save(modal, 'approval-write-lock')
  await modal.locator('.ant-btn').filter({ hasText: 'Reject' }).click()
})

test('capture explicit post-deployment next steps', async ({ page }) => {
  await openHome(page)
  // Use a sanitized deterministic result fixture so capture never broadcasts a
  // transaction. The rendered card is the production component populated by
  // the same result shape that a successful deploy_contract returns.
  await getChatState(page, {
    activeKey: [],
    deploymentNextStep: {
      contractName: 'Storage',
      contractAddress: '0x1234567890abcdef1234567890abcdef12345678',
      transactionHash: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      network: 'JavaScript VM (Tron)'
    }
  })
  const nextSteps = page.locator('[data-id="aiDeploymentNextSteps"]')
  await expect(nextSteps).toContainText('AI next steps')
  await expect(nextSteps.locator('button')).toHaveCount(6)
  await save(nextSteps, 'deploy-next-steps')
})
