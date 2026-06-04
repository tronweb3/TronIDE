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
  .prompt_text {
    width: 100%;
  }
  .prompt_tokens {
    margin: 10px 0;
  }
  .prompt_token_row {
    display: flex;
    width: 100%;
    margin-bottom: 5px;
    border-bottom: solid 2px var(--secondary);
  }
  .prompt_token_row_set {
    display: flex;
    width: 100%;
    margin: 20px 0 0;
  }
  .prompt_token_id {
    width: 30%;
    margin-right: 20px;
  }
  .prompt_token_val {
    width: 40%;
    margin-right: 20px;
  }
  .prompt_token_set {
    width: 20%
  }
  .prompt_token_error {
    margin-top: 5px;
    color: red;
  }
`

module.exports = css
