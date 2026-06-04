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

import { AbstractPanel } from './panel'
import * as packageJson from '../../../../../package.json'
const csjs = require('csjs-inject')
const yo = require('yo-yo')

const css = csjs`
  .pluginsContainer {
    display: none;
  }
`

const profile = {
  name: 'hiddenPanel',
  displayName: 'Hidden Panel',
  description: '',
  version: packageJson.version,
  methods: ['addView', 'removeView']
}

export class HiddenPanel extends AbstractPanel {
  constructor () {
    super(profile)
  }

  render () {
    return yo`
      <div class=${css.pluginsContainer}>
        ${this.view}
      </div>`
  }
}
