const assert = require('assert')
const { searchWorkspaceFiles, createWorkspaceReplacePreview, matchesGlob } = require('../../src/app/search/workspace-search')

const files = [
  { path: 'README.txt', content: 'Storage in docs' },
  { path: 'scripts/deploy.js', content: 'const value = "Transfer"\n// TODO deploy transfer' },
  { path: 'contracts/1_Storage.sol', content: 'contract Storage {\n  uint256 value;\n  function store(uint256 num) public { value = num; }\n  function transfer(address to) public {}\n  function transferFrom(address from) public {}\n}' },
  { path: 'contracts/2_Owner.sol', content: 'contract Owner {}' },
  { path: '.git/config', content: 'transfer hidden' },
  { path: 'artifacts/Storage.json', content: 'transfer artifact' }
]

const legacy = searchWorkspaceFiles(files, 'Storage')
assert.strictEqual(legacy.totalMatches, 1)
assert.strictEqual(legacy.fileMatches, 1)
assert.strictEqual(legacy.results[0].path, 'contracts/1_Storage.sol')
assert.strictEqual(legacy.results[0].line, 1)
assert.strictEqual(legacy.results[0].column, 10)
assert.strictEqual(legacy.groups[0].matchCount, 1)

const empty = searchWorkspaceFiles(files, '')
assert.strictEqual(empty.totalMatches, 0)
assert.strictEqual(empty.scannedFiles, 0)

const literal = searchWorkspaceFiles([{ path: 'contracts/A.sol', content: 'a.*b aXXb' }], { query: 'a.*b', includePattern: '*.sol' })
assert.strictEqual(literal.totalMatches, 1)
assert.strictEqual(literal.results[0].preview, 'a.*b aXXb')

const matchCase = searchWorkspaceFiles(files, { query: 'transfer', includePattern: '*.sol, *.js', matchCase: true })
assert.strictEqual(matchCase.totalMatches, 3)
assert.ok(matchCase.results.every((item) => item.preview.indexOf('Transfer') === -1))

const wholeWord = searchWorkspaceFiles(files, { query: 'transfer', includePattern: '*.sol', matchWholeWord: true })
assert.strictEqual(wholeWord.totalMatches, 1)
assert.ok(wholeWord.results[0].preview.includes('function transfer('))

const regex = searchWorkspaceFiles(files, { query: '^\\s*function\\s+(\\w+)', includePattern: 'contracts/**/*.sol', useRegex: true })
assert.strictEqual(regex.totalMatches, 3)
assert.strictEqual(regex.groups[0].path, 'contracts/1_Storage.sol')
assert.deepStrictEqual(regex.results[0].ranges[0], { start: 0, end: 16 })

const regexError = searchWorkspaceFiles(files, { query: '[abc', includePattern: '*.sol', useRegex: true })
assert.strictEqual(regexError.totalMatches, 0)
assert.strictEqual(regexError.error.type, 'regex')

const globError = searchWorkspaceFiles(files, { query: 'transfer', includePattern: '[bad' })
assert.strictEqual(globError.totalMatches, 0)
assert.strictEqual(globError.error.type, 'glob')

const includeExclude = searchWorkspaceFiles(files, {
  query: 'transfer',
  includePattern: '**/*.sol, **/*.js',
  excludePattern: '**/artifacts/**, .*/**/*'
})
assert.strictEqual(includeExclude.totalMatches, 4)
assert.ok(includeExclude.results.every((item) => item.path !== '.git/config'))
assert.ok(includeExclude.results.every((item) => item.path !== 'artifacts/Storage.json'))

const limited = searchWorkspaceFiles(files, { query: 'contract', includePattern: '*.sol', limits: { maxResults: 1 } })
assert.strictEqual(limited.totalMatches, 1)
assert.strictEqual(limited.truncated, true)
assert.ok(limited.warnings[0].includes('Search stopped'))

const replacePreview = createWorkspaceReplacePreview(files, { query: 'transfer', includePattern: '*.sol', matchWholeWord: true }, 'send')
assert.strictEqual(replacePreview.canApply, true)
assert.strictEqual(replacePreview.totalMatches, 1)
assert.strictEqual(replacePreview.updates.length, 1)
assert.ok(replacePreview.updates[0].content.includes('function send(address to)'))
assert.ok(replacePreview.updates[0].content.includes('function transferFrom(address from)'))

const replaceRegex = createWorkspaceReplacePreview(files, { query: 'function\\s+(transfer\\w*)', includePattern: '*.sol', useRegex: true }, 'function tron$1')
assert.strictEqual(replaceRegex.totalMatches, 2)
assert.ok(replaceRegex.updates[0].content.includes('function trontransfer(address to)'))
assert.ok(replaceRegex.updates[0].content.includes('function trontransferFrom(address from)'))

const largeWorkspaceFiles = Array.from({ length: 25 }, (_, index) => ({
  path: `contracts/large/Large${index}.sol`,
  content: `contract Large${index} { string constant marker = "TRONIDE_LARGE_TOKEN"; }`
})).concat([{ path: 'contracts/large/NoMatch.sol', content: 'contract NoMatch { string constant marker = "TRONIDE_OTHER_TOKEN"; }' }])
const largeWorkspaceSearch = searchWorkspaceFiles(largeWorkspaceFiles, { query: 'TRONIDE_LARGE_TOKEN', includePattern: 'contracts/**/*.sol' })
assert.strictEqual(largeWorkspaceSearch.totalMatches, 25)
assert.strictEqual(largeWorkspaceSearch.fileMatches, 25)
const largeWorkspaceReplace = createWorkspaceReplacePreview(largeWorkspaceFiles, { query: 'TRONIDE_LARGE_TOKEN', includePattern: 'contracts/**/*.sol' }, 'TRONIDE_LARGE_REPLACED')
assert.strictEqual(largeWorkspaceReplace.totalMatches, 25)
assert.strictEqual(largeWorkspaceReplace.updates.length, 25)
assert.ok(largeWorkspaceReplace.updates.every((update) => update.content.includes('TRONIDE_LARGE_REPLACED')))
assert.ok(largeWorkspaceFiles.find((file) => file.path.endsWith('NoMatch.sol')).content.includes('TRONIDE_OTHER_TOKEN'))

assert.strictEqual(matchesGlob('contracts/1_Storage.sol', 'contracts/**/*.sol'), true)
assert.strictEqual(matchesGlob('contracts/1_Storage.sol', '*.sol'), true)
assert.strictEqual(matchesGlob('.git/config', '.*/**/*'), true)
assert.strictEqual(matchesGlob('scripts/deploy.js', 'contracts/**/*.sol'), false)

console.log('workspace search tests passed')
