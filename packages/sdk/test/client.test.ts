import { describe, expect, it } from 'vitest';
import Omnigraph from '../src';
import { stubFetch } from './helpers';

describe('top-level client operations', () => {
  it('health sends GET /healthz', async () => {
    const { fetch, calls } = stubFetch({
      body: { status: 'ok', version: '0.8.0', internal_schema_version: 4 },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const h = await og.health();
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://x/healthz');
    expect(h.status).toBe('ok');
    expect(h.version).toBe('0.8.0');
    // New in server 0.8.0: the storage-format version, camelized like any field.
    expect(h.internalSchemaVersion).toBe(4);
  });

  it('snapshot encodes branch as a query param', async () => {
    const { fetch, calls } = stubFetch({
      body: { branch: 'main', tables: [], snapshot_id: 'snap-1' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const s = await og.snapshot({ branch: 'main' });
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://x/graphs/g/snapshot?branch=main');
    expect(s.branch).toBe('main');
  });

  it('snapshot allows omitting branch (server default)', async () => {
    const { fetch, calls } = stubFetch({
      body: { branch: 'main', tables: [], snapshot_id: 'snap-1' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await og.snapshot();
    expect(calls[0]?.url).toBe('http://x/graphs/g/snapshot');
  });

  it('load sends POST /load and tolerates a null base_branch', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        actor_id: null,
        base_branch: null,
        branch: 'main',
        branch_created: false,
        mode: 'merge',
        tables: [],
        uri: 's3://x',
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const r = await og.load({
      branch: 'main',
      mode: 'merge',
      data: '{"type":"Person","data":{"name":"A"}}\n',
    });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://x/graphs/g/load');
    expect(r.baseBranch).toBeNull();
    expect(r.branchCreated).toBe(false);
  });

  it('loadNdjson sends the raw NDJSON body with the x-ndjson content type', async () => {
    const ndjson =
      '{"type":"Person","data":{"name":"A"}}\n' +
      '{"edge":"Knows","from":"a","to":"b","data":{}}\n';
    const { fetch, calls } = stubFetch({
      body: {
        actor_id: null,
        base_branch: null,
        branch: 'main',
        branch_created: false,
        mode: 'merge',
        nodes: [{ name: 'Person', rows: 1 }],
        edges: [{ name: 'Knows', rows: 1 }],
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const r = await og.loadNdjson({ ndjson, branch: 'main', mode: 'merge' });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://x/graphs/g/load/ndjson?branch=main&mode=merge');
    // The body must pass through verbatim — no JSON re-encoding, no
    // camel-to-snake rewriting of the user-schema `data` keys.
    expect(calls[0]?.body).toBe(ndjson);
    expect(calls[0]?.headers['content-type']).toBe('application/x-ndjson');
    expect(r.branchCreated).toBe(false);
    expect(r.nodes[0]?.name).toBe('Person');
  });
});

describe('og.query and og.mutate (canonical successors to read/change)', () => {
  it('og.query sends POST /query with canonical snake_case body and camelizes response', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        query_name: 'find',
        target: { branch: 'main', snapshot: null },
        row_count: 1,
        columns: ['$p.name'],
        rows: [{ '$p.name': 'Alice' }],
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const r = await og.query({
      query: 'query find($name: String) { match { $p: Person { name: $name } } return { $p.name } }',
      name: 'find',
      params: { name: 'Alice' },
      branch: 'main',
    });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://x/graphs/g/query');
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.query).toContain('match');
    expect(body.name).toBe('find');
    expect(body.branch).toBe('main');
    expect(body.params).toEqual({ name: 'Alice' });
    expect(r.queryName).toBe('find');
    expect(r.rowCount).toBe(1);
  });

  it('og.query preserves opaque param keys verbatim', async () => {
    const { fetch, calls } = stubFetch({
      body: { query_name: 'q', target: { branch: 'main', snapshot: null }, row_count: 0, columns: [], rows: [] },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await og.query({
      query: 'query q($keyName: String) { match { $u: User { id: $keyName } } return { $u.name } }',
      params: { keyName: 'value', $internal: 1 },
    });
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.params).toEqual({ keyName: 'value', $internal: 1 });
  });

  it('og.mutate sends POST /mutate with canonical snake_case body and camelizes response', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        actor_id: null,
        affected_edges: 0,
        affected_nodes: 1,
        branch: 'feature',
        query_name: 'addPerson',
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const r = await og.mutate({
      query: 'query addPerson($name: String) { insert Person { name: $name } }',
      name: 'addPerson',
      params: { name: 'Frank' },
      branch: 'feature',
    });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://x/graphs/g/mutate');
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.query).toContain('insert Person');
    expect(body.name).toBe('addPerson');
    expect(body.branch).toBe('feature');
    expect(body.params).toEqual({ name: 'Frank' });
    expect(r.affectedNodes).toBe(1);
  });
});

describe('og.graph(id)', () => {
  it('returns a new client scoped to graphId; original is unchanged', async () => {
    const { fetch, calls } = stubFetch([
      { body: { branches: [] } },
      { body: { branches: [] } },
    ]);
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'orig', fetch });
    const scoped = og.graph('alpha');
    expect(scoped).not.toBe(og);
    await scoped.branches.list();
    await og.branches.list();
    expect(calls[0]?.url).toBe('http://x/graphs/alpha/branches');
    expect(calls[1]?.url).toBe('http://x/graphs/orig/branches');
  });

  it('inherits token and fetch from the parent client', async () => {
    const { fetch, calls } = stubFetch({ body: { branches: [] } });
    const og = new Omnigraph({ baseUrl: 'http://x', token: 't', fetch });
    await og.graph('alpha').branches.list();
    expect(calls[0]?.headers['authorization']).toBe('Bearer t');
  });

  it('replaces a previously-configured graphId rather than nesting it', async () => {
    const { fetch, calls } = stubFetch({ body: { branches: [] } });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'alpha', fetch });
    await og.graph('beta').branches.list();
    expect(calls[0]?.url).toBe('http://x/graphs/beta/branches');
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
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
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
      graphId: 'g',
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
