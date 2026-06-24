'use strict'

const DEFAULT_LIMITS = {
  maxFiles: 200,
  maxFileSize: 300 * 1024,
  maxResults: 1000,
  maxDurationMs: 1500,
  previewRadius: 40
}

const DEFAULT_INCLUDE_PATTERN = '*.sol, *.js'
const DEFAULT_EXCLUDE_PATTERN = '.*/**/*'

function searchWorkspaceFiles (files, queryOrOptions, options = {}) {
  const searchOptions = normalizeSearchOptions(queryOrOptions, options)
  const limits = Object.assign({}, DEFAULT_LIMITS, searchOptions.limits || {})
  const startedAt = Date.now()
  const normalizedQuery = typeof searchOptions.query === 'string' ? searchOptions.query.trim() : ''
  const results = []
  const groups = []
  const groupByPath = new Map()
  const warnings = []
  let scannedFiles = 0
  let skippedFiles = searchOptions.skippedFiles || 0
  let truncated = false

  if (!normalizedQuery) {
    return createResult({ results, groups, scannedFiles, skippedFiles, warnings, truncated, durationMs: 0 })
  }

  const globValidation = validateGlobPatterns(searchOptions.includePattern, searchOptions.excludePattern)
  if (globValidation) {
    return createResult({
      results,
      groups,
      scannedFiles,
      skippedFiles,
      warnings,
      truncated,
      durationMs: Date.now() - startedAt,
      error: globValidation
    })
  }

  const matcher = createMatcher(normalizedQuery, searchOptions)
  if (matcher.error) {
    return createResult({
      results,
      groups,
      scannedFiles,
      skippedFiles,
      warnings,
      truncated,
      durationMs: Date.now() - startedAt,
      error: matcher.error
    })
  }

  const sortedFiles = (files || []).slice().sort(sortSearchFiles)
  const includePatterns = parseGlobList(searchOptions.includePattern || DEFAULT_INCLUDE_PATTERN)
  const excludePatterns = parseGlobList(searchOptions.excludePattern || DEFAULT_EXCLUDE_PATTERN)

  for (const file of sortedFiles) {
    if (scannedFiles >= limits.maxFiles) {
      truncated = true
      warnings.push(`Search stopped after ${limits.maxFiles} files. Narrow your query or workspace.`)
      break
    }
    if (Date.now() - startedAt > limits.maxDurationMs) {
      warnings.push(`Search stopped after ${limits.maxDurationMs}ms. Narrow your query or workspace.`)
      break
    }

    const path = String(file.path || '')
    if (!matchesAnyGlob(path, includePatterns) || matchesAnyGlob(path, excludePatterns)) continue

    const content = typeof file.content === 'string' ? file.content : ''
    if (content.length > limits.maxFileSize) {
      skippedFiles++
      warnings.push(`Skipped ${path}: file is larger than ${limits.maxFileSize} bytes.`)
      continue
    }

    scannedFiles++
    const lines = content.split(/\r?\n/)
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex]
      const lineMatches = matcher.find(line)
      for (const range of lineMatches) {
        const preview = createPreview(line, range.start, range.end - range.start, limits.previewRadius)
        const match = {
          path,
          line: lineIndex + 1,
          column: range.start + 1,
          preview: preview.text,
          previewMatch: { start: preview.matchStart, length: preview.matchLength },
          ranges: [{ start: range.start, end: range.end }]
        }
        results.push(match)
        addGroupMatch(groups, groupByPath, path, match)
        if (results.length >= limits.maxResults) {
          truncated = true
          warnings.push(`Search stopped after ${limits.maxResults} matches. Narrow your query.`)
          return createResult({ results, groups, scannedFiles, skippedFiles, warnings, truncated, durationMs: Date.now() - startedAt })
        }
      }
    }
  }

  return createResult({ results, groups, scannedFiles, skippedFiles, warnings, truncated, durationMs: Date.now() - startedAt })
}

function createWorkspaceReplacePreview (files, queryOrOptions, replacement, options = {}) {
  const searchOptions = normalizeSearchOptions(queryOrOptions, options)
  const searchResult = searchWorkspaceFiles(files, searchOptions)
  if (searchResult.error) return Object.assign({}, searchResult, { replacement, updates: [], canApply: false })
  const updatesByPath = new Map()

  for (const file of files || []) {
    const path = String(file.path || '')
    if (!searchResult.groups.some((group) => group.path === path)) continue
    const content = typeof file.content === 'string' ? file.content : ''
    const nextContent = replaceContent(content, searchOptions.query, replacement, searchOptions)
    if (nextContent !== content) {
      updatesByPath.set(path, { path, content: nextContent, previousContent: content })
    }
  }

  return Object.assign({}, searchResult, {
    replacement,
    updates: Array.from(updatesByPath.values()),
    canApply: updatesByPath.size > 0 && searchResult.totalMatches > 0
  })
}

function normalizeSearchOptions (queryOrOptions, options) {
  if (queryOrOptions && typeof queryOrOptions === 'object' && !Array.isArray(queryOrOptions)) {
    return Object.assign({}, queryOrOptions, {
      limits: Object.assign({}, options || {}, queryOrOptions.limits || {})
    })
  }
  return Object.assign({}, options || {}, {
    query: queryOrOptions,
    limits: options || {}
  })
}

function createResult ({ results, groups, scannedFiles, skippedFiles, warnings, truncated, durationMs, error }) {
  return {
    results,
    groups,
    totalMatches: results.length,
    fileMatches: groups.length,
    scannedFiles,
    skippedFiles,
    warnings,
    truncated,
    durationMs,
    error
  }
}

function sortSearchFiles (a, b) {
  const aContracts = a.path && a.path.indexOf('contracts/') !== -1
  const bContracts = b.path && b.path.indexOf('contracts/') !== -1
  if (aContracts !== bContracts) return aContracts ? -1 : 1
  return String(a.path).localeCompare(String(b.path))
}

function createMatcher (query, options) {
  if (options.useRegex) {
    try {
      const flags = options.matchCase ? 'g' : 'gi'
      const regex = new RegExp(query, flags)
      return {
        find: (line) => findRegexMatches(line, regex)
      }
    } catch (error) {
      return { error: { type: 'regex', message: error.message || String(error) } }
    }
  }

  const needle = options.matchCase ? query : query.toLowerCase()
  return {
    find: (line) => findTextMatches(line, needle, query.length, options)
  }
}

function findRegexMatches (line, regex) {
  const matches = []
  regex.lastIndex = 0
  let match = regex.exec(line)
  while (match) {
    const text = match[0]
    const start = match.index
    const end = start + text.length
    if (end > start) matches.push({ start, end })
    regex.lastIndex = end > start ? regex.lastIndex : regex.lastIndex + 1
    match = regex.exec(line)
  }
  return matches
}

function findTextMatches (line, needle, length, options) {
  const haystack = options.matchCase ? line : line.toLowerCase()
  const matches = []
  let fromIndex = 0
  let index = haystack.indexOf(needle, fromIndex)
  while (index !== -1) {
    const end = index + length
    if (!options.matchWholeWord || isWholeWordMatch(line, index, end)) {
      matches.push({ start: index, end })
    }
    fromIndex = Math.max(end, index + 1)
    index = haystack.indexOf(needle, fromIndex)
  }
  return matches
}

function replaceContent (content, query, replacement, options = {}) {
  const normalizedQuery = typeof query === 'string' ? query.trim() : ''
  if (!normalizedQuery) return content
  if (options.useRegex) {
    const flags = options.matchCase ? 'g' : 'gi'
    return content.replace(new RegExp(normalizedQuery, flags), replacement)
  }
  const escapedQuery = escapeRegex(normalizedQuery)
  const boundary = options.matchWholeWord ? '\\b' : ''
  const flags = options.matchCase ? 'g' : 'gi'
  return content.replace(new RegExp(`${boundary}${escapedQuery}${boundary}`, flags), replacement)
}

function isWholeWordMatch (line, start, end) {
  return !isWordChar(line[start - 1]) && !isWordChar(line[end])
}

function isWordChar (char) {
  return Boolean(char && /[A-Za-z0-9_]/.test(char))
}

function addGroupMatch (groups, groupByPath, path, match) {
  let group = groupByPath.get(path)
  if (!group) {
    group = { path, matchCount: 0, matches: [] }
    groupByPath.set(path, group)
    groups.push(group)
  }
  group.matchCount++
  group.matches.push(match)
}

function createPreview (line, columnIndex, queryLength, radius) {
  const start = Math.max(0, columnIndex - radius)
  const end = Math.min(line.length, columnIndex + queryLength + radius)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < line.length ? '…' : ''
  const windowText = line.slice(start, end)
  const trimmedText = windowText.trim()
  const text = `${prefix}${trimmedText}${suffix}`
  // Offset of this match's start within the produced preview string, so the
  // renderer can highlight the exact occurrence this result was split from
  // (rather than the first occurrence on the line). Account for the leading
  // ellipsis and the whitespace stripped by trim().
  const leadingTrimmed = windowText.length - windowText.trimStart().length
  const rawOffset = prefix.length + (columnIndex - start) - leadingTrimmed
  const maxOffset = prefix.length + trimmedText.length
  const matchStart = Math.min(Math.max(rawOffset, prefix.length), maxOffset)
  const matchLength = Math.max(0, Math.min(queryLength, maxOffset - matchStart))
  return { text, matchStart, matchLength }
}

function parseGlobList (pattern) {
  return String(pattern || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function validateGlobPatterns (...patterns) {
  for (const patternList of patterns) {
    for (const pattern of parseGlobList(patternList)) {
      if (hasUnclosedBracket(pattern)) return { type: 'glob', message: 'Invalid glob pattern' }
    }
  }
  return null
}

function hasUnclosedBracket (pattern) {
  let open = false
  for (const char of pattern) {
    if (char === '[') open = true
    if (char === ']' && open) open = false
  }
  return open
}

function matchesAnyGlob (path, patterns) {
  if (!patterns.length) return true
  return patterns.some((pattern) => matchesGlob(path, pattern))
}

function matchesGlob (path, pattern) {
  const normalizedPath = normalizePath(path)
  const normalizedPattern = normalizePath(pattern)
  const pathParts = normalizedPath.split('/').filter(Boolean)
  const patternParts = normalizedPattern.split('/').filter(Boolean)

  if (patternParts.length === 1 && normalizedPattern.indexOf('/') === -1) {
    return matchSegment(pathParts[pathParts.length - 1] || normalizedPath, normalizedPattern)
  }
  return matchPathParts(pathParts, patternParts)
}

function normalizePath (path) {
  return String(path || '').replace(/^\/+/, '').replace(/\\/g, '/')
}

function matchPathParts (pathParts, patternParts) {
  if (!patternParts.length) return !pathParts.length
  const [patternPart, ...remainingPatterns] = patternParts
  if (patternPart === '**') {
    if (matchPathParts(pathParts, remainingPatterns)) return true
    return pathParts.length > 0 && matchPathParts(pathParts.slice(1), patternParts)
  }
  if (!pathParts.length) return false
  return matchSegment(pathParts[0], patternPart) && matchPathParts(pathParts.slice(1), remainingPatterns)
}

function matchSegment (segment, pattern) {
  let regexSource = ''
  for (const char of pattern) {
    if (char === '*') regexSource += '[^/]*'
    else if (char === '?') regexSource += '[^/]'
    else regexSource += escapeRegex(char)
  }
  return new RegExp(`^${regexSource}$`).test(segment)
}

function escapeRegex (value) {
  return String(value).replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
}

module.exports = {
  searchWorkspaceFiles,
  createWorkspaceReplacePreview,
  DEFAULT_LIMITS,
  DEFAULT_INCLUDE_PATTERN,
  DEFAULT_EXCLUDE_PATTERN,
  parseGlobList,
  matchesGlob
}
