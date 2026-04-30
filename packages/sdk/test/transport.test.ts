import { describe, expect, it, vi } from 'vitest';
import Omnigraph, { NetworkError } from '../src';
import { Transport } from '../src/transport';
import { stubFetch } from './helpers';

describe('transport URL handling', () => {
  it('strips trailing slashes from baseUrl', async () => {
    const { fetch, calls } = stubFetch({ body: { branches: [] } });
    const og = new Omnigraph({ baseUrl: 'http://x///', fetch });
    await og.branches.list();
    expect(calls[0]?.url).toBe('http://x/branches');
  });

  it('preserves a non-slashed baseUrl', async () => {
    const { fetch, calls } = stubFetch({ body: { branches: [] } });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    await og.branches.list();
    expect(calls[0]?.url).toBe('http://x/branches');
  });

  it('rejects paths missing a leading slash', async () => {
    const { fetch } = stubFetch({ body: {} });
    const t = new Transport({ baseUrl: 'http://x', fetch });
    await expect(t.request('GET', 'no-slash')).rejects.toThrow(/must start with '\/'/);
  });

  it('omits null/undefined query params', async () => {
    const { fetch, calls } = stubFetch({ body: { commits: [] } });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    await og.commits.list({ branch: undefined });
    expect(calls[0]?.url).toBe('http://x/commits');
  });

  it('appends array query values as repeated keys', async () => {
    const { fetch, calls } = stubFetch({ body: {} });
    const t = new Transport({ baseUrl: 'http://x', fetch });
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

describe('transport bearer auth', () => {
  it('attaches Authorization header when token is set', async () => {
    const { fetch, calls } = stubFetch({ body: { branches: [] } });
    const og = new Omnigraph({ baseUrl: 'http://x', token: 'tok-1', fetch });
    await og.branches.list();
    expect(calls[0]?.headers['authorization']).toBe('Bearer tok-1');
  });

  it('omits Authorization header when token is unset', async () => {
    const { fetch, calls } = stubFetch({ body: { branches: [] } });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    await og.branches.list();
    expect(calls[0]?.headers['authorization']).toBeUndefined();
  });
});
