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
  .contextview {
    opacity             : 1;
    position            : relative;
    height              : 25px;
  }
  .container {
    padding             : 1px 15px;
  }
  .line {
    display             : flex;
    justify-content     : flex-end;
    align-items         : center;
    text-overflow       : ellipsis;
    overflow            : hidden;
    white-space         : nowrap;
    font-size           : 13px;
  }
  .type {
    font-style        : italic;
    margin-right      : 5px;
  }
  .name  {
    font-weight       : bold;
  }
  .jump {
    cursor            : pointer;
    margin            : 0 5px;
  }
  .jump:hover              {
    color             : var(--secondary);
  }
  .referencesnb {
    float             : right;
    margin-left       : 15px;
  }
  .gasEstimation {
    margin-right      : 15px;
    display           : flex;
    align-items       : center;
  }
  .gasStationIcon {
    margin-right      : 5px;
  }
  .contextviewcontainer {
    z-index           : 50;
    border-radius     : 1px;
    border            : 2px solid var(--secondary);
  }
  .contextviewcontainer{
    z-index           : 50;
    border-radius     : 1px;
    border            : 2px solid var(--secondary);
  }
`

module.exports = css
