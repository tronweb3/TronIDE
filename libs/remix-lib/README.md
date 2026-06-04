## Remix Lib
`@remix-project/remix-lib` is a common library to various remix tools. It is used in `remix-astwalker`, `remix-analyzer`, `remix-debug`, `remix-simulator`, `remix-solidity`, `remix-tests` libraries and in Remix IDE codebase.

### How to use

`@remix-project/remix-lib` exports:

```
{
    EventManager: EventManager,
    helpers: {
      ui: uiHelper,
      compiler: compilerHelper
    },
    vm: {
      Web3Providers: Web3Providers,
      DummyProvider: DummyProvider,
      Web3VMProvider: Web3VmProvider
    },
    Storage: Storage,
    util: util,
    execution: {
      EventsDecoder: EventsDecoder,
      txExecution: txExecution,
      txHelper: txHelper,
      executionContext: new ExecutionContext(),
      txFormat: txFormat,
      txListener: TxListener,
      txRunner: TxRunner,
      typeConversion: typeConversion
    },
    UniversalDApp: UniversalDApp
}
```

### License
This project contains code from the original MIT-licensed project:

MIT © 2018-21 Remix Team

New modifications and additions are licensed under the Apache License 2.0.