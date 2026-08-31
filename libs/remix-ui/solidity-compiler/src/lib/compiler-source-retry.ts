type RetryWait = (delayMs: number) => Promise<void>
type RetryPredicate = (error: unknown) => boolean

const defaultWait: RetryWait = (delayMs) => new Promise(resolve => window.setTimeout(resolve, delayMs))

/**
 * Retry a compiler-source request a finite number of times.
 *
 * The caller owns the per-attempt network timeout. This helper only adds the
 * configured retry count and never retries an error rejected by shouldRetry,
 * so an unavailable source cannot leave the compiler panel waiting forever.
 */
export async function withBoundedRetries<T> (
  operation: () => Promise<T>,
  retries: number,
  shouldRetry: RetryPredicate = () => true,
  wait: RetryWait = defaultWait,
  retryDelayMs = 250
): Promise<T> {
  const boundedRetries = Number.isSafeInteger(retries) && retries > 0 ? retries : 0

  for (let attempt = 0; attempt <= boundedRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (attempt === boundedRetries || !shouldRetry(error)) throw error
      if (retryDelayMs > 0) await wait(retryDelayMs)
    }
  }

  throw new Error('Compiler source retry loop exited unexpectedly')
}
