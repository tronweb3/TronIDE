/*
 * Modifications Copyright © 2022 TronIDE
 * Licensed under the Apache License, Version 2.0
 */

const REMIX_220_HOME_PARITY_FEATURES = {
  p0: [
    {
      id: 'home-structure',
      title: 'Home structure',
      baseline: ['Prepare Workspace', 'First Time? Start Here!', 'Most used plugins', 'Explore all plugins'],
      status: 'required',
      dataIds: ['landingCreateWorkspaceButton', 'landingFirstTimeStartHere', 'landingMostUsedPlugins', 'landingExploreAllPluginsButton']
    },
    {
      id: 'home-onboarding',
      title: 'TRON onboarding',
      baseline: ['TRON documentation', 'TronIDE website/source builds', 'TRON DApp starter', 'Connect Wallet'],
      status: 'required',
      dataIds: ['landingDocumentationButton', 'landingWebsiteButton', 'landingDesktopDownloadButton', 'landingDappStarterCard', 'landingWalletConnectEntry']
    },
    {
      id: 'most-used-plugins',
      title: 'Most used plugins',
      baseline: ['TRON Contract Verification', 'TVM Solidity Analyzers', 'TRON Cookbook'],
      status: 'required',
      dataIds: ['landingPluginContractVerification', 'landingPluginSolidityAnalyzers', 'landingPluginCookbook']
    },
    {
      id: 'contract-verification',
      title: 'Contract Verification',
      baseline: ['Verify', 'Receipts', 'Lookup', 'Settings', 'Chain', 'Contract Address', 'Contract Name', 'Proxy', 'TronScan'],
      status: 'required',
      dataIds: ['landingVerificationPanel', 'landingVerificationTabVerify', 'landingVerificationTabReceipts', 'landingVerificationTabLookup', 'landingVerificationChecklist']
    },
    {
      id: 'remixai-entry',
      title: 'RemixAI Assistant entry',
      baseline: ['REMIXAI ASSISTANT', 'New chat', 'File', 'New Workspace', 'Create a DApp'],
      status: 'required',
      dataIds: ['landingAiAssistantPanel', 'landingAiNewChat', 'landingAiActionFile', 'landingAiActionNewWorkspace', 'landingAiActionCreateDapp']
    }
  ],
  p1: [
    {
      id: 'topbar-productization',
      title: 'Top bar productization',
      baseline: ['Workspace selector', 'Header layout controls', 'Connect GitHub', 'Connect Wallet', 'Sign In Beta', 'Notifications', 'Settings'],
      status: 'required',
      dataIds: ['landingAdvancedToolsPanel', 'landingAdvancedToolsToggle', 'landingLayoutControlsPanel', 'landingLayoutToggleSidePanel', 'landingLayoutToggleAiPanel', 'landingLayoutToggleTerminal', 'landingLayoutReset', 'headerWorkspaceMenu', 'headerWorkspaceDropdown', 'headerCreateWorkspace', 'headerBackupWorkspace', 'headerRestoreWorkspace', 'headerConnectLocalhost', 'headerLayoutToggles', 'headerToggleSidePanel', 'headerToggleBottomPanel', 'headerToggleAiPanel', 'headerGithubConnect', 'headerWalletConnect', 'headerNotificationsButton', 'headerNotificationsPanel', 'headerSettingsButton']
    },
    {
      id: 'status-entry-replacements',
      title: 'Status entry replacements',
      baseline: ['Workspace status', 'Prepare Git workflow', 'Did you know?'],
      status: 'required',
      dataIds: ['landingAdvancedToolsPanel', 'landingWorkspaceHealthPanel', 'landingGitWorkflowPanel', 'landingGitPrepare', 'landingRecipeNileDeploy', 'headerNotificationsButton', 'headerNotificationsPanel']
    },
    {
      id: 'plugin-card-actions',
      title: 'Plugin card actions',
      baseline: ['Toggle state', 'Maintained by TronIDE', 'Open Verification', 'Search TRON templates'],
      status: 'required',
      dataIds: ['landingPluginToggleContractVerification', 'landingPluginToggleAnalyzers', 'landingPluginToggleCookbook']
    },
    {
      id: 'github-account-boundaries',
      title: 'GitHub/account boundaries',
      baseline: ['Public import available', 'Token private read/write available', 'OAuth deferred until backend'],
      status: 'required',
      dataIds: ['headerGithubConnect', 'headerWalletConnect', 'landingGithubTokenPanel', 'landingGithubTokenConnect', 'landingGithubTokenImport', 'landingGithubTokenCommit', 'landingGithubTokenChecklist', 'landingRecipeTronLink', 'landingWorkspaceHealthPanel', 'landingCookbookPanel']
    }
  ]
}

function getRemix220HomeParityFeatures () {
  return REMIX_220_HOME_PARITY_FEATURES
}

function getRemix220HomeParityDataIds () {
  return REMIX_220_HOME_PARITY_FEATURES.p0.concat(REMIX_220_HOME_PARITY_FEATURES.p1).reduce(function (ids, item) {
    return ids.concat(item.dataIds || [])
  }, [])
}

if (typeof module !== 'undefined') {
  module.exports = {
    REMIX_220_HOME_PARITY_FEATURES,
    getRemix220HomeParityFeatures,
    getRemix220HomeParityDataIds
  }
}
