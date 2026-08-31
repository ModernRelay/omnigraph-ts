import { describe, expect, it, vi } from 'vitest';
import Omnigraph, { NotFoundError } from '../src';
import { stubFetch } from './helpers';

const cell = {
  entity: 'node' as const,
  type: 'Document',
  id: 'a/b',
  property: 'file_data',
};

describe('blobs resource', () => {
  it('get preserves raw binary and metadata, forwards selectors/headers, and disables redirects', async () => {
    const bytes = new Uint8Array([0, 255, 128, 65]);
    const response = new Response(bytes, {
      status: 206,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': '4',
        'Content-Range': 'bytes 2-5/10',
        ETag: '"opaque"',
        'Omnigraph-Snapshot-Id': 'c',
      },
    });
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => response,
    );
    const og = new Omnigraph({
      baseUrl: 'http://x',
      graphId: 'g',
      token: 'token',
      fetch,
    });
    const signal = new AbortController().signal;
    const result = await og.blobs.get(
      {
        ...cell,
        branch: 'feature/a',
        range: 'bytes=2-5',
        ifMatch: '"opaque"',
        ifNoneMatch: '"old"',
        ifRange: '"opaque"',
      },
      { signal },
    );
    expect(result).toBe(response);
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes);
    expect(result.headers.get('Omnigraph-Snapshot-Id')).toBe('c');
    const [requestUrl, init] = fetch.mock.calls[0]!;
    const url = new URL(String(requestUrl));
    expect(url.pathname).toBe('/graphs/g/blob');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      ...cell,
      branch: 'feature/a',
    });
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    expect(init?.signal).toBe(signal);
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer token');
    expect(headers.get('Accept')).toBe('application/octet-stream');
    expect(headers.get('Range')).toBe('bytes=2-5');
    expect(headers.get('If-Match')).toBe('"opaque"');
    expect(headers.get('If-None-Match')).toBe('"old"');
    expect(headers.get('If-Range')).toBe('"opaque"');
  });

  it.each(['get', 'stat'] as const)(
    '%s exposes external redirects without following them',
    async (method) => {
      const response = new Response(null, {
        status: 302,
        headers: {
          Location: 'https://external.example/private-object',
          'Cache-Control': 'no-store',
        },
      });
      const fetch = vi.fn(
        async (_url: string | URL | Request, _init?: RequestInit) => response,
      );
      const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
      const result = await og.blobs[method](cell);
      expect(result.status).toBe(302);
      expect(result.headers.get('Location')).toBe(
        'https://external.example/private-object',
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]?.[1]?.redirect).toBe('manual');
    },
  );

  it.each(['get', 'stat'] as const)(
    '%s returns a bodyless 304 without trying to decode JSON',
    async (method) => {
      const { fetch } = stubFetch({
        status: 304,
        headers: { ETag: '"unchanged"' },
      });
      const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
      const result = await og.blobs[method]({
        ...cell,
        ifNoneMatch: '"unchanged"',
      });
      expect(result.status).toBe(304);
      expect(result.body).toBeNull();
      expect(result.headers.get('etag')).toBe('"unchanged"');
    },
  );

  it('stat uses HEAD against a snapshot and retains complete representation metadata', async () => {
    const response = new Response(null, {
      headers: {
        'Content-Length': '100',
        ETag: '"value"',
        'Omnigraph-Snapshot-Id': 'snapshot',
      },
    });
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => response,
    );
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const result = await og.blobs.stat({
      ...cell,
      entity: 'edge',
      snapshot: 'snapshot',
    });
    expect(result.body).toBeNull();
    expect(result.headers.get('Content-Length')).toBe('100');
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('HEAD');
    expect(
      new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get('snapshot'),
    ).toBe('snapshot');
    expect(
      new URL(String(fetch.mock.calls[0]?.[0])).searchParams.has('branch'),
    ).toBe(false);
  });

  it('preserves headers and structured details for an unsatisfiable range', async () => {
    const { fetch } = stubFetch({
      status: 416,
      body: {
        error: 'Range unsatisfiable',
        blob_range: { start: 10, end: 11, length: 5 },
      },
      headers: { 'Content-Range': 'bytes */5', ETag: '"value"' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await expect(
      og.blobs.get({ ...cell, range: 'bytes=10-10' }),
    ).rejects.toMatchObject({
      status: 416,
      body: { blobRange: { start: 10, end: 11, length: 5 } },
      response: expect.objectContaining({ status: 416 }),
    });
  });

  it('maps a bodyless HEAD 404 to the correct status error', async () => {
    const fetch = async () =>
      new Response(null, { status: 404, headers: { 'X-Request-Id': 'r' } });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await expect(og.blobs.stat(cell)).rejects.toBeInstanceOf(NotFoundError);
    await expect(og.blobs.stat(cell)).rejects.toMatchObject({
      status: 404,
      requestId: 'r',
      message: 'HTTP 404',
    });
  });
});
