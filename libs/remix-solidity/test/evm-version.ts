import * as tape from 'tape'
import { normalizeEvmVersion } from '../src/compiler/evm-version'

tape('normalizeEvmVersion allowlists only the tron target', (t) => {
  t.equal(normalizeEvmVersion('tron'), 'tron', 'tron')
  t.equal(normalizeEvmVersion('TRON'), 'tron', 'case-insensitive')
  t.equal(normalizeEvmVersion(' Tron '), 'tron', 'trimmed')
  // anything not 'tron' -> null (solc default), so a crafted URL can't break compile
  for (const v of ['istanbul', 'shanghai', 'foo', '', '   ', 'undefined', 'null', undefined, null]) {
    t.equal(normalizeEvmVersion(v), null, `${JSON.stringify(v)} -> null`)
  }
  t.end()
})
