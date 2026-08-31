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

const SWARM_RAW_UPLOAD_URL = 'https://swarm-gateways.net/bzz-raw:/'

const putSwarmContent = async (content): Promise<string> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    const response = await fetch(SWARM_RAW_UPLOAD_URL, {
      method: 'POST',
      body: content,
      redirect: 'error',
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`Swarm upload failed with HTTP ${response.status}`)
    const hash = await response.text()
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Swarm gateway returned an invalid hash')
    return hash
  } finally {
    clearTimeout(timeout)
  }
}

export const publishToSwarm = async (contract, fileManager) => {
  // gather list of files to publish
  const sources = []
  let metadata
  const item = { content: null, hash: null }
  const uploaded = []

  try {
    metadata = JSON.parse(contract.metadata)
  } catch (e) {
    throw new Error(e)
  }

  if (metadata === undefined || !metadata.sources || typeof metadata.sources !== 'object') {
    throw new Error('No metadata sources')
  }

  const sourceFiles = await Promise.all(Object.keys(metadata.sources).map(async fileName => {
    // find hash
    let hash = null
    try {
      // we try extract the hash defined in the metadata.json
      // in order to check if the hash that we get after publishing is the same as the one located in metadata.json
      // if it's not the same, we throw "hash mismatch between solidity bytecode and uploaded content"
      // if we don't find the hash in the metadata.json, the check is not done.
      //
      // TODO: refactor this with publishOnIpfs
      if (metadata.sources[fileName].urls) {
        metadata.sources[fileName].urls.forEach(url => {
          if (url.includes('bzz')) hash = url.match('(bzzr|bzz-raw)://(.+)')[1]
        })
      }
    } catch (e) {
      throw new Error('Error while extracting the hash from metadata.json')
    }

    const content = await readProviderFile(fileManager.fileProviderOf(fileName), fileName)
    return {
      content,
      hash,
      filename: fileName
    }
  }))
  sources.push(...sourceFiles)
  // publish the list of sources in order, fail if any failed

  await Promise.all(sources.map(async (item) => {
    try {
      const result = await swarmVerifiedPublish(item.content, item.hash)

      try {
        item.hash = result.url.match('bzz-raw://(.+)')[1]
      } catch (e) {
        item.hash = '<Metadata inconsistency> - ' + item.filename
      }
      item.output = result
      uploaded.push(item)
      // TODO this is a fix cause Solidity metadata does not contain the right swarm hash (poc 0.3)
      const sourceMetadata = metadata.sources[item.filename]
      sourceMetadata.urls = Array.isArray(sourceMetadata.urls) ? sourceMetadata.urls : []
      sourceMetadata.urls[0] = result.url
    } catch (error) {
      throw new Error(error)
    }
  }))

  const metadataContent = JSON.stringify(metadata)
  try {
    const result = await swarmVerifiedPublish(metadataContent, '')

    try {
      contract.metadataHash = result.url.match('bzz-raw://(.+)')[1]
    } catch (e) {
      contract.metadataHash = '<Metadata inconsistency> - metadata.json'
    }
    item.content = metadataContent
    item.hash = contract.metadataHash
    uploaded.push({
      content: contract.metadata,
      hash: contract.metadataHash,
      filename: 'metadata.json',
      output: result
    })
  } catch (error) {
    throw new Error(error)
  }

  return { uploaded, item }
}

const readProviderFile = (provider, path): Promise<string> => new Promise((resolve, reject) => {
  try {
    provider.get(path, (error, content) => {
      if (error) return reject(error)
      if (content === null || content === undefined) return reject(new Error(`Source file not found: ${path}`))
      resolve(content)
    })
  } catch (error) {
    reject(error)
  }
})

const swarmVerifiedPublish = async (content, expectedHash): Promise<Record<string, any>> => {
  const ret = await putSwarmContent(content)
  if (expectedHash && ret !== expectedHash) {
    return { message: 'hash mismatch between solidity bytecode and uploaded content.', url: 'bzz-raw://' + ret, hash: ret }
  }
  return { message: 'ok', url: 'bzz-raw://' + ret, hash: ret }
}
