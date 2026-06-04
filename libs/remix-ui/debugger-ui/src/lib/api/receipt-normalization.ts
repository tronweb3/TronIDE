export const isMissingTxReceiptError = (payload, error) => {
  return payload?.method === 'eth_getTransactionReceipt' && error?.message?.startsWith('unable to retrieve txReceipt')
}

export const missingTxReceiptResponse = (payload) => ({
  id: payload.id,
  jsonrpc: payload.jsonrpc || '2.0',
  result: null
})
