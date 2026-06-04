## Remix Debug`

`@remix-project/remix-debug` is a tool to debug Tron transactions on different Remix environments (VM, nile etc.). It works underneath Remix IDE "DEBUGGER" plugin which is used to analyse step-to-step executioon of a transaction to debug it.

### How to use

`@remix-project/remix-debug` can be used as:

```ts

var Debugger = require('remix-debug').EthDebugger
var BreakpointManager = require('remix-debug').BreakpointManager

var debugger = new Debugger({
  compilationResult: () => {
    return compilationResult // that helps resolving source location
  }
})

debugger.addProvider(web3, 'web3')
debugger.switchProvider('web3')

var breakPointManager = new remixCore.code.BreakpointManager(this.debugger, (sourceLocation) => {
    // return offsetToLineColumn
})
debugger.setBreakpointManager(breakPointManager)
breakPointManager.add({fileName, row})
breakPointManager.add({fileName, row})

debugger.debug(<tx_hash>)

// this.traceManager.getCurrentCalledAddressAt

debugger.event.register('newTraceLoaded', () => {
  // start doing basic stuff like retrieving step details
  debugger.traceManager.getCallStackAt(34, (error, callstack) => {})
})

debugger.callTree.register('callTreeReady', () => {
  // start doing more complex stuff like resolvng local variables
  breakPointManager.jumpNextBreakpoint(true)
  
  var storageView = debugger.storageViewAt(38, <contract address>, 
  storageView.storageSlot(0, (error, storage) => {})
  storageView.storageRange(error, storage) => {}) // retrieve 0 => 1000 slots

  debugger.extractStateAt(23, (error, state) => {
    debugger.decodeStateAt(23, state, (error, decodedState) => {})
  })
  
  debugger.sourceLocationFromVMTraceIndex(<contract address>, 23, (error, location) => {
    debugger.decodeLocalsAt(23, location, (error, decodedlocals) => {})
  })
  
  debugger.extractLocalsAt(23, (null, locals) => {})
  
})
```

It exports:

```javascript
{
  init,
  traceHelper,
  sourceMappingDecoder,
  EthDebugger,
  TransactionDebugger,
  BreakpointManager,
  SolidityDecoder,
  storage: {
    StorageViewer: StorageViewer,
    StorageResolver: StorageResolver
  },
  CmdLine
}
```

### License
This project contains code from the original MIT-licensed project:

MIT © 2018-21 Remix Team

New modifications and additions are licensed under the Apache License 2.0.

