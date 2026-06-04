import { isMissingTxReceiptError, missingTxReceiptResponse } from './receipt-normalization'

describe('DebuggerApiMixin receipt normalization', () => {
  it('normalizes missing eth_getTransactionReceipt errors to a null result', () => {
    const payload = {
      id: 7,
      jsonrpc: '2.0',
      method: 'eth_getTransactionReceipt'
    }
    const error = new Error('unable to retrieve txReceipt 0xabc')

    expect(isMissingTxReceiptError(payload, error)).toBe(true)
    expect(missingTxReceiptResponse(payload)).toEqual({
      id: 7,
      jsonrpc: '2.0',
      result: null
    })
  })

  it('does not normalize unrelated provider errors', () => {
    expect(isMissingTxReceiptError({ method: 'eth_getTransactionByHash' }, new Error('unable to retrieve txReceipt 0xabc'))).toBe(false)
    expect(isMissingTxReceiptError({ method: 'eth_getTransactionReceipt' }, new Error('provider unavailable'))).toBe(false)
  })

  it('defaults jsonrpc to 2.0 when the payload omits it', () => {
    expect(missingTxReceiptResponse({ id: 9, method: 'eth_getTransactionReceipt' })).toEqual({
      id: 9,
      jsonrpc: '2.0',
      result: null
    })
  })
})
