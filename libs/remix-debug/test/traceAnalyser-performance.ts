import tape from 'tape'
import { TraceAnalyser } from '../src/trace/traceAnalyser'

tape('TraceAnalyser slices only the requested memory words', (t) => {
  const analyser = new TraceAnalyser({} as any)
  const memory: any = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)]
  memory.join = () => { throw new Error('the full memory snapshot must not be joined') }

  t.equal(analyser.sliceMemory(memory, 60, 12), 'aaaa' + 'bbbbbbbb', 'a range spanning two words is copied correctly')
  t.equal(analyser.sliceMemory(memory, 128, 64), 'c'.repeat(64), 'a range uses only the requested word')
  t.end()
})
