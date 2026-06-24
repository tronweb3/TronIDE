/*
 * Coerce the `optimize` URL-hash / ConfigurationSettings param.
 *
 * It used to be compared with a strict, lowercase `=== 'true'`, so a shared
 * link like #optimize=TRUE or #optimize=1 silently disabled optimization (and
 * the hash was then rewritten to optimize=false). parseOptimizeParam accepts
 * the usual truthy/falsy tokens case-insensitively and returns null when the
 * value is absent/unrecognised so the caller can fall back to its own default.
 */
export function parseOptimizeParam (value: unknown): boolean | null {
  const token = String(value ?? '').trim().toLowerCase()
  if (token === 'true' || token === '1' || token === 'yes' || token === 'on') return true
  if (token === 'false' || token === '0' || token === 'no' || token === 'off') return false
  return null
}
