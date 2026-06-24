/*
 * Original work Copyright © 2018-2021 Remix Team
 * Licensed under the MIT License.
 *
 * Modifications Copyright © 2022 TronIDE
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

export const generateContractMetadataText = 'Generate contract metadata. Generate a JSON file in the contract folder. Allows to specify library addresses the contract depends on. If nothing is specified, TronIDE deploys libraries automatically.'
export const textSecondary = 'text-secondary'
export const textDark = 'text-dark'
export const warnText = 'Be sure the endpoint is opened before enabling it. \nThis mode allows a user to provide a passphrase in the TronIDE interface without having to unlock the account. Although this is very convenient, you should completely trust the backend you are connected to (Geth, Parity, ...). TronIDE never persists any passphrase'.split('\n').map(s => s.trim()).join(' ')
export const gitAccessTokenTitle = 'Gist Access Token'
export const gitAccessTokenText = 'Used only to publish and load Gists (not for GitHub repositories). Stored on this device and kept across sessions.'
export const gitAccessTokenText2 = 'Create a classic token at the link below with only the \'gist\' scope (a fine-grained PAT cannot create gists). To import from or push to a GitHub repository instead, connect a token on the Home page — that one needs the \'repo\' / Contents permission.'
export const gitAccessTokenLink = 'https://github.com/settings/tokens'
export const ethereunVMText = 'Always use JavaScript VM (Tron) at load'
export const wordWrapText = 'Word wrap in editor'
export const enablePersonalModeText = ' Enable Personal Mode for web3 provider. Transaction sent over Web3 will use the web3.personal API.\n'
export const matomoAnalytics = 'Enable Matomo Analytics. We do not collect personally identifiable information (PII). The info is used to improve the site’s UX & UI. See more about '
