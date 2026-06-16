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
    await expect(t.request('GET', 'no-slash')).rejects.toThrow(/must start with '\/'/);
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
      expect((e as NetworkError).message).toBe('ECONNREFUSED');
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
      return new Response('{}', { status: 200 });
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
      body: { actor_id: null, outcome: 'fast_forward', source: 'a', target: 'b' },
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
          manifest_version: 1,
          parent_commit_id: null,
          merged_parent_commit_id: null,
          manifest_branch: null,
        },
      },
    ]);
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'alpha', fetch });
    await og.commits.list();
    await og.commits.retrieve('c1');
    expect(calls[0]?.url).toBe('http://x/graphs/alpha/commits');
    expect(calls[1]?.url).toBe('http://x/graphs/alpha/commits/c1');
  });

  it('prefixes /schema and /schema/apply under /graphs/{graphId}', async () => {
    const { fetch, calls } = stubFetch([
      { body: { schema_source: 'node Person { name: String @key }' } },
      { body: { applied: true, manifest_version: 1, steps: [], supported: true } },
    ]);
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'alpha', fetch });
    await og.schema.get();
    await og.schema.apply({ schemaSource: 'node Foo { id: String @key }' });
    expect(calls[0]?.url).toBe('http://x/graphs/alpha/schema');
    expect(calls[1]?.url).toBe('http://x/graphs/alpha/schema/apply');
  });

  it('prefixes /query, /mutate, /load, /snapshot, /export under /graphs/{graphId}', async () => {
    const loadBody = {
      actor_id: null,
      base_branch: 'main',
      branch: 'main',
      branch_created: false,
      mode: 'merge',
      tables: [],
      uri: 's3://x',
    };
    const { fetch, calls } = stubFetch([
      { body: { rows: [], columns: [] } },
      { body: { affected_nodes: 0, affected_edges: 0 } },
      { body: loadBody },
      { body: { branch: 'main', tables: [] } },
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
    const { fetch, calls } = stubFetch({ body: { status: 'ok', version: '0.6.0' } });
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
    const og = new Omnigraph({ baseUrl: 'http://x', token: 'tok-1', graphId: 'g', fetch });
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
