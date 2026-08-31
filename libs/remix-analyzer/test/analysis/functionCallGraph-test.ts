import test from 'tape'
import { analyseCallGraph, resolveCallGraphSymbol } from '../../src/solidity-analyzer/modules/functionCallGraph'
import { getCompilerVersion } from '../../src/solidity-analyzer/modules/staticAnalysisCommon'

const functionGraph = (calls: string[] = [], relevantNodes: any[] = []) => ({
  node: { relevantNodes },
  calls
})

test('function call graph does not mutate inheritance order', function (t) {
  t.plan(3)
  const inheritsFrom = ['BaseA', 'BaseB']
  const graph: any = {
    Child: { contract: { inheritsFrom }, functions: {} },
    BaseA: { contract: { inheritsFrom: [] }, functions: { 'BaseA.value': functionGraph() } },
    BaseB: { contract: { inheritsFrom: [] }, functions: { 'BaseB.value': functionGraph() } }
  }

  t.equal(resolveCallGraphSymbol(graph, 'Child.value').node, graph.BaseB.functions['BaseB.value'].node)
  t.deepEqual(inheritsFrom, ['BaseA', 'BaseB'])
  t.equal(resolveCallGraphSymbol(graph, 'Child.value').node, graph.BaseB.functions['BaseB.value'].node)
})

test('function call graph treats a pure recursion cycle as neutral', function (t) {
  t.plan(1)
  const graph: any = {
    A: { contract: { inheritsFrom: [] }, functions: { 'A.start': functionGraph(['B.next']) } },
    B: { contract: { inheritsFrom: [] }, functions: { 'B.next': functionGraph(['A.start']) } }
  }

  t.equal(analyseCallGraph(graph, 'A.start', {} as any, () => false), false)
})

test('compiler version lookup fails closed to latest on malformed metadata', function (t) {
  t.plan(3)
  t.equal(getCompilerVersion({}), 'latest')
  t.equal(getCompilerVersion({ 'A.sol': { A: { metadata: '{' } } } as any), 'latest')
  t.equal(getCompilerVersion({ 'A.sol': { A: { metadata: JSON.stringify({ compiler: { version: '0.8.25+commit.test' } }) } } } as any), 'v0.8.25')
})
