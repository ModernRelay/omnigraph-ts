import { vi } from 'vitest';
import { HTTP_API_CONTRACT, HTTP_API_CONTRACT_HEADER } from '../src';

/** Resource tests record application requests; transport tests exercise admission directly. */
export function withContract(
  fetch: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    if (init?.method === 'HEAD' && String(input).endsWith('/healthz'))
      return new Response(null, {
        headers: { [HTTP_API_CONTRACT_HEADER]: HTTP_API_CONTRACT },
      });
    const response = await fetch(input, init);
    response.headers.set(HTTP_API_CONTRACT_HEADER, HTTP_API_CONTRACT);
    return response;
  };
}

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
  const fn = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = init?.method ?? 'GET';
      const headers: Record<string, string> = {};
      new Headers(init?.headers ?? {}).forEach((v, k) => (headers[k] = v));
      let body: string | undefined;
      if (typeof init?.body === 'string') body = init.body;
      calls.push({ url, method, headers, body });
      const r: StubResponse = queue.shift() ?? { status: 200, body: {} };
      if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
      const status = r.status ?? 200;
      // The Response constructor throws if a body is supplied for 204/205/304.
      const isNullBody = status === 204 || status === 205 || status === 304;
      const responseBody = isNullBody
        ? null
        : typeof r.body === 'string'
          ? r.body
          : JSON.stringify(r.body ?? {});
      const responseHeaders = new Headers(r.headers ?? {});
      if (
        !isNullBody &&
        typeof r.body !== 'string' &&
        !responseHeaders.has('content-type')
      ) {
        responseHeaders.set('content-type', 'application/json');
      }
      return new Response(responseBody, { status, headers: responseHeaders });
    },
  );
  return {
    fetch: withContract(fn as unknown as typeof globalThis.fetch),
    calls,
  };
}
