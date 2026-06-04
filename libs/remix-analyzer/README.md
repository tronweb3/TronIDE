## Remix Analyzer

`@remix-project/remix-analyzer` is a tool to perform static analysis on Solidity smart contracts to check security vulnerabilities and bad development practices. It works underneath Remix IDE "SOLIDITY STATIC ANALYSIS" plugin which is used to run analysis for a compiled contract according to selected modules.

### How to use

`@remix-project/remix-analyzer` exports below interface:

```
import { CompilationResult, AnalyzerModule, AnalysisReport } from 'types';
declare type ModuleObj = {
    name: string;
    mod: AnalyzerModule;
};
export default class staticAnalysisRunner {
    /**
     * Run analysis (Used by IDE)
     * @param compilationResult contract compilation result
     * @param toRun module indexes (compiled from remix IDE)
     * @param callback callback
     */
    run(compilationResult: CompilationResult, toRun: number[], callback: ((reports: AnalysisReport[]) => void)): void;
    
    /**
     * Run analysis passing list of modules to run
     * @param compilationResult contract compilation result
     * @param modules analysis module
     * @param callback callback
     */
    runWithModuleList(compilationResult: CompilationResult, modules: ModuleObj[], callback: ((reports: AnalysisReport[]) => void)): void;
    
    /**
     * Get list of all analysis modules
     */
    modules(): any[];
}
```

### License
This project contains code from the original MIT-licensed project:

MIT © 2018-21 Remix Team

New modifications and additions are licensed under the Apache License 2.0.

