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
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const r = await og.ingest({
      branch: 'feat',
      from: 'main',
      mode: 'merge',
      data: '{"type":"Person","data":{"name":"A"}}\n',
    });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://x/graphs/g/ingest');
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.branch).toBe('feat');
    expect(body.from).toBe('main');
    expect(body.mode).toBe('merge');
    expect(body.data).toContain('Person');
    expect(r.branchCreated).toBe(true);
    expect(r.tables[0]?.tableKey).toBe('node:Person');
    expect(r.tables[0]?.rowsLoaded).toBe(2);
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

  it('og.change accepts canonical query/name fields and emits canonical wire fields', async () => {
    const { fetch, calls } = stubFetch({
      body: { actor_id: null, affected_edges: 0, affected_nodes: 1, branch: 'main', query_name: 'q' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await og.change({ query: 'query q() { insert X {} }', name: 'q', branch: 'main' });
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.query).toBe('query q() { insert X {} }');
    expect(body.name).toBe('q');
    expect('query_source' in body).toBe(false);
    expect('query_name' in body).toBe(false);
  });

  it('og.change accepts legacy querySource/queryName fields and normalizes to canonical wire fields', async () => {
    const { fetch, calls } = stubFetch({
      body: { actor_id: null, affected_edges: 0, affected_nodes: 1, branch: 'main', query_name: 'q' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await og.change({
      querySource: 'query q() { insert X {} }',
      queryName: 'q',
      branch: 'main',
    });
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(calls[0]?.url).toBe('http://x/graphs/g/change');
    expect(body.query).toBe('query q() { insert X {} }');
    expect(body.name).toBe('q');
    expect('query_source' in body).toBe(false);
    expect('query_name' in body).toBe(false);
  });

  it('og.change rejects mixed canonical and legacy mutation field families', async () => {
    const { fetch } = stubFetch({
      body: { actor_id: null, affected_edges: 0, affected_nodes: 1, branch: 'main', query_name: 'q' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    expect(() =>
      og.change({
        query: 'query q() { insert X {} }',
        querySource: 'query q() { insert X {} }',
      } as never),
    ).toThrow(/either query\/name or querySource\/queryName/);
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
