'use strict'
import tape from 'tape'
import { assertWorkspaceWriteGuard, createWorkspaceCapabilityMatrix } from '../src/workspace/workspaceCapabilities'

tape('workspaceCapabilities marks high-risk writes and missing capabilities', function (t) {
  t.plan(5)

  const matrix = createWorkspaceCapabilityMatrix({ replace: { status: 'unsupported' } })
  t.equal(matrix.capabilities.length >= 13, true)
  t.equal(matrix.missing.includes('replace'), true)
  t.equal(matrix.highRisk.includes('delete'), true)

  const replace = matrix.capabilities.find((capability) => capability.name === 'replace')!
  t.equal(assertWorkspaceWriteGuard(replace).length, 0)

  const unsafeDelete = { ...matrix.capabilities.find((capability) => capability.name === 'delete')!, requiresConfirmation: false, rollbackRequired: false }
  t.equal(assertWorkspaceWriteGuard(unsafeDelete).length, 2)
})
