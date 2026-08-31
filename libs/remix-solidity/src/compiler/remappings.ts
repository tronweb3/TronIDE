/*
 * Copyright © 2026 TronIDE
 * Licensed under the Apache License, Version 2.0.
 */

'use strict'

/** Parse a remappings.txt file into Solidity Standard JSON remappings. */
export const parseRemappings = (content: string): string[] => {
  if (typeof content !== 'string') return []

  return content
    .split(/\r?\n/)
    .map((remapping) => remapping.trim())
    .filter(Boolean)
}
