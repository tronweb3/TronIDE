export interface SearchReplaceMatch {
  file: string
  line: number
  column: number
  before: string
  after: string
}

export interface SearchReplacePlan {
  matches: SearchReplaceMatch[]
  changedFiles: string[]
  skippedFiles: Array<{ file: string, reason: string }>
  canApply: boolean
}

export interface WorkspaceFileSnapshot {
  path: string
  content: string
  version?: string | number
  readonly?: boolean
}

export interface ApplySearchReplaceResult {
  updates: Array<{ path: string, content: string, previousContent: string }>
  undo: Array<{ path: string, content: string }>
  conflicts: Array<{ path: string, reason: string }>
}

export function createSearchReplacePlan (
  files: WorkspaceFileSnapshot[],
  search: string | RegExp,
  replacement: string,
  options: { maxFileSize?: number, excludedPathPattern?: RegExp } = {}
): SearchReplacePlan {
  const matches: SearchReplaceMatch[] = []
  const changedFiles = new Set<string>()
  const skippedFiles: Array<{ file: string, reason: string }> = []
  const maxFileSize = options.maxFileSize || 1024 * 1024

  files.forEach((file) => {
    if (file.readonly) {
      skippedFiles.push({ file: file.path, reason: 'readonly' })
      return
    }
    if (file.content.length > maxFileSize) {
      skippedFiles.push({ file: file.path, reason: 'file too large' })
      return
    }
    if (options.excludedPathPattern && options.excludedPathPattern.test(file.path)) {
      skippedFiles.push({ file: file.path, reason: 'excluded path' })
      return
    }

    const lines = file.content.split('\n')
    lines.forEach((line, index) => {
      if (typeof search === 'string') {
        if (!search) return
        let start = 0
        while (line.indexOf(search, start) !== -1) {
          const column = line.indexOf(search, start)
          matches.push({ file: file.path, line: index + 1, column: column + 1, before: line, after: replaceAll(line, search, replacement) })
          changedFiles.add(file.path)
          start = column + search.length
        }
      } else {
        const regex = new RegExp(search.source, search.flags.includes('g') ? search.flags : `${search.flags}g`)
        let match: RegExpExecArray | null
        while ((match = regex.exec(line))) {
          matches.push({ file: file.path, line: index + 1, column: match.index + 1, before: line, after: replaceAll(line, search, replacement) })
          changedFiles.add(file.path)
          if (match[0] === '') regex.lastIndex++
        }
      }
    })
  })

  return { matches, changedFiles: Array.from(changedFiles), skippedFiles, canApply: matches.length > 0 }
}

export function applySearchReplacePlan (
  files: WorkspaceFileSnapshot[],
  search: string | RegExp,
  replacement: string,
  expectedVersions: Record<string, string | number | undefined> = {}
): ApplySearchReplaceResult {
  const updates: ApplySearchReplaceResult['updates'] = []
  const undo: ApplySearchReplaceResult['undo'] = []
  const conflicts: ApplySearchReplaceResult['conflicts'] = []

  files.forEach((file) => {
    if (Object.prototype.hasOwnProperty.call(expectedVersions, file.path) && expectedVersions[file.path] !== file.version) {
      conflicts.push({ path: file.path, reason: 'version changed' })
      return
    }

    const content = replaceAll(file.content, search, replacement)
    if (content !== file.content) {
      updates.push({ path: file.path, content, previousContent: file.content })
      undo.push({ path: file.path, content: file.content })
    }
  })

  return { updates, undo, conflicts }
}

function replaceAll (content: string, search: string | RegExp, replacement: string): string {
  if (typeof search === 'string') {
    if (!search) return content
    return content.split(search).join(replacement)
  }
  const regex = new RegExp(search.source, search.flags.includes('g') ? search.flags : `${search.flags}g`)
  return content.replace(regex, replacement)
}
