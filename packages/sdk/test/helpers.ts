import { vi } from 'vitest';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface StubResponse {
  status?: number;
  body?: string | object;
  headers?: Record<string, string>;
  delayMs?: number;
}

export function stubFetch(responses: StubResponse[] | StubResponse) {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const calls: RecordedRequest[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((v, k) => (headers[k] = v));
    let body: string | undefined;
    if (typeof init?.body === 'string') body = init.body;
    calls.push({ url, method, headers, body });
    const r = queue.shift() ?? { status: 200, body: {} };
    if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
    const responseBody =
      typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {});
    const responseHeaders = new Headers(r.headers ?? {});
    if (typeof r.body !== 'string' && !responseHeaders.has('content-type')) {
      responseHeaders.set('content-type', 'application/json');
    }
    return new Response(responseBody, {
      status: r.status ?? 200,
      headers: responseHeaders,
    });
  });
  return { fetch: fn as unknown as typeof globalThis.fetch, calls };
}
