export type WorkspaceCapabilityName =
  | 'createFile'
  | 'createFolder'
  | 'openFile'
  | 'rename'
  | 'delete'
  | 'copy'
  | 'move'
  | 'backup'
  | 'restore'
  | 'importGitHub'
  | 'publishGist'
  | 'search'
  | 'replace'

export type WorkspaceCapabilityStatus = 'supported' | 'partial' | 'unsupported' | 'unknown'

export interface WorkspaceCapability {
  name: WorkspaceCapabilityName
  status: WorkspaceCapabilityStatus
  risk: 'low' | 'medium' | 'high'
  requiresConfirmation: boolean
  rollbackRequired: boolean
  notes?: string
}

export interface WorkspaceCapabilityMatrix {
  capabilities: WorkspaceCapability[]
  missing: WorkspaceCapabilityName[]
  highRisk: WorkspaceCapabilityName[]
}

const DEFAULT_CAPABILITIES: WorkspaceCapability[] = [
  { name: 'createFile', status: 'supported', risk: 'low', requiresConfirmation: false, rollbackRequired: false },
  { name: 'createFolder', status: 'supported', risk: 'low', requiresConfirmation: false, rollbackRequired: false },
  { name: 'openFile', status: 'supported', risk: 'low', requiresConfirmation: false, rollbackRequired: false },
  { name: 'rename', status: 'partial', risk: 'medium', requiresConfirmation: true, rollbackRequired: true },
  { name: 'delete', status: 'partial', risk: 'high', requiresConfirmation: true, rollbackRequired: true },
  { name: 'copy', status: 'partial', risk: 'medium', requiresConfirmation: false, rollbackRequired: true },
  { name: 'move', status: 'partial', risk: 'medium', requiresConfirmation: true, rollbackRequired: true },
  { name: 'backup', status: 'partial', risk: 'medium', requiresConfirmation: false, rollbackRequired: false },
  { name: 'restore', status: 'partial', risk: 'high', requiresConfirmation: true, rollbackRequired: true },
  { name: 'importGitHub', status: 'partial', risk: 'high', requiresConfirmation: true, rollbackRequired: true, notes: 'Token must be redacted and conflicts must be prompted.' },
  { name: 'publishGist', status: 'partial', risk: 'high', requiresConfirmation: true, rollbackRequired: false, notes: 'Public Gist requires explicit confirmation.' },
  { name: 'search', status: 'supported', risk: 'low', requiresConfirmation: false, rollbackRequired: false },
  { name: 'replace', status: 'partial', risk: 'high', requiresConfirmation: true, rollbackRequired: true, notes: 'Requires preview, conflict check and undo.' }
]

export function createWorkspaceCapabilityMatrix (overrides: Partial<Record<WorkspaceCapabilityName, Partial<WorkspaceCapability>>> = {}): WorkspaceCapabilityMatrix {
  const capabilities = DEFAULT_CAPABILITIES.map((capability) => ({
    ...capability,
    ...(overrides[capability.name] || {})
  }))

  return {
    capabilities,
    missing: capabilities.filter((capability) => capability.status === 'unsupported' || capability.status === 'unknown').map((capability) => capability.name),
    highRisk: capabilities.filter((capability) => capability.risk === 'high').map((capability) => capability.name)
  }
}

export function assertWorkspaceWriteGuard (capability: WorkspaceCapability): string[] {
  const errors: string[] = []
  const writeCapabilities: WorkspaceCapabilityName[] = ['rename', 'delete', 'copy', 'move', 'restore', 'importGitHub', 'replace']

  if (!writeCapabilities.includes(capability.name)) return errors
  if (!capability.rollbackRequired) errors.push(`${capability.name} requires a rollback or undo path.`)
  if (capability.risk === 'high' && !capability.requiresConfirmation) errors.push(`${capability.name} requires explicit confirmation.`)

  return errors
}
