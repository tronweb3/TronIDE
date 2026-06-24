// tape entry point for remix-solidity unit tests (run via `npm test` in this
// package, or wire remix-solidity into the root `test:libs` nx target). Mirrors
// the remix-lib convention: plain <name>.ts files aggregated here, so none match
// the root jest `*.{spec,test}.{ts,js}` glob and they're run by tape only.
require('./runs.ts')
require('./optimize.ts')
require('./evm-version.ts')
