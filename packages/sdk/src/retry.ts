interface RetryOptions {
  signal?: AbortSignal;
}

/** Cap on `Retry-After` server hints. A misconfigured or hostile server
 * returning `Retry-After: 31536000` (1 year) shouldn't wedge the SDK. */
const MAX_RETRY_AFTER_MS = 60_000;

export async function withRetryAfter(
  doFetch: () => Promise<Response>,
  opts: RetryOptions = {},
): Promise<Response> {
  const first = await doFetch();
  if (first.status !== 503) return first;
  const headerValue = first.headers.get('Retry-After');
  if (!headerValue) return first;
  const delayMs = parseRetryAfter(headerValue);
  if (delayMs === null) return first;
  // Drain/cancel the discarded response body so the underlying connection
  // can be reused or closed cleanly while we sleep.
  await first.body?.cancel().catch(() => {});
  await sleep(delayMs, opts.signal);
  return doFetch();
}

function parseRetryAfter(value: string): number | null {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }
  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    const delta = date - Date.now();
    if (delta <= 0) return 0;
    return Math.min(delta, MAX_RETRY_AFTER_MS);
  }
  return null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
