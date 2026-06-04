export const GITHUB_TOKEN_REDACTION = '[github-token-redacted]'

const TOKEN_PATTERNS = [
  /ghp_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /gho_[A-Za-z0-9_]{20,}/g,
  /ghu_[A-Za-z0-9_]{20,}/g,
  /ghs_[A-Za-z0-9_]{20,}/g,
  /ghr_[A-Za-z0-9_]{20,}/g,
  /([?&](?:access_token|token)=)[^&#\s]+/gi,
  /(Authorization:\s*(?:token|Bearer)\s+)[^\s]+/gi
]

export interface GitHubAuthPolicy {
  scopes: string[]
  allowPrivateRepos?: boolean
  allowGistPublish?: boolean
}

export interface GitHubAuthPolicyResult {
  ok: boolean
  missingScopes: string[]
  warnings: string[]
}

export interface GitHubImportPlan {
  owner: string
  repo: string
  branch?: string
  isPrivate: boolean
  requiresOAuth: boolean
  conflictPolicy: 'prompt' | 'replace' | 'merge' | 'cancel'
}

export interface GistPublishPlan {
  files: string[]
  isPublic: boolean
  requiresConfirmation: boolean
  warnings: string[]
}

export function redactGitHubSecrets (value: unknown): string {
  let output = value === undefined || value === null ? '' : String(value)
  TOKEN_PATTERNS.forEach((pattern) => {
    // Patterns without a capture group pass the match offset (a number) as the 2nd arg,
    // so only a string capture is a real prefix to preserve (e.g. "?token=", "Authorization: Bearer ").
    output = output.replace(pattern, (_match, prefix) => typeof prefix === 'string' ? `${prefix}${GITHUB_TOKEN_REDACTION}` : GITHUB_TOKEN_REDACTION)
  })
  return output
}

export function validateGitHubAuthPolicy (policy: GitHubAuthPolicy): GitHubAuthPolicyResult {
  const scopes = new Set(policy.scopes || [])
  const requiredScopes = new Set<string>()
  const warnings: string[] = []

  if (policy.allowPrivateRepos) requiredScopes.add('repo')
  if (policy.allowGistPublish) requiredScopes.add('gist')

  const missingScopes = Array.from(requiredScopes).filter((scope) => !scopes.has(scope))

  if (scopes.has('repo') && !policy.allowPrivateRepos) {
    warnings.push('repo scope is broader than needed for public repository import.')
  }

  return { ok: missingScopes.length === 0, missingScopes, warnings }
}

export function createGitHubImportPlan (input: Partial<GitHubImportPlan>): GitHubImportPlan {
  if (!input.owner || !input.repo) throw new Error('GitHub import requires owner and repo.')

  const isPrivate = Boolean(input.isPrivate)
  return {
    owner: input.owner,
    repo: input.repo,
    branch: input.branch,
    isPrivate,
    requiresOAuth: isPrivate,
    conflictPolicy: input.conflictPolicy || 'prompt'
  }
}

export function createGistPublishPlan (files: string[], isPublic = false): GistPublishPlan {
  const warnings: string[] = []
  const normalizedFiles = files.filter(Boolean)

  if (normalizedFiles.length === 0) warnings.push('No files selected for Gist publishing.')
  if (isPublic) warnings.push('Public Gists can be viewed by anyone with the link.')

  return {
    files: normalizedFiles,
    isPublic,
    requiresConfirmation: true,
    warnings
  }
}
