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

/* global describe, before, it */
import Web3 from 'web3'
import { Provider } from '../src/index'
import * as assert from 'assert'
const web3 = new Web3()

describe('Accounts', () => {
  let provider

  before(async function () {
    provider = new Provider()
    await provider.init()
    web3.setProvider(provider as any)
  })

  describe('eth_getAccounts', () => {
    it('should get a list of accounts', async function () {
      const accounts: string[] = await web3.eth.getAccounts()
      assert.notEqual(accounts.length, 0)
    })
  })

  describe('eth_getBalance', () => {
    it('should get a account balance', async () => {
      const accounts: string[] = await web3.eth.getAccounts()
      const balance0: string = await web3.eth.getBalance(accounts[0])
      const balance1: string = await web3.eth.getBalance(accounts[1])
      const balance2: string = await web3.eth.getBalance(accounts[2])

      assert.deepEqual(balance0, '1000000000000')
      assert.deepEqual(balance1, '1000000000000')
      assert.deepEqual(balance2, '1000000000000')
    })
  })

  describe('eth_sign', () => {
    it('should sign payloads', async () => {
      const accounts: string[] = await web3.eth.getAccounts()
      const signature: string = await web3.eth.sign('Hello world', accounts[0])

      assert.deepEqual(signature.length, 132)
    })
  })

  describe('setTRC10Balance', () => {
    it('should reject token ids below the TRC10 minimum', async () => {
      const accounts: string[] = await web3.eth.getAccounts()

      await assert.rejects(async () => {
        await new Promise((resolve, reject) => {
          provider.Accounts.setTRC10Balance(accounts[0], '1000000', '1', (error) => {
            if (error) return reject(error)
            resolve(null)
          })
        })
      }, /Invalid tokenId: must be greater than 1000000/)
    })

    it('should reject transfers when tokenValue exceeds TRC10 balance', async () => {
      const accounts: string[] = await web3.eth.getAccounts()

      await new Promise((resolve, reject) => {
        provider.Accounts.setTRC10Balance(accounts[0], '1000001', '10', (error) => {
          if (error) return reject(error)
          resolve(null)
        })
      })

      await assert.rejects(async () => {
        await web3.eth.sendTransaction({
          from: accounts[0],
          to: accounts[1],
          data: '0x',
          value: '0',
          gas: 3000000,
          tokenId: '1000001',
          tokenValue: '100'
        } as any)
      }, /No asset/)
    })
  })
})
