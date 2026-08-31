import * as tape from 'tape'
import { canUseWorker, compilerIntegrityToSRI, pathToURL, urlFromVersion } from '../src/compiler/compiler-utils'
import { compile } from '../src/compiler/compiler-helpers'

tape('compiler helper rejects missing or unknown versions instead of creating a hanging promise', async (t) => {
  const expectReject = async (promise: Promise<any>, pattern: RegExp) => {
    try {
      await promise
      t.fail('expected compiler helper to reject')
    } catch (error) {
      t.ok(pattern.test(error.message), `rejection is explicit: ${error.message}`)
    }
  }
  await expectReject(compile({}, {}), /Compiler settings are required|A compiler version is required/)
  await expectReject(compile({}, { version: '0.8.99+commit.unknown' }), /not present in the loaded manifest/)
  t.equal(canUseWorker(undefined), false, 'invalid versions cannot enable a worker')
  t.end()
})

tape('urlFromVersion accepts the bare compiler version used by the plugin API', (t) => {
  const version = '0.6.8+commit.0bbfe453'
  const path = `soljson-v${version}.js`
  pathToURL[path] = 'https://tronprotocol.github.io/solc-bin/wasm'
  t.equal(urlFromVersion(version), `https://tronprotocol.github.io/solc-bin/wasm/${path}`)
  t.equal(compilerIntegrityToSRI('0x' + '00'.repeat(32)), 'sha256-' + 'A'.repeat(43) + '=', 'manifest SHA-256 converts to SRI')
  delete pathToURL[path]
  t.end()
})
