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

'use strict'
import { Plugin } from '@remixproject/engine'
import { CompilerAbstract } from '@remix-project/remix-solidity'

const profile = {
  name: 'compilerMetadata',
  methods: ['deployMetadataOf'],
  events: [],
  version: '0.0.1'
}

const JS_VM_TRON = 'JavaScript VM (Tron):-'

export class CompilerMetadata extends Plugin {
  networks: string[]
  innerPath: string
  constructor () {
    super(profile)
    this.networks = [JS_VM_TRON, 'VM:-', 'main:1', 'ropsten:3', 'rinkeby:4', 'kovan:42', 'görli:5', 'Custom']
    this.innerPath = 'artifacts'
  }

  _JSONFileName (path, contractName) {
    return this.joinPath(path, this.innerPath, contractName + '.json')
  }

  _MetadataFileName (path, contractName) {
    return this.joinPath(path, this.innerPath, contractName + '_metadata.json')
  }

  onActivation () {
    var self = this
    this.on('solidity', 'compilationFinished', async (file, source, languageVersion, data) => {
      if (!await this.call('settings', 'get', 'settings/generate-contract-metadata')) return
      const compiler = new CompilerAbstract(languageVersion, data, source)
      var path = self._extractPathOf(source.target)
      compiler.visitContracts((contract) => {
        if (contract.file !== source.target) return
        (async () => {
          const fileName = self._JSONFileName(path, contract.name)
          const content = await this.call('fileManager', 'exists', fileName) ? await this.call('fileManager', 'readFile', fileName) : null
          await this._setArtefacts(content, contract, path)
        })()
      })
    })
  }

  _extractPathOf (file) {
    var reg = /(.*)(\/).*/
    var path = reg.exec(file)
    return path ? path[1] : '/'
  }

  async _setArtefacts (content, contract, path) {
    console.log('[INFO] Setting artifacts for contract:', contract)
    let metadata
    let contentToParse = content
    try {
      if (typeof contentToParse !== 'string' || contentToParse.trim() === '' || contentToParse === 'undefined') {
        if (content !== undefined && content !== null && content !== '') { // Log if original content was problematic
          console.warn('[WARN] Initial content for metadata was invalid or "undefined", defaulting to "{}". Original:', content)
        }
        contentToParse = '{}'
      }
      metadata = JSON.parse(contentToParse)
    } catch (e) {
      console.error(`[ERROR] Failed to parse initial content for metadata. Content provided: "${content}". Attempted to parse: "${contentToParse}". Error:`, e)
      metadata = {}
    }

    const contractName = (contract && contract.name) ? contract.name : 'UnknownContract'
    var fileName = this._JSONFileName(path, contractName)
    var metadataFileName = this._MetadataFileName(path, contractName)

    var deploy = (metadata && typeof metadata.deploy === 'object' && metadata.deploy !== null) ? metadata.deploy : {}

    this.networks.forEach((network) => {
      const networkContext = (deploy && typeof deploy[network] === 'object' && deploy[network] !== null) ? deploy[network] : {}
      if (contract) {
        deploy[network] = this._syncContext(contract, networkContext)
      } else {
        deploy[network] = networkContext
      }
    })

    let parsedMetadata
    const contractMetadataString = contract && contract.object && contract.object.metadata
    if (typeof contractMetadataString === 'string' && contractMetadataString.trim() !== '' && contractMetadataString !== 'undefined') {
      try {
        parsedMetadata = JSON.parse(contractMetadataString)
      } catch (e) {
        console.error(`[ERROR] Failed to parse contract.object.metadata. Metadata string was: "${contractMetadataString}". Error:`, e)
      }
    } else {
      if (contractMetadataString !== undefined && contractMetadataString !== null && contractMetadataString !== '') { // 仅当它有值但无效时记录警告
        console.warn('[WARN] contract.object.metadata was not a valid JSON string or was "undefined", skipping metadata file write. Value:', contractMetadataString)
      }
    }

    if (parsedMetadata) { // 只有当 parsedMetadata 成功解析后才写入文件
      try {
        await this.call('fileManager', 'writeFile', metadataFileName, JSON.stringify(parsedMetadata, null, '\t'))
      } catch (writeError) {
        console.error(`[ERROR] Failed to write metadata file "${metadataFileName}". Error:`, writeError)
      }
    }

    // 准备主构建产物数据，增加对 contract 及其属性的空值检查
    const contractObject = contract && contract.object
    const contractEvm = contractObject && contractObject.evm

    var data = {
      deploy, // deploy 已经被安全地初始化或填充
      data: {
        bytecode: contractEvm && contractEvm.bytecode ? contractEvm.bytecode : {},
        deployedBytecode: contractEvm && contractEvm.deployedBytecode ? contractEvm.deployedBytecode : {},
        gasEstimates: contractEvm ? contractEvm.gasEstimates : null,
        methodIdentifiers: contractEvm ? contractEvm.methodIdentifiers : {}
      },
      abi: contractObject ? contractObject.abi : []
    }

    try {
      await this.call('fileManager', 'writeFile', fileName, JSON.stringify(data, null, '\t'))
    } catch (writeError) {
      console.error(`[ERROR] Failed to write main artifact file "${fileName}". Error:`, writeError)
    }
  }

  _syncContext (contract, metadata) {
    var linkReferences = metadata.linkReferences
    var autoDeployLib = metadata.autoDeployLib
    if (!linkReferences) linkReferences = {}
    if (autoDeployLib === undefined) autoDeployLib = true

    for (var libFile in contract.object.evm.bytecode.linkReferences) {
      if (!linkReferences[libFile]) linkReferences[libFile] = {}
      for (var lib in contract.object.evm.bytecode.linkReferences[libFile]) {
        if (!linkReferences[libFile][lib]) {
          linkReferences[libFile][lib] = '<address>'
        }
      }
    }
    metadata.linkReferences = linkReferences
    metadata.autoDeployLib = autoDeployLib
    return metadata
  }

  async deployMetadataOf (contractName, fileLocation) {
    let path
    if (fileLocation) {
      path = fileLocation.split('/')
      path.pop()
      path = path.join('/')
    } else {
      try {
        path = this._extractPathOf(await this.call('fileManager', 'getCurrentFile'))
      } catch (err) {
        console.log(err)
        throw new Error(err)
      }
    }
    try {
      const { id, name } = await this.call('network', 'detectNetwork')
      const fileName = this._JSONFileName(path, contractName)
      try {
        const content = await this.call('fileManager', 'readFile', fileName)
        if (!content) return null
        let metadata = JSON.parse(content)
        metadata = metadata.deploy || {}
        return metadata[name + ':' + id] || metadata[name] || metadata[id] || metadata[name.toLowerCase() + ':' + id] || metadata[name.toLowerCase()]
      } catch (err) {
        return null
      }
    } catch (err) {
      console.log(err)
      throw new Error(err)
    }
  }

  joinPath (...paths) {
    paths = paths.filter((value) => value !== '').map((path) => path.replace(/^\/|\/$/g, '')) // remove first and last slash)
    if (paths.length === 1) return paths[0]
    return paths.join('/')
  }
}
