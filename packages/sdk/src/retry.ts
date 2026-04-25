export interface RetryOptions {
  signal?: AbortSignal;
}

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
  await sleep(delayMs, opts.signal);
  return doFetch();
}

function parseRetryAfter(value: string): number | null {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    const delta = date - Date.now();
    return delta > 0 ? delta : 0;
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
