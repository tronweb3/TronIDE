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
  .popup             {
    position         : absolute;
    text-align       : left;
    display          : none;
    width            : 95%;
    font-family      : monospace;
    background-color : var(--secondary);
    overflow         : auto;
    padding-bottom   : 13px;
    z-index          : 80;
    bottom           : 1em;
    border-width     : 4px;
    left             : 2em;
  }

  .autoCompleteItem {
    padding          : 4px;
    border-radius    : 2px;
  }

  .popup a {
    cursor           : pointer;
  }

  .listHandlerShow   {
    display          : block;
  }

  .listHandlerHide   {
    display          : none;
  }

  .listHandlerButtonShow {
    position         : fixed;
    width            : 46%;
  }

  .pageNumberAlignment {
    font-size        : 10px;
    float            : right;
  }

  .modalContent {
    position         : absolute;
    margin-left      : 20%;
    margin-bottom    : 32px;
    bottom           : 0px;
    padding          : 0;
    line-height      : 18px;
    font-size        : 12px;
    width            : 40%;
    box-shadow       : 0 4px 8px 0 rgba(0,0,0,0.2),0 6px 20px 0 rgba(0,0,0,0.19);
    -webkit-animation-name: animatebottom;
    -webkit-animation-duration: 0.4s;
    animation-name   : animatetop;
    animation-duration: 0.4s
  }

  @-webkit-keyframes animatetop {
    from {bottom: -300px; opacity: 0}
    to {bottom: 0; opacity: 1}
  }

  @keyframes animatetop {
    from {bottom: -300px; opacity: 0}
    to {bottom: 0; opacity: 1}
  }
`

module.exports = css
