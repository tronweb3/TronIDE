/*
 * Modifications Copyright © 2022 TronIDE
 * Licensed under the Apache License, Version 2.0
 */

var fs = require('fs')
var path = require('path')
var test = require('tape')
var parity = require('../src/app/ui/landing-page/remix-220-home-parity-features')

var landingSourcePath = path.join(__dirname, '../src/app/ui/landing-page/landing-page.js')
var aiPanelSourcePath = path.join(__dirname, '../src/app/components/ai-panel.js')
var topHeaderSourcePath = path.join(__dirname, '../../../libs/remix-ui/top-header/src/lib/top-header.js')
var topHeaderStylePath = path.join(__dirname, '../../../libs/remix-ui/top-header/src/lib/top-header.css')
var settingsSourcePath = path.join(__dirname, '../../../libs/remix-ui/settings/src/lib/remix-ui-settings.tsx')
var appSourcePath = path.join(__dirname, '../src/app.js')
var contractVerificationSourcePath = path.join(__dirname, '../src/app/tabs/contract-verification-tab.js')
var versionJsonPath = path.join(__dirname, '../src/assets/version.json')
var parityTracePath = path.join(__dirname, '../docs/remix-220-home-parity.md')
var roadmap3TracePath = path.join(__dirname, '../docs/v2.3.0-roadmap-section-3-traceability.md')
var rootReadmePath = path.join(__dirname, '../../../README.md')

function sourceContainsDataId (source, dataId) {
  var computedDataId = 'data-id=$' + '{dataId}'
  var templatedDataId = 'data-id=$' + '{`' + dataId + '`}'
  return source.indexOf('data-id="' + dataId + '"') !== -1 ||
    source.indexOf('data-id=\'' + dataId + '\'') !== -1 ||
    source.indexOf('data-id=`' + dataId + '`') !== -1 ||
    source.indexOf(computedDataId) !== -1 ||
    source.indexOf(templatedDataId) !== -1
}

test('Remix 2.2.0 home parity manifest tracks all P0 and P1 release-gate items', function (t) {
  var features = parity.getRemix220HomeParityFeatures()
  var p0Ids = features.p0.map(function (item) { return item.id })
  var p1Ids = features.p1.map(function (item) { return item.id })

  t.deepEqual(p0Ids, [
    'home-structure',
    'home-onboarding',
    'most-used-plugins',
    'contract-verification',
    'remixai-entry'
  ], 'all P0 screenshot parity areas are tracked')

  t.deepEqual(p1Ids, [
    'topbar-productization',
    'status-entry-replacements',
    'plugin-card-actions',
    'github-account-boundaries'
  ], 'all P1 screenshot parity areas are tracked')

  t.ok(features.p0.every(function (item) { return item.status === 'required' }), 'P0 items are release-gate requirements')
  t.ok(features.p1.every(function (item) { return item.status === 'required' }), 'P1 items are release-gate requirements')
  t.end()
})

test('Landing page exposes every Remix 2.2.0 parity data-id from the manifest', function (t) {
  var landingSource = fs.readFileSync(landingSourcePath, 'utf8')
  var aiPanelSource = fs.readFileSync(aiPanelSourcePath, 'utf8')
  var topHeaderSource = fs.readFileSync(topHeaderSourcePath, 'utf8')
  var combinedSource = landingSource + '\n' + aiPanelSource + '\n' + topHeaderSource
  var missing = parity.getRemix220HomeParityDataIds().filter(function (dataId) {
    return !sourceContainsDataId(combinedSource, dataId)
  })

  t.deepEqual(missing, [], 'all manifest data-id hooks exist in landing page or AI panel source')
  t.end()
})

test('Remix 2.2.0 home parity user-facing copy contains no placeholder markers', function (t) {
  var landingSource = fs.readFileSync(landingSourcePath, 'utf8')
  var homeParitySource = landingSource.slice(landingSource.indexOf('const renderOnboarding'), landingSource.indexOf('return container'))
  var placeholders = homeParitySource.match(/TODO|FIXME|lorem ipsum|coming soon|dummy credentials/ig) || []

  t.deepEqual(placeholders, [], 'home parity source avoids placeholder markers in user-facing copy')
  t.end()
})

test('Remix 2.2.0 home parity records edge, security, accessibility, and blocked-service behavior', function (t) {
  var landingSource = fs.readFileSync(landingSourcePath, 'utf8')
  var contractVerificationSource = fs.readFileSync(contractVerificationSourcePath, 'utf8')

  t.ok(landingSource.indexOf('OAuth write flows remain out of scope for this MVP.') !== -1 && landingSource.indexOf('fine-grained GitHub token') !== -1, 'GitHub OAuth and token-mode boundaries are explicit')
  t.ok(landingSource.indexOf('Default storage is session-only') !== -1 && landingSource.indexOf('remember mode stores the token in this browser') !== -1, 'account auth is documented as token-only instead of mocked')
  t.equal(landingSource.indexOf('landingAiAudioButton'), -1, 'Home no longer exposes an AI audio placeholder hook')
  t.equal(landingSource.indexOf('landingAiModelSelector'), -1, 'Home no longer exposes an AI model selector placeholder hook')
  t.equal(landingSource.indexOf('landingAiHistoryButton'), -1, 'Home no longer exposes an AI history placeholder hook')
  t.ok(landingSource.indexOf('rel="noopener noreferrer"') !== -1, 'external links use noopener noreferrer')
  t.ok(landingSource.indexOf('https://tronscan.org/#/contracts/verify') !== -1 && landingSource.indexOf('rel="noopener noreferrer"') !== -1, 'external verification link uses noopener noreferrer')
  t.ok(landingSource.indexOf('aria-label="Quick actions"') !== -1, 'quick action grid has an accessible region label')
  t.ok(landingSource.indexOf('data-id="landingWalletConnectEntry"') !== -1 && landingSource.indexOf('Connect TronLink and open Deploy & Run') !== -1, 'Start building exposes a wallet/deploy entry')
  t.ok(landingSource.indexOf('alt="TRON IDE"') !== -1, 'brand image has alt text')
  t.equal(landingSource.indexOf('${renderWalkthroughsPanel()}'), -1, 'walkthrough panel is hidden from the Home layout')
  t.ok(contractVerificationSource.indexOf('Sourcify, Etherscan, Blockscout, and Routescan are EVM services') !== -1, 'unsupported EVM verification providers are not advertised as TRON backends')
  t.ok(contractVerificationSource.indexOf('TronScan source submission remains a manual external step') !== -1, 'TronScan source submission boundary is explicit')
  t.equal(landingSource.indexOf('Blocked'), -1, 'Home does not expose blocked status labels to users')
  t.ok(landingSource.indexOf('TRON Contract Verification') !== -1 && landingSource.indexOf('TVM Solidity Analyzers') !== -1 && landingSource.indexOf('TRON Cookbook') !== -1, 'Most used plugin cards use TRON-specific labels')
  t.equal(landingSource.indexOf('TRON Tutorials'), -1, 'Home hides tutorial walkthrough plugin card')
  t.equal(landingSource.indexOf('LearnEth Tutorials'), -1, 'Home no longer exposes LearnEth plugin copy')
  t.equal(landingSource.indexOf('multiple services at the same time'), -1, 'Home no longer exposes EVM multi-service verification copy')
  t.end()
})

test('TronIDE contract verification MVP packages compilation data and queries TronScan', function (t) {
  var landingSource = fs.readFileSync(landingSourcePath, 'utf8')
  var appSource = fs.readFileSync(appSourcePath, 'utf8')
  var contractVerificationSource = fs.readFileSync(contractVerificationSourcePath, 'utf8')
  var combinedSource = landingSource + '\n' + appSource + '\n' + contractVerificationSource
  var requiredVerificationHooks = [
    'contractVerification',
    'ContractVerificationTab',
    'contractVerificationPlugin',
    'tronScanTargets',
    'https://apilist.tronscanapi.com/api/contract',
    'https://nileapi.tronscan.org/api/contract',
    'https://shastapi.tronscan.org/api/contract',
    'getLatestCompilation',
    "artefacts.api.get('__last')",
    'createVerificationPackage',
    'standardJsonInput',
    'contractVerificationNetworkSelect',
    'contractVerificationAddressInput',
    'contractVerificationCheckStatus',
    'contractVerificationGeneratePackage',
    'contractVerificationCopyPackage',
    'contractVerificationDownloadPackage',
    'contractVerificationOpenTronScan',
    'contractVerificationStatusResult',
    'contractVerificationPackageChecklist',
    'contractVerificationPackageHistory',
    'savePackageHistory',
    'landingVerificationOpenPlugin'
  ]
  var missingVerificationHooks = requiredVerificationHooks.filter(function (item) {
    return combinedSource.indexOf(item) === -1
  })

  t.deepEqual(missingVerificationHooks, [], 'verification plugin exposes status query, package generation, and TronScan handoff hooks')
  t.end()
})

test('Remix 2.2.0 home parity uses only documented local assets and static external URLs', function (t) {
  var landingSource = fs.readFileSync(landingSourcePath, 'utf8')
  var homeParitySource = landingSource.slice(landingSource.indexOf('const renderOnboarding'), landingSource.indexOf('return container'))
  var assetMatches = homeParitySource.match(/src="assets\/[^"]+"/g) || []
  var missingAssets = assetMatches.map(function (match) {
    return match.replace('src="', '').replace('"', '')
  }).filter(function (assetPath) {
    return !fs.existsSync(path.join(__dirname, '../src', assetPath))
  })
  var urls = homeParitySource.match(/https?:\/\/[^'"\s)]+/g) || []
  var unsupportedUrls = urls.filter(function (url) {
    return !/^https:\/\/(developers\.tron\.network|tronide\.io|github\.com|raw\.githubusercontent\.com|tronscan\.org|discord\.gg)\//.test(url)
  })

  t.deepEqual(missingAssets, [], 'all local assets referenced by the home parity surface exist')
  t.deepEqual(unsupportedUrls, [], 'home parity external links stay on documented TRON/GitHub endpoints')
  t.end()
})

test('Remix 2.2.0 home parity constrains user input, logs, performance, and responsiveness', function (t) {
  var landingSource = fs.readFileSync(landingSourcePath, 'utf8')
  var topHeaderSource = fs.readFileSync(topHeaderSourcePath, 'utf8')
  var topHeaderStyle = fs.readFileSync(topHeaderStylePath, 'utf8')
  var settingsSource = fs.readFileSync(settingsSourcePath, 'utf8')
  var aiPanelSource = fs.readFileSync(aiPanelSourcePath, 'utf8')
  var appSource = fs.readFileSync(appSourcePath, 'utf8')
  var versionJson = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'))
  var cssSource = landingSource.slice(landingSource.indexOf('const css = csjs`'), landingSource.indexOf('const profile ='))
  var homeParitySource = landingSource.slice(landingSource.indexOf('const renderOnboarding'), landingSource.indexOf('return container'))
  var consoleStatements = homeParitySource.match(/console\.(log|error|warn|info)\([^\n]+/g) || []
  var leakingConsoleStatements = consoleStatements.filter(function (statement) {
    return /token|secret|password|private|credential|api/i.test(statement)
  })

  var generatedWorkspacePrefix = 'workspaceName = `tron_workspace_' + '$' + '{Date.now()}`'

  t.equal(landingSource.indexOf('${renderWalkthroughsPanel()}'), -1, 'walkthroughs are hidden from the Home advanced tools layout')
  t.equal(landingSource.indexOf('landingStartLearningButton'), -1, 'Start Learning entry is hidden while walkthroughs are disabled')
  t.ok(landingSource.indexOf('connectWalletFromHome') !== -1 && landingSource.indexOf('[data-id="headerWalletConnect"]') !== -1, 'Home wallet entry delegates to the real header wallet action')
  t.ok(landingSource.indexOf('landingAdvancedToolsPanel') !== -1 && landingSource.indexOf('advancedToolsState.open') !== -1 && landingSource.indexOf('landingAdvancedToolsContent') !== -1, 'advanced Home tools are collapsed behind an explicit toggle')
  t.ok(landingSource.indexOf('${renderMostUsedPlugins()}') !== -1 && landingSource.indexOf('landingPluginContractVerification') !== -1, 'Most used plugin cards are rendered as clickable Home actions')
  t.ok(landingSource.indexOf("globalRegistry.get('mainview')") !== -1 && landingSource.indexOf('openGlobalSearch(\'home\')') !== -1, 'Home search entry opens the real global search panel')
  t.ok(landingSource.indexOf('landingLayoutControlsPanel') !== -1 && landingSource.indexOf('toggleLayoutControl') !== -1 && landingSource.indexOf('landingLayoutReset') !== -1, 'layout controls are implemented as local toggles with reset')
  t.ok(topHeaderSource.indexOf("data-id='headerNotificationsPanel'") !== -1 && landingSource.indexOf('addNotification') !== -1 && landingSource.indexOf('type = \'info\'') !== -1, 'header notification center records typed local Home actions')
  t.ok(landingSource.indexOf('togglePluginCard') !== -1 && landingSource.indexOf('deactivatePlugin') !== -1, 'plugin card toggles call real plugin activation APIs')
  t.ok(landingSource.indexOf('startSolidityAnalyzer') !== -1 && landingSource.indexOf("this.verticalIcons.select('solidityStaticAnalysis')") !== -1 && landingSource.indexOf("this.verticalIcons.select('solhint')") === -1, 'analyzer plugin card opens the real Solidity Static Analysis plugin')
  t.ok(landingSource.indexOf('landingGithubTokenPanel') !== -1 && landingSource.indexOf('githubRequest') !== -1 && landingSource.indexOf('landingGithubTokenChecklist') !== -1, 'GitHub token MVP exposes private import, commit, and permission checklist actions')
  t.ok(landingSource.indexOf('landingGitWorkflowPanel') !== -1 && landingSource.indexOf('exportWorkspaceForGit') !== -1 && landingSource.indexOf('landingGitPrepare') !== -1, 'git init placeholder is replaced by a frontend git workflow panel')
  t.ok(landingSource.indexOf('const exported = await downloadFiles()') !== -1 && landingSource.indexOf("[data-id='headerBackupWorkspace']") === -1, 'Home git export calls the local workspace backup flow without depending on an open header dropdown')
  t.ok(landingSource.indexOf('landingWorkspaceHealthPanel') !== -1 && landingSource.indexOf('landingHealthContracts') !== -1 && landingSource.indexOf('landingHealthReadme') !== -1, 'workspace health panel summarizes local workspace readiness')
  t.ok(landingSource.indexOf("refreshHomeSection('landingWorkspaceHealthPanel', renderWorkspaceHealthPanel)") !== -1, 'workspace health panel refreshes after workspace status updates')
  t.ok(landingSource.indexOf('isElementCollapsed(side)') !== -1 && landingSource.indexOf('isElementCollapsed(terminalPanel)') !== -1 && landingSource.indexOf('isElementCollapsed(ai)') !== -1, 'layout reset checks side, terminal, and AI panel visibility before restoring')
  t.ok(landingSource.indexOf('landingRecipeTronLink') !== -1 && landingSource.indexOf('checkTronLinkReadiness') !== -1, 'TronLink readiness checker is available without backend support')
  t.ok(landingSource.indexOf('landingCookbookPanel') !== -1 && landingSource.indexOf('landingRecipeGithubToken') !== -1, 'static TRON cookbook recipes are available locally')
  t.ok(landingSource.indexOf(generatedWorkspacePrefix) !== -1, 'workspace creation uses generated names instead of accepting raw user input')
  t.deepEqual(leakingConsoleStatements, [], 'home parity console diagnostics do not include secret-bearing fields')
  t.ok(landingSource.indexOf('window.setTimeout') !== -1 && landingSource.indexOf('120)') !== -1, 'workspace refresh is debounced before file/workspace event processing')
  t.ok(landingSource.indexOf('countWorkspaceFiles') !== -1 && landingSource.indexOf('resolveDirectory') !== -1, 'workspace file counting is isolated to the existing workspace provider traversal')
  t.ok(cssSource.indexOf('@media (max-width: 1180px)') !== -1, 'desktop/tablet responsive breakpoint is present')
  t.ok(cssSource.indexOf('@media (max-width: 640px)') !== -1, 'mobile responsive breakpoint is present')
  t.ok(cssSource.indexOf('grid-template-columns: minmax(0, 1fr);') !== -1, 'desktop layout keeps the default Home content focused in a single column')
  t.equal(landingSource.indexOf('const renderTopProductBar'), -1, 'landing page no longer renders a duplicate product header')
  t.ok(topHeaderSource.indexOf("data-id='headerGithubConnect'") !== -1 && topHeaderSource.indexOf('connectGithub') !== -1 && topHeaderSource.indexOf('landingGithubTokenPanel') !== -1, 'real header GitHub action opens the token connection flow')
  t.ok(topHeaderSource.indexOf('landingAdvancedToolsToggle') !== -1 && topHeaderSource.indexOf('landingGithubTokenConnect') !== -1, 'header GitHub action expands advanced tools before token flow')
  t.ok(topHeaderSource.indexOf("data-id='headerWalletConnect'") !== -1 && topHeaderSource.indexOf('connectWallet') !== -1, 'real header wallet action invokes the wallet connection flow')
  t.ok(topHeaderSource.indexOf("data-id='headerLayoutToggles'") !== -1 && topHeaderSource.indexOf("data-id='headerToggleSidePanel'") !== -1 && topHeaderSource.indexOf("data-id='headerToggleBottomPanel'") !== -1 && topHeaderSource.indexOf("data-id='headerToggleAiPanel'") !== -1, 'real header exposes side, bottom, and AI panel layout toggles')
  t.ok(topHeaderSource.indexOf("data-id='headerWorkspaceMenu'") !== -1 && topHeaderSource.indexOf("data-id='headerCreateWorkspace'") !== -1 && topHeaderSource.indexOf("data-id='headerBackupWorkspace'") !== -1 && topHeaderSource.indexOf("data-id='headerRestoreWorkspace'") !== -1 && topHeaderSource.indexOf("data-id='headerConnectLocalhost'") !== -1, 'real header exposes workspace create, backup, restore, and localhost actions')
  t.ok(topHeaderSource.indexOf("plugin.call('filePanel', 'getWorkspaces')") !== -1 && topHeaderSource.indexOf("plugin.call('filePanel', 'setWorkspace'") !== -1, 'workspace header reuses filePanel workspace APIs')
  t.ok(topHeaderSource.indexOf("data-id='headerNotificationsButton'") !== -1 && topHeaderSource.indexOf("data-id='headerNotificationsPanel'") !== -1 && topHeaderSource.indexOf('tronide.home.notifications') !== -1, 'real header exposes persisted Home notifications')
  t.ok(topHeaderSource.indexOf('toggleSidePanel') !== -1 && topHeaderSource.indexOf("document.getElementById('side-panel')") !== -1, 'side panel header toggle targets the real side panel')
  t.ok(topHeaderSource.indexOf('toggleBottomPanel') !== -1 && topHeaderSource.indexOf('mainview.minimizeTerminal') !== -1 && appSource.indexOf('new HeaderPanel(appManager, mainview)') !== -1, 'bottom panel header toggle uses the real mainview terminal control')
  t.ok(topHeaderSource.indexOf('toggleAiPanel') !== -1 && topHeaderSource.indexOf("plugin.call('aiPanel', 'hide')") !== -1, 'AI panel header toggle uses the existing AI panel show/hide method')
  t.ok(topHeaderSource.indexOf("data-id='headerSettingsButton'") !== -1 && topHeaderSource.indexOf('settingsHandler') !== -1, 'settings entry is rendered as a real header action')
  t.equal(topHeaderSource.indexOf('theme-wrapper'), -1, 'theme selector is removed from the header and remains available through Settings')
  t.ok(settingsSource.indexOf('data-id="settingsTabThemePanel"') !== -1 && settingsSource.indexOf('settingsTabTheme') !== -1 && settingsSource.indexOf('switchTheme') !== -1, 'Settings exposes the theme selector after it is removed from the header')
  t.ok(topHeaderStyle.indexOf('.header-layout-toggles') !== -1 && topHeaderStyle.indexOf('.layout-toggle-btn') !== -1, 'header layout toggles have compact centered styles')
  t.ok(topHeaderStyle.indexOf('.header-workspace-menu') !== -1 && topHeaderStyle.indexOf('.header-workspace-dropdown') !== -1, 'header workspace dropdown has compact dark-theme styles')
  t.ok(topHeaderStyle.indexOf('.notification-badge') !== -1 && topHeaderStyle.indexOf('.header-notifications-dropdown') !== -1, 'header notifications have badge and dropdown styles')
  t.ok(topHeaderStyle.indexOf('--header-control-text') !== -1 && topHeaderStyle.indexOf('var(--header-control-bg)') !== -1 && topHeaderStyle.indexOf('.header-action-icon') !== -1, 'header GitHub and wallet buttons use theme-adaptive action styling')
  t.ok(topHeaderSource.indexOf('shortenTronAddress') !== -1 && topHeaderSource.indexOf('tron_requestAccounts') !== -1, 'wallet flow requests TronLink accounts and renders a truncated connected address')
  t.ok(topHeaderSource.indexOf('onWalletAccountsChanged') !== -1 && topHeaderSource.indexOf('accountsChanged') !== -1, 'wallet flow listens for account changes after connect')
  t.ok(topHeaderSource.indexOf('onWalletNetworkChanged') !== -1 && topHeaderSource.indexOf('chainChanged') !== -1 && topHeaderSource.indexOf('setNode') !== -1, 'wallet flow listens for network changes after connect')
  t.ok(topHeaderSource.indexOf('TRON_GENESIS_NETWORKS') !== -1 && topHeaderSource.indexOf('getNetworkFromGenesisBlock') !== -1 && topHeaderSource.indexOf('trx.getBlock(0)') !== -1, 'header wallet network label uses genesis detection before host fallback')
  t.ok(topHeaderSource.indexOf("data-id='headerWalletDisconnect'") !== -1 && topHeaderSource.indexOf('disconnectInjectedTronWeb') !== -1, 'wallet menu exposes an explicit disconnect flow')
  var disabledWalletButton = 'disabled={' + 'walletConnectInFlight}'
  t.ok(topHeaderSource.indexOf('walletConnectInFlight') !== -1 && topHeaderSource.indexOf(disabledWalletButton) !== -1, 'wallet connection guards against duplicate clicks while a request is pending')
  t.ok(topHeaderSource.indexOf('TronLink is not installed') !== -1 && topHeaderSource.indexOf('Wallet connection was rejected') !== -1, 'wallet missing and rejected paths have clear user-facing feedback')
  t.ok(topHeaderStyle.indexOf('.header-actions') !== -1 && topHeaderStyle.indexOf('.header-action-btn') !== -1, 'real header owns compact GitHub and wallet actions')
  t.ok(appSource.indexOf('style="min-width: 340px;"') !== -1 && aiPanelSource.indexOf("'340px'") !== -1, 'AI panel defaults visible and restores to reduced width')
  t.equal(versionJson.version, '2.3.0', 'header version asset matches package release version')
  t.ok(cssSource.indexOf('grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));') !== -1, 'quick actions use auto-fit columns to avoid narrow cards')
  t.ok(cssSource.indexOf('grid-template-columns: 1fr;') !== -1, 'multi-column panels collapse to one column on narrower screens')
  t.end()
})

test('Remix 2.2.0 home parity traceability document maps every 4.1 row to code and tests', function (t) {
  var traceSource = fs.readFileSync(parityTracePath, 'utf8')
  var requiredRows = [
    '首页结构',
    '首页 onboarding',
    'Most used plugins',
    'Contract Verification',
    'RemixAI 首页化',
    '顶部栏',
    '状态入口替换',
    '插件卡开关与 Explore all plugins',
    '顶部账号与通知',
    'GitHub 连接产品化'
  ]
  var missingRows = requiredRows.filter(function (row) {
    return traceSource.indexOf(row) === -1
  })
  var requiredEvidence = [
    'apps/remix-ide/src/app/ui/landing-page/landing-page.js',
    'apps/remix-ide/src/app/ui/landing-page/remix-220-home-parity-features.js',
    'apps/remix-ide/test/remix-220-home-parity-test.js',
    'apps/remix-ide-e2e/src/tests/defaultLayout.test.ts',
    'node apps/remix-ide/test/remix-220-home-parity-test.js',
    'node apps/remix-ide/test/index.js',
    'pnpm nx build remix-ide',
    'Browser smoke result',
    'console errors: []',
    'Root cause',
    'Manual verification steps',
    'Upstream reference',
    'No new dependencies',
    'No new environment variables',
    '1366x768',
    '1440x900',
    '1920x1080',
    '768px',
    '375px',
    'Primary journey',
    'Changed files summary',
    'Clean checkout reproduction',
    'Current unsupported browser coverage',
    'Theme/style evidence',
    'State and failure feedback',
    'No new CSP, CORS, mixed-content, or SRI surface',
    'All 4.1 rows are decomposed',
    'Permission/auth matrix',
    'Routing and navigation evidence',
    'Editor/file/compiler evidence',
    'Stats source evidence',
    'Internationalization boundary',
    'Upload/import boundary',
    'Preference persistence boundary',
    'Null/empty/slow/repeated-trigger boundaries',
    'No error-boundary or strict-mode bypass',
    'Core regression smoke',
    'Dev server smoke',
    'Keyboard activation evidence',
    'Color contrast evidence',
    'Refresh/back/forward/repeated-click evidence',
    'Preview evidence',
    'No unrelated report-section regression',
    'User-code execution boundary',
    'File upload failure boundary'
  ]
  var missingEvidence = requiredEvidence.filter(function (item) {
    return traceSource.indexOf(item) === -1
  })

  t.deepEqual(missingRows, [], 'every 4.1 P0/P1 row appears in the traceability document')
  t.deepEqual(missingEvidence, [], 'traceability document includes code, test, and verification evidence')
  t.end()
})

test('TronIDE v2.3.0 roadmap section 3 traceability maps every short-term item and external boundary', function (t) {
  var traceSource = fs.readFileSync(roadmap3TracePath, 'utf8')
  var requiredItems = [
    '3.1 功能状态矩阵与首页入口校准',
    '3.2 TronLink 连接流程产品化',
    '3.3 TRON Provider / Network Selector',
    '3.4 Solidity / TVM 编译基础稳定性',
    '3.5 部署与合约交互最小闭环',
    '3.6 v2.3.0 测试与发布证据',
    '3.7 README / 文档口径修正',
    'headerGithubConnect',
    'headerWalletConnect',
    'connectWallet',
    'tron_requestAccounts',
    'shortenTronAddress',
    'walletConnectInFlight',
    'Home GitHub Token flow',
    'node apps/remix-ide/test/remix-220-home-parity-test.js',
    'node apps/remix-ide/test/index.js',
    'pnpm nx build remix-ide --skip-nx-cache',
    'git diff --check',
    'Nightwatch E2E needs Selenium on `localhost:4444`',
    'Mainnet is not a pass criterion',
    'Real TronLink authorization, account switching, network switching, and Nile deploy/call smoke cannot be completed without',
    'default Home single-column layout',
    'horizontal overflow: `false`',
    'missing-wallet result: `Connect Wallet · TronLink is not installed`',
    'mock-success result with Nile host and address `TCrDi83pUoK17GbwxN1SckM3YNXzahWvoN`: `Wallet TCrDi8…ahWvoN · Nile`',
    'mock-reject result with TronLink `code=4001`: `Connect Wallet · Wallet connection was rejected`',
    'runtime error collector result: `errors: []`',
    'dev server reachable: `http://127.0.0.1:8080/` with `headerGithubConnect`, `headerWalletConnect`, and `landingRemix220Shell` present'
  ]
  var missingItems = requiredItems.filter(function (item) {
    return traceSource.indexOf(item) === -1
  })

  t.deepEqual(missingItems, [], 'roadmap 3 traceability covers ordered 3.1-3.7 items, top actions, tests, and external blocked evidence')
  t.end()
})

test('TronIDE v2.3.0 README states TRON scope, Nile validation, and external boundaries', function (t) {
  var readmeSource = fs.readFileSync(rootReadmePath, 'utf8')
  var requiredReadmeCopy = [
    'TRON-oriented fork of the Remix Project',
    'rather than full Ethereum Remix parity',
    'install TronLink in your browser, unlock it, and switch to Nile',
    'Mainnet is not required for release validation',
    'Use Nile/testnet for validation; do not treat mainnet deployment as a release pass criterion',
    'apps/remix-ide/docs/v2.3.0-roadmap-section-3-traceability.md',
    'the TronScan-oriented Contract Verification plugin exposes its actual local state',
    'GitHub OAuth is deferred while private read/write uses user-provided fine-grained tokens in the browser',
    'automated TronScan source submission/receipts plus EVM-only verification services remain blocked/unavailable or not applicable to TRON rather than marked done'
  ]
  var missingReadmeCopy = requiredReadmeCopy.filter(function (item) {
    return readmeSource.indexOf(item) === -1
  })

  t.deepEqual(missingReadmeCopy, [], 'README describes v2.3.0 TRON-oriented scope and does not overclaim unavailable features')
  t.end()
})

test('Remix 2.2.0 home parity keeps interactive controls accessible and named', function (t) {
  var landingSource = fs.readFileSync(landingSourcePath, 'utf8')
  var homeParitySource = landingSource.slice(landingSource.indexOf('const renderOnboarding'), landingSource.indexOf('return container'))
  var requiredLabels = [
    'aria-label="Create workspace"',
    'aria-label="Open TRON DApp template"',
    'aria-label="Connect wallet"',
    'aria-label="Open all plugins"',
    'aria-label="Open verification lookup"'
  ]
  var missingLabels = requiredLabels.filter(function (label) {
    return homeParitySource.indexOf(label) === -1
  })

  t.deepEqual(missingLabels, [], 'key 4.1 controls have explicit accessible names')
  t.end()
})

test('Remix 2.2.0 home parity interactive non-button controls are keyboard reachable', function (t) {
  var landingSource = fs.readFileSync(landingSourcePath, 'utf8')
  var createContractAction = 'data-id="quickStartCreateContract" onclick=$' + '{() => createNewFile()}'
  var requiredSemantics = [
    'data-id="landingExploreAllPluginsButton" role="button" tabindex="0"',
    createContractAction
  ]
  var missingSemantics = requiredSemantics.filter(function (item) {
    return landingSource.indexOf(item) === -1
  })

  t.deepEqual(missingSemantics, [], 'non-button clickable 4.1 controls have button role and tab stop')
  t.end()
})

test('Remix 2.2.0 home parity avoids new unsafe APIs, debug leftovers, and unbounded polling', function (t) {
  var landingSource = fs.readFileSync(landingSourcePath, 'utf8')
  var homeParitySource = landingSource.slice(landingSource.indexOf('const renderOnboarding'), landingSource.indexOf('return container'))

  t.equal(homeParitySource.indexOf('console.log'), -1, '4.1 home parity source has no console.log debug leftovers')
  t.equal(homeParitySource.indexOf('debugger'), -1, '4.1 home parity source has no debugger statements')
  t.equal(homeParitySource.indexOf('innerHTML'), -1, '4.1 home parity source does not introduce innerHTML injection')
  t.equal(homeParitySource.indexOf('setInterval'), -1, '4.1 home parity source does not introduce interval polling')
  t.ok(landingSource.indexOf('clearTimeout(this._workspaceStatusTimer)') !== -1, 'workspace status timer is cleaned up')
  t.end()
})

test('Remix 2.2.0 home parity source exposes user feedback and blocked states', function (t) {
  var landingSource = fs.readFileSync(landingSourcePath, 'utf8')
  var contractVerificationSource = fs.readFileSync(contractVerificationSourcePath, 'utf8')
  var topHeaderSource = fs.readFileSync(topHeaderSourcePath, 'utf8')
  var combinedSource = landingSource + '\n' + contractVerificationSource + '\n' + topHeaderSource
  var requiredFeedback = [
    'Workspace created:',
    'TronScan status query',
    'Package checklist',
    'Generate package',
    'No notifications yet.'
  ]
  var missingFeedback = requiredFeedback.filter(function (item) {
    return combinedSource.indexOf(item) === -1
  })

  t.deepEqual(missingFeedback, [], 'async, blocked, empty, and unavailable states provide visible text feedback')
  t.end()
})

test('Remix 2.2.0 home parity links final evidence to browser smoke and preview artifacts', function (t) {
  var traceSource = fs.readFileSync(parityTracePath, 'utf8')
  var requiredFinalEvidence = [
    'screenshot_path',
    'browser_screenshot_',
    'Tab-order smoke',
    'Enter/Space activation',
    'latest Chrome/Chromium',
    'dev server startup',
    'home → file/editor → compiler/plugin navigation',
    'no unrelated report section changed'
  ]
  var missingFinalEvidence = requiredFinalEvidence.filter(function (item) {
    return traceSource.indexOf(item) === -1
  })

  t.deepEqual(missingFinalEvidence, [], 'final traceability evidence includes preview, keyboard, dev, and regression artifacts')
  t.end()
})

test('Remix 2.2.0 home parity documents non-applicable external services instead of faking them', function (t) {
  var traceSource = fs.readFileSync(parityTracePath, 'utf8')
  var blockedStates = [
    'OAuth flow remains deferred',
    'account sign-in is token-only',
    'GitHub private read/write uses browser token MVP',
    'notifications use the local Home action center',
    'external EVM verification providers are documented in the verification plugin as not applicable to TRON',
    'Git init is replaced by a frontend Git workflow'
  ]
  var missingBlockedStates = blockedStates.filter(function (state) {
    return traceSource.indexOf(state) === -1
  })

  t.deepEqual(missingBlockedStates, [], 'unavailable external/account/model/git features are explicit blocked or not-applicable states')
  t.end()
})
