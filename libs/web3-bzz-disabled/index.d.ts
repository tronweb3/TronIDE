declare class Bzz {
  givenProvider: null
  currentProvider: null
  setProvider(): boolean
  upload(): Promise<never>
  download(): Promise<never>
  pick(): Promise<never>
}

export = Bzz

