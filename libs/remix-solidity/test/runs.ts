import * as tape from 'tape'
import { normalizeRuns, DEFAULT_OPTIMIZER_RUNS, MIN_OPTIMIZER_RUNS, MAX_OPTIMIZER_RUNS } from '../src/compiler/runs'

tape('normalizeRuns sanitises the optimizer "runs" setting', (t) => {
  // valid passthrough
  t.equal(normalizeRuns('200'), 200, 'plain integer string')
  t.equal(normalizeRuns(1000), 1000, 'plain integer number')
  t.equal(normalizeRuns('1'), 1, 'minimum allowed')

  // #2: Number() parsing instead of parseInt (the silent-truncation bug)
  t.equal(normalizeRuns('1e3'), 1000, '"1e3" -> 1000 (was 1 under parseInt)')
  t.equal(normalizeRuns('0xff'), 255, 'hex literal parsed, not truncated to 0')
  t.equal(normalizeRuns('3.9'), 3, 'decimal floored')

  // #1: invalid / out-of-range no longer reaches solc
  t.equal(normalizeRuns('-1'), MIN_OPTIMIZER_RUNS, 'negative clamped to min')
  t.equal(normalizeRuns('0'), MIN_OPTIMIZER_RUNS, 'zero clamped to min')
  t.equal(normalizeRuns('99999999999999999999'), MAX_OPTIMIZER_RUNS, 'huge clamped to max')
  t.equal(normalizeRuns('abc'), DEFAULT_OPTIMIZER_RUNS, 'non-numeric -> default')
  t.equal(normalizeRuns('200abc'), DEFAULT_OPTIMIZER_RUNS, 'trailing garbage -> default')

  // empty / missing -> default (covers the URL-hash 'undefined'/'null' strings)
  t.equal(normalizeRuns(''), DEFAULT_OPTIMIZER_RUNS, 'empty string -> default')
  t.equal(normalizeRuns('   '), DEFAULT_OPTIMIZER_RUNS, 'whitespace -> default')
  t.equal(normalizeRuns(undefined), DEFAULT_OPTIMIZER_RUNS, 'undefined -> default')
  t.equal(normalizeRuns(null), DEFAULT_OPTIMIZER_RUNS, 'null -> default')
  t.equal(normalizeRuns('undefined'), DEFAULT_OPTIMIZER_RUNS, 'literal "undefined" -> default')
  t.equal(normalizeRuns('null'), DEFAULT_OPTIMIZER_RUNS, 'literal "null" -> default')

  // result is always a finite integer in range
  for (const v of ['1e3', '-5', '99999999999999999999', 'abc', '3.9', '']) {
    const r = normalizeRuns(v)
    t.ok(Number.isInteger(r) && r >= MIN_OPTIMIZER_RUNS && r <= MAX_OPTIMIZER_RUNS, `${JSON.stringify(v)} -> in-range integer ${r}`)
  }
  t.end()
})
