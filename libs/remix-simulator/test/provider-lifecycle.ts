/*
 * Regression coverage for simulator cleanup used by timed-out AI test runs.
 */

import { Provider } from '../src/index'
import * as assert from 'assert'

describe('Provider lifecycle', () => {
  it('disconnects idempotently and rejects work queued after cleanup', async () => {
    const provider: any = new Provider()

    assert.equal(provider.isConnected(), true)
    assert.equal(provider.disconnect(), true)
    assert.equal(provider.isConnected(), false)
    assert.equal(provider.disconnect(), true)

    await assert.rejects(async () => {
      await new Promise((resolve, reject) => {
        provider.sendAsync({ method: 'eth_accounts' }, (error, result) => {
          if (error) return reject(error)
          resolve(result)
        })
      })
    }, /Simulator provider is disconnected/)
  })
})
