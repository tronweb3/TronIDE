/*
 * Copyright 2026 [TronIDE]
 * Licensed under the Apache License, Version 2.0 (the "License");
 */

'use strict'

// Tron receipts use receipt.result (SUCCESS/FAILED), while EVM-style
// providers commonly expose status (0x1/0x0 or booleans). Keep the UI status
// mapping in one small, DOM-free module so every transaction surface agrees.
function receiptStatus (receipt) {
  if (receipt === undefined || receipt === null) return undefined
  if (typeof receipt !== 'object') return receipt
  if (receipt.status !== undefined && receipt.status !== null) return receipt.status
  if (receipt.result !== undefined && receipt.result !== null && typeof receipt.result !== 'object') return receipt.result
  if (receipt.receipt && receipt.receipt.status !== undefined && receipt.receipt.status !== null) return receipt.receipt.status
  if (receipt.receipt && receipt.receipt.result !== undefined && receipt.receipt.result !== null) return receipt.receipt.result
  if (receipt.contractResult && receipt.contractResult.status !== undefined && receipt.contractResult.status !== null) return receipt.contractResult.status
  if (receipt.contractResult && receipt.contractResult.result !== undefined && receipt.contractResult.result !== null) return receipt.contractResult.result
  return undefined
}

function normalizedStatus (receipt) {
  const value = receiptStatus(receipt)
  return value == null ? '' : String(value).trim().toUpperCase()
}

function isSuccessfulReceipt (receipt) {
  const value = receiptStatus(receipt)
  const normalized = normalizedStatus(receipt)
  return value === true || value === 1 || normalized === '0X1' || normalized === 'SUCCESS' || normalized === 'SUCCEEDED'
}

function isFailedReceipt (receipt) {
  const value = receiptStatus(receipt)
  const normalized = normalizedStatus(receipt)
  return value === false || value === 0 || normalized === '0X0' || normalized === 'FAILED' || normalized === 'REVERT' || normalized === 'REVERTED'
}

module.exports = {
  receiptStatus,
  isSuccessfulReceipt,
  isFailedReceipt
}
