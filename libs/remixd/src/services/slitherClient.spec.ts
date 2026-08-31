import { EventEmitter } from 'events'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { SlitherClient, SlitherCommands } from './slitherClient'

const compilerCommits: Record<string, string> = {
  '0.8.2': '661d1103',
  '0.8.3': '8d00100c'
}

function createCommands () {
  const execFileSync = jest.fn((command: string, args: string[], options: any) => {
    if (command === 'solc') {
      const version = options.env.SOLC_VERSION
      return Buffer.from(`solc, Version: ${version}+commit.${compilerCommits[version]}\n`)
    }
    if (command === 'solc-select' && args[0] === 'versions') return Buffer.from('0.8.2\n0.8.3\n')
    if (command === 'solc-select' && args[0] === 'install') return Buffer.from('')
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
  })
  const spawn = jest.fn((_command: string, args: string[]) => {
    const outputFile = args[args.indexOf('--json') + 1]
    writeFileSync(outputFile, JSON.stringify({ success: true, results: { detectors: [] } }))
    const child = new EventEmitter() as any
    child.kill = jest.fn()
    process.nextTick(() => child.emit('close', 0))
    return child
  })
  return { execFileSync, spawn } as unknown as SlitherCommands
}

describe('SlitherClient compiler selection', () => {
  test('isolates concurrent compiler versions per Slither process', async () => {
    const sharedFolder = mkdtempSync(path.join(os.tmpdir(), 'tronide-slither-test-'))
    try {
      writeFileSync(path.join(sharedFolder, 'First.sol'), 'pragma solidity 0.8.2; contract First {}')
      writeFileSync(path.join(sharedFolder, 'Second.sol'), 'pragma solidity 0.8.3; contract Second {}')
      const commands = createCommands()
      const client = new SlitherClient(false, commands)
      client.sharedFolder(sharedFolder)

      await Promise.all([
        client.analyse('First.sol', { currentVersion: '0.8.2+commit.661d1103' }),
        client.analyse('Second.sol', { currentVersion: '0.8.3+commit.8d00100c' })
      ])

      const spawnCalls = (commands.spawn as jest.Mock).mock.calls
      expect(spawnCalls.map(call => call[2].env.SOLC_VERSION)).toEqual(['0.8.2', '0.8.3'])
      const execCalls = (commands.execFileSync as jest.Mock).mock.calls
      expect(execCalls.some(call => call[0] === 'solc-select' && call[1][0] === 'use')).toBe(false)
      expect(execCalls.filter(call => call[0] === 'solc').map(call => call[2].env.SOLC_VERSION)).toEqual(['0.8.2', '0.8.3'])
    } finally {
      rmSync(sharedFolder, { recursive: true, force: true })
    }
  })

  test('omits logical TRON target variants while preserving standard EVM versions', async () => {
    const sharedFolder = mkdtempSync(path.join(os.tmpdir(), 'tronide-slither-test-'))
    try {
      writeFileSync(path.join(sharedFolder, 'First.sol'), 'pragma solidity 0.8.2; contract First {}')
      writeFileSync(path.join(sharedFolder, 'Second.sol'), 'pragma solidity 0.8.3; contract Second {}')
      const commands = createCommands()
      const client = new SlitherClient(false, commands)
      client.sharedFolder(sharedFolder)

      await client.analyse('First.sol', { currentVersion: '0.8.2+commit.661d1103', evmVersion: ' TRON ' })
      await client.analyse('Second.sol', { currentVersion: '0.8.3+commit.8d00100c', evmVersion: 'istanbul' })

      const spawnCalls = (commands.spawn as jest.Mock).mock.calls
      const logicalTargetArgs = spawnCalls[0][1]
      expect(logicalTargetArgs).not.toContain('--solc-args')
      const standardTargetArgs = spawnCalls[1][1]
      const solcArgsIndex = standardTargetArgs.indexOf('--solc-args')
      expect(solcArgsIndex).toBeGreaterThan(-1)
      expect(standardTargetArgs[solcArgsIndex + 1]).toContain('--evm-version istanbul')
    } finally {
      rmSync(sharedFolder, { recursive: true, force: true })
    }
  })

  test('still rejects unsafe EVM version arguments', async () => {
    const sharedFolder = mkdtempSync(path.join(os.tmpdir(), 'tronide-slither-test-'))
    try {
      writeFileSync(path.join(sharedFolder, 'First.sol'), 'pragma solidity 0.8.2; contract First {}')
      const commands = createCommands()
      const client = new SlitherClient(false, commands)
      client.sharedFolder(sharedFolder)

      await expect(client.analyse('First.sol', {
        currentVersion: '0.8.2+commit.661d1103',
        evmVersion: 'tron;rm'
      })).rejects.toThrow('Invalid EVM version.')
      expect(commands.spawn).not.toHaveBeenCalled()
    } finally {
      rmSync(sharedFolder, { recursive: true, force: true })
    }
  })
})
