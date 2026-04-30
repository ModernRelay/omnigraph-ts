import { describe, expect, it } from 'vitest';
import Omnigraph from '../src';
import { stubFetch } from './helpers';

describe('top-level client operations', () => {
  it('health sends GET /healthz', async () => {
    const { fetch, calls } = stubFetch({ body: { status: 'ok', version: '0.3.1' } });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const h = await og.health();
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://x/healthz');
    expect(h.status).toBe('ok');
    expect(h.version).toBe('0.3.1');
  });

  it('snapshot encodes branch as a query param', async () => {
    const { fetch, calls } = stubFetch({
      body: { branch: 'main', tables: [], snapshot_id: 'snap-1' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const s = await og.snapshot({ branch: 'main' });
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://x/snapshot?branch=main');
    expect(s.branch).toBe('main');
  });

  it('snapshot allows omitting branch (server default)', async () => {
    const { fetch, calls } = stubFetch({
      body: { branch: 'main', tables: [], snapshot_id: 'snap-1' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    await og.snapshot();
    expect(calls[0]?.url).toBe('http://x/snapshot');
  });

  it('ingest sends NDJSON data via JSON body and camelCases the response', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        actor_id: null,
        base_branch: 'main',
        branch: 'feat',
        branch_created: true,
        mode: 'merge',
        tables: [
          { table_key: 'node:Person', rows_loaded: 2 },
        ],
        uri: 's3://x',
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const r = await og.ingest({
      branch: 'feat',
      from: 'main',
      mode: 'merge',
      data: '{"type":"Person","data":{"name":"A"}}\n',
    });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://x/ingest');
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.branch).toBe('feat');
    expect(body.from).toBe('main');
    expect(body.mode).toBe('merge');
    expect(body.data).toContain('Person');
    expect(r.branchCreated).toBe(true);
    expect(r.tables[0]?.tableKey).toBe('node:Person');
    expect(r.tables[0]?.rowsLoaded).toBe(2);
  });
});

describe('export streaming options', () => {
  it('passes typed row generic through the iterator', async () => {
    interface PersonRow {
      type: string;
      data: { name: string };
    }
    const ndjson = '{"type":"Person","data":{"name":"Alice"}}\n';
    const { fetch } = stubFetch({
      body: ndjson,
      headers: { 'content-type': 'application/x-ndjson' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const rows: PersonRow[] = [];
    for await (const row of og.export<PersonRow>({ branch: 'main' })) {
      rows.push(row);
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data.name).toBe('Alice');
  });

  it('aborts mid-stream when the signal is triggered', async () => {
    // A body that never completes — the abort must terminate iteration.
    const ac = new AbortController();
    const abortablefetch = async (_input: unknown, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"a":1}\n'));
          // Then stall — caller must abort.
          init?.signal?.addEventListener('abort', () => {
            controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson' },
      });
    };
    const og = new Omnigraph({
      baseUrl: 'http://x',
      fetch: abortablefetch as unknown as typeof globalThis.fetch,
    });
    const rows: unknown[] = [];
    let caught: unknown;
    try {
      for await (const r of og.export({ branch: 'main' }, { signal: ac.signal })) {
        rows.push(r);
        ac.abort();
      }
    } catch (e) {
      caught = e;
    }
    expect(rows).toEqual([{ a: 1 }]);
    expect(caught).toBeDefined();
  });
});
