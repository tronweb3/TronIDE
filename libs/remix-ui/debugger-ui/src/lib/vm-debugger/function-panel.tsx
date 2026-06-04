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

import React, { useState, useEffect } from 'react' // eslint-disable-line
import DropdownPanel from './dropdown-panel' // eslint-disable-line
import { default as deepequal } from 'deep-equal' // eslint-disable-line

export const FunctionPanel = ({ data }) => {
  const [calldata, setCalldata] = useState(null)

  useEffect(() => {
    if (!deepequal(calldata, data)) setCalldata(data)
  }, [data])

  return (
    <div id='FunctionPanel'>
      <DropdownPanel dropdownName='Function Stack' calldata={calldata || {}} />
    </div>
  )
}

export default FunctionPanel
