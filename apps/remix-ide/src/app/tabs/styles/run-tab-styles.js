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

var csjs = require('csjs-inject')

var css = csjs`
  [data-title] {
      position: relative;
      cursor: pointer;
  }

  .tooltip-above::after {
      content: attr(data-title);
      position: absolute;
      bottom: 100%; /* Position ABOVE the element */
      left: 50%;
      transform: translateX(-90px) translateY(49px); /* Center horizontally, move slightly UP */
      background-color: rgba(0, 0, 0, 0.85);
      color: #fff;
      padding: 6px 8px;
      border-radius: 6px;
      white-space: nowrap;
      opacity: 0;
      visibility: hidden;
      z-index: 1000;
      pointer-events: none;
      min-height: 32px;
      box-shadow: 0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 9px 28px 8px rgba(0, 0, 0, 0.05);
      box-sizing: border-box;
      line-height: 21px;
      font-size: 14px;
  }
  .tooltip-above.ta-add::after {
    transform: translateX(-90px) translateY(-5px);
  }
  .tooltip-above.ta-copy::after {
    transform: translateX(-140px) translateY(-5px);
  }
  .tooltip-above.ta-right::after {
    transform: translateX(-140px) translateY(-5px);
  }
  .tooltip-above.ta-right.ta-clear::after {
    transform: translateX(-90%) translateY(-5px);
  }

  .tooltip-above:hover::after {
      opacity: 1;
      visibility: visible;
  }
  .tooltipContainer { /* 对应 yo-yo 中的 css.tooltipContainer */
    position: relative;
    display: inline-block; /* 或者 block, flex 等，取决于按钮的布局需求 */
  }

  .tooltipTextCss { /* 对应 yo-yo 中的 css.tooltipTextCss */
    visibility: hidden;          /* 默认隐藏 */
    opacity: 0;                  /* 默认透明 */
    width: max-content;          /* 宽度根据内容自适应 */
    min-width: 150px;            /* 最小宽度 */
    max-width: 300px;            /* 最大宽度，超出则文字会自动换行 */
    background-color: #333;      /* 背景色 */
    color: #fff;                 /* 文字颜色 */
    text-align: left;            /* 文字左对齐 */
    border-radius: 4px;          /* 圆角 */
    padding: 6px 10px;           /* 内边距 */
    position: absolute;          /* 绝对定位 */
    z-index: 1000;               /* 确保在顶层 */
    bottom: 110%;                /* 定位到触发元素的上方 (100% + 10% 的间距) */
    left: -20px;
    transition: opacity 0.15s ease-in-out, visibility 0.15s ease-in-out; /* 平滑过渡动画 */
    pointer-events: none;        /* Tooltip本身不捕获鼠标事件 */
    font-size: 0.8rem;           /* 稍小一点的字体 */
    line-height: 1.4;            /* 合适的行高 */
    box-shadow: 0 2px 5px rgba(0,0,0,0.2); /* 轻微阴影增加立体感 */
    white-space: normal;         /* 允许 tooltip 内的文字换行 */
  }

  /* 可选：为 tooltip 添加一个小箭头，指向触发元素 */
  .tooltipTextCss::after {
    content: "";
    position: absolute;
    top: 100%; /* 箭头位于 tooltip 底部 */
    left: 65px;
    border-width: 5px;
    border-style: solid;
    border-color: #333 transparent transparent transparent; /* 箭头颜色与背景一致 */
  }

  .tooltipContainer:hover .tooltipTextCss { /* 当鼠标悬停在容器上时 */
    visibility: visible;         /* 显示 tooltip */
    opacity: 1;                  /* 完全可见 */
    /* transition-delay: 0.05s; */ /* 可以根据需要设置一个极小的延迟 */
  }
  .runTabView {
    display: flex;
    flex-direction: column;
  }
  .runTabView::-webkit-scrollbar {
    display: none;
  }
  .settings {
    padding: 0 24px 16px;
  }
  .crow {
    display: block;
    margin-top: 8px;
  }
  .col1 {
    width: 30%;
    float: left;
    align-self: center;
  }
  .settingsLabel {
    font-size: 11px;
    margin-bottom: 4px;
    text-transform: uppercase;
  }
  .environment {
    display: flex;
    align-items: center;
    position: relative;
    width: 100%;
  }
  .environment a {
    margin-left: 7px;
  }
  .account {
    display: flex;
    align-items: center;
  }
  .account i {
    margin-left: 12px;
  }
  .col2 {
    border-radius: 3px;
  }
  .col2_1 {
    width: 164px;
    min-width: 164px;
  }
  .col2_2 {
  }
  .select {
    font-weight: normal;
    width: 100%;
    overflow: hidden;
  }
  .instanceContainer {
    display: flex;
    flex-direction: column;
    margin-bottom: 2%;
    border: none;
    text-align: center;
    padding: 0 14px 16px;
  }
  .pendingTxsContainer  {
    display: flex;
    flex-direction: column;
    margin-top: 2%;
    border: none;
    text-align: center;
  }
  .container {
    padding: 0 24px 16px;
  }
  .recorderDescription {
    margin: 0 15px 15px 0;
   }
  .contractNames {
    width: 100%;
    border: 1px solid
  }
  .subcontainer {
    display: flex;
    flex-direction: row;
    align-items: center;
    margin-bottom: 8px;
  }
  .subcontainer i {
    width: 16px;
    display: flex;
    justify-content: center;
    margin-left: 1px;
  }
  .button button{
    flex: none;
  }
  .button {
    display: flex;
    align-items: center;
    margin-top: 13px;
  }
  .transaction {
  }
  .atAddress {
    margin: 0;
    min-width: 100px;
    width: 100px;
    height: 100%;
    word-break: inherit;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    border-right: 0;
  }
  .atAddressSect {
    margin-top: 8px;
    height: 32px;
  }
  .atAddressSect input {
    height: 32px;
    border-top-left-radius: 0 !important;
    border-bottom-left-radius: 0 !important;
  }
  .ataddressinput {
    padding: .25rem;
  }
  .create {
  }
  .input {
    font-size: 10px !important;
  }
  .noInstancesText {
    font-style: italic;
    text-align: left;
    padding-left: 15px;
  }
  .pendingTxsText {
    font-style: italic;
    display: flex;
    justify-content: space-evenly;
    align-items: center;
    flex-wrap: wrap;
  }
  .item {
    margin-right: 1em;
    display: flex;
    align-items: center;
  }
  .pendingContainer {
    display: flex;
    align-items: baseline;
  }
  .pending {
    height: 25px;
    text-align: center;
    padding-left: 10px;
    border-radius: 3px;
    margin-left: 5px;
  }
  .disableMouseEvents {
    pointer-events: none;
  }
  .icon {
    cursor: pointer;
    font-size: 12px;
    cursor: pointer;
    margin-left: 5px;
  }
  .icon:hover {
    font-size: 12px;
    color: var(--warning);
  }
  .errorIcon {
    color: var(--warning);
    margin-left: 15px;
  }
  .failDesc {
    color: var(--warning);
    padding-left: 10px;
    display: inline;
  }
  .network {
    margin-left: 8px;
    pointer-events: none;
  }
  .networkItem {
    margin-right: 5px;
  }
  .transactionActions {
    display: flex;
    justify-content: space-evenly;
    width: 145px;
  }
  .orLabel {
    text-align: center;
    text-transform: uppercase;
  }
  .infoDeployAction {
    margin-left: 1px;
    font-size: 13px;
    color: var(--info);
  }
  .gasValueContainer {
    flex-direction: row;
    display: flex;
  }
  .gasNval {
    width: 55%;
    font-size: 0.8rem;
  }
  .gasNvalUnit {
    width: 41%;
    margin-left: 10px;
    font-size: 0.8rem;
  }
  .gasNTid {
    width: 41%;
    font-size: 0.8rem;
  }
  .gasNTval {
    width: 55%;
    margin-left: 10px;
    font-size: 0.8rem;
  }
  .inputError {
    min-height: 16px;
    margin-top: 4px;
    font-size: 11px;
    line-height: 1.3;
    color: #dc3545;
  }
  .extendWrapper {
    display: none;
  }
  .extendBtn {
    width: 100%;
    cursor: pointer;
    margin: 0.8rem 0 -16px;
    text-align: center;
  }
  .deployDropdown {
    text-align: center;
    text-transform: uppercase;
  }
  .checkboxAlign {
    padding-top: 2px;
  }
`

module.exports = css
