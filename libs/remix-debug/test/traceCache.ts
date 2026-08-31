import tape from 'tape'
import { TraceCache } from '../src/trace/traceCache'

function storageKey (index: number): string {
  return index.toString(16).padStart(64, '0')
}

tape('TraceCache checkpoints contain every storage delta', (t) => {
  const cache = new TraceCache()
  const firstAddress = '41' + '1'.repeat(40)
  const secondAddress = '41' + '2'.repeat(40)

  for (let index = 1; index <= 128; index++) {
    cache.pushStoreChanges(index, firstAddress, storageKey(index), `value-${index}`)
  }
  cache.pushStoreChanges(129, firstAddress, storageKey(1), 'updated-value')
  cache.pushStoreChanges(1, secondAddress, storageKey(999), 'other-address')

  const at64 = cache.accumulateStorageChanges(64, firstAddress, {})
  const at128 = cache.accumulateStorageChanges(128, firstAddress, {})
  const at129 = cache.accumulateStorageChanges(129, firstAddress, {})

  t.equal(Object.keys(at64).length, 64, 'the first checkpoint preserves all 64 changes')
  t.equal(Object.keys(at128).length, 128, 'the next checkpoint preserves all 128 changes')
  t.equal(at129[cache.sstore[129].hashedKey].value, 'updated-value', 'changes after a checkpoint are applied')
  t.equal(Object.keys(at129).length, 128, 'updating a slot does not create an extra entry')
  t.equal(Object.keys(cache.accumulateStorageChanges(129, secondAddress, {})).length, 1, 'addresses remain isolated')
  t.end()
})
