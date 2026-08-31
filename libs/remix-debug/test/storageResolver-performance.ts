import tape from 'tape'
import { StorageResolver } from '../src/storage/storageResolver'

tape('StorageResolver deduplicates concurrent storage range requests', async (t) => {
  let calls = 0
  const slot = '0x' + '1'.repeat(64)
  const web3: any = {
    debug: {
      storageRangeAt: (_block, _tx, _address, _start, _maxSize, callback) => {
        calls++
        setImmediate(() => callback(null, { storage: { [slot]: { key: slot, value: '0x2' } }, nextKey: null }))
      }
    }
  }
  const resolver = new StorageResolver({ web3 })
  const tx = { blockHash: '0xblock', transactionIndex: 0 }
  const results = await Promise.all([
    resolver.storageRange(tx, 0, '0xabc'),
    resolver.storageRange(tx, 0, '0xabc')
  ])

  t.equal(calls, 1, 'identical in-flight requests share one RPC')
  t.equal(results[0][slot].value, '0x2', 'the first caller receives the resolved storage')
  t.equal(results[1][slot].value, '0x2', 'the second caller receives the resolved storage')
  t.end()
})
