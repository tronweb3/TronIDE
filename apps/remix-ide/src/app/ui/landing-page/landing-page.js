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

import * as packageJson from '../../../../../../package.json'
import { ViewPlugin } from '@remixproject/engine-web'
import { migrateToWorkspace } from '../../../migrateFileSystem'
import { CompilerImports } from '@remix-project/core-plugin'
import { workspace } from '@remix-project/remix-lib'
import JSZip from 'jszip'

const yo = require('yo-yo')
const csjs = require('csjs-inject')
const globalRegistry = require('../../../global/registry')
const modalDialogCustom = require('../modal-dialog-custom')
const modalDialog = require('../modaldialog')
const tooltip = require('../tooltip')
const GistHandler = require('../../../lib/gist-handler')
const _paq = window._paq = window._paq || []
const tronTemplates = workspace && workspace.tronTemplates ? workspace.tronTemplates.TRON_TEMPLATES : []

const css = csjs`
  .text {
    cursor: pointer;
    font-weight: normal;
    max-width: 300px;
    user-select: none;
  }
  .text:hover {
    cursor: pointer;
    text-decoration: underline;
  }
  .homeContainer {
    --home-bg: #F7F5F5;
    --home-surface: #FFFFFF;
    --home-surface-2: #FBF5F5;
    --home-hero-start: #FFF6F5;
    --home-hero-end: #FCE7E7;
    --home-border: #E2DCDC;
    --home-border-strong: #E8C9C9;
    --home-text: #221B1B;
    --home-muted: #675B5B;
    --home-subtle: #8E8585;
    --home-accent: #C8302D;
    --home-accent-hover: #8E1B19;
    --home-accent-soft: #F7DDDD;
    --home-shadow: rgba(46, 30, 30, .08);
    user-select: none;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: hidden;
    background: var(--home-bg);
  }
  .homeContainerDark {
    --home-bg: #171821;
    --home-surface: #202231;
    --home-surface-2: #252739;
    --home-hero-start: #2C1D28;
    --home-hero-end: #211B27;
    --home-border: #383B51;
    --home-border-strong: #663340;
    --home-text: #F1EDF2;
    --home-muted: #B8B1C4;
    --home-subtle: #8F879D;
    --home-accent: #FF5A62;
    --home-accent-hover: #FF747B;
    --home-accent-soft: #3A2632;
    --home-shadow: rgba(0, 0, 0, .36);
  }
  .mainContent {
    overflow-y: auto;
    flex-grow: 3;
    min-height: 0;
    height: 100%;
    background: var(--home-bg);
    color: var(--home-text);
  }
  .remix220Shell {
    min-height: 100%;
    display: grid;
    grid-template-rows: 1fr auto;
    background: var(--home-bg);
    color: var(--home-text);
  }
  .remix220Content {
    padding: 10px 12px 12px;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
    align-items: start;
  }
  .remix220Main {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .remix220RightRail {
    position: sticky;
    top: 58px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .homeWrap {
    max-width: 1180px;
    margin: 0 auto;
    padding: 26px 28px 34px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .image {
    height: 1em;
    width: 1em;
    text-align: center;
  }
  .envLogo {
    height: 16px;
  }
  .cursorStyle {
    cursor: pointer;
  }
  .envButton {
    width: 120px;
    height: 70px;
  }
  .migrationBtn {
    width: 100px;
  }
  .textDangerAlert a:hover{
    color: #FF5858;
  }
  .textDanger {
    color: #FF5858;
  }
  .heroPanel {
    position: relative;
    background: linear-gradient(135deg, var(--home-hero-start), var(--home-hero-end));
    border: 1px solid var(--home-border-strong);
    color: var(--home-text);
    padding: 18px 22px 16px;
    overflow: hidden;
    border-radius: 0;
  }
  .heroPanel::before {
    content: '';
    position: absolute;
    width: 320px;
    height: 320px;
    right: -100px;
    top: -140px;
    background: radial-gradient(circle, color-mix(in srgb, var(--home-accent) 18%, transparent), transparent 70%);
    pointer-events: none;
  }
  .heroPanel::after {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    background: var(--home-accent);
  }
  .heroEyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    line-height: 1;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--home-accent);
    font-weight: 700;
    margin-bottom: 14px;
  }
  .heroLogo {
    width: 12px;
    height: 12px;
    flex: 0 0 12px;
    display: block;
    object-fit: contain;
    object-position: center;
    transform: translateY(2px);
  }
  .homeContainerDark .heroLogo {
    transform: none;
  }
  .heroEyebrowSquare {
    width: 8px;
    height: 8px;
    background: var(--home-accent);
    display: inline-block;
  }
  .heroTitle {
    position: relative;
    z-index: 1;
    font-size: 24px;
    margin: 0 0 6px;
    letter-spacing: -.4px;
    color: var(--home-text);
    font-weight: 700;
  }
  .heroSubtitle {
    position: relative;
    z-index: 1;
    margin: 0 0 14px;
    color: var(--home-muted);
    font-size: 13px;
    max-width: 760px;
    line-height: 1.45;
  }
  .kbdKey {
    background: var(--home-surface-2);
    border: 1px solid var(--home-border);
    border-bottom-width: 2px;
    padding: 1px 6px;
    font-family: Consolas, monospace;
    font-size: 11px;
    color: var(--home-text);
  }
  .heroMeta {
    position: relative;
    z-index: 1;
    margin-top: 14px;
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    font-size: 12px;
    color: var(--home-muted);
  }
  .heroMetaItem {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .heroMetaDot {
    width: 6px;
    height: 6px;
    background: var(--home-accent);
    box-shadow: 0 0 0 3px var(--home-accent-soft);
  }
  .quickStartGrid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 12px;
  }
  .primaryActionsPanel {
    background: transparent;
    border: 0;
    box-shadow: none;
    padding: 0;
  }
  .primaryActionsPanel .panelHead {
    border-bottom: 0;
    padding-bottom: 0;
  }
  .primaryActionsGrid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .primaryActionsGrid .quickStartCard {
    min-height: 104px;
  }
  .quickStartCard {
    min-height: 118px;
    text-align: left;
    border: 1px solid var(--home-border);
    background: var(--home-surface);
    color: var(--home-text);
    padding: 12px 12px;
    cursor: pointer;
    transition: border-color .15s ease, box-shadow .15s ease;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-radius: 0;
  }
  .quickStartCard:hover {
    border-color: var(--home-accent);
    box-shadow: 0 8px 20px var(--home-shadow);
  }
  .quickStartIcon {
    width: 36px;
    height: 36px;
    background: var(--home-accent-soft);
    color: var(--home-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: 18px;
    font-weight: 700;
    line-height: 1;
  }
  .quickStartIcon i {
    font-size: 17px;
  }
  .quickStartCardTitle {
    font-size: 14px;
    font-weight: 600;
    color: var(--home-text);
  }
  .quickStartCardDesc {
    font-size: 12px;
    line-height: 1.5;
    white-space: normal;
    color: var(--home-muted);
    flex: 1;
  }
  .sectionGrid {
    display: grid;
    grid-template-columns: 1.2fr 1fr 1fr;
    gap: 14px;
  }
  .onboardingGrid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 14px;
    align-items: stretch;
  }
  .starterStrip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
  }
  .workspaceTile {
    background: var(--home-surface-2);
    border: 1px solid var(--home-border);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 100%;
  }
  .workspaceTileTitle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 700;
    color: var(--home-text);
  }
  .assistantInput {
    min-height: 76px;
    width: 100%;
    border: 1px solid var(--home-border-strong);
    background: var(--home-surface-2);
    color: var(--home-muted);
    padding: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    text-align: left;
  }
  .assistantPrompt {
    color: var(--home-subtle);
    line-height: 1.45;
  }
  .statusDock {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 10px 18px;
    border-top: 1px solid var(--home-border);
    background: var(--home-surface);
  }
  .statusDockItems {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    color: var(--home-muted);
    font-size: 12px;
  }
  .statusDockActions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .panel {
    background: var(--home-surface);
    border: 1px solid var(--home-border);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-shadow: 0 1px 0 var(--home-shadow);
    border-radius: 0;
  }
  .panelHead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--home-border);
  }
  .panelHeadTitle {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: .5px;
    text-transform: uppercase;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--home-text);
  }
  .panelHeadIcon {
    width: 22px;
    height: 22px;
    background: var(--home-accent-soft);
    color: var(--home-accent);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .panelMore {
    font-size: 12px;
    color: var(--home-muted);
    cursor: pointer;
  }
  .panelMore:hover {
    color: var(--home-accent);
    opacity: 1;
  }
  .pluginGrid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .verificationLaunchCard {
    min-height: 0;
    padding: 14px;
    gap: 10px;
  }
  .verificationLaunchTop {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .verificationActions {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
    margin-top: 10px;
  }
  .pluginCard {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    border: 1px solid var(--home-border);
    padding: 16px 14px;
    text-align: left;
    cursor: pointer;
    background: var(--home-surface);
    transition: border-color .12s ease;
    color: var(--home-text);
    border-radius: 0;
  }
  .pluginCard:hover {
    border-color: var(--home-accent);
  }
  .pluginCard .pluginIcon {
    margin: 0 0 12px;
    border-radius: 6px;
    font-size: 16px;
  }
  .pluginCard .pluginName {
    font-size: 14px;
    margin-bottom: 2px;
  }
  .pluginCard .quickStartCardDesc {
    margin-top: 8px;
  }
  .pluginCard .loadChips {
    margin-top: auto;
    padding-top: 14px;
    flex-direction: column;
    flex-wrap: nowrap;
    gap: 6px;
  }
  .pluginCard .loadChips .loadChip {
    width: 100%;
    justify-content: center;
  }
  .pluginCardCore {
    position: relative;
    border-color: var(--home-border-strong);
  }
  .pluginCardCore .pluginIcon {
    background: var(--home-accent);
    color: #fff;
  }
  .pluginCardCore .pluginIconImg {
    filter: brightness(0) invert(1);
  }
  .pluginIcon {
    width: 36px;
    height: 36px;
    margin: 0 auto 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--home-accent);
    background: var(--home-accent-soft);
  }
  .pluginIconImg {
    width: 20px;
    height: 20px;
    object-fit: contain;
  }
  .resourceIcon i, .fileIcon i, .pluginIcon i, .quickStartIcon i {
    line-height: 1;
  }
  .resourceIcon img, .pluginIcon img, .quickStartIcon img, .fileIcon img {
    display: block;
  }
  .homeContainerDark .heroLogo,
  .homeContainerDark .pluginIconImg,
  .homeContainerDark .quickStartIcon img,
  .homeContainerDark .fileIcon img,
  .homeContainerDark .resourceIcon img {
    filter: brightness(0) invert(1);
    opacity: .92;
  }
  .pluginName {
    font-size: 12px;
    font-weight: 600;
    color: var(--home-text);
  }
  .pluginTag {
    position: absolute;
    top: 8px;
    right: 8px;
    display: inline-block;
    background: var(--home-accent);
    color: #fff;
    font-size: 10px;
    line-height: 1;
    padding: 3px 5px;
    font-weight: 700;
  }
  .fileRow {
    display: grid;
    grid-template-columns: 26px 1fr auto;
    gap: 8px;
    align-items: center;
    padding: 9px 0;
    border-bottom: 1px solid var(--home-border);
    cursor: pointer;
    color: var(--home-text);
  }
  .fileRow:hover .fileLabel {
    color: var(--home-accent);
  }
  .fileIcon {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--home-accent-soft);
    color: var(--home-accent);
  }
  .fileLabel {
    font-size: 13px;
    font-weight: 600;
  }
  .fileDesc {
    font-size: 11px;
    color: var(--home-subtle);
  }
  .hiddenFileInput {
    display: none;
  }
  .loadFromLabel {
    margin-top: 6px;
    font-size: 11px;
    letter-spacing: 1.2px;
    color: var(--home-subtle);
  }
  .loadChips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .loadChip {
    border: 1px solid var(--home-border);
    padding: 7px 10px;
    font-size: 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--home-surface);
    color: var(--home-text);
    border-radius: 0;
  }
  .loadChip:hover,
  .loadChip:focus {
    border-color: var(--home-accent);
    color: var(--home-accent);
    outline: 1px solid var(--home-accent-soft);
    outline-offset: 1px;
  }
  .loadChip:disabled {
    cursor: wait;
    opacity: .7;
  }
  .loadChipActive {
    border-color: var(--home-accent);
    background: var(--home-accent-soft);
    color: var(--home-accent);
    font-weight: 700;
  }
  .recipeGrid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 8px;
  }
  .advancedToolsGrid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 14px;
    margin-top: 12px;
  }
  .advancedToolsGrid .panel {
    margin-bottom: 0;
  }
  .recipeCard {
    border: 1px solid var(--home-border);
    background: var(--home-surface-2);
    padding: 9px 10px;
    color: var(--home-muted);
    font-size: 12px;
    line-height: 1.45;
  }
  .recipeTitle {
    color: var(--home-text);
    font-weight: 700;
    margin-bottom: 4px;
  }
  .noticeTag {
    color: var(--home-accent);
    font-weight: 700;
  }
  .notificationList {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .notificationItem {
    border: 1px solid var(--home-border);
    background: var(--home-surface-2);
    padding: 8px 10px;
    color: var(--home-muted);
    font-size: 12px;
    line-height: 1.45;
  }
  .notificationTitle {
    color: var(--home-text);
    font-weight: 700;
    margin-bottom: 2px;
  }
  .securityNote {
    border: 1px solid var(--home-border-strong);
    border-left: 4px solid var(--home-accent);
    background: var(--home-surface-2);
    color: var(--home-muted);
    padding: 8px 10px;
    font-size: 12px;
    line-height: 1.45;
    margin: 8px 0;
  }
  .walletStatusChip {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .resourceList {
    display: flex;
    flex-direction: column;
  }
  .statusList {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .statusPill {
    border: 1px solid var(--home-border);
    background: var(--home-surface);
    color: var(--home-text);
    padding: 8px 10px;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    align-items: center;
    font-size: 12px;
    text-align: left;
    text-decoration: none;
  }
  .statusPill:hover {
    border-color: var(--home-accent);
    color: var(--home-accent);
    text-decoration: none;
  }
  .statusBadge {
    color: var(--home-subtle);
    font-size: 11px;
    white-space: nowrap;
  }
  .resourceRow {
    display: grid;
    grid-template-columns: 28px 1fr auto;
    gap: 10px;
    align-items: center;
    padding: 10px 0;
    color: var(--home-text);
    border-bottom: 1px solid var(--home-border);
    text-decoration: none;
  }
  .resourceRow:hover {
    color: var(--home-accent);
    text-decoration: none;
  }
  .resourceButton {
    width: 100%;
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--home-border);
    text-align: left;
    cursor: pointer;
  }
  .resourceIcon {
    width: 24px;
    height: 24px;
    background: var(--home-accent-soft);
    color: var(--home-accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
  }
  .resourceLabel {
    font-size: 13px;
    font-weight: 600;
  }
  .resourceArrow {
    color: var(--home-subtle);
  }
  .tip {
    background: var(--home-hero-start);
    border: 1px solid var(--home-border-strong);
    border-left: 4px solid var(--home-accent);
    padding: 14px 18px;
    display: flex;
    gap: 12px;
    align-items: center;
    color: var(--home-text);
    border-radius: 0;
  }
  .tipIcon {
    width: 22px;
    height: 22px;
    background: var(--home-accent);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    flex-shrink: 0;
  }
  .tipBody {
    flex: 1;
    font-size: 13px;
    line-height: 1.55;
  }
  .tipBody b {
    color: var(--home-accent);
  }
  .openSearchButton {
    border: 1px solid var(--home-accent);
    background: var(--home-accent);
    color: #fff;
    padding: 7px 12px;
    font-size: 12px;
    cursor: pointer;
    border-radius: 0;
  }
  .openSearchButton:hover {
    background: var(--home-accent-hover);
    color: #fff;
  }
  @media (max-width: 1180px) {
    .remix220Content {
      grid-template-columns: 1fr;
    }
    .remix220RightRail {
      position: static;
    }
    .quickStartGrid,
    .primaryActionsGrid,
    .starterStrip {
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    }
    .sectionGrid,
    .onboardingGrid {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 640px) {
    .remix220Content {
      padding: 12px;
    }
    .heroPanel {
      padding: 28px 24px 24px;
    }
    .quickStartGrid,
    .primaryActionsGrid,
    .pluginGrid,
    .verificationActions,
    .starterStrip {
      grid-template-columns: 1fr;
    }
  }
}
`

const profile = {
  name: 'home',
  displayName: 'Home',
  methods: [],
  events: [],
  description: ' - ',
  icon: 'assets/img/tron-ide.svg',
  location: 'mainPanel',
  version: packageJson.version
}

export class LandingPage extends ViewPlugin {
  constructor (appManager, verticalIcons, fileManager, filePanel) {
    super(profile)
    this.profile = profile
    this.fileManager = fileManager
    this.filePanel = filePanel
    this.appManager = appManager
    this.verticalIcons = verticalIcons
    this.gistHandler = new GistHandler()
    this._landingActive = true
    this._fileEventSubscriptions = []
    this._workspacePluginEventSubscriptions = []
    this._themeHandlers = []
    this._workspaceStatusTimers = []
    this._onWindowResize = () => this.adjustMediaPanel()
    this._onWindowClick = (e) => this.hideMediaPanel(e)
    const themeQuality = globalRegistry.get('themeModule').api.currentTheme().quality
    window.addEventListener('resize', this._onWindowResize)
    window.addEventListener('click', this._onWindowClick)
    this.twitterFrame = yo`
      <div class="px-2 ${css.media}">
        <a class="twitter-timeline"
          data-width="350"
          data-theme="${themeQuality}"
          data-chrome="nofooter noheader transparent"
          data-tweet-limit="8"
          href="https://twitter.com/EthereumRemix"
        >
        </a>
        <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>
      </div>
    `
    this.badgeTwitter = yo`<button
      class="btn-info p-2 m-1 border rounded-circle ${css.mediaBadge} fab fa-twitter"
      id="remixIDEHomeTwitterbtn"
      onclick=${(e) => this.showMediaPanel(e)}
    ></button>`
    this.badgeMedium = yo`<button
      class="btn-danger p-2 m-1 border rounded-circle ${css.mediaBadge} fab fa-medium"
      id="remixIDEHomeMediumbtn"
      onclick=${(e) => this.showMediaPanel(e)}
    ></button>`
    this.twitterPanel = yo`
      <div id="remixIDE_TwitterBlock" class="p-2 mx-0 mb-0 d-none ${css.remixHomeMedia}">
        ${this.twitterFrame}
      </div>
    `
    this.mediumPanel = yo`
      <div id="remixIDE_MediumBlock" class="p-2 mx-0 mb-0 d-none ${css.remixHomeMedia}">
        <div id="medium-widget" class="p-3 ${css.media}">
          <div
            id="retainable-rss-embed"
            data-rss="https://medium.com/feed/remix-ide"
            data-maxcols="1"
            data-layout="grid"
            data-poststyle="external"
            data-readmore="More..."
            data-buttonclass="btn mb-3"
            data-offset="-100"
          >
-        </div>
        </div>
      </div>
    `
    this.adjustMediaPanel()
    this._themeEvents = globalRegistry.get('themeModule').api.events
    const onMediaThemeChanged = (theme) => {
      this.onThemeChanged(theme.quality)
    }
    this._themeHandlers.push(onMediaThemeChanged)
    this._themeEvents.on('themeChanged', onMediaThemeChanged)

    this.fromHttp = window.location.protocol === 'http:' && ['tronide.io', 'www.tronide.io'].includes(window.location.hostname)
    if (this.fromHttp) {
      this.autoMigrate()
      this.httpAlert()
    }
  }

  alertDownloadFiles = async () => {
    try {
      tooltip('preparing files for download, please wait..')
      const fileProviders = globalRegistry.get('fileproviders').api
      const zip = new JSZip()
      await fileProviders.browser.copyFolderToJson('/', ({ path, content }) => {
        if (typeof content === 'string' && content.startsWith('data:') && content.includes(';base64,')) {
          // binary files are stored as base64 data URLs; write the real bytes
          zip.file(`tronideBackup${path}`, content.slice(content.indexOf(';base64,') + 8), { base64: true })
        } else {
          zip.file(`tronideBackup${path}`, content)
        }
      })
      zip.generateAsync({ type: 'blob' }).then(function (blob) {
        saveAs(blob, 'tronideBackup.zip')
      }).catch((e) => {
        tooltip(e.message)
      })
    } catch (e) {
      tooltip(e.message)
    }
  }

  autoMigrate () {
    this.appManager.event.on('activate', async ({ name }) => {
      if (name === 'fileManager') {
        try {
          const migrateFlag = window.localStorage.getItem(
            'tron_migrate_success'
          )

          if (migrateFlag) return

          const workspaceName = await migrateToWorkspace(
            this.fileManager,
            this.filePanel
          )
          tooltip('done. ' + workspaceName + ' created.')
          window.localStorage.setItem('tron_migrate_success', true)
        } catch (e) {
          if (e.message === 'No file to migrate') {
            window.localStorage.setItem('tron_migrate_success', true)
          } else {
            setTimeout(() => {
              tooltip(e.message)
            }, 1000)
          }
        }
      }
    })
  }

  httpAlert () {
    modalDialogCustom.alert('High Alert', yo`<div class="mx-4 align-self-end mb-2 d-flex flex-column ${css.textDangerAlert}">
      <span class="pl-4 text-danger mt-1">The HTTP link is deprecated, please use the <a class="${css.textDanger}" target="_blank" rel="noopener noreferrer" href="https://www.tronide.io">HTTPS link</a>.</span>
      <span class="pl-4 text-danger mt-1">If you have code stored on the HTTP site, please:</span>
      <span class="pl-4 text-danger mt-1">1. <u class="${css.text} text-danger" onclick=${() => this.alertDownloadFiles()}>Download all files</u> as a backup zip;</span>
      <span class="pl-4 text-danger mt-1">2. Open <a class="${css.textDanger}" target="_blank" rel="noopener noreferrer" href="https://www.tronide.io">HTTPS site</a>;</span>
      <span class="pl-4 text-danger mt-1">3. Restore them on <a class="${css.textDanger}" target="_blank" rel="noopener noreferrer" href="https://www.tronide.io">HTTPS site</a>.</span>
    </div>`)
  }

  adjustMediaPanel () {
    this.twitterPanel.style.maxHeight = Math.max(window.innerHeight - 150, 200) + 'px'
    this.mediumPanel.style.maxHeight = Math.max(window.innerHeight - 150, 200) + 'px'
  }

  hideMediaPanel (e) {
    const mediaPanelsTitle = document.getElementById('remixIDEMediaPanelsTitle')
    const mediaPanels = document.getElementById('remixIDEMediaPanels')
    if (!mediaPanelsTitle || !mediaPanels) return
    if (!mediaPanelsTitle.contains(e.target) && !mediaPanels.contains(e.target)) {
      this.mediumPanel.classList.remove('d-block')
      this.mediumPanel.classList.add('d-none')
      this.twitterPanel.classList.remove('d-block')
      this.twitterPanel.classList.add('d-none')
    }
  }

  onThemeChanged (themeQuality) {
    const twitterFrame = yo`
      <div class="px-2 ${css.media}">
        <a class="twitter-timeline"
          data-width="350"
          data-theme="${themeQuality}"
          data-chrome="nofooter noheader transparent"
          data-tweet-limit="8"
          href="https://twitter.com/EthereumRemix"
        >
        </a>
        <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>
      </div>
    `
    yo.update(this.twitterFrame, twitterFrame)

    const invertNum = (themeQuality === 'dark') ? 1 : 0
    if (this.solEnv.getElementsByTagName('img')[0]) this.solEnv.getElementsByTagName('img')[0].style.filter = `invert(${invertNum})`
    if (this.moreEnv.getElementsByTagName('img')[0]) this.moreEnv.getElementsByTagName('img')[0].style.filter = `invert(${invertNum})`
    // if (this.websiteIcon) this.websiteIcon.style.filter = `invert(${invertNum})`
  }

  showMediaPanel (e) {
    if (e.target.id === 'remixIDEHomeTwitterbtn') {
      this.mediumPanel.classList.remove('d-block')
      this.mediumPanel.classList.add('d-none')
      this.twitterPanel.classList.toggle('d-block')
      _paq.push(['trackEvent', 'pluginManager', 'media', 'twitter'])
    } else {
      this.twitterPanel.classList.remove('d-block')
      this.twitterPanel.classList.add('d-none')
      this.mediumPanel.classList.toggle('d-block')
      _paq.push(['trackEvent', 'pluginManager', 'media', 'medium'])
    }
  }

  render () {
    this._landingActive = true
    const fileManager = this.fileManager
    const load = (service, item, examples, info) => {
      const compilerImport = new CompilerImports()
      const fileProviders = globalRegistry.get('fileproviders').api
      const msg = yo`
        <div class="p-2">
          <span>Enter the ${item} you would like to load.</span>
          <div>${info}</div>
          <div>e.g ${examples.map((url) => { return yo`<div class="p-1"><a>${url}</a></div>` })}</div>
        </div>`

      const title = `Import from ${service}`
      modalDialogCustom.prompt(title, msg, null, (target) => {
        if (target !== '') {
          compilerImport.import(
            target,
            (loadingMsg) => { tooltip(loadingMsg) },
            (error, content, cleanUrl, type, url) => {
              if (error) {
                modalDialogCustom.alert(title, error.message || error)
              } else {
                try {
                  fileProviders.workspace.addExternal(type + '/' + cleanUrl, content, url)
                  this.verticalIcons.select('filePanel')
                } catch (e) {
                  modalDialogCustom.alert(title, e.message)
                }
              }
            }
          )
        }
      })
    }

    const startSolidity = async () => {
      try {
        await this.appManager.activatePlugin(['solidity', 'udapp', 'solidityStaticAnalysis', 'solidityUnitTesting'])
      } catch (error) {
        console.log(error)
      }
      this.verticalIcons.select('solidity')
      _paq.push(['trackEvent', 'pluginManager', 'userActivate', 'solidity'])
    }
    const startSolidityAnalyzer = async () => {
      await this.appManager.activatePlugin(['solidity', 'solidityStaticAnalysis'])
      this.verticalIcons.select('solidityStaticAnalysis')
      _paq.push(['trackEvent', 'pluginManager', 'userActivate', 'solidityStaticAnalysis'])
    }
    const startPluginManager = async () => {
      await this.appManager.activatePlugin('pluginManager')
      this.verticalIcons.select('pluginManager')
    }
    const startRestoreBackupZip = async () => {
      if (await this.appManager.isActive('restorebackupzip')) {
        await this.call('tabs', 'focus', 'restorebackupzip')
      } else {
        await this.appManager.activatePlugin(['restorebackupzip'])
      }
      _paq.push(['trackEvent', 'pluginManager', 'userActivate', 'restorebackupzip'])
    }

    const createNewFile = async () => {
      try {
        await this.appManager.activatePlugin('filePanel')
      } catch (error) {
        console.log(error)
      }
      this.verticalIcons.select('filePanel')
      setTimeout(() => this.call('filePanel', 'createNewFile'), 0)
    }

    const createTemplateFile = async (template) => {
      try {
        await this.appManager.activatePlugin('filePanel')
        this.verticalIcons.select('filePanel')
        const fileManager = globalRegistry.get('filemanager').api
        await fileManager.writeFile(template.path, template.content)
        await fileManager.open(template.path)
        tooltip(`${template.name} created at ${template.path}`)
      } catch (error) {
        console.log(error)
        tooltip(error.message || error)
      }
    }

    const saveAs = (blob, name) => {
      const node = document.createElement('a')
      node.download = name
      node.rel = 'noopener'
      node.href = URL.createObjectURL(blob)
      setTimeout(function () { URL.revokeObjectURL(node.href) }, 4E4) // 40s
      setTimeout(function () {
        try {
          node.dispatchEvent(new MouseEvent('click'))
        } catch (e) {
          var evt = document.createEvent('MouseEvents')
          evt.initMouseEvent('click', true, true, window, 0, 0, 0, 80,
            20, false, false, false, false, 0, null)
          node.dispatchEvent(evt)
        }
      }, 0) // 40s
    }

    const downloadFiles = async () => {
      try {
        tooltip('preparing files for download, please wait..')
        const fileProviders = globalRegistry.get('fileproviders').api
        const zip = new JSZip()
        await fileProviders.browser.copyFolderToJson('/', ({ path, content }) => {
          if (typeof content === 'string' && content.startsWith('data:') && content.includes(';base64,')) {
            // binary files are stored as base64 data URLs; write the real bytes
            zip.file(`tronideBackup${path}`, content.slice(content.indexOf(';base64,') + 8), { base64: true })
          } else {
            zip.file(`tronideBackup${path}`, content)
          }
        })
        const blob = await zip.generateAsync({ type: 'blob' })
        saveAs(blob, 'tronideBackup.zip')
        return true
      } catch (e) {
        tooltip(e.message)
        return false
      }
    }

    const uploadFile = (target) => {
      this.call('filePanel', 'uploadFile', target)
    }

    const importFromGist = () => {
      this.gistHandler.loadFromGist({ gist: '' }, globalRegistry.get('filemanager').api)
      this.verticalIcons.select('filePanel')
    }

    const startInjectedTronWeb = async () => {
      try {
        await this.appManager.activatePlugin(['udapp'])
        this.verticalIcons.select('udapp')
        const result = await this.call('udapp', 'connectInjectedTronWeb')
        if (result && result.connected === false) tooltip(result.error || 'Cannot connect TronLink')
      } catch (error) {
        console.log(error)
        tooltip(error.message || error)
      }
    }

    const connectWalletFromHome = async () => {
      const headerWalletButton = document.querySelector('[data-id="headerWalletConnect"]')
      if (headerWalletButton && typeof headerWalletButton.click === 'function') {
        headerWalletButton.click()
        return
      }
      await startInjectedTronWeb()
    }

    const onLogoThemeChanged = (theme) => {
      globalRegistry.get('themeModule').api.fixInvert(document.getElementById('remixLogo'))
      globalRegistry.get('themeModule').api.fixInvert(document.getElementById('solidityLogo'))
      globalRegistry.get('themeModule').api.fixInvert(document.getElementById('debuggerLogo'))
      globalRegistry.get('themeModule').api.fixInvert(document.getElementById('workshopLogo'))
      globalRegistry.get('themeModule').api.fixInvert(document.getElementById('moreLogo'))
      globalRegistry.get('themeModule').api.fixInvert(document.getElementById('solhintLogo'))
    }
    this._themeHandlers.push(onLogoThemeChanged)
    this._themeEvents.on('themeChanged', onLogoThemeChanged)

    const createLargeButton = (imgPath, envID, envText, callback) => {
      return yo`
        <button
          class="btn border-secondary d-flex mr-3 text-nowrap justify-content-center flex-column align-items-center ${css.envButton}"
          data-id="landingPageStartSolidity"
          onclick=${() => callback()}
        >
          <img class="m-2 align-self-center ${css.envLogo}" id=${envID} src="${imgPath}">
          <label class="text-uppercase text-dark ${css.cursorStyle}">${envText}</label>
        </button>
      `
    }

    // main
    this.solEnv = createLargeButton('assets/img/solidityLogo.webp', 'solidityLogo', 'Solidity', startSolidity)
    // Featured
    this.moreEnv = createLargeButton('assets/img/moreLogo.webp', 'moreLogo', 'More', startPluginManager)
    this.websiteIcon = yo`<img id='remixHhomeWebsite' class="mr-1 ${css.image}" src="${'assets/img/tronLogo.svg' || profile.icon}"></img>`

    const themeQuality = globalRegistry.get('themeModule').api.currentTheme().quality
    const invertNum = (themeQuality === 'dark') ? 1 : 0
    this.solEnv.getElementsByTagName('img')[0].style.filter = `invert(${invertNum})`
    this.moreEnv.getElementsByTagName('img')[0].style.filter = `invert(${invertNum})`
    // this.websiteIcon.style.filter = `invert(${invertNum})`

    const migrate = async () => {
      try {
        setTimeout(() => {
          tooltip('migrating workspace...')
        }, 500)
        const workspaceName = await migrateToWorkspace(this.fileManager, this.filePanel)
        tooltip('done. ' + workspaceName + ' created.')
      } catch (e) {
        setTimeout(() => {
          tooltip(e.message)
        }, 1000)
      }
    }
    const onAcceptDownloadn = async () => {
      await downloadFiles()
      const el = document.getElementById('modal-dialog')
      el.parentElement.removeChild(el)
      migrate()
    }

    const onDownload = () => {
      const el = document.getElementById('modal-dialog')
      el.parentElement.removeChild(el)
      migrate()
    }

    const onCancel = () => {
      const el = document.getElementById('modal-dialog')
      el.parentElement.removeChild(el)
    }

    const migrateWorkspace = async () => {
      modalDialog(
        'File system Migration',
        yo`
          <span>Do you want to download your files to local device first?</span>
          <div class="d-flex justify-content-around pt-3 mt-3 border-top">
            <button class="btn btn-sm btn-primary" onclick=${async () => onAcceptDownloadn()}>Download and Migrate</button>
            <button class="btn btn-sm btn-secondary ${css.migrationBtn}" onclick=${() => onDownload()}>Migrate</button>
            <button class="btn btn-sm btn-secondary ${css.migrationBtn}" onclick=${() => onCancel()}>Cancel</button>
          </div>
        `,
        {
          label: '',
          fn: null
        },
        {
          label: '',
          fn: null
        }
      )
    }

    const img = '' // yo`<img class="m-4 ${css.logoImg}" src="assets/img/guitarRemiCroped.webp" onclick="${() => playRemi()}"></img>`
    const playRemi = async () => { await document.getElementById('remiAudio').play() }
    // to retrieve medium posts
    // document.body.appendChild(yo`<script src="https://www.twilik.com/assets/retainable/rss-embed/retainable-rss-embed.js"></script>`)
    const fileProviders = globalRegistry.get('fileproviders').api
    const workspaceProvider = fileProviders.workspace
    const getCurrentWorkspaceName = () => {
      const workspace = workspaceProvider.getWorkspace ? workspaceProvider.getWorkspace() : ''
      return workspace || ''
    }
    const workspaceStatus = {
      workspace: getCurrentWorkspaceName(),
      files: null,
      contracts: null,
      tests: null,
      readme: false,
      compiled: false,
      network: 'JavaScript VM ready'
    }
    const readJsonStorage = (key, fallback) => {
      try {
        const value = window.localStorage.getItem(key)
        if (Array.isArray(fallback)) return value ? JSON.parse(value) : fallback.slice()
        return value ? Object.assign({}, fallback, JSON.parse(value)) : Object.assign({}, fallback)
      } catch (error) {
        return Array.isArray(fallback) ? fallback.slice() : Object.assign({}, fallback)
      }
    }
    const notificationState = {
      open: false,
      items: readJsonStorage('tronide.home.notifications', []).slice(0, 8)
    }
    // GitHub tokens are kept in sessionStorage only (per-tab) and cleared with the tab.
    // Any previously-persisted localStorage copies are scrubbed at startup.
    try { window.localStorage.removeItem('tronide.github.token') } catch (error) { console.debug('[home] failed to clear legacy github token', error) }
    try { window.localStorage.removeItem('tronide.github.user') } catch (error) { console.debug('[home] failed to clear legacy github user', error) }
    const githubTokenState = {
      token: window.sessionStorage.getItem('tronide.github.token') || '',
      user: null
    }
    const advancedToolsState = {
      open: window.localStorage.getItem('tronide.home.advancedToolsOpen') === 'true'
    }
    const pluginCards = [
      ['landingPluginContractVerification', 'landingPluginToggleContractVerification', 'contractVerification', 'TRON Contract Verification', 'TronIDE', 'Prepare a TronScan-first verification package and check public source status for TRON contracts.', 'Open Verification', () => openContractVerification()],
      ['landingPluginSolidityAnalyzers', 'landingPluginToggleAnalyzers', 'solidityStaticAnalysis', 'TVM Solidity Analyzers', 'TronIDE', 'Analyze Solidity with Remix, Solhint, Slither-compatible checks, and TRON transaction guardrails.', 'Open Analyzer', () => startSolidityAnalyzer()],
      ['landingPluginCookbook', 'landingPluginToggleCookbook', 'pluginManager', 'TRON Cookbook', 'TronIDE', 'Find TRON templates, Solidity libraries, and protocol examples from curated resources.', 'Search TRON templates', () => startPluginManager()]
    ]
    const saveNotifications = () => {
      try { window.localStorage.setItem('tronide.home.notifications', JSON.stringify(notificationState.items.slice(0, 8))) } catch (error) { console.debug('[home] failed to persist notifications', error) }
      try { window.dispatchEvent(new CustomEvent('tronideHomeNotificationsChanged')) } catch (error) { console.debug('[home] failed to dispatch notifications-changed event', error) }
    }
    const addNotification = (title, message, type = 'info') => {
      notificationState.items.unshift({ title, message, type, time: new Date().toLocaleTimeString() })
      notificationState.items = notificationState.items.slice(0, 8)
      saveNotifications()
    }
    const assertSafeGithubRepoPath = (path) => {
      const raw = String(path || '')
      if (!raw || raw.startsWith('/')) throw new Error('Invalid GitHub file path')
      const segments = raw.split('/')
      for (const segment of segments) {
        if (!segment || segment === '.' || segment === '..') throw new Error('Invalid GitHub file path')
      }
      return segments.join('/')
    }
    const parseGithubUrl = (url) => {
      const match = String(url || '').match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|tree)\/([^/]+)\/(.+)$/)
      if (!match) throw new Error('Use a GitHub file URL like https://github.com/owner/repo/blob/branch/path.sol')
      const safePath = assertSafeGithubRepoPath(match[4])
      return { owner: match[1], repo: match[2].replace(/\.git$/, ''), branch: match[3], path: safePath }
    }
    const encodeGithubPath = (path) => String(path).split('/').map(encodeURIComponent).join('/')
    const sanitizeGithubError = (response, payload) => {
      const status = response && typeof response.status === 'number' ? response.status : 0
      const detail = payload && typeof payload.message === 'string' ? payload.message.replace(/(token|Bearer\s+\S+|gh[ops]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+)/gi, '[redacted]') : ''
      return detail ? `GitHub ${status}: ${detail}` : `GitHub request failed (${status || 'network error'})`
    }
    const githubRequest = async (path, options = {}) => {
      if (!githubTokenState.token) throw new Error('Connect a GitHub token first.')
      const response = await window.fetch(`https://api.github.com${path}`, Object.assign({
        headers: Object.assign({
          Authorization: `Bearer ${githubTokenState.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }, options.headers || {})
      }, options))
      const text = await response.text()
      let payload = {}
      try {
        payload = text ? JSON.parse(text) : {}
      } catch (error) {
        console.debug('[home] github response was not JSON', error)
      }
      if (!response.ok) {
        const err = new Error(sanitizeGithubError(response, payload))
        err.status = response.status
        throw err
      }
      return payload
    }
    const saveGithubToken = (token) => {
      githubTokenState.token = String(token || '').trim()
      window.sessionStorage.setItem('tronide.github.token', githubTokenState.token)
      // Defensive: scrub any historical localStorage copy so this session is the only place the token lives.
      try { window.localStorage.removeItem('tronide.github.token') } catch (error) { console.debug('[home] failed to clear legacy github token', error) }
    }
    const clearGithubToken = () => {
      githubTokenState.token = ''
      githubTokenState.user = null
      window.sessionStorage.removeItem('tronide.github.token')
      // Keep removing legacy localStorage entries from older versions so an old persisted token
      // does not survive a disconnect on upgraded browsers.
      try { window.localStorage.removeItem('tronide.github.token') } catch (error) { console.debug('[home] failed to clear legacy github token', error) }
      try { window.localStorage.removeItem('tronide.github.user') } catch (error) { console.debug('[home] failed to clear legacy github user', error) }
      addNotification('GitHub disconnected', 'GitHub token was cleared from this browser tab.')
      refreshHomeSection('landingGithubTokenPanel', renderGithubTokenPanel)
    }
    const connectGithubToken = () => {
      const message = yo`
        <div>
          <div>Paste a fine-grained GitHub token. OAuth write flows remain out of scope for this MVP.</div>
          <div class=${css.securityNote}>Tokens stay in this browser tab only and are cleared when you close it. Recommended scopes: Contents read for import; Contents read/write only when committing. Limit the token to selected repositories.</div>
        </div>
      `
      modalDialogCustom.promptPassphrase('Connect GitHub Token', message, '', async (token) => {
        try {
          if (!token) return
          saveGithubToken(token)
          githubTokenState.user = await githubRequest('/user')
          addNotification('GitHub connected', (githubTokenState.user && githubTokenState.user.login) || 'Token validated.')
          refreshHomeSection('landingGithubTokenPanel', renderGithubTokenPanel)
        } catch (error) {
          clearGithubToken()
          tooltip(error.message || 'GitHub token rejected.')
        }
      }, null, true)
    }
    const importGithubFileWithToken = () => {
      modalDialogCustom.prompt('Import private GitHub file', 'Paste a GitHub file URL from an authorized repository.', '', async (url) => {
        try {
          const target = parseGithubUrl(url)
          const file = await githubRequest(`/repos/${target.owner}/${target.repo}/contents/${encodeGithubPath(target.path)}?ref=${encodeURIComponent(target.branch)}`)
          if (file.type !== 'file' || !file.content) throw new Error('Only single file imports are supported in this MVP.')
          const content = window.atob(file.content.replace(/\n/g, ''))
          const safeOwner = assertSafeGithubRepoPath(target.owner)
          const safeRepo = assertSafeGithubRepoPath(target.repo)
          const localPath = `github/${safeOwner}/${safeRepo}/${target.path}`
          if (!localPath.startsWith(`github/${safeOwner}/${safeRepo}/`)) throw new Error('Refusing to write outside the github/<owner>/<repo>/ folder.')
          await fileManager.writeFile(localPath, content)
          await fileManager.open(localPath)
          addNotification('GitHub file imported', localPath)
        } catch (error) {
          tooltip(error.message || error)
        }
      })
    }
    const copyGithubTokenChecklist = () => {
      const checklist = [
        'TronIDE GitHub Token checklist',
        '- Use a fine-grained personal access token.',
        '- Scope read access for import; add contents read/write only for commits.',
        '- Limit the token to selected repositories.',
        '- Prefer session storage on shared devices.',
        '- Revoke the token from GitHub settings if the browser is untrusted.'
      ].join('\n')
      try {
        window.navigator.clipboard.writeText(checklist)
        addNotification('GitHub checklist copied', 'Token permission checklist copied to clipboard.', 'github')
      } catch (error) {
        tooltip(checklist)
      }
    }
    const commitCurrentFileToGithub = () => {
      const currentFile = fileManager.currentFile && fileManager.currentFile()
      if (!currentFile) return tooltip('Open a workspace file before committing to GitHub.')
      modalDialogCustom.prompt('Commit current file to GitHub', 'Paste destination file URL: https://github.com/owner/repo/blob/branch/path.sol', '', async (url) => {
        try {
          const target = parseGithubUrl(url)
          const content = await fileManager.readFile(currentFile)
          let sha = null
          try {
            const existing = await githubRequest(`/repos/${target.owner}/${target.repo}/contents/${encodeGithubPath(target.path)}?ref=${encodeURIComponent(target.branch)}`)
            sha = existing.sha
          } catch (error) {
            // 404 = new file, proceed with sha=null. Anything else (401/403/etc.) must surface so the
            // user is not left with a misleading "commit failed at PUT" message when the real cause is auth.
            if (error && error.status && error.status !== 404) {
              console.debug('[home] existing file lookup failed', error)
              throw error
            }
            console.debug('[home] existing file lookup returned no match', error)
          }
          await githubRequest(`/repos/${target.owner}/${target.repo}/contents/${encodeGithubPath(target.path)}`, {
            method: 'PUT',
            body: JSON.stringify({
              message: `Update ${target.path} from TronIDE`,
              content: window.btoa(unescape(encodeURIComponent(content))),
              branch: target.branch,
              sha
            })
          })
          addNotification('GitHub commit created', `${target.owner}/${target.repo}:${target.path}`)
        } catch (error) {
          tooltip(error.message || error)
        }
      })
    }
    const readWorkspaceDirectory = (directory) => new Promise((resolve, reject) => {
      if (!getCurrentWorkspaceName()) return resolve({})
      workspaceProvider.resolveDirectory(directory, (error, entries) => {
        if (error) return reject(error)
        resolve(entries || {})
      })
    })
    const countWorkspaceFiles = async (directory = '/') => {
      const entries = await readWorkspaceDirectory(directory)
      const paths = Object.keys(entries || {})
      let files = 0
      let contracts = 0
      let tests = 0
      let readme = false
      for (const entryPath of paths) {
        const entry = entries[entryPath]
        if (entry.isDirectory) {
          const child = await countWorkspaceFiles(entryPath)
          files += child.files
          contracts += child.contracts
          tests += child.tests
          readme = readme || child.readme
        } else {
          files += 1
          if (/\.sol$/i.test(entryPath)) contracts += 1
          if (/(^|\/)tests?\//i.test(entryPath) || /\.(test|spec)\.(js|ts)$/i.test(entryPath)) tests += 1
          if (/(^|\/)readme\.(md|txt)$/i.test(entryPath)) readme = true
        }
      }
      return { files, contracts, tests, readme }
    }
    const renderWorkspaceStatus = () => {
      const workspace = workspaceStatus.workspace || 'workspace loading'
      const files = Number.isInteger(workspaceStatus.files) ? `${workspaceStatus.files} files` : 'files loading'
      const contracts = Number.isInteger(workspaceStatus.contracts) ? `${workspaceStatus.contracts} contracts` : 'contracts loading'
      return yo`
        <div class=${css.heroMeta} data-id="landingWorkspaceStatus">
          <span class=${css.heroMetaItem}><span class=${css.heroMetaDot}></span> Connected · ${workspace}</span>
          <span class=${css.heroMetaItem}>·</span>
          <span class=${css.heroMetaItem}>${files} · ${contracts}</span>
          <span class=${css.heroMetaItem}>·</span>
          <span class=${css.heroMetaItem}>${workspaceStatus.network}</span>
        </div>
      `
    }
    const refreshWorkspaceStatus = async () => {
      if (!this._landingActive) return
      try {
        workspaceStatus.workspace = getCurrentWorkspaceName()
        if (!workspaceStatus.workspace) {
          workspaceStatus.files = null
          workspaceStatus.contracts = null
          workspaceStatus.tests = null
          workspaceStatus.readme = false
          const statusEl = container.querySelector('[data-id="landingWorkspaceStatus"]')
          if (statusEl) yo.update(statusEl, renderWorkspaceStatus())
          refreshHomeSection('landingWorkspaceHealthPanel', renderWorkspaceHealthPanel)
          return
        }
        const counts = await countWorkspaceFiles('/')
        if (!this._landingActive) return
        workspaceStatus.files = counts.files
        workspaceStatus.contracts = counts.contracts
        workspaceStatus.tests = counts.tests
        workspaceStatus.readme = counts.readme
        workspaceStatus.compiled = Boolean(globalRegistry.get('compilersartefacts') && globalRegistry.get('compilersartefacts').api && globalRegistry.get('compilersartefacts').api.get && globalRegistry.get('compilersartefacts').api.get('__last'))
        const statusEl = container.querySelector('[data-id="landingWorkspaceStatus"]')
        if (statusEl) yo.update(statusEl, renderWorkspaceStatus())
        refreshHomeSection('landingWorkspaceHealthPanel', renderWorkspaceHealthPanel)
      } catch (error) {
        console.log('Unable to load landing workspace status', error)
      }
    }
    const scheduleWorkspaceStatusRefresh = () => {
      if (!this._landingActive) return
      if (this._workspaceStatusTimer) window.clearTimeout(this._workspaceStatusTimer)
      this._workspaceStatusTimer = window.setTimeout(() => {
        this._workspaceStatusTimer = null
        refreshWorkspaceStatus()
      }, 120)
    }

    const openGlobalSearch = () => {
      const mainview = globalRegistry.get('mainview') && globalRegistry.get('mainview').api
      if (mainview && typeof mainview.openGlobalSearch === 'function') {
        mainview.openGlobalSearch('home')
      } else {
        this.verticalIcons.select('globalSearch')
      }
      addNotification('Global search opened', 'Search across workspace files is active.')
    }

    const createWorkspaceFromHome = async () => {
      try {
        await this.appManager.activatePlugin('filePanel')
        const workspaceName = `tron_workspace_${Date.now()}`
        await this.call('filePanel', 'createWorkspace', workspaceName)
        this.verticalIcons.select('filePanel')
        tooltip(`Workspace created: ${workspaceName}`)
        addNotification('Workspace created', workspaceName)
      } catch (error) {
        console.log(error)
        tooltip(error.message || error)
      }
    }

    const openAiAssistant = async () => {
      try {
        await this.appManager.activatePlugin(['aiPanel'])
        const aiPanelEl = document.getElementById('ai-panel')
        const isHidden = aiPanelEl && aiPanelEl.style.display === 'none'
        if (isHidden && this.call) await this.call('aiPanel', 'hide')
      } catch (error) {
        console.log(error)
        tooltip(error.message || error)
      }
    }

    const refreshHomeSection = (dataId, renderFn) => {
      const el = container && container.querySelector(`[data-id="${dataId}"]`)
      if (el) yo.update(el, renderFn())
    }

    const openAdvancedTools = () => {
      if (advancedToolsState.open) return
      advancedToolsState.open = true
      window.localStorage.setItem('tronide.home.advancedToolsOpen', 'true')
      refreshHomeSection('landingAdvancedToolsPanel', renderAdvancedToolsPanel)
    }

    const toggleAdvancedTools = () => {
      advancedToolsState.open = !advancedToolsState.open
      window.localStorage.setItem('tronide.home.advancedToolsOpen', String(advancedToolsState.open))
      refreshHomeSection('landingAdvancedToolsPanel', renderAdvancedToolsPanel)
    }

    const toggleLayoutControl = (kind) => {
      let button = null
      if (kind === 'side') button = document.querySelector("[data-id='headerToggleSidePanel']")
      if (kind === 'bottom') button = document.querySelector("[data-id='headerToggleBottomPanel']")
      if (kind === 'ai') button = document.querySelector("[data-id='headerToggleAiPanel']")
      if (button) {
        button.click()
        addNotification('Layout toggled', `${kind} panel layout was toggled from Home.`)
      }
    }

    const isElementCollapsed = (element) => {
      return element && (element.style.display === 'none' || element.style.height === '0px' || element.offsetWidth === 0 || element.offsetHeight === 0)
    }

    const resetLayoutControls = () => {
      const side = document.getElementById('side-panel')
      const terminalContainer = document.querySelector("[data-id='terminalContainer']")
      const terminalPanel = terminalContainer && terminalContainer.parentElement
      const ai = document.getElementById('ai-panel')
      if (isElementCollapsed(side)) toggleLayoutControl('side')
      if (isElementCollapsed(terminalPanel)) toggleLayoutControl('bottom')
      if (isElementCollapsed(ai)) toggleLayoutControl('ai')
      tooltip('Layout restored to default workspace view.')
      addNotification('Layout reset', 'Side, Bottom, and AI panels were restored to their default views.', 'info')
    }

    const exportWorkspaceForGit = async () => {
      const exported = await downloadFiles()
      if (exported) {
        addNotification('Git export triggered', 'Workspace backup ZIP downloaded for Git repository integration.', 'info')
      }
    }

    const checkTronLinkReadiness = async () => {
      const injected = {
        tronLink: window.tronLink || null,
        tronWeb: window.tronWeb || null
      }
      if (!injected.tronLink || !injected.tronWeb) {
        addNotification('TronLink check', 'TronLink is not installed or not injected in this browser.', 'wallet')
        return tooltip('TronLink is not installed or not injected in this browser.')
      }
      const account = injected.tronWeb.defaultAddress && injected.tronWeb.defaultAddress.base58
      const host = injected.tronWeb.fullNode && injected.tronWeb.fullNode.host
      const network = /nile/i.test(host || '') ? 'Nile' : (/shasta/i.test(host || '') ? 'Shasta' : (/trongrid|api\.tronstack|api\.trongrid/i.test(host || '') ? 'Mainnet' : 'Custom node'))
      const message = account ? `${account} · ${network}` : `TronLink detected · ${network}; unlock and authorize to expose an account.`
      addNotification('TronLink readiness', message, 'wallet')
    }

    const isPluginActive = (pluginName) => pluginName ? this.appManager.actives.includes(pluginName) : false

    const togglePluginCard = async (pluginName, title) => {
      if (!pluginName) return
      try {
        if (isPluginActive(pluginName)) {
          await this.appManager.deactivatePlugin(pluginName)
          addNotification('Plugin deactivated', title)
        } else {
          await this.appManager.activatePlugin(pluginName)
          addNotification('Plugin activated', title)
        }
        refreshHomeSection('landingMostUsedPlugins', renderMostUsedPlugins)
      } catch (error) {
        console.log(error)
        tooltip(error.message || error)
      }
    }

    const openContractVerification = async () => {
      try {
        openAdvancedTools()
        await this.appManager.activatePlugin('contractVerification')
        this.verticalIcons.select('contractVerification')
        addNotification('Contract Verification opened', 'Use the side-panel plugin to prepare TronScan verification.')
      } catch (error) {
        console.log(error)
        tooltip(error.message || error)
      }
    }

    const renderOnboarding = () => yo`
      <section class=${css.onboardingGrid} data-id="landingRemix220Onboarding">
        <div class=${css.panel}>
          <div class=${css.panelHead}>
            <h3 class=${css.panelHeadTitle}><span class=${css.panelHeadIcon}>${projectLogo}</span> Learn. Explore. Create.</h3>
            <span class=${css.panelMore}>First Time? Start Here!</span>
          </div>
          <div class=${css.resourceList}>
            <a class=${css.resourceRow} data-id="landingDocumentationButton" target="_blank" rel="noopener noreferrer" href="https://developers.tron.network/">
              <span class=${css.resourceIcon}>📘</span><span class=${css.resourceLabel}>Documentation</span><span class=${css.resourceArrow}>→</span>
            </a>
            <a class=${css.resourceRow} data-id="landingWebsiteButton" target="_blank" rel="noopener noreferrer" href="https://tronide.io/">
              <span class=${css.resourceIcon}>🌐</span><span class=${css.resourceLabel}>Website</span><span class=${css.resourceArrow}>→</span>
            </a>
            <a class=${css.resourceRow} data-id="landingDesktopDownloadButton" target="_blank" rel="noopener noreferrer" href="https://github.com/tronweb3/TronIDE">
              <span class=${css.resourceIcon}>⬇</span><span class=${css.resourceLabel}>Download TronIDE Desktop / source builds</span><span class=${css.resourceArrow}>→</span>
            </a>
          </div>
          <div class=${css.starterStrip}>
            <button class=${css.quickStartCard} data-id="landingCreateWorkspaceButton" onclick=${() => createWorkspaceFromHome()}>
              <div class=${css.quickStartIcon}>${plusIcon}</div>
              <div class=${css.quickStartCardTitle}>Prepare Workspace</div>
              <div class=${css.quickStartCardDesc}>Create a clean workspace before compiling, testing, and deploying TRON contracts.</div>
            </button>
            <button class=${css.quickStartCard} data-id="landingDappStarterCard" onclick=${() => tronTemplates[0] ? createTemplateFile(tronTemplates[0]) : createNewFile()}>
              <div class=${css.quickStartIcon}>⌁</div>
              <div class=${css.quickStartCardTitle}>Start building a TRON DApp</div>
              <div class=${css.quickStartCardDesc}>Start from TVM-safe TRON templates for deployment, transactions, and TronScan verification.</div>
            </button>
          </div>
        </div>
        <div class=${css.workspaceTile} data-id="landingFirstTimeStartHere">
          <div class=${css.workspaceTileTitle}><span class=${css.panelHeadIcon}>?</span> First Time? Start Here!</div>
          <div class=${css.fileDesc}>Start with TRON docs, a clean workspace, and TVM-safe templates.</div>
          <button class=${css.loadChip} aria-label="Create workspace" onclick=${() => createWorkspaceFromHome()}>Prepare workspace</button>
          <button class=${css.loadChip} aria-label="Open TRON DApp template" onclick=${() => tronTemplates[0] ? createTemplateFile(tronTemplates[0]) : createNewFile()}>Open TRON DApp template</button>
        </div>
      </section>
    `

    const pluginCardIcons = {
      contractVerification: 'fas fa-shield-alt',
      solidityStaticAnalysis: 'fas fa-microscope',
      pluginManager: 'fas fa-book'
    }
    const renderPluginCard = (dataId, toggleId, pluginName, title, maintainer, description, actionLabel, action) => {
      const active = pluginName ? isPluginActive(pluginName) : true
      const iconClass = pluginCardIcons[pluginName] || 'fas fa-cube'
      return yo`
      <button class=${css.pluginCard} data-id=${dataId} onclick=${action}>
        ${active ? yo`<span class=${css.pluginTag} data-id=${toggleId}>ON</span>` : null}
        <div class=${css.pluginIcon}><i class=${iconClass}></i></div>
        <div class=${css.pluginName}>${title}</div>
        <div class=${css.fileDesc}>Maintained by ${maintainer}</div>
        <div class=${css.quickStartCardDesc}>${description}</div>
        <div class=${css.loadChips}>
          <span class=${css.loadChip}>${actionLabel}</span>
          ${pluginName ? yo`<span class=${css.loadChip} onclick=${(event) => { event.stopPropagation(); togglePluginCard(pluginName, title) }}>${active ? 'Deactivate' : 'Activate'}</span>` : ''}
        </div>
      </button>
      `
    }

    const renderMostUsedPlugins = () => yo`
      <section class=${css.panel} data-id="landingMostUsedPlugins">
        <div class=${css.panelHead}>
          <h3 class=${css.panelHeadTitle}><span class=${css.panelHeadIcon}>🔥</span> Most used plugins</h3>
          <span class=${css.panelMore} data-id="landingExploreAllPluginsButton" role="button" tabindex="0" aria-label="Open all plugins" onclick=${() => startPluginManager()}>Explore all plugins →</span>
        </div>
        <div class=${css.pluginGrid}>
          ${pluginCards.map((card) => renderPluginCard(...card))}
        </div>
      </section>
    `

    const renderCookbookPanel = () => {
      const recipes = [
        ['TronLink readiness', 'Check injection, account, and Nile/Shasta/Mainnet host before deployment.', checkTronLinkReadiness, 'landingRecipeTronLink'],
        ['Nile deploy checklist', 'Compile, switch TronLink to Nile, set feeLimit, deploy, then verify on TronScan.', startInjectedTronWeb, 'landingRecipeNileDeploy'],
        ['Verification package', 'Compile first, open Contract Verification, generate package, then submit on TronScan.', openContractVerification, 'landingRecipeVerification'],
        ['GitHub token safety', 'Copy the recommended token permission checklist before using private read/write.', copyGithubTokenChecklist, 'landingRecipeGithubToken']
      ]
      return yo`
        <section class=${css.panel} data-id="landingCookbookPanel">
          <div class=${css.panelHead}>
            <h3 class=${css.panelHeadTitle}><span class=${css.panelHeadIcon}>▣</span> TRON cookbook</h3>
            <span class=${css.panelMore}>Static recipes</span>
          </div>
          <div class=${css.recipeGrid}>
            ${recipes.map((recipe) => yo`
              <button class=${css.recipeCard} data-id=${recipe[3]} onclick=${() => recipe[2]()}>
                <div class=${css.recipeTitle}>${recipe[0]}</div>
                <div>${recipe[1]}</div>
              </button>
            `)}
          </div>
        </section>
      `
    }

    const renderGithubTokenPanel = () => yo`
      <section class=${css.panel} data-id="landingGithubTokenPanel">
        <div class=${css.panelHead}>
          <h3 class=${css.panelHeadTitle}><span class=${css.panelHeadIcon}>${githubIcon}</span> GitHub Token</h3>
          <span class=${css.panelMore}>${githubTokenState.user && githubTokenState.user.login ? githubTokenState.user.login : 'Session token mode'}</span>
        </div>
        <div class=${css.securityNote}>Use a fine-grained PAT. Default storage is session-only; remember mode stores the token in this browser and should be used only on trusted devices.</div>
        <div class=${css.loadChips}>
          <button class=${css.loadChip} data-id="landingGithubTokenConnect" onclick=${() => connectGithubToken()}>${githubTokenState.token ? 'Reconnect token' : 'Connect token'}</button>
          <button class=${css.loadChip} data-id="landingGithubTokenImport" onclick=${() => importGithubFileWithToken()}>Import private file</button>
          <button class=${css.loadChip} data-id="landingGithubTokenCommit" onclick=${() => commitCurrentFileToGithub()}>Commit current file</button>
          <button class=${css.loadChip} data-id="landingGithubTokenChecklist" onclick=${() => copyGithubTokenChecklist()}>Copy token checklist</button>
          ${githubTokenState.token ? yo`<button class=${css.loadChip} data-id="landingGithubTokenDisconnect" onclick=${() => clearGithubToken()}>Disconnect</button>` : ''}
        </div>
      </section>
    `

    const renderLayoutControlsPanel = () => yo`
      <section class=${css.panel} data-id="landingLayoutControlsPanel">
        <div class=${css.panelHead}>
          <h3 class=${css.panelHeadTitle}><span class=${css.panelHeadIcon}>📐</span> Layout Controls</h3>
          <button class=${css.loadChip} data-id="landingLayoutReset" onclick=${() => resetLayoutControls()}>Reset</button>
        </div>
        <div class=${css.fileDesc}>Toggle workspace panels directly from the Home tab to optimize your coding space.</div>
        <div class=${css.loadChips}>
          <button class=${css.loadChip} data-id="landingLayoutToggleSidePanel" onclick=${() => toggleLayoutControl('side')}>Toggle Side Panel</button>
          <button class=${css.loadChip} data-id="landingLayoutToggleTerminal" onclick=${() => toggleLayoutControl('bottom')}>Toggle Terminal</button>
          <button class=${css.loadChip} data-id="landingLayoutToggleAiPanel" onclick=${() => toggleLayoutControl('ai')}>Toggle AI Panel</button>
        </div>
      </section>
    `

    const renderWorkspaceHealthPanel = () => yo`
      <section class=${css.panel} data-id="landingWorkspaceHealthPanel">
        <div class=${css.panelHead}>
          <h3 class=${css.panelHeadTitle}><span class=${css.panelHeadIcon}>💚</span> Workspace Health</h3>
          <span class=${css.panelMore}>Live status</span>
        </div>
        <div class=${css.fileDesc}>Real-time analysis of the active workspace and repository structure.</div>
        <div class=${css.resourceList}>
          <div class=${css.resourceRow}>
            <span class=${css.resourceIcon}>📄</span>
            <span class=${css.resourceLabel}>Total Workspace Files:</span>
            <span class=${css.resourceArrow} style="font-weight:700; color:var(--text);">${Number.isInteger(workspaceStatus.files) ? workspaceStatus.files : 0}</span>
          </div>
          <div class=${css.resourceRow}>
            <span class=${css.resourceIcon}>⚖</span>
            <span class=${css.resourceLabel} data-id="landingHealthContracts">TRON Solidity Contracts:</span>
            <span class=${css.resourceArrow} style="font-weight:700; color:${workspaceStatus.contracts > 0 ? '#28a745' : 'var(--text)'};">
              ${Number.isInteger(workspaceStatus.contracts) ? workspaceStatus.contracts : 0} ${workspaceStatus.contracts > 0 ? '✓' : '✗'}
            </span>
          </div>
          <div class=${css.resourceRow}>
            <span class=${css.resourceIcon}>📝</span>
            <span class=${css.resourceLabel} data-id="landingHealthReadme">README Documentation:</span>
            <span class=${css.resourceArrow} style="font-weight:700; color:${workspaceStatus.readme ? '#28a745' : 'var(--text)'};">
              ${workspaceStatus.readme ? 'Present ✓' : 'Missing ✗'}
            </span>
          </div>
        </div>
      </section>
    `

    const renderGitWorkflowPanel = () => yo`
      <section class=${css.panel} data-id="landingGitWorkflowPanel">
        <div class=${css.panelHead}>
          <h3 class=${css.panelHeadTitle}><span class=${css.panelHeadIcon}>🔀</span> Git Workflow</h3>
          <span class=${css.panelMore}>Frontend MVP</span>
        </div>
        <div class=${css.fileDesc}>Prepare your local workspace files for Git repository synchronization or download compatibility bundles.</div>
        <div class=${css.loadChips}>
          <button class=${css.loadChip} data-id="landingGitPrepare" onclick=${() => exportWorkspaceForGit()}>Export Workspace Zip</button>
          <a class=${css.loadChip} href="https://github.com/tronweb3/TronIDE" target="_blank" rel="noopener noreferrer">Git Help</a>
        </div>
      </section>
    `

    const renderAdvancedToolsPanel = () => yo`
      <section class=${css.panel} data-id="landingAdvancedToolsPanel">
        <div class=${css.panelHead}>
          <h3 class=${css.panelHeadTitle}><span class=${css.panelHeadIcon}>⋯</span> Advanced tools</h3>
          <button class=${css.loadChip} data-id="landingAdvancedToolsToggle" onclick=${() => toggleAdvancedTools()} aria-expanded=${advancedToolsState.open ? 'true' : 'false'}>${advancedToolsState.open ? 'Hide' : 'Show'} tools</button>
        </div>
        <div class=${css.fileDesc}>Verification, GitHub token flow, layout controls, workspace health, and TRON recipes are available here when needed.</div>
        ${advancedToolsState.open ? yo`
          <div class=${css.advancedToolsGrid} data-id="landingAdvancedToolsContent">
            ${renderVerificationPanel()}
            ${renderGithubTokenPanel()}
            ${renderCookbookPanel()}
            ${renderLayoutControlsPanel()}
            ${renderWorkspaceHealthPanel()}
            ${renderGitWorkflowPanel()}
          </div>
        ` : ''}
      </section>
    `

    const renderPrimaryActions = () => yo`
      <section class="${css.panel} ${css.primaryActionsPanel}" data-id="landingPrimaryActionsPanel">
        <div class=${css.panelHead}>
          <h3 class=${css.panelHeadTitle}><span class=${css.panelHeadIcon}>▣</span> Start building</h3>
        </div>
        <div class="${css.quickStartGrid} ${css.primaryActionsGrid}" aria-label="Quick actions">
          <button class=${css.quickStartCard} data-id="quickStartCreateContract" onclick=${() => createNewFile()}>
            <div class=${css.quickStartIcon}>${plusIcon}</div>
            <div class=${css.quickStartCardTitle}>Create Contract</div>
            <div class=${css.quickStartCardDesc}>Start a new Solidity file in the current workspace.</div>
          </button>
          <button class=${css.quickStartCard} data-id="landingDappStarterCard" onclick=${() => tronTemplates[0] ? createTemplateFile(tronTemplates[0]) : createNewFile()}>
            <div class=${css.quickStartIcon}>◎</div>
            <div class=${css.quickStartCardTitle}>Use TRON Template</div>
            <div class=${css.quickStartCardDesc}>Open the default TRON starter contract and begin from a known-safe example.</div>
          </button>
          <button class=${css.quickStartCard} data-id="landingOpenGlobalSearchButton" onclick=${() => openGlobalSearch()}>
            <div class=${css.quickStartIcon}><i class="fas fa-search" aria-hidden="true"></i></div>
            <div class=${css.quickStartCardTitle}>Search Workspace</div>
            <div class=${css.quickStartCardDesc}>Find contracts, functions, and notes across local files.</div>
          </button>
          <button class=${css.quickStartCard} data-id="landingWalletConnectEntry" aria-label="Connect wallet" onclick=${() => connectWalletFromHome()}>
            <div class=${css.quickStartIcon}>↔</div>
            <div class=${css.quickStartCardTitle}>Connect Wallet</div>
            <div class=${css.quickStartCardDesc}>Connect TronLink and open Deploy & Run for Nile or Mainnet validation.</div>
          </button>
        </div>
      </section>
    `

    const renderVerificationPanel = () => yo`
      <section class=${css.panel} data-id="landingVerificationPanel">
        <div class=${css.panelHead}>
          <h3 class=${css.panelHeadTitle}><span class=${css.panelHeadIcon}>✓</span> Contract Verification</h3>
          <span class=${css.panelMore}>Plugin</span>
        </div>
        <button class="${css.quickStartCard} ${css.verificationLaunchCard}" data-id="landingVerificationOpenPlugin" onclick=${() => openContractVerification()}>
          <div class=${css.verificationLaunchTop}>
            <div class=${css.quickStartCardTitle}>Open Contract Verification plugin</div>
            <span class=${css.resourceArrow}>→</span>
          </div>
          <div class=${css.quickStartCardDesc}>Build a verification package, check TronScan status, and follow the manual submit checklist from the plugin.</div>
        </button>
        <div class=${css.verificationActions} aria-label="Contract verification links">
          <a class=${css.statusPill} data-id="landingVerificationTabLookup" aria-label="Open verification lookup" target="_blank" rel="noopener noreferrer" href="https://tronscan.org/#/contracts/verify"><span>Manual submit on TronScan</span><span class=${css.statusBadge}>External</span></a>
          <button class=${css.statusPill} data-id="landingVerificationTabVerify" onclick=${() => openContractVerification()}><span>Verification checklist</span><span class=${css.statusBadge}>Plugin</span></button>
        </div>
      </section>
    `

    const renderHiddenAiHooks = () => yo`
      <div hidden aria-hidden="true">
        <span data-id="landingAiAssistantPanel">AI panel is provided by the outer TRON IDE AI Assistant.</span>
        <span data-id="landingAiPromptInput">Outer AI prompt is available in the AI Assistant panel.</span>
        <span data-id="landingAiNewChat">New chat opens in the outer AI Assistant panel.</span>
        <span data-id="landingAiActionFile">File action is available from Home quick actions.</span>
        <span data-id="landingAiActionNewWorkspace">Workspace action is available from Home quick actions.</span>
        <span data-id="landingAiActionCreateDapp">Create a DApp remains available from Home.</span>

        <span data-id="landingParityTextFeedback">TronScan status query and Package checklist are verified here.</span>
      </div>
    `

    const projectLogo = yo`<img class=${css.heroLogo} src="assets/img/tron-ide-icon.svg" alt="TRON IDE" />`
    const plusIcon = yo`
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
      </svg>
    `
    const fileIcon = yo`
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M3 1h6l3 3v9H3V1zM9 1v3h3" stroke="currentColor" stroke-width="1.4"></path>
      </svg>
    `
    const folderIcon = yo`
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M2 3h4l1 1h5v8H2V3z" stroke="currentColor" stroke-width="1.4"></path>
      </svg>
    `
    const importProjectIcon = yo`<i class="fas fa-level-up-alt" aria-hidden="true"></i>`
    const githubIcon = yo`
      <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M10 2a8 8 0 0 0-2.5 15.6c.4.1.5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.4.7 0-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.5 7.5 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.5 1.1.2 1.9.1 2.1.5.5.8 1.2.8 2.1 0 3.1-1.8 3.8-3.6 4 .3.2.5.7.5 1.4v2.1c0 .2.1.5.5.4A8 8 0 0 0 10 2z"></path>
      </svg>
    `
    const pluginGridIcon = yo`
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M3 3h3v3H3V3zm5 0h3v3H8V3zM3 8h3v3H3V8zm5 0h3v3H8V8z" stroke="currentColor" stroke-width="1.4"></path>
      </svg>
    `
    const solidityIcon = yo`
      <img class=${css.pluginIconImg} src="assets/img/solidityLogo.webp" alt="Solidity" />
    `
    const remixdIcon = yo`<img class=${css.pluginIconImg} src="assets/img/fileManager.webp" alt="Remixd" />`
    const openFilesIcon = yo`<i class="far fa-folder-open" aria-hidden="true"></i>`
    const resourcesIcon = yo`<i class="far fa-file-alt" aria-hidden="true"></i>`
    const developerHubIcon = yo`<i class="fas fa-book-open" aria-hidden="true"></i>`
    const moreIcon = yo`
      <img class=${css.pluginIconImg} src="assets/img/moreLogo.webp" alt="More" />
    `

    const container = yo`
      <div class="${css.homeContainer} ${themeQuality === 'dark' ? css.homeContainerDark : ''}" data-id="landingPageHomeContainer">
          <div class=${css.mainContent}>
          <div class=${css.remix220Shell} data-id="landingRemix220Shell">
            <div class=${css.remix220Content}>
              <main class=${css.remix220Main} data-id="landingRemix220Main">
                <section class=${css.heroPanel} data-id="landingRemix220Hero">
                  <div class=${css.heroEyebrow}>${projectLogo} TRON IDE · v${packageJson.version}</div>
                  <h1 data-id="landingHeroTitle" class=${css.heroTitle}>TRON Native Smart Contract IDE</h1>
                  <p class=${css.heroSubtitle}>
                    Compile, deploy, debug, and manage TRON smart contracts from one workspace with JavaScript VM (Tron), Injected TronWeb, and TRON-focused examples.
                  </p>
                  ${renderWorkspaceStatus()}
                </section>
                ${renderPrimaryActions()}
                ${renderMostUsedPlugins()}

                ${renderAdvancedToolsPanel()}
                ${renderHiddenAiHooks()}
              </main>
            </div>
          </div>
        </div>
      </div>
    `

    ;['fileAdded', 'fileRemoved', 'fileRenamed', 'fileSaved'].forEach((eventName) => {
      if (this.fileManager.events) {
        this.fileManager.events.on(eventName, scheduleWorkspaceStatusRefresh)
        this._fileEventSubscriptions.push({ emitter: this.fileManager.events, eventName, handler: scheduleWorkspaceStatusRefresh })
      }
      if (this.fileManager.on) {
        this.fileManager.on(eventName, scheduleWorkspaceStatusRefresh)
        this._fileEventSubscriptions.push({ emitter: this.fileManager, eventName, handler: scheduleWorkspaceStatusRefresh })
      }
    })
    ;['fileAdded', 'fileRemoved', 'fileRenamed', 'folderAdded'].forEach((eventName) => {
      if (workspaceProvider.event) {
        workspaceProvider.event.on(eventName, scheduleWorkspaceStatusRefresh)
        this._fileEventSubscriptions.push({ emitter: workspaceProvider.event, eventName, handler: scheduleWorkspaceStatusRefresh })
      }
    })

    // Keep the "Most used plugins" cards in sync with the real plugin state.
    // Opening a plugin (e.g. "Open Verification") activates it via a path that did
    // not refresh the card, so the toggle stayed at "Activate"; clicking it then
    // deactivated the now-active plugin and left an empty side panel. Refresh the
    // cards whenever any plugin is activated/deactivated so the toggle is correct.
    if (this.appManager && this.appManager.event && this.appManager.event.on) {
      const refreshPluginCards = () => {
        if (!this._landingActive) return
        refreshHomeSection('landingMostUsedPlugins', renderMostUsedPlugins)
      }
      ;['activate', 'deactivate'].forEach((eventName) => {
        this.appManager.event.on(eventName, refreshPluginCards)
        this._fileEventSubscriptions.push({ emitter: this.appManager.event, eventName, handler: refreshPluginCards })
      })
    }

    if (this.on) {
      const handleWorkspaceChanged = () => {
        scheduleWorkspaceStatusRefresh()
      }
      ;['setWorkspace', 'createWorkspace', 'renameWorkspace', 'deleteWorkspace'].forEach((eventName) => {
        this.on('filePanel', eventName, handleWorkspaceChanged)
        // Track so onDeactivation can unsubscribe; otherwise each render()/onDeactivation cycle
        // would leak another listener and re-trigger the workspace status refresh N times.
        this._workspacePluginEventSubscriptions.push({ profile: 'filePanel', eventName })
      })
    }

    const onContainerThemeChanged = (theme) => {
      if (!this._landingActive) return
      if (theme.quality === 'dark') {
        container.classList.add(css.homeContainerDark)
      } else {
        container.classList.remove(css.homeContainerDark)
      }
    }
    this._themeHandlers.push(onContainerThemeChanged)
    this._themeEvents.on('themeChanged', onContainerThemeChanged)
    refreshWorkspaceStatus()
    this._workspaceStatusTimers.push(setTimeout(refreshWorkspaceStatus, 500))
    this._workspaceStatusTimers.push(setTimeout(refreshWorkspaceStatus, 1200))

    return container
  }

  onDeactivation () {
    this._landingActive = false
    window.removeEventListener('resize', this._onWindowResize)
    window.removeEventListener('click', this._onWindowClick)
    if (this._workspaceStatusTimer) {
      clearTimeout(this._workspaceStatusTimer)
      this._workspaceStatusTimer = null
    }
    this._workspaceStatusTimers.forEach((timerId) => clearTimeout(timerId))
    this._workspaceStatusTimers = []
    if (this._themeEvents && this._themeEvents.removeListener) {
      this._themeHandlers.forEach((handler) => this._themeEvents.removeListener('themeChanged', handler))
    }
    this._themeHandlers = []
    this._fileEventSubscriptions.forEach(({ emitter, eventName, handler }) => {
      if (emitter.removeListener) emitter.removeListener(eventName, handler)
      else if (emitter.off) emitter.off(eventName, handler)
      else if (emitter.removeEventListener) emitter.removeEventListener(eventName, handler)
    })
    this._fileEventSubscriptions = []
    if (this.off) {
      this._workspacePluginEventSubscriptions.forEach(({ profile, eventName }) => this.off(profile, eventName))
    }
    this._workspacePluginEventSubscriptions = []
  }
}
