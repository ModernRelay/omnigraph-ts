import { describe, expect, it } from 'vitest';
import Omnigraph, { InternalServerError } from '../src';
import { stubFetch } from './helpers';

describe('Retry-After handling (idempotent methods)', () => {
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

describe('Retry-After: non-idempotent methods do not retry', () => {
  it('POST /branches does not retry on 503 + Retry-After', async () => {
    const { fetch, calls } = stubFetch([
      { status: 503, body: { error: 'busy' }, headers: { 'Retry-After': '0' } },
      // Second slot only used if we wrongly retry.
      { body: { actor_id: null, from: 'main', name: 'x', uri: 's3://x' } },
    ]);
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    await expect(og.branches.create({ name: 'x' })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('POST /change does not retry on 503', async () => {
    const { fetch, calls } = stubFetch({
      status: 503,
      body: { error: 'busy' },
      headers: { 'Retry-After': '0' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    await expect(og.change({ querySource: 'q' })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});
