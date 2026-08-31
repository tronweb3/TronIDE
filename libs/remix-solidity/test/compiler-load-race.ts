import * as tape from 'tape'
import { Compiler } from '../src/compiler/compiler'

const compilerAUrl = 'https://binaries.soliditylang.org/bin/soljson-v0.4.26+commit.4563c3fc.js'
const compilerBUrl = 'https://binaries.soliditylang.org/bin/soljson-v0.5.17+commit.d19bba13.js'
const disallowedCompilerUrl = 'https://attacker.example/soljson-v0.8.20.js'

function fakeSoljson (version: string) {
  return {
    _solidity_version: () => {},
    cwrap: (name: string) => {
      if (name === 'solidity_version') return () => version
      return () => ''
    }
  }
}

function installBrowserHarness () {
  const root: any = global as any
  const previous = {
    window: root.window,
    document: root.document,
    self: root.self,
    Worker: root.Worker
  }
  const scripts: any[] = []
  let timerId = 0
  const head: any = {
    appendChild: (script) => {
      script.parentNode = head
      scripts.push(script)
      return script
    },
    removeChild: (script) => {
      const index = scripts.indexOf(script)
      if (index !== -1) scripts.splice(index, 1)
      script.parentNode = null
      return script
    }
  }
  const fakeWindow: any = {
    location: {
      href: 'https://tronide.test/',
      origin: 'https://tronide.test',
      hash: '',
      search: ''
    },
    localStorage: { getItem: () => null },
    setInterval: () => ++timerId,
    clearInterval: () => {},
    setTimeout: () => ++timerId,
    clearTimeout: () => {}
  }
  const fakeDocument: any = {
    createElement: () => ({ parentNode: null, onload: null, onerror: null }),
    getElementsByTagName: (tag: string) => tag === 'head' ? [head] : []
  }
  root.window = fakeWindow
  root.document = fakeDocument
  root.self = fakeWindow
  root.Worker = undefined

  return {
    window: fakeWindow,
    scripts,
    restore: () => {
      for (const key of Object.keys(previous)) {
        if (previous[key] === undefined) delete root[key]
        else root[key] = previous[key]
      }
    }
  }
}

const flushAsyncImports = async () => {
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
}

tape('non-worker compiler load ignores a stale script that finishes after the latest request', (t) => {
  (async () => {
    const browser = installBrowserHarness()
    try {
      const compiler = new Compiler()
      const loadedVersions: string[] = []
      compiler.event.register('compilerLoaded', (version: string) => loadedVersions.push(version))

      await compiler.loadVersion(false, compilerAUrl)
      const scriptA = browser.scripts[0]
      await compiler.loadVersion(false, compilerBUrl)
      const scriptB = browser.scripts[0]

      t.equal(browser.scripts.length, 1, 'the superseded script is removed from the document')
      t.notEqual(scriptA, scriptB, 'the latest request owns a distinct script')

      const latestModule = fakeSoljson('0.5.17+commit.d19bba13.Emscripten.clang')
      browser.window.Module = latestModule
      scriptA.onload()
      await flushAsyncImports()
      t.equal(compiler.state.currentVersion, null, 'the late first script cannot publish its compiler')
      t.equal(browser.window.Module, latestModule, 'the stale callback cannot delete the latest script Module')

      scriptB.onload()
      await flushAsyncImports()

      t.equal(compiler.state.currentVersion, '0.5.17+commit.d19bba13.Emscripten.clang', 'the actual compiler matches the latest selection')
      t.deepEqual(loadedVersions, ['0.5.17+commit.d19bba13.Emscripten.clang'], 'only the latest request emits compilerLoaded')
      t.equal((compiler as any).pendingLoadHandles.size, 0, 'completed script load timers are released')
    } finally {
      browser.restore()
      t.end()
    }
  })().catch((error) => {
    t.fail(error && error.stack ? error.stack : String(error))
    t.end()
  })
})

tape('a rejected compiler URL does not cancel the current non-worker load', (t) => {
  (async () => {
    const browser = installBrowserHarness()
    try {
      const compiler = new Compiler()
      await compiler.loadVersion(false, compilerAUrl)
      const allowedScript = browser.scripts[0]

      await compiler.loadVersion(false, disallowedCompilerUrl)
      t.equal(browser.scripts[0], allowedScript, 'the allowed in-flight script remains attached')

      browser.window.Module = fakeSoljson('0.4.26+commit.4563c3fc.Emscripten.clang')
      allowedScript.onload()
      await flushAsyncImports()
      t.equal(compiler.state.currentVersion, '0.4.26+commit.4563c3fc.Emscripten.clang', 'the existing compiler can still finish loading')
    } finally {
      browser.restore()
      t.end()
    }
  })().catch((error) => {
    t.fail(error && error.stack ? error.stack : String(error))
    t.end()
  })
})

tape('a rejected compiler URL does not terminate the current worker', (t) => {
  (async () => {
    const browser = installBrowserHarness()
    try {
      const compiler = new Compiler()
      let terminated = 0
      const activeWorker: any = { terminate: () => { terminated++ } }
      compiler.state.worker = activeWorker

      await compiler.loadVersion(true, disallowedCompilerUrl)

      t.equal(terminated, 0, 'the active worker is not terminated')
      t.equal(compiler.state.worker, activeWorker, 'the active worker remains selected')
    } finally {
      browser.restore()
      t.end()
    }
  })().catch((error) => {
    t.fail(error && error.stack ? error.stack : String(error))
    t.end()
  })
})

tape('a valid compiler switch invalidates the old compiler before async worker setup', (t) => {
  (async () => {
    const browser = installBrowserHarness()
    try {
      const compiler = new Compiler()
      let oldCompilerCalls = 0
      const oldCompile = () => { oldCompilerCalls++ }
      compiler.state.currentVersion = '0.4.26+commit.4563c3fc.Emscripten.clang'
      compiler.state.compileJSON = oldCompile

      let releaseWorkerSetup: () => void = () => {}
      compiler.workerHandler = undefined
      compiler.loadWorkerHandler = () => new Promise<void>((resolve) => { releaseWorkerSetup = resolve })
      const loading = compiler.loadVersion(true, compilerBUrl)

      t.equal(compiler.state.currentVersion, null, 'the old version is cleared synchronously')
      t.notEqual(compiler.state.compileJSON, oldCompile, 'the old compile function is replaced synchronously')
      compiler.state.compileJSON({ sources: { 'A.sol': { content: 'contract A {}' } } })
      t.equal(oldCompilerCalls, 0, 'compile during worker setup cannot run the old compiler')

      releaseWorkerSetup()
      await loading
    } finally {
      browser.restore()
      t.end()
    }
  })().catch((error) => {
    t.fail(error && error.stack ? error.stack : String(error))
    t.end()
  })
})

tape('a worker commit mismatch clears the unusable worker compile function', (t) => {
  (async () => {
    const browser = installBrowserHarness()
    try {
      const compiler = new Compiler()
      const listeners: Record<string, Function> = {}
      const posted: any[] = []
      let terminated = 0
      const worker: any = {
        addEventListener: (type: string, listener: Function) => { listeners[type] = listener },
        postMessage: (message) => posted.push(message),
        terminate: () => { terminated++ }
      }
      compiler.workerHandler = { getWorker: () => worker } as any

      await compiler.loadVersion(true, compilerBUrl)
      const postsBeforeMismatch = posted.length
      listeners.message({ data: { cmd: 'versionLoaded', data: '0.5.17+commit.aaaaaaaa.Emscripten.clang' } })

      t.equal(terminated, 1, 'the mismatched worker is terminated')
      t.equal(compiler.state.worker, null, 'the mismatched worker is detached')
      t.equal(compiler.state.currentVersion, null, 'the mismatched version is never published')
      compiler.state.compileJSON({ sources: { 'B.sol': { content: 'contract B {}' } } })
      t.equal(posted.length, postsBeforeMismatch, 'compile after mismatch cannot post to the rejected worker')
    } finally {
      browser.restore()
      t.end()
    }
  })().catch((error) => {
    t.fail(error && error.stack ? error.stack : String(error))
    t.end()
  })
})

tape('a non-worker commit mismatch is rejected even when semver matches', (t) => {
  (async () => {
    const browser = installBrowserHarness()
    try {
      const compiler = new Compiler()
      const failures: string[] = []
      compiler.event.register('compilerLoadFailed', (message: string) => failures.push(message))

      await compiler.loadVersion(false, compilerBUrl)
      const script = browser.scripts[0]
      browser.window.Module = fakeSoljson('0.5.17+commit.aaaaaaaa.Emscripten.clang')
      script.onload()
      await flushAsyncImports()

      t.equal(compiler.state.currentVersion, null, 'the wrong commit is never published')
      t.equal(compiler.state.worker, null, 'no compiler worker remains active')
      t.ok(failures[0] && failures[0].includes('does not match requested version 0.5.17+commit.d19bba13'), 'the failure identifies the expected commit')
    } finally {
      browser.restore()
      t.end()
    }
  })().catch((error) => {
    t.fail(error && error.stack ? error.stack : String(error))
    t.end()
  })
})

tape('an empty worker version payload fails closed instead of waiting forever', (t) => {
  (async () => {
    const browser = installBrowserHarness()
    try {
      const compiler = new Compiler()
      const listeners: Record<string, Function> = {}
      const posted: any[] = []
      let terminated = 0
      const worker: any = {
        addEventListener: (type: string, listener: Function) => { listeners[type] = listener },
        postMessage: (message) => posted.push(message),
        terminate: () => { terminated++ }
      }
      compiler.workerHandler = { getWorker: () => worker } as any

      await compiler.loadVersion(true, compilerBUrl)
      const postsBeforeFailure = posted.length
      listeners.message({ data: { cmd: 'versionLoaded', data: '' } })

      t.equal(terminated, 1, 'the versionless worker is terminated')
      t.equal(compiler.state.worker, null, 'the versionless worker is detached')
      t.equal(compiler.state.currentVersion, null, 'no compiler version is published')
      compiler.state.compileJSON({ sources: { 'B.sol': { content: 'contract B {}' } } })
      t.equal(posted.length, postsBeforeFailure, 'compile cannot post to the versionless worker')
    } finally {
      browser.restore()
      t.end()
    }
  })().catch((error) => {
    t.fail(error && error.stack ? error.stack : String(error))
    t.end()
  })
})

tape('non-worker compiler load ignores a stale wrapper resolution after a version switch', (t) => {
  (async () => {
    const browser = installBrowserHarness()
    try {
      const compiler = new Compiler()
      const loadedVersions: string[] = []
      compiler.event.register('compilerLoaded', (version: string) => loadedVersions.push(version))

      await compiler.loadVersion(false, compilerAUrl)
      const scriptA = browser.scripts[0]
      browser.window.Module = fakeSoljson('0.4.26+commit.4563c3fc.Emscripten.clang')
      scriptA.onload()

      // Switch before solc/wrapper's dynamic import resolves.
      await compiler.loadVersion(false, compilerBUrl)
      const scriptB = browser.scripts[0]
      browser.window.Module = fakeSoljson('0.5.17+commit.d19bba13.Emscripten.clang')
      scriptB.onload()
      await flushAsyncImports()

      t.equal(compiler.state.currentVersion, '0.5.17+commit.d19bba13.Emscripten.clang', 'the second compiler remains active')
      t.deepEqual(loadedVersions, ['0.5.17+commit.d19bba13.Emscripten.clang'], 'the stale wrapper cannot emit or overwrite state')
    } finally {
      browser.restore()
      t.end()
    }
  })().catch((error) => {
    t.fail(error && error.stack ? error.stack : String(error))
    t.end()
  })
})

tape('worker compiles fail closed until the version is ready and preserve the request target', (t) => {
  (async () => {
    const browser = installBrowserHarness()
    try {
      const compiler = new Compiler()
      const listeners: Record<string, Function> = {}
      const posted: any[] = []
      const worker: any = {
        addEventListener: (type: string, listener: Function) => { listeners[type] = listener },
        postMessage: (message) => posted.push(message),
        terminate: () => {}
      }
      compiler.workerHandler = { getWorker: () => worker } as any
      const finished: any[] = []
      compiler.event.register('compilationFinished', (success, data, source) => finished.push({ success, data, source }))

      await compiler.loadVersion(true, compilerBUrl)
      compiler.compile({ 'A.sol': { content: 'contract A {}' } }, 'A.sol')
      t.equal(posted.filter(message => message.cmd === 'compile').length, 0, 'compile before versionLoaded is not posted as a worker job')
      t.equal(finished.length, 0, 'compile before versionLoaded waits for the compiler instead of failing transiently')

      listeners.message({ data: { cmd: 'versionLoaded', data: '0.5.17+commit.d19bba13.Emscripten.clang' } })
      await flushAsyncImports()
      const compileMessage = posted.find(message => message.cmd === 'compile')
      t.equal(compileMessage.job, 0, 'the first ready compile receives a stable job id')
      listeners.message({ data: { cmd: 'compiled', job: compileMessage.job, data: JSON.stringify({ contracts: {} }) } })

      const last = finished[finished.length - 1]
      t.equal(last.success, true, 'the ready worker compile succeeds')
      t.equal(last.source.target, 'A.sol', 'the worker response preserves the request target')
      t.equal(compiler.state.lastCompilationResult.source.target, 'A.sol', 'lastCompilationResult uses the response target, not global state')
      t.equal((compiler as any).pendingLoadHandles.size, 0, 'completed worker load timer is released')

      compiler.compile({ 'A.sol': { content: 'contract A {}' } }, 'A.sol')
      const recycledCompile = posted.filter(message => message.cmd === 'compile').pop()
      t.equal(recycledCompile.job, 0, 'completed worker job ids are recycled instead of growing forever')
    } finally {
      browser.restore()
      t.end()
    }
  })().catch((error) => {
    t.fail(error && error.stack ? error.stack : String(error))
    t.end()
  })
})

tape('worker responses from superseded jobs cannot replace the latest artefact', (t) => {
  (async () => {
    const browser = installBrowserHarness()
    try {
      const compiler = new Compiler()
      const listeners: Record<string, Function> = {}
      const posted: any[] = []
      const worker: any = {
        addEventListener: (type: string, listener: Function) => { listeners[type] = listener },
        postMessage: (message) => posted.push(message),
        terminate: () => {}
      }
      compiler.workerHandler = { getWorker: () => worker } as any
      const targets: string[] = []
      compiler.event.register('compilationFinished', (success, data, source) => {
        if (success) targets.push(source.target)
      })
      await compiler.loadVersion(true, compilerBUrl)
      listeners.message({ data: { cmd: 'versionLoaded', data: '0.5.17+commit.d19bba13.Emscripten.clang' } })
      compiler.compile({ 'A.sol': { content: 'contract A {}' } }, 'A.sol')
      compiler.compile({ 'B.sol': { content: 'contract B {}' } }, 'B.sol')
      const compileMessages = posted.filter(message => message.cmd === 'compile')
      listeners.message({ data: { cmd: 'compiled', job: compileMessages[1].job, data: JSON.stringify({ contracts: {} }) } })
      listeners.message({ data: { cmd: 'compiled', job: compileMessages[0].job, data: JSON.stringify({ contracts: {} }) } })

      t.deepEqual(targets, ['B.sol'], 'a stale A response is discarded after B supersedes it')
      t.equal(compiler.state.lastCompilationResult.source.target, 'B.sol', 'the latest target owns lastCompilationResult')
    } finally {
      browser.restore()
      t.end()
    }
  })().catch((error) => {
    t.fail(error && error.stack ? error.stack : String(error))
    t.end()
  })
})

tape('worker rejects an unknown job without dereferencing an undefined entry', (t) => {
  (async () => {
    const browser = installBrowserHarness()
    try {
      const compiler = new Compiler()
      const listeners: Record<string, Function> = {}
      let terminated = 0
      const worker: any = {
        addEventListener: (type: string, listener: Function) => { listeners[type] = listener },
        postMessage: () => {},
        terminate: () => { terminated++ }
      }
      compiler.workerHandler = { getWorker: () => worker } as any
      const failures: string[] = []
      compiler.event.register('compilerLoadFailed', (message: string) => failures.push(message))
      await compiler.loadVersion(true, compilerBUrl)
      listeners.message({ data: { cmd: 'versionLoaded', data: '0.5.17+commit.d19bba13.Emscripten.clang' } })
      listeners.message({ data: { cmd: 'compiled', job: 99, data: '{}' } })

      t.equal(terminated, 1, 'the worker is terminated after an invalid job response')
      t.ok(failures.some(message => message.includes('unknown compilation job')), 'the failure explains the invalid job')
    } finally {
      browser.restore()
      t.end()
    }
  })().catch((error) => {
    t.fail(error && error.stack ? error.stack : String(error))
    t.end()
  })
})
