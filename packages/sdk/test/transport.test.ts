import { describe, expect, it, vi } from 'vitest';
import Omnigraph, { ConfigurationError, NetworkError } from '../src';
import { Transport } from '../src/transport';
import { stubFetch } from './helpers';

describe('transport URL handling', () => {
  it('strips trailing slashes from baseUrl', async () => {
    const { fetch, calls } = stubFetch({ body: { branches: [] } });
    const og = new Omnigraph({ baseUrl: 'http://x///', graphId: 'g', fetch });
    await og.branches.list();
    expect(calls[0]?.url).toBe('http://x/graphs/g/branches');
  });

  it('preserves a non-slashed baseUrl', async () => {
    const { fetch, calls } = stubFetch({ body: { branches: [] } });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await og.branches.list();
    expect(calls[0]?.url).toBe('http://x/graphs/g/branches');
  });

  it('rejects paths missing a leading slash', async () => {
    const { fetch } = stubFetch({ body: {} });
    const t = new Transport({ baseUrl: 'http://x', graphId: 'g', fetch });
    await expect(t.request('GET', 'no-slash')).rejects.toThrow(
      /must start with '\/'/,
    );
  });

  it('omits null/undefined query params', async () => {
    const { fetch, calls } = stubFetch({ body: { commits: [] } });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await og.commits.list({ branch: undefined });
    expect(calls[0]?.url).toBe('http://x/graphs/g/commits');
  });

  it('appends array query values as repeated keys', async () => {
    const { fetch, calls } = stubFetch({ body: {} });
    const t = new Transport({ baseUrl: 'http://x', graphId: 'g', fetch });
    await t.request('GET', '/p', { query: { tag: ['a', 'b'] } });
    const u = new URL(calls[0]!.url);
    expect(u.searchParams.getAll('tag')).toEqual(['a', 'b']);
  });
});

describe('transport error handling', () => {
  it('wraps fetch failures as NetworkError with status 0', async () => {
    const failing = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof globalThis.fetch;
    const og = new Omnigraph({ baseUrl: 'http://x', fetch: failing });
    try {
      await og.health();
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NetworkError);
      expect((e as NetworkError).status).toBe(0);
      expect((e as NetworkError).message).toContain('transport failed');
      expect((e as NetworkError).request.method).toBe('GET');
    }
  });

  it('rethrows AbortError unchanged (does not wrap)', async () => {
    const aborted = vi.fn(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof globalThis.fetch;
    const og = new Omnigraph({ baseUrl: 'http://x', fetch: aborted });
    await expect(og.health()).rejects.toThrow(/aborted/);
    await expect(og.health()).rejects.not.toBeInstanceOf(NetworkError);
  });

  it('propagates AbortSignal to the underlying fetch', async () => {
    const ac = new AbortController();
    let received: AbortSignal | null = null;
    const captured = vi.fn(async (_input, init) => {
      received = init?.signal ?? null;
      return new Response('{}', {
        status: 200,
        headers: { 'Omnigraph-Http-Api': '0.13' },
      });
    }) as unknown as typeof globalThis.fetch;
    const og = new Omnigraph({ baseUrl: 'http://x', fetch: captured });
    await og.health({ signal: ac.signal });
    expect(received).toBe(ac.signal);
  });
});

describe('transport graphId prefixing', () => {
  it('prefixes /branches under /graphs/{graphId}', async () => {
    const { fetch, calls } = stubFetch({ body: { branches: [] } });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'alpha', fetch });
    await og.branches.list();
    expect(calls[0]?.url).toBe('http://x/graphs/alpha/branches');
  });

  it('prefixes /branches/{name} under /graphs/{graphId}', async () => {
    const { fetch, calls } = stubFetch({
      body: { actor_id: null, name: 'feature', uri: 's3://x' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'alpha', fetch });
    await og.branches.delete('feature');
    expect(calls[0]?.url).toBe('http://x/graphs/alpha/branches/feature');
  });

  it('prefixes /branches/merge under /graphs/{graphId}', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        actor_id: null,
        outcome: 'already_up_to_date',
        commit: null,
        source: 'a',
        target: 'b',
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'alpha', fetch });
    await og.branches.merge({ source: 'a', target: 'b' });
    expect(calls[0]?.url).toBe('http://x/graphs/alpha/branches/merge');
  });

  it('prefixes /commits and /commits/{id} under /graphs/{graphId}', async () => {
    const { fetch, calls } = stubFetch([
      { body: { commits: [] } },
      {
        body: {
          graph_commit_id: 'c1',
          graph_manifest_version: 1,
          created_at: 1,
          parent_commit_id: null,
          merged_parent_commit_id: null,
          graph_branch: null,
        },
      },
    ]);
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'alpha', fetch });
    await og.commits.list();
    await og.commits.retrieve('c1');
    expect(calls[0]?.url).toBe('http://x/graphs/alpha/commits');
    expect(calls[1]?.url).toBe('http://x/graphs/alpha/commits/c1');
  });

  it('prefixes /schema under /graphs/{graphId}', async () => {
    const { fetch, calls } = stubFetch({
      body: { schema_source: 'node Person { name: String @key }' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'alpha', fetch });
    await og.schema.get();
    expect(calls[0]?.url).toBe('http://x/graphs/alpha/schema');
  });

  it('prefixes /query, /mutate, /load, /snapshot, /export under /graphs/{graphId}', async () => {
    const loadBody = {
      actor_id: null,
      base_branch: 'main',
      branch: 'main',
      branch_created: false,
      mode: 'merge',
      nodes: [],
      edges: [],
      total_entities: 0,
      uri: 's3://x',
    };
    const { fetch, calls } = stubFetch([
      {
        body: {
          query_name: 'q',
          target: { branch: 'main' },
          rows: [],
          columns: [],
          row_count: 0,
          graph_commit_id: 'c1',
        },
      },
      {
        body: {
          branch: 'main',
          query_name: 'q',
          affected_nodes: 0,
          affected_edges: 0,
          commit: null,
        },
      },
      { body: loadBody },
      {
        body: {
          graph_branch: 'main',
          graph_manifest_version: 1,
          internal_schema_version: 6,
          datasets: [],
        },
      },
      { body: '', headers: { 'content-type': 'application/x-ndjson' } },
    ]);
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'alpha', fetch });
    await og.query({ query: 'query q() {}' });
    await og.mutate({ query: 'query q() {}' });
    await og.load({ branch: 'main', mode: 'merge', data: '{}\n' });
    await og.snapshot();
    for await (const _ of og.export({ branch: 'main' })) void _;
    expect(calls[0]?.url).toBe('http://x/graphs/alpha/query');
    expect(calls[1]?.url).toBe('http://x/graphs/alpha/mutate');
    expect(calls[2]?.url).toBe('http://x/graphs/alpha/load');
    expect(calls[3]?.url).toBe('http://x/graphs/alpha/snapshot');
    expect(calls[4]?.url).toBe('http://x/graphs/alpha/export');
  });

  it('never prefixes /healthz', async () => {
    const { fetch, calls } = stubFetch({
      body: { status: 'ok', version: '0.6.0' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'alpha', fetch });
    await og.health();
    expect(calls[0]?.url).toBe('http://x/healthz');
  });

  it('never prefixes /graphs', async () => {
    const { fetch, calls } = stubFetch({ body: { graphs: [] } });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'alpha', fetch });
    await og.graphs.list();
    expect(calls[0]?.url).toBe('http://x/graphs');
  });

  it('encodes special characters in graphId', async () => {
    const { fetch, calls } = stubFetch({ body: { branches: [] } });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'a/b c', fetch });
    await og.branches.list();
    expect(calls[0]?.url).toBe('http://x/graphs/a%2Fb%20c/branches');
  });

  it('throws ConfigurationError for a graph-scoped op when graphId is undefined', async () => {
    const { fetch, calls } = stubFetch({ body: { branches: [] } });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    await expect(og.branches.list()).rejects.toBeInstanceOf(ConfigurationError);
    await expect(og.branches.list()).rejects.toThrow(/graphId is required/);
    // The guard fires before any network call.
    expect(calls.length).toBe(0);
  });

  it('allows flat management ops (/healthz, /graphs) without a graphId', async () => {
    const { fetch, calls } = stubFetch([
      { body: { status: 'ok', version: '0.7.0' } },
      { body: { graphs: [] } },
    ]);
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    await og.health();
    await og.graphs.list();
    expect(calls[0]?.url).toBe('http://x/healthz');
    expect(calls[1]?.url).toBe('http://x/graphs');
  });
});

describe('transport bearer auth', () => {
  it('attaches Authorization header when token is set', async () => {
    const { fetch, calls } = stubFetch({ body: { branches: [] } });
    const og = new Omnigraph({
      baseUrl: 'http://x',
      token: 'tok-1',
      graphId: 'g',
      fetch,
    });
    await og.branches.list();
    expect(calls[0]?.headers['authorization']).toBe('Bearer tok-1');
  });

  it('omits Authorization header when token is unset', async () => {
    const { fetch, calls } = stubFetch({ body: { branches: [] } });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await og.branches.list();
    expect(calls[0]?.headers['authorization']).toBeUndefined();
  });
});

describe('0.13 contract admission', () => {
  it('refuses a mismatched discovery before sending data or credentials', async () => {
    const calls: RequestInit[] = [];
    const fetch = vi.fn(async (_url, init) => {
      calls.push(init!);
      return new Response(null, { headers: { 'Omnigraph-Http-Api': '0.12' } });
    }) as typeof globalThis.fetch;
    const og = new Omnigraph({
      baseUrl: 'http://x',
      token: 'secret',
      graphId: 'g',
      fetch,
    });
    await expect(og.mutate({ query: 'mutate m() {}' })).rejects.toMatchObject({
      code: 'api_contract_mismatch',
      requestDispatched: false,
      outcomeUnknown: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('HEAD');
    expect(new Headers(calls[0]?.headers).has('authorization')).toBe(false);
  });

  it('does not expose a response body from a backend with a changed contract', async () => {
    const fetch = vi.fn(
      async (_url, init) =>
        new Response(init?.method === 'HEAD' ? null : '{"commit":null}', {
          headers: {
            'Omnigraph-Http-Api': init?.method === 'HEAD' ? '0.13' : '0.12',
          },
        }),
    ) as typeof globalThis.fetch;
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await expect(og.mutate({ query: 'mutate m() {}' })).rejects.toMatchObject({
      code: 'api_contract_mismatch',
      requestDispatched: true,
      outcomeUnknown: true,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('0.13 transport boundaries', () => {
  const header = { 'Omnigraph-Http-Api': '0.13' };
  const root = 'https://host.example/proxy/graphs/prefix';

  it('probes the configured proxy root before every protected call without credentials', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetch: typeof globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(init?.method === 'HEAD' ? null : '{"branches":[]}', {
        headers: header,
      });
    };
    const og = new Omnigraph({
      baseUrl: root,
      graphId: 'my graph',
      token: 'secret',
      fetch,
    });
    await og.branches.list();
    await og.branches.list();
    expect(calls.map((c) => c.url)).toEqual([
      root + '/healthz',
      root + '/graphs/my%20graph/branches',
      root + '/healthz',
      root + '/graphs/my%20graph/branches',
    ]);
    for (const [index, call] of calls.entries()) {
      const headers = new Headers(call.init?.headers);
      expect(call.init?.redirect).toBe('manual');
      expect(headers.get('authorization')).toBe(
        index % 2 ? 'Bearer secret' : null,
      );
      expect(headers.get('Omnigraph-Http-Api')).toBe('0.13');
    }
  });

  it.each(['', '0.12', '0.13, 0.13', '0.13, 0.12'])(
    'rejects discovery contract %j before a data request',
    async (value) => {
      const fetch = vi.fn(
        async () =>
          new Response(null, {
            headers: value ? { 'Omnigraph-Http-Api': value } : {},
          }),
      );
      const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
      await expect(og.mutate({ query: 'mutate m() {}' })).rejects.toMatchObject(
        { requestDispatched: false, outcomeUnknown: false },
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([302, 401, 503])(
    'rejects discovery status %s even with a correct header',
    async (status) => {
      const fetch = vi.fn(
        async () =>
          new Response(null, {
            status,
            headers: { ...header, Location: 'https://other.example/' },
          }),
      );
      const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
      await expect(og.branches.list()).rejects.toMatchObject({
        requestDispatched: false,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('bounds discovery and classifies a timeout before dispatch', async () => {
    const deadline = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(deadline.signal);
    try {
      const fetch = vi.fn(
        async (_url, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(init.signal?.reason),
            );
          }),
      );
      const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
      const call = expect(
        og.mutate({ query: 'mutate m() {}' }),
      ).rejects.toMatchObject({
        requestDispatched: false,
        outcomeUnknown: false,
      });
      expect(timeout).toHaveBeenCalledWith(5_000);
      deadline.abort(new DOMException('timed out', 'TimeoutError'));
      await call;
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      timeout.mockRestore();
    }
  });

  it.each(['query', 'mutate'] as const)(
    'reports transport uncertainty for %s without replay',
    async (method) => {
      const fetch = vi.fn(async (_url, init?: RequestInit) => {
        if (init?.method === 'HEAD')
          return new Response(null, { headers: header });
        throw new Error('connection lost: token=secret');
      });
      const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
      await expect(
        og[method]({ query: `${method} q() {}` }),
      ).rejects.toMatchObject({
        requestDispatched: true,
        outcomeUnknown: method === 'mutate',
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it('marks cancellation after write dispatch uncertain', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async (_url, init?: RequestInit) => {
      if (init?.method === 'HEAD')
        return new Response(null, { headers: header });
      controller.abort();
      throw controller.signal.reason;
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await expect(
      og.mutate({ query: 'mutate m() {}' }, { signal: controller.signal }),
    ).rejects.toMatchObject({ requestDispatched: true, outcomeUnknown: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['', 'not json'])(
    'does not acknowledge a write from an invalid body %j',
    async (body) => {
      const fetch: typeof globalThis.fetch = async (_url, init) =>
        new Response(init?.method === 'HEAD' ? null : body, {
          headers: header,
        });
      const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
      await expect(og.mutate({ query: 'mutate m() {}' })).rejects.toMatchObject(
        { requestDispatched: true, outcomeUnknown: true },
      );
    },
  );

  it.each(['blob', 'export', 'error'] as const)(
    'checks the contract before exposing %s content',
    async (kind) => {
      let cancelled = false;
      const fetch: typeof globalThis.fetch = async (_url, init) => {
        if (init?.method === 'HEAD')
          return new Response(null, { headers: header });
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          {
            status: kind === 'error' ? 503 : 200,
            headers: { 'Omnigraph-Http-Api': '0.12' },
          },
        );
      };
      const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
      const call =
        kind === 'blob'
          ? og.blobs.get({
              entity: 'node',
              type: 'Document',
              id: 'id',
              property: 'file',
            })
          : kind === 'export'
            ? og.export()[Symbol.asyncIterator]().next()
            : og.branches.list();
      await expect(call).rejects.toMatchObject({
        code: 'api_contract_mismatch',
        requestDispatched: true,
        outcomeUnknown: false,
      });
      expect(cancelled).toBe(true);
    },
  );

  it.each([
    'https://alice:secret@host/',
    'https://host/?token=secret',
    'https://host/#fragment',
    'file:///tmp/graph',
  ])('refuses invalid server root %s before any request', (baseUrl) => {
    const fetch = vi.fn();
    expect(() => new Omnigraph({ baseUrl, fetch })).toThrow(ConfigurationError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('write error certainty', () => {
  it.each([400, 409, 429, 503])(
    'marks malformed HTTP %s responses uncertain',
    async (status) => {
      const { fetch, calls } = stubFetch({ status, body: '{"error":' });
      const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
      await expect(og.mutate({ query: 'mutate m() {}' })).rejects.toMatchObject(
        { status, requestDispatched: true, outcomeUnknown: true },
      );
      expect(calls).toHaveLength(1);
    },
  );

  it('does not infer definite refusal solely from a service_unavailable code', async () => {
    const { fetch } = stubFetch({
      status: 503,
      body: { error: 'operation closed', code: 'service_unavailable' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await expect(og.mutate({ query: 'mutate m() {}' })).rejects.toMatchObject({
      outcomeUnknown: true,
    });
  });

  it('exposes a complete admission refusal and Retry-After without retrying', async () => {
    const { fetch, calls } = stubFetch({
      status: 429,
      body: { error: 'capacity full', code: 'too_many_requests' },
      headers: { 'Retry-After': '2' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await expect(og.mutate({ query: 'mutate m() {}' })).rejects.toMatchObject({
      outcomeUnknown: false,
      retryAfter: '2',
    });
    expect(calls).toHaveLength(1);
  });
});
