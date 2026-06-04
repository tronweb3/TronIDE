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

import React from 'react' // eslint-disable-line
import DropdownPanel from './dropdown-panel' // eslint-disable-line
import { extractData } from '../../utils/solidityTypeFormatter'
import { ExtractData } from '../../types' // eslint-disable-line

export const SolidityState = ({ calldata, message }) => {
  const formatSelf = (key: string, data: ExtractData) => {
    try {
      let color = 'var(--primary)'
      if (data.isArray || data.isStruct || data.isMapping) {
        color = 'var(--info)'
      } else if (
        data.type.indexOf('uint') === 0 ||
            data.type.indexOf('int') === 0 ||
            data.type.indexOf('bool') === 0 ||
            data.type.indexOf('enum') === 0
      ) {
        color = 'var(--green)'
      } else if (data.type === 'string') {
        color = 'var(--teal)'
        } else if (data.self == 0x0) { // eslint-disable-line
        color = 'var(--gray)'
      }
      return (
        <label className='mb-0' style={{ color: data.isProperty ? 'var(--info)' : '', whiteSpace: 'pre-wrap' }}>
          {' ' + key}:
          <label className='mb-0' style={{ color }}>
            {' ' + data.self}
          </label>
          <label style={{ fontStyle: 'italic' }}>
            {data.isProperty || !data.type ? '' : ' ' + data.type}
          </label>
        </label>
      )
    } catch (e) {
      return (<></>)
    }
  }

  return (
    <div id='soliditystate' data-id='soliditystate'>
      {
        <DropdownPanel dropdownName='Solidity State' calldata={calldata || {}} formatSelfFunc={formatSelf} extractFunc={extractData} />
      }
    </div>
  )
}

export default SolidityState
