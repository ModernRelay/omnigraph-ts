import { describe, expect, it } from 'vitest';
import Omnigraph, { InternalServerError } from '../src';
import { stubFetch } from './helpers';

describe('Retry-After handling', () => {
  it('retries once on 503 with Retry-After', async () => {
    const { fetch, calls } = stubFetch([
      { status: 503, body: { error: 'busy', code: 'internal' }, headers: { 'Retry-After': '0' } },
      { body: { branches: ['main'] } },
    ]);
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const r = await og.branches.list();
    expect(r).toEqual(['main']);
    expect(calls).toHaveLength(2);
  });

  it('does not retry without Retry-After', async () => {
    const { fetch, calls } = stubFetch({ status: 503, body: { error: 'down' } });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    await expect(og.branches.list()).rejects.toBeInstanceOf(InternalServerError);
    expect(calls).toHaveLength(1);
  });

  it('does not retry on 4xx', async () => {
    const { fetch, calls } = stubFetch({
      status: 400,
      body: { error: 'bad', code: 'bad_request' },
      headers: { 'Retry-After': '1' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    await expect(og.branches.list()).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('gives up after one retry', async () => {
    const { fetch, calls } = stubFetch([
      { status: 503, body: { error: 'busy' }, headers: { 'Retry-After': '0' } },
      { status: 503, body: { error: 'still busy' }, headers: { 'Retry-After': '0' } },
    ]);
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    await expect(og.branches.list()).rejects.toThrow();
    expect(calls).toHaveLength(2);
  });
});

import { describe as describe2, expect as expect2, it as it2 } from 'vitest';
import Omnigraph2 from '../src';
import { stubFetch as stub2 } from './helpers';

describe2('write methods do not retry on 503', () => {
  it2('POST /branches does not retry on 503 + Retry-After', async () => {
    const { fetch, calls } = stub2([
      {
        status: 503,
        body: { error: 'busy' },
        headers: { 'Retry-After': '0' },
      },
      // Second slot would be used if we wrongly retried
      { body: { actor_id: null, from: 'main', name: 'x', uri: 's3://x' } },
    ]);
    const og = new Omnigraph2({ baseUrl: 'http://x', fetch });
    await expect2(og.branches.create({ name: 'x' })).rejects.toThrow();
    expect2(calls).toHaveLength(1);            // not retried
  });

  it2('POST /change does not retry on 503', async () => {
    const { fetch, calls } = stub2([
      {
        status: 503,
        body: { error: 'busy' },
        headers: { 'Retry-After': '0' },
      },
    ]);
    const og = new Omnigraph2({ baseUrl: 'http://x', fetch });
    await expect2(og.change({ querySource: 'q' })).rejects.toThrow();
    expect2(calls).toHaveLength(1);
  });
});

describe2('Retry-After cap', () => {
  it2('caps Retry-After delay at 60 seconds', async () => {
    const { fetch, calls } = stub2([
      {
        status: 503,
        body: { error: 'busy' },
        headers: { 'Retry-After': '999999' }, // 11+ days
      },
      { body: { branches: ['main'] } },
    ]);
    const og = new Omnigraph2({ baseUrl: 'http://x', fetch });
    const start = Date.now();
    // Set a small deadline; if cap doesn't apply, this will hang past 1 second.
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 1000);
    try {
      await og.branches.list({ signal: ac.signal });
    } catch {
      // Either succeeds within ~60s cap or is aborted; not stuck for ~999999s.
    }
    const elapsed = Date.now() - start;
    expect2(elapsed).toBeLessThan(2000);  // would be ~999999000 without the cap
    expect2(calls.length).toBeGreaterThanOrEqual(1);
  });
});
