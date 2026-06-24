import * as tape from 'tape'
import { parseOptimizeParam } from '../src/compiler/optimize'

tape('parseOptimizeParam coerces the optimize param case-insensitively', (t) => {
  // truthy tokens (the bug: only lowercase "true" used to work)
  for (const v of ['true', 'TRUE', 'True', '1', 'yes', 'on', ' true ']) {
    t.equal(parseOptimizeParam(v), true, `${JSON.stringify(v)} -> true`)
  }
  // falsy tokens
  for (const v of ['false', 'FALSE', '0', 'no', 'off']) {
    t.equal(parseOptimizeParam(v), false, `${JSON.stringify(v)} -> false`)
  }
  // unrecognised / absent -> null (caller keeps its own default)
  for (const v of ['', '   ', 'maybe', '2', undefined, null]) {
    t.equal(parseOptimizeParam(v), null, `${JSON.stringify(v)} -> null`)
  }
  t.end()
})
