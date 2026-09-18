/*
 * Copyright © 2026 TronIDE
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

const DEEP_LINK_LIMITS = Object.freeze({
  code: Object.freeze({
    maxParameterChars: 64 * 1024,
    maxDecodedBytes: 32 * 1024,
    tooLargeMessage: 'The contract source link is too large. Deep links accept up to 32 KiB of decoded source and a 64 KiB code parameter. Import the contract from GitHub or GitHub Gist instead.'
  }),
  remaps: Object.freeze({
    maxParameterChars: 16 * 1024,
    maxDecodedBytes: 8 * 1024,
    tooLargeMessage: 'The remappings link is too large. Deep links accept up to 8 KiB of decoded remappings and a 16 KiB remaps parameter. Keep only the required mappings or import the project from GitHub or GitHub Gist instead.'
  })
})

function decodeBase64Utf8 (payload) {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new Error('The encoded Base64 payload is empty.')
  }

  let raw
  try {
    raw = atob(payload)
  } catch (error) {
    throw new Error('The payload is not valid Base64.')
  }

  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function encodeBase64Utf8 (value) {
  if (typeof value !== 'string') throw new Error('Only text can be encoded as Base64.')

  const bytes = new TextEncoder().encode(value)
  const chunks = []
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize)))
  }
  return btoa(chunks.join(''))
}

/**
 * Decode UTF-8 text transported as a (possibly percent-encoded) Base64 URL
 * parameter. Hash parameters stay raw in QueryParams so each consumer can
 * decode exactly once without corrupting encoded separators such as `%26`.
 *
 * @param {string} payload Base64 text from a URL parameter
 * @param {{maxParameterChars?: number, maxDecodedBytes?: number, tooLargeMessage?: string}} [limits]
 * @returns {string} decoded UTF-8 text
 */
function decodeUrlBase64 (payload, limits) {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new Error('The encoded URL payload is empty.')
  }

  limits = limits || {}
  if (limits.maxParameterChars && payload.length > limits.maxParameterChars) {
    throw new Error(limits.tooLargeMessage || 'The encoded URL payload is too large.')
  }

  let encoded
  try {
    encoded = decodeURIComponent(payload)
  } catch (error) {
    throw new Error('The URL payload contains invalid percent encoding.')
  }

  let decoded
  try {
    decoded = decodeBase64Utf8(encoded)
  } catch (error) {
    throw new Error('The URL payload is not valid Base64.')
  }

  if (limits.maxDecodedBytes && new TextEncoder().encode(decoded).byteLength > limits.maxDecodedBytes) {
    throw new Error(limits.tooLargeMessage || 'The decoded URL payload is too large.')
  }
  return decoded
}

module.exports = { DEEP_LINK_LIMITS, decodeBase64Utf8, decodeUrlBase64, encodeBase64Utf8 }
