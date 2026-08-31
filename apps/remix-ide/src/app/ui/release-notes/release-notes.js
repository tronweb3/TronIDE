/*
 * Copyright 2026 [TronIDE]
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as packageJson from '../../../../../../package.json'
import { ViewPlugin } from '@remixproject/engine-web'

const yo = require('yo-yo')
const csjs = require('csjs-inject')

const css = csjs`
  .container {
    height: 100%;
    overflow-y: auto;
    padding: 32px 48px 64px;
    line-height: 1.55;
  }
  .inner {
    max-width: 860px;
    margin: 0 auto;
  }
  .standaloneNav {
    margin-bottom: 18px;
  }
  .standaloneNav a {
    font-size: .9rem;
    font-weight: 600;
    text-decoration: underline;
  }
  .pageTitle {
    font-size: 1.6rem;
    font-weight: 700;
    margin: 0 0 4px;
  }
  .pageSub {
    opacity: .7;
    margin-bottom: 28px;
  }
  .release {
    border: 1px solid var(--secondary, rgba(128,128,128,.25));
    border-radius: 10px;
    padding: 20px 24px;
    margin-bottom: 24px;
  }
  .releaseHead {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 6px;
  }
  .releaseVersion {
    font-size: 1.25rem;
    font-weight: 700;
    margin: 0;
  }
  .releaseDate {
    opacity: .75;
    font-size: .85rem;
  }
  .releaseTag {
    font-size: .7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .04em;
    padding: 2px 8px;
    border-radius: 10px;
    border: 1px solid currentColor;
    opacity: .8;
  }
  .releaseSummary {
    margin: 8px 0 12px;
    max-width: 760px;
    font-size: .95rem;
    opacity: .86;
  }
  .releaseDisclosure {
    margin-top: 12px;
  }
  .releaseDisclosure > summary {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    cursor: pointer;
    list-style: none;
    border: 1px solid var(--secondary, rgba(128,128,128,.25));
    border-radius: 7px;
    background: rgba(127,127,127,.04);
    font-size: .9rem;
    font-weight: 600;
  }
  .releaseDisclosure > summary::-webkit-details-marker {
    display: none;
  }
  .releaseDisclosure > summary::before {
    content: '›';
    display: inline-block;
    font-size: 1.2rem;
    line-height: 1;
    transform: rotate(0deg);
    transition: transform .15s ease;
  }
  .releaseDisclosure[open] > summary::before {
    transform: rotate(90deg);
  }
  .releaseDetailsLabel {
    flex: 1;
  }
  .releaseDetailsHint {
    opacity: .75;
    font-size: .78rem;
    font-weight: 400;
  }
  .releaseContent {
    padding-top: 2px;
  }
  .areaBlock {
    margin-top: 16px;
  }
  .areaBlock + .areaBlock {
    padding-top: 16px;
    border-top: 1px solid var(--secondary, rgba(128,128,128,.2));
  }
  .areaTitle {
    font-size: .95rem;
    font-weight: 700;
    margin: 0 0 4px;
  }
  .areaList {
    margin: 0;
    padding-left: 20px;
  }
  .areaList li {
    margin: 3px 0;
  }
  .mediaGrid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    margin-top: 10px;
  }
  .mediaCard {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    border: 1px solid var(--secondary, rgba(128,128,128,.25));
    border-radius: 8px;
    background: rgba(127,127,127,.04);
  }
  .mediaImageLink {
    display: block;
    background: rgba(20,24,32,.9);
  }
  .mediaImage {
    display: block;
    width: 100%;
    height: auto;
    max-height: 720px;
    object-fit: contain;
  }
  .mediaCaption {
    padding: 10px 12px 12px;
    font-size: .84rem;
  }
  .mediaCaption strong {
    display: block;
    margin-bottom: 3px;
    font-size: .9rem;
  }
  .mediaSource {
    display: inline-block;
    margin-top: 6px;
    text-decoration: underline;
  }
  .footer {
    font-size: .9rem;
    margin-top: 8px;
  }
  .footer a {
    text-decoration: underline;
  }
  @media (max-width: 760px) {
    .container {
      padding: 20px 14px 40px;
    }
    .release {
      padding: 16px;
    }
    .releaseHead {
      flex-wrap: wrap;
    }
    .releaseDetailsHint {
      display: none;
    }
    .mediaGrid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
`

// One entry per release, newest first. Keep the copy user-facing: what changed
// and why it matters, not commit prose.
const RELEASES = [
  {
    version: '2.3.3',
    date: 'July 2026',
    tag: 'Current',
    summary: 'Guided AI workflows, safer local integrations, and Prague / Osaka-aware deployment protection.',
    areas: [
      {
        title: 'Protocol compatibility',
        items: [
          'Deploy & Run reads Prague and Osaka activation parameters from the selected TRON node and shows Active, Inactive, Unknown, or Unsupported without guessing.',
          'Creation and runtime bytecode are checked for CLZ, the P-256 precompile, the Prague history contract, and MODEXP behavior changes.',
          'Capability responses are bound to the active provider and network so a late response from a previous environment cannot authorize deployment.'
        ]
      },
      {
        title: 'Deployment protection & examples',
        items: [
          'A deployment that requires an inactive or unverifiable upgrade is blocked before account selection, fee estimation, signing, or broadcast.',
          'MODEXP compatibility changes remain a visible warning instead of blocking deployments that use its established interface.',
          'A four-file Prague / Osaka workspace demonstrates P-256 verification, historical block hashes, a smoke test, and Nile deployment guidance.'
        ]
      },
      {
        title: 'Compiler boundary',
        items: [
          'This v2.3.3 update keeps the existing TRON compiler catalogue; CLZ source compilation will follow when an official compatible compiler is available.',
          'The scanner reports only static bytecode evidence and clearly notes that dynamic call targets are outside this first-pass check.'
        ]
      },
      {
        title: 'Guided AI workflows',
        items: [
          'Home starts four guided workflows: edit and test, Nile deployment, TronScan verification, and Recorder-to-TronBox export.',
          'Tasks show each step and status, survive refreshes, and never claim that Stop reversed an on-chain transaction.',
          'Local history restores steps, artifacts, evidence, and the next safe action.'
        ],
        mediaIds: ['HomeAiTasks', 'TaskTimeline']
      },
      {
        title: 'TRON intelligence & safety',
        items: [
          'Built-in TRON skills and checklists cover TVM, TronLink, networks, TronScan, energy, and bandwidth.',
          'Read-only tools verify the network, account, preflight, and transaction status around chain writes.',
          'All side effects require policy approval; Mainnet writes require a final confirmation.'
        ],
        mediaIds: ['TronSkillResult', 'ApprovalWriteLock']
      },
      {
        title: 'Local integrations & provider behavior',
        items: [
          'Gemini supports native tool calling through the same task and approval flow.',
          'Custom plugins are limited to localhost addresses.',
          'Remixd uses loopback plus a per-session token and stops on authentication or origin errors.'
        ]
      },
      {
        title: 'Models, deployment & TronBox handoff',
        items: [
          'Bank of AI is the default BYOK provider, with memory-only keys and live model discovery.',
          'Direct providers and Bank of AI use the same tools, approvals, history, and safety rules.',
          'Usage metrics stay on the device; prompts and keys are not included.',
          'After deployment, five optional actions cover the receipt, interaction, verification, Recorder, and DApp starter.',
          'Recorder exports are checked against TronBox 4.8.0 and solc 0.8.20.'
        ],
        mediaIds: ['BankOfAIProvider', 'DeploymentNextSteps']
      },
      {
        title: 'Faster, safer cold starts',
        items: [
          'The compiler loads only when needed, cutting the main bundle gzip size by more than half.',
          'AI SDKs and UI assets load on demand, reducing the remaining main bundle by about a quarter.',
          'A size budget prevents large dependencies from returning to startup.'
        ]
      }
    ],
    media: [
      {
        id: 'HomeAiTasks',
        title: 'Start from a TRON task, not a tool list',
        description: 'Home shows the network, side effects, TronLink needs, and recommended checks before a task starts.',
        alt: 'TRON IDE Home showing four TRON AI task cards with network, side-effect, TronLink, Skill and checklist prerequisites.',
        webp: 'assets/img/release-notes/v2.3.3/home-ai-task-cards.webp',
        png: 'assets/img/release-notes/v2.3.3/home-ai-task-cards.png'
      },
      {
        id: 'BankOfAIProvider',
        title: 'Start with Bank of AI, keep provider choice explicit',
        description: 'Bank of AI uses a memory-only key, explicit API format, live model discovery, and local usage counters.',
        alt: 'TRON IDE AI settings showing Bank of AI as the selected provider, a memory-only API key field, an Anthropic-compatible format and a Bank-served Claude model.',
        webp: 'assets/img/release-notes/v2.3.3/bank-of-ai-provider.webp',
        png: 'assets/img/release-notes/v2.3.3/bank-of-ai-provider.png'
      },
      {
        id: 'TaskTimeline',
        title: 'Resume from local task history',
        description: 'The timeline keeps step status, risk level, artifacts and recovery context visible across sessions.',
        alt: 'TRON IDE AI panel showing a persistent task timeline with completed and waiting task steps.',
        webp: 'assets/img/release-notes/v2.3.3/task-timeline-history.webp',
        png: 'assets/img/release-notes/v2.3.3/task-timeline-history.png'
      },
      {
        id: 'TronSkillResult',
        title: 'Evidence-backed TRON workflow result',
        description: 'Workflow results show each required phase, its evidence, and the next review action.',
        alt: 'Structured TRON code-to-test workflow result with ordered inspect, change, diff, compile and test evidence.',
        webp: 'assets/img/release-notes/v2.3.3/tron-skill-result.webp',
        png: 'assets/img/release-notes/v2.3.3/tron-skill-result.png'
      },
      {
        id: 'ApprovalWriteLock',
        title: 'Approval bound to the workspace and branch',
        description: 'The approval preview shows the side effect and task-owned write lock before a local or chain change.',
        alt: 'TRON IDE R1 approval dialog showing a local write preview and the task-owned workspace and branch write lock.',
        webp: 'assets/img/release-notes/v2.3.3/approval-write-lock.webp',
        png: 'assets/img/release-notes/v2.3.3/approval-write-lock.png'
      },
      {
        id: 'DeploymentNextSteps',
        title: 'Choose what happens after deployment',
        description: 'Receipt, verification, Recorder, and DApp actions remain optional and approval-gated.',
        alt: 'TRON IDE AI panel showing five explicit next-step actions after a successful Storage contract deployment.',
        webp: 'assets/img/release-notes/v2.3.3/deploy-next-steps.webp',
        png: 'assets/img/release-notes/v2.3.3/deploy-next-steps.png'
      }
    ]
  },
  {
    version: '2.3.2',
    date: 'July 2026',
    tag: '',
    summary: 'Local Git and GitHub collaboration, tool-using AI, resilient compilation, clearer editor workflows and more actionable analysis.',
    areas: [
      {
        title: 'Git & GitHub',
        items: [
          'Full local Git panel for every workspace: init, stage / unstage, commit, history, and branches — with a guard before switching away from uncommitted changes.',
          'Clone GitHub repositories into a fresh workspace, then fetch, pull, push and force-push — all in the browser, routed through a hardened proxy.',
          'Connect GitHub with an OAuth popup instead of pasting a personal access token; once connected, the header button opens an account menu.',
          'GitHub connections survive a refresh in the same browser tab; closing the tab or choosing Disconnect forgets the token.',
          'The Settings-tab gist token is retired: gist import and publish now use the connected GitHub account, and any token saved there by an older version is scrubbed at startup.'
        ],
        mediaIds: ['LocalGit', 'GitHubAccount']
      },
      {
        title: 'AI Assistant',
        items: [
          'The assistant gained a real tool belt: compile and set the compiler version, deploy, read and write contracts, run tests and static analysis, save a compiler-settings reference for manual TronScan verification, and manage files, workspaces and local git (including clone, push and pull).',
          'It can also search the workspace by content, show a diff of your changes, make precise in-place edits, and turn a recorded deploy flow into a runnable TronBox project — record, replay and export.',
          'Esc interrupts a running request, ArrowUp / ArrowDown recalls previous questions, and failed requests render a visible error instead of hanging.',
          'Plain-HTTP AI endpoints are rejected so API keys and prompts never travel in cleartext.'
        ],
        mediaIds: ['AiToolExecution']
      },
      {
        title: 'Compiler',
        items: [
          'When a compiler binary cannot be downloaded, the IDE falls back to the bundled 0.8.20 compiler and shows a clear banner about it.',
          'Version switches are more reliable on slow networks (load timeout raised to 120 s) and stale error annotations are cleared on every compile.'
        ]
      },
      {
        title: 'Contract Verification',
        items: [
          'Choose the actual deployable main contract instead of an imported interface, then download a flattened .sol file that TronScan accepts under Contract File(s).',
          'Verification metadata is clearly labeled as a reference checklist because TronScan does not accept the exported JSON as a contract upload.'
        ]
      },
      {
        title: 'Editor & Workspace',
        items: [
          'Custom right-click menu in the editor so Copy / Cut / Paste work in every browser, with keyboard access.',
          'Syntax highlighting for HTML, CSS, Markdown and TypeScript files.',
          'The IDE restores your last-used workspace at boot, and a failed clone can no longer hijack the restore target.'
        ],
        mediaIds: ['EditorContextMenu']
      },
      {
        title: 'Analysis & Recorder',
        items: [
          'Static analysis: category summary bar, advisory findings collapsed by default and excluded from the sidebar badge, imported libraries recognized across URL and .deps import styles.',
          'Recorder: reverted executions are stamped on both the VM and injected paths, and the TronBox export fences them as TODO steps.'
        ],
        mediaIds: ['StaticAnalysisSummary']
      },
      {
        title: 'Debugger',
        items: [
          'Transactions retain their execution-environment source, and the debugger explains why an Injected TronWeb transaction cannot expose a JavaScript VM trace instead of opening the wrong session.'
        ],
        mediaIds: ['DebuggerEnvironmentBoundary']
      },
      {
        title: 'Help & Feedback',
        items: [
          'Open these Release Notes in a separate tab from the version badge, header icon, or Home link.',
          'Hit a bug or have a suggestion? The "Report an issue" link on the Home page and at the bottom of this page opens the project\'s GitHub issues.'
        ]
      }
    ],
    media: [
      {
        id: 'LocalGit',
        title: 'Manage Git without leaving the workspace',
        description: 'Initialize a repository, stage changes, commit, inspect history and manage branches from the local Git panel.',
        alt: 'TRON IDE local Git panel showing repository status, changed files, a commit message field, history and branches.',
        webp: 'assets/img/release-notes/v2.3.2/local-git.webp',
        original: 'assets/img/release-notes/v2.3.2/local-git.jpg'
      },
      {
        id: 'GitHubAccount',
        title: 'Keep the connected GitHub account visible',
        description: 'The header account menu makes the active OAuth session explicit and provides reconnect and disconnect controls.',
        alt: 'TRON IDE header showing a connected GitHub account menu with Reconnect and Disconnect actions.',
        webp: 'assets/img/release-notes/v2.3.2/github-account.webp',
        original: 'assets/img/release-notes/v2.3.2/github-account.jpg'
      },
      {
        id: 'AiToolExecution',
        title: 'Run IDE tools from the AI Assistant',
        description: 'Tool results stay visible in the conversation, including file changes, compilation, tests, analysis and deployment actions.',
        alt: 'TRON IDE AI Assistant showing a structured tool execution result and a visible error response in the conversation.',
        webp: 'assets/img/release-notes/v2.3.2/ai-tool-execution.webp',
        original: 'assets/img/release-notes/v2.3.2/ai-tool-execution.jpg'
      },
      {
        id: 'EditorContextMenu',
        title: 'Use familiar editor context actions',
        description: 'Copy, Cut, Paste and Select all are available from the editor context menu as well as the keyboard.',
        alt: 'TRON IDE Solidity editor with its context menu open over source code, showing Copy, Cut, Paste and Select all.',
        webp: 'assets/img/release-notes/v2.3.2/editor-context-menu.webp',
        original: 'assets/img/release-notes/v2.3.2/editor-context-menu.jpg'
      },
      {
        id: 'StaticAnalysisSummary',
        title: 'Focus static analysis on actionable findings',
        description: 'Category filters, advisory controls and imported-library handling keep the signal clear without hiding TRON checks.',
        alt: 'TRON IDE Solidity Static Analysis panel showing Security, Gas and Economy, ERC, Miscellaneous and TRON categories.',
        webp: 'assets/img/release-notes/v2.3.2/static-analysis-summary.webp',
        original: 'assets/img/release-notes/v2.3.2/static-analysis-summary.jpg'
      },
      {
        id: 'DebuggerEnvironmentBoundary',
        title: 'Explain debugger environment boundaries',
        description: 'When a transaction belongs to another execution environment, the IDE explains why it cannot be debugged and what to do next.',
        alt: 'TRON IDE debugger alert explaining that an Injected TronWeb transaction cannot be debugged in JavaScript VM and how to continue.',
        webp: 'assets/img/release-notes/v2.3.2/debugger-environment-boundary.webp',
        original: 'assets/img/release-notes/v2.3.2/debugger-environment-boundary.jpg'
      }
    ]
  },
  {
    version: '2.3.1',
    date: 'June 2026',
    tag: '',
    summary: 'Recorder-to-TronBox handoff, recommended TVM compilers, safer workspace templates, formatting and flattened verification sources.',
    areas: [
      {
        title: 'Deploy Recorder',
        items: [
          'Deployed-contracts address book on the recorder card, with per-step deploy status and fail-stop highlighting.',
          'Export a recorded deploy flow as a ready-to-run TronBox project, pinned to the solc version that actually compiled it.'
        ],
        mediaIds: ['DeployRecorder', 'TronBoxExport']
      },
      {
        title: 'Compiler & Workspace',
        items: [
          'Recommended TVM compiler quick-picks (legacy 0.4.x builds removed from the recommendations).',
          'Template picker when creating a workspace, with a confirmation before a template overwrites user edits.'
        ],
        mediaIds: ['WorkspaceTemplate', 'CompilerQuickPicks']
      },
      {
        title: 'Editor',
        items: [
          'Format code with Prettier from the file-explorer menu.'
        ],
        mediaIds: ['PrettierFormat']
      },
      {
        title: 'Contract Verification',
        items: [
          'Flatten sources directly in the Contract Verification panel.'
        ],
        mediaIds: ['VerificationFlatten']
      }
    ],
    media: [
      {
        id: 'WorkspaceTemplate',
        title: 'Start a workspace from a template',
        description: 'Choose the project shape at creation time while keeping overwrite protection for existing user work.',
        alt: 'TRON IDE Create Workspace dialog showing a workspace name field and a project template selector.',
        webp: 'assets/img/release-notes/v2.3.1/workspace-template.webp',
        original: 'assets/img/release-notes/v2.3.1/workspace-template.jpg'
      },
      {
        id: 'CompilerQuickPicks',
        title: 'Choose a recommended TVM compiler',
        description: 'Recommended Solidity versions are available as quick picks while the full version selector remains available.',
        alt: 'TRON IDE Solidity Compiler panel showing recommended TVM compiler versions, language and optimizer controls.',
        webp: 'assets/img/release-notes/v2.3.1/compiler-quick-picks.webp',
        original: 'assets/img/release-notes/v2.3.1/compiler-quick-picks.jpg'
      },
      {
        id: 'VerificationFlatten',
        title: 'Prepare flattened source for TronScan',
        description: 'The verification panel selects the deployable contract and produces a flattened Solidity source for manual submission.',
        alt: 'TRON IDE Contract Verification panel showing address input, compiled-contract selection and source flattening actions.',
        webp: 'assets/img/release-notes/v2.3.1/verification-flatten.webp',
        original: 'assets/img/release-notes/v2.3.1/verification-flatten.jpg'
      },
      {
        id: 'PrettierFormat',
        title: 'Format code from the file explorer',
        description: 'The file context menu exposes Format code alongside the standard workspace actions.',
        alt: 'TRON IDE file explorer context menu showing Rename, Delete, Format code, Publish file to gist, Copy and Compile.',
        webp: 'assets/img/release-notes/v2.3.1/prettier-format.webp',
        original: 'assets/img/release-notes/v2.3.1/prettier-format.jpg'
      },
      {
        id: 'DeployRecorder',
        title: 'Track recorded deployment steps',
        description: 'Recorder keeps the transaction count, replay boundary and per-step outcome visible before export.',
        alt: 'TRON IDE Deploy Recorder showing one recorded transaction and the JavaScript VM to Injected TronWeb replay boundary.',
        webp: 'assets/img/release-notes/v2.3.1/deploy-recorder.webp',
        original: 'assets/img/release-notes/v2.3.1/deploy-recorder.jpg'
      },
      {
        id: 'TronBoxExport',
        title: 'Hand a recorded flow to TronBox',
        description: 'Recorded transactions and deployed addresses can be exported as a runnable, compiler-pinned TronBox project.',
        alt: 'TRON IDE Deploy Recorder showing a deployed contract address and the Export to TronBox action.',
        webp: 'assets/img/release-notes/v2.3.1/tronbox-export.webp',
        original: 'assets/img/release-notes/v2.3.1/tronbox-export.jpg'
      }
    ]
  },
  {
    version: '2.3.0',
    date: 'June 2026',
    tag: '',
    summary: 'A TRON-first Home, TronLink execution, TronScan verification, multi-provider AI, TVM debugging and stronger security boundaries.',
    areas: [
      {
        title: 'Home & Navigation',
        items: [
          'Redesigned Home: quick-start cards, most-used plugins with one-click activation, and a collapsible advanced-tools area.',
          'New top bar with a workspace menu (create / backup / restore / connect to localhost), Connect GitHub and Connect Wallet.'
        ],
        mediaIds: ['HomeWorkbench']
      },
      {
        title: 'TronLink Wallet (new)',
        items: [
          'First-class TronLink connection: deploy and transact on Nile or Mainnet, with clear feedback when the wallet is rejected, locked or unresponsive.',
          'The IDE follows account and network switches, blocks cross-network transactions, and a dead wallet bridge can no longer hang a transaction at "pending".'
        ],
        mediaIds: ['TronLinkEnvironment']
      },
      {
        title: 'Contract Verification (new)',
        items: [
          'TronScan-first verification plugin: check a deployed address, preserve the latest compilation metadata, and submit the matching Solidity source manually on TronScan.'
        ],
        mediaIds: ['ContractVerification']
      },
      {
        title: 'AI Assistant',
        items: [
          'Model lineup expanded across five vendors — Anthropic, OpenAI, Google, xAI and Qwen — including GPT-5.5, Claude Opus 4.8, Gemini 3.0 Pro and Qwen 3.7.',
          'API keys stay in browser memory only and are never uploaded or stored.'
        ],
        mediaIds: ['AiProviderPicker']
      },
      {
        title: 'Build, Debug & Analysis',
        items: [
          'One-click compile of the current file from the editor tab bar.',
          'The debugger works on the TVM engine: instruction stepping (including TRON-specific opcodes), Solidity locals, state and the call stack.',
          'Static analysis gained a TRON category with transaction-config checks such as feeLimit and callValue.'
        ],
        mediaIds: ['TvmDebugger', 'TronStaticAnalysis']
      },
      {
        title: 'Security & Reliability',
        items: [
          'Security headers (CSP, anti-clickjacking), strict plugin-URL validation and dependency CVE fixes.',
          'Workspace search / replace with one-click undo, hardened GitHub token and Gist workflows, and dozens of stability fixes.'
        ]
      }
    ],
    media: [
      {
        id: 'HomeWorkbench',
        title: 'Meet the redesigned Home workspace',
        description: 'Quick starts, most-used plugins, workspace context and AI help share one development overview.',
        alt: 'TRON IDE v2.3.0 Home workspace with the file explorer, quick-start cards, most-used plugins and AI Assistant.',
        webp: 'assets/img/release-notes/v2.3.0/home-workbench.webp',
        original: 'assets/img/release-notes/v2.3.0/home-workbench.png'
      },
      {
        id: 'TronLinkEnvironment',
        title: 'Choose VM or TronLink execution',
        description: 'Deploy & Run exposes JavaScript VM (Tron) and Injected TronWeb alongside the active account and transaction limits.',
        alt: 'TRON IDE Deploy and Run panel showing JavaScript VM Tron and Injected TronWeb environments, account, fee limit and value.',
        webp: 'assets/img/release-notes/v2.3.0/tronlink-environment.webp',
        original: 'assets/img/release-notes/v2.3.0/tronlink-environment.png'
      },
      {
        id: 'ContractVerification',
        title: 'Check and prepare TronScan verification',
        description: 'Normalize a deployed address, inspect its status and prepare the matching compiler and source material.',
        alt: 'TRON IDE Contract Verification panel with network, contract address, status check and verification material actions.',
        webp: 'assets/img/release-notes/v2.3.0/contract-verification.webp',
        original: 'assets/img/release-notes/v2.3.0/contract-verification.png'
      },
      {
        id: 'AiProviderPicker',
        title: 'Select an AI provider explicitly',
        description: 'The assistant presents the supported provider families before requesting a memory-only API key.',
        alt: 'TRON IDE AI Assistant with the provider selector open for Anthropic, OpenAI, Google, xAI and Qwen.',
        webp: 'assets/img/release-notes/v2.3.0/ai-provider-picker.webp',
        original: 'assets/img/release-notes/v2.3.0/ai-provider-picker.png'
      },
      {
        id: 'TvmDebugger',
        title: 'Step through TVM execution',
        description: 'The debugger exposes instruction stepping, function stack, Solidity locals, state and the TVM stack.',
        alt: 'TRON IDE Debugger panel showing TVM instruction stepping controls, function stack, Solidity locals, state and stack data.',
        webp: 'assets/img/release-notes/v2.3.0/tvm-debugger.webp',
        original: 'assets/img/release-notes/v2.3.0/tvm-debugger.png'
      },
      {
        id: 'TronStaticAnalysis',
        title: 'Run TRON-specific static analysis',
        description: 'The static-analysis categories include dedicated TRON checks alongside the general Solidity rules.',
        alt: 'TRON IDE Solidity Static Analysis panel showing Security, Gas and Economy, ERC, Miscellaneous and TRON categories.',
        webp: 'assets/img/release-notes/v2.3.0/tron-static-analysis.webp',
        original: 'assets/img/release-notes/v2.3.0/tron-static-analysis.png'
      }
    ]
  }
]

const profile = {
  name: 'releaseNotes',
  displayName: 'Release Notes',
  methods: [],
  events: [],
  description: 'What changed in each TRON IDE release',
  icon: 'assets/img/tron-ide.svg',
  location: 'mainPanel',
  version: packageJson.version
}

export class ReleaseNotes extends ViewPlugin {
  constructor (options = {}) {
    super(profile)
    this.profile = profile
    this.standalone = options.standalone === true
    this.el = null
  }

  renderMedia (media) {
    const original = media.original || media.png
    return yo`
      <figure class=${css.mediaCard} data-id="releaseNotesMedia${media.id}">
        <a class=${css.mediaImageLink} href=${original} target="_blank" rel="noopener noreferrer" aria-label="Open original image: ${media.title}">
          <picture>
            <source srcset=${media.webp} type="image/webp" />
            <img class=${css.mediaImage} src=${original} alt=${media.alt} loading="lazy" decoding="async" />
          </picture>
        </a>
        <figcaption class=${css.mediaCaption}>
          <strong>${media.title}</strong>
          <span>${media.description}</span>
          <a class=${css.mediaSource} href=${original} target="_blank" rel="noopener noreferrer">Open high-resolution image</a>
        </figcaption>
      </figure>
    `
  }

  renderReleaseContent (release, versionId) {
    const media = release.media || []
    return yo`
      <div class=${css.releaseContent} data-id="releaseNotesGalleryV${versionId}">
        ${release.areas.map((area, areaIndex) => {
          const areaMedia = (area.mediaIds || [])
            .map(mediaId => media.find(item => item.id === mediaId))
            .filter(Boolean)
          return yo`
            <section class=${css.areaBlock} data-id="releaseNotesAreaV${versionId}-${areaIndex + 1}">
              <h3 class=${css.areaTitle}>${area.title}</h3>
              <ul class=${css.areaList}>
                ${area.items.map(item => yo`<li>${item}</li>`)}
              </ul>
              ${areaMedia.length ? yo`
                <div class=${css.mediaGrid} data-id="releaseNotesAreaGalleryV${versionId}-${areaIndex + 1}">
                  ${areaMedia.map(item => this.renderMedia(item))}
                </div>
              ` : ''}
            </section>
          `
        })}
      </div>
    `
  }

  renderReleaseDisclosure (release, versionId) {
    const summary = yo`
      <summary data-id="releaseNotesToggleV${versionId}">
        <span class=${css.releaseDetailsLabel}>Version highlights and screenshots</span>
        <span class=${css.releaseDetailsHint} aria-hidden="true">Expand or collapse</span>
      </summary>
    `
    const content = this.renderReleaseContent(release, versionId)
    if (release.tag === 'Current') {
      return yo`
        <details class=${css.releaseDisclosure} data-id="releaseNotesDetailsV${versionId}" open>
          ${summary}
          ${content}
        </details>
      `
    }
    return yo`
      <details class=${css.releaseDisclosure} data-id="releaseNotesDetailsV${versionId}">
        ${summary}
        ${content}
      </details>
    `
  }

  renderRelease (release) {
    const versionId = release.version.replace(/\./g, '')
    return yo`
      <section class=${css.release} data-id="releaseNotesV${versionId}" aria-labelledby="releaseNotesTitleV${versionId}">
        <div class=${css.releaseHead}>
          <h2 class=${css.releaseVersion} id="releaseNotesTitleV${versionId}">v${release.version}</h2>
          <span class=${css.releaseDate}>${release.date}</span>
          ${release.tag ? yo`<span class=${css.releaseTag}>${release.tag}</span>` : ''}
        </div>
        ${release.summary ? yo`<p class=${css.releaseSummary}>${release.summary}</p>` : ''}
        ${this.renderReleaseDisclosure(release, versionId)}
      </section>
    `
  }

  render () {
    if (this.el) return this.el
    this.el = yo`
      <div class=${css.container} data-id="releaseNotesView">
        <div class=${css.inner}>
          ${this.standalone ? yo`
            <nav class=${css.standaloneNav} aria-label="Release Notes navigation">
              <a href="./" data-id="releaseNotesBackToIde">← Back to TRON IDE</a>
            </nav>
          ` : ''}
          <h1 class=${css.pageTitle}>Release Notes</h1>
          <div class=${css.pageSub}>You are running TRON IDE v${packageJson.version}.</div>
          ${RELEASES.map(release => this.renderRelease(release))}
          <div class=${css.footer}>
            Found a bug or have a suggestion?
            <a href="https://github.com/tronweb3/TronIDE/issues" target="_blank" rel="noopener noreferrer" data-id="releaseNotesReportIssue">Open an issue on GitHub</a>.
            For the complete change history, see the
            <a href="https://github.com/tronweb3/TronIDE" target="_blank" rel="noopener noreferrer">project repository</a>.
          </div>
        </div>
      </div>
    `
    return this.el
  }
}
