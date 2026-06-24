/*
 * Optimizer "runs" sanitisation.
 *
 * The runs value can arrive from three places that all used to feed solc raw:
 * the URL hash (#runs=...), the number input, and ConfigurationSettings. solc
 * requires an unsigned integer, so unvalidated values either broke compilation
 * outright (negative / huge -> "The 'runs' setting must be an unsigned number")
 * or were silently mangled by parseInt (e.g. "1e3" -> 1 instead of 1000).
 * normalizeRuns is the single coercion point: it always yields a positive
 * integer within solc-safe bounds.
 */

export const DEFAULT_OPTIMIZER_RUNS = 200
export const MIN_OPTIMIZER_RUNS = 1
// uint32 max — far beyond any practical use, and keeps the serialised solc
// setting a plain integer (values >= 1e21 would stringify with an exponent).
export const MAX_OPTIMIZER_RUNS = 4294967295

export function normalizeRuns (value: unknown): number {
  if (value === undefined || value === null || String(value).trim() === '') return DEFAULT_OPTIMIZER_RUNS
  // Number() (not parseInt) so "1e3" -> 1000 rather than 1; floor any decimal.
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return DEFAULT_OPTIMIZER_RUNS
  if (parsed < MIN_OPTIMIZER_RUNS) return MIN_OPTIMIZER_RUNS
  if (parsed > MAX_OPTIMIZER_RUNS) return MAX_OPTIMIZER_RUNS
  return parsed
}
