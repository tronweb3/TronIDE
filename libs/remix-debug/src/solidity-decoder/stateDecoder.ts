/*
 * Original work Copyright © 2018-2021 Remix Team
 * Licensed under the Apache License, Version 2.0.
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

import { extractStatesDefinitions } from './astHelper'
import { computeOffsets } from './decodeInfo'

/**
  * decode the contract state storage
  *
  * @param {Array} storage location  - location of all state variables
  * @param {Object} storageResolver  - resolve storage queries
  * @return {Map} - decoded state variable
  */
export async function decodeState (stateVars, storageResolver) {
  const ret = {}
  for (var k in stateVars) {
    var stateVar = stateVars[k]
    try {
      const decoded = await stateVar.type.decodeFromStorage(stateVar.storagelocation, storageResolver)
      decoded.constant = stateVar.constant
      decoded.immutable = stateVar.immutable
      if (decoded.constant) {
        decoded.value = '<constant>'
      }
      if (decoded.immutable) {
        decoded.value = '<immutable>'
      }
      ret[stateVar.name] = decoded
    } catch (e) {
      console.log(e)
      ret[stateVar.name] = '<decoding failed - ' + e.message + '>'
    }
  }
  return ret
}

/**
  * return all storage location variables of the given @arg contractName
  *
  * @param {String} contractName  - name of the contract
  * @param {Object} sourcesList  - sources list
  * @return {Object} - return the location of all contract variables in the storage
  */
export function extractStateVariables (contractName, sourcesList) {
  const states = extractStatesDefinitions(sourcesList, null)
  if (!states[contractName]) {
    return []
  }
  const types = states[contractName].stateVariables
  const offsets = computeOffsets(types, states, contractName, 'storage')
  if (!offsets) {
    return [] // TODO should maybe return an error
  }
  return offsets.typesOffsets
}

/**
  * return the state of the given @a contractName as a json object
  *
  * @param {Object} storageResolver  - resolve storage queries
  * @param {astList} astList  - AST nodes of all the sources
  * @param {String} contractName  - contract for which state var should be resolved
  * @return {Map} - return the state of the contract
  */
export async function solidityState (storageResolver, astList, contractName) {
  const stateVars = extractStateVariables(contractName, astList)
  try {
    return await decodeState(stateVars, storageResolver)
  } catch (e) {
    return '<decoding failed - ' + e.message + '>'
  }
}
