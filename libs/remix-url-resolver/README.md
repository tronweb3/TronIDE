## Remix Url Resolver

`@remix-project/remix-url-resolver` is a tool to handle import from different sources and resolve the content. It is used in Remix IDE to handle imports from `Github`, `Swarm`, `IPFS` and other URLs. 

### How to use

`@remix-project/remix-url-resolver` exports:

```

export declare class RemixURLResolver {
    private previouslyHandled;
    gistAccessToken: string;
    constructor(gistToken?: string);
    /**
    * Handle an import statement based on github
    * @param root The root of the github import statement
    * @param filePath path of the file in github
    */
    handleGithubCall(root: string, filePath: string): Promise<HandlerResponse>;
    /**
    * Handle an import statement based on http
    * @param url The url of the import statement
    * @param cleanUrl
    */
    handleHttp(url: string, cleanUrl: string): Promise<HandlerResponse>;
    /**
    * Handle an import statement based on https
    * @param url The url of the import statement
    * @param cleanUrl
    */
    handleHttps(url: string, cleanUrl: string): Promise<HandlerResponse>;
    handleSwarm(url: string, cleanUrl: string): Promise<HandlerResponse>;
    /**
    * Handle an import statement based on IPFS
    * @param url The url of the IPFS import statement
    */
    handleIPFS(url: string): Promise<HandlerResponse>;
    getHandlers(): Handler[];
    resolve(filePath: string, customHandlers?: Handler[]): Promise<Imported>;
}

```

**Usage**

`resolve(url, customHandlers)` function should be called from within `handleImportCb` function of `solc.compile(input, handleImportCb)`.

```ts
import { RemixURLResolver } from 'remix-url-resolver'

const urlResolver = new RemixURLResolver()
const fileName: string = '../greeter.sol'
urlResolver.resolve(fileName, urlHandler)
	.then((sources: object) => {
		console.log(sources)
	})
	.catch((e: Error) => {
		throw e
	})
```

#### References

* [TypeScript Publishing](http://www.typescriptlang.org/docs/handbook/declaration-files/publishing.html)
* [DefinitelyTyped 'Create a new package' guide](https://github.com/DefinitelyTyped/DefinitelyTyped#create-a-new-package)


### License
This project contains code from the original MIT-licensed project:

MIT © 2018-21 Remix Team

New modifications and additions are licensed under the Apache License 2.0.