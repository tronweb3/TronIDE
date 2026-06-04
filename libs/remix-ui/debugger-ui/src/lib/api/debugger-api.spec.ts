import { DebuggerApiMixin } from './debugger-api'

jest.mock('@remix-project/remix-debug', () => {
  class TransactionDebugger {
    static instances: TransactionDebugger[] = []
    static nextGetTrace = jest.fn(async (hash) => ({ hash, source: 'primary-trace' }))

    debugger: { traceManager: { getTrace: jest.Mock } }
    options: any

    constructor (options) {
      this.options = options
      this.debugger = {
        traceManager: {
          getTrace: TransactionDebugger.nextGetTrace
        }
      }
      TransactionDebugger.instances.push(this)
    }
  }

  return {
    TransactionDebugger,
    init: {
      extendWeb3: jest.fn(),
      web3DebugNode: jest.fn(() => null)
    },
    traceHelper: {
      isContractCreation: jest.fn(() => false)
    }
  }
}, { virtual: true })

const remixDebug = require('@remix-project/remix-debug')

describe('DebuggerApiMixin getTrace runtime path', () => {
  beforeEach(() => {
    remixDebug.TransactionDebugger.instances.length = 0
    remixDebug.TransactionDebugger.nextGetTrace = jest.fn(async (hash) => ({ hash, source: 'primary-trace' }))
    remixDebug.init.extendWeb3.mockClear()
    remixDebug.init.web3DebugNode.mockClear()
  })

  function createApi (overrides: Partial<Record<string, any>> = {}) {
    class Base {}
    const Mixed = DebuggerApiMixin(Base)
    const api = new Mixed()
    const web3 = {
      eth: {
        getTransactionReceipt: jest.fn(async () => ({ transactionHash: '0xabc', to: '0x123' })),
        getCode: jest.fn(async () => '0x6000')
      },
      currentProvider: {
        sendAsync: jest.fn((payload, callback) => callback(null, { id: payload.id, jsonrpc: '2.0', result: { source: 'fallback-trace', structLogs: [{ pc: 1, op: 'STOP' }] } }))
      }
    }

    api.call = jest.fn(async (profile, method, ...args) => {
      if (profile === 'network' && method === 'detectNetwork') return { name: 'custom' }
      if (profile === 'fetchAndCompile' && method === 'resolve') return null
      throw new Error(`unexpected call ${profile}.${method} ${args.join(',')}`)
    })
    api.initDebuggerApi()
    api._web3 = web3

    Object.assign(api, overrides)
    return { api, web3 }
  }

  it('uses the primary debugger trace provider when the runtime path can retrieve a trace', async () => {
    const { api, web3 } = createApi()

    await expect(api.getTrace('0xabc')).resolves.toEqual({ hash: '0xabc', source: 'primary-trace' })

    expect(web3.eth.getTransactionReceipt).toHaveBeenCalledWith('0xabc')
    expect(remixDebug.TransactionDebugger.instances).toHaveLength(1)
    expect(remixDebug.TransactionDebugger.nextGetTrace).toHaveBeenCalledWith('0xabc')
    expect(remixDebug.init.extendWeb3).toHaveBeenCalledWith(web3)
  })

  it('keeps the debugger api usable after fallback so later traces can use the primary provider again', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const { api, web3 } = createApi()
    remixDebug.TransactionDebugger.nextGetTrace = jest.fn()
      .mockRejectedValueOnce(new Error('primary debug trace unavailable'))
      .mockResolvedValueOnce({ hash: '0xnext', source: 'primary-after-fallback' })

    await expect(api.getTrace('0xfallback')).resolves.toEqual({
      source: 'fallback-trace',
      structLogs: [{ pc: 1, op: 'STOP' }],
      runtimeTraceSource: 'debug-rpc-fallback',
      primaryTraceError: 'primary debug trace unavailable'
    })
    await expect(api.getTrace('0xnext')).resolves.toEqual({ hash: '0xnext', source: 'primary-after-fallback' })

    expect(web3.eth.getTransactionReceipt).toHaveBeenCalledWith('0xfallback')
    expect(web3.eth.getTransactionReceipt).toHaveBeenCalledWith('0xnext')
    expect(remixDebug.TransactionDebugger.nextGetTrace).toHaveBeenNthCalledWith(1, '0xfallback')
    expect(remixDebug.TransactionDebugger.nextGetTrace).toHaveBeenNthCalledWith(2, '0xnext')
    expect(web3.currentProvider.sendAsync).toHaveBeenCalledTimes(1)
    expect(web3.currentProvider.sendAsync).toHaveBeenCalledWith(
      { id: expect.any(Number), jsonrpc: '2.0', method: 'debug_traceTransaction', params: ['0xfallback', {}] },
      expect.any(Function)
    )
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
