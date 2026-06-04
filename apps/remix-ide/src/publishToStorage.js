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

const yo = require('yo-yo')
const publishOnSwarm = require('./lib/publishOnSwarm')
const publishOnIpfs = require('./lib/publishOnIpfs')
const modalDialogCustom = require('./app/ui/modal-dialog-custom')

export default function publish (storage, fileProvider, fileManager, contract) {
  if (contract) {
    if (contract.metadata === undefined || contract.metadata.length === 0) {
      modalDialogCustom.alert('This contract may be abstract, may not implement an abstract parent\'s methods completely or not invoke an inherited contract\'s constructor correctly.')
    } else {
      if (storage === 'swarm') {
        publishOnSwarm(contract, fileManager, function (err, uploaded) {
          if (err) {
            try {
              err = JSON.stringify(err)
            } catch (e) { console.warn('[publishToStorage] failed to stringify swarm publish error', e) }
            console.log(`Failed to publish metadata file to swarm, please check the Swarm gateways is available ( swarm-gateways.net ) ${err}`)
          } else {
            var result = yo`<div>${uploaded.map((value) => {
              return yo`<div><b>${value.filename}</b> : <pre>${value.output.url}</pre></div>`
            })}</div>`
            modalDialogCustom.alert(`Published ${contract.name}'s Metadata`, yo`<span>Metadata of "${contract.name.toLowerCase()}" was published successfully.<br> <pre>${result}</pre> </span>`)
          }
        }, (item) => { // triggered each time there's a new verified publish (means hash correspond)
          fileProvider.addExternal('swarm/' + item.hash, item.content)
        })
      } else {
        publishOnIpfs(contract, fileManager, function (err, uploaded) {
          if (err) {
            try {
              err = JSON.stringify(err)
            } catch (e) { console.warn('[publishToStorage] failed to stringify ipfs publish error', e) }
            modalDialogCustom.alert(yo`<span>Failed to publish metadata file to ${storage}, please check the ${storage} gateways is available.<br />
            ${err}</span>`)
          } else {
            var result = yo`<div>${uploaded.map((value) => {
              return yo`<div><b>${value.filename}</b> : <pre>${value.output.url.replace('dweb:/ipfs/', 'ipfs://')}</pre></div>`
            })}</div>`
            modalDialogCustom.alert(`Published ${contract.name}'s Metadata`, yo`<span>Metadata of "${contract.name.toLowerCase()}" was published successfully.<br> <pre>${result}</pre> </span>`)
          }
        }, (item) => { // triggered each time there's a new verified publish (means hash correspond)
          fileProvider.addExternal('ipfs/' + item.hash, item.content)
        })
      }
    }
  }
}
