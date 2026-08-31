/*
 * Modifications Copyright © 2026 TronIDE
 * Licensed under the Apache License, Version 2.0.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, test } from '@jest/globals'
import { compileFileOrFiles } from '../src/compiler'

describe('remix-tests compiler initialisation', () => {
  test('waits for the bundled compiler with the default configuration', (done) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tronide-remix-tests-'))
    const filename = path.join(directory, 'default_compiler_test.sol')
    fs.writeFileSync(filename, [
      '// SPDX-License-Identifier: UNLICENSED',
      'pragma solidity ^0.8.0;',
      'contract DefaultCompilerTest {',
      '  function checkCompilerLoads() public pure returns (bool) { return true; }',
      '}'
    ].join('\n'))

    compileFileOrFiles(filename, false, { accounts: ['0x0000000000000000000000000000000000000001'] }, undefined, (error, contracts) => {
      try {
        expect(error).toBeFalsy()
        expect(contracts[filename].DefaultCompilerTest).toBeDefined()
        done()
      } catch (assertionError) {
        done(assertionError)
      } finally {
        fs.unlinkSync(filename)
        fs.rmdirSync(directory)
      }
    })
  })
})
