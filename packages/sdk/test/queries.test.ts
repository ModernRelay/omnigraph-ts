import { describe, expect, it } from 'vitest';
import Omnigraph, { BadRequestError } from '../src';
import { stubFetch } from './helpers';

describe('queries resource (stored queries)', () => {
  it('list sends GET /queries and camelizes the catalog', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        queries: [
          {
            name: 'find_inactive',
            tool_name: 'find_inactive',
            mutation: false,
            description: 'inactive users',
            instruction: null,
            params: [
              { name: 'days', kind: 'int', nullable: false, item_kind: null, vector_dim: null },
            ],
          },
        ],
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const r = await og.queries.list();
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://x/graphs/g/queries');
    expect(r.queries[0]?.toolName).toBe('find_inactive');
    expect(r.queries[0]?.mutation).toBe(false);
    // Typed-catalog fields are camelized (not opaque).
    expect(r.queries[0]?.params[0]?.itemKind).toBeNull();
  });

  it('invoke escapes the name in the path and keeps params/rows opaque', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        query_name: 'find_inactive',
        row_count: 1,
        columns: ['$u.name'],
        rows: [{ '$u.name': 'Alice' }],
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', token: 't', graphId: 'g', fetch });
    const r = await og.queries.invoke('find inactive', {
      params: { min_days: 30 },
      branch: 'main',
    });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://x/graphs/g/queries/find%20inactive');
    const body = JSON.parse(calls[0]?.body ?? '{}');
    // `params` is opaque: the snake_case key must reach the wire unchanged.
    expect(body.params).toEqual({ min_days: 30 });
    expect(body.branch).toBe('main');
    // A stored read returns a Read envelope; rows/columns are opaque (verbatim).
    const read = r as { rowCount: number; rows: Array<Record<string, unknown>> };
    expect(read.rowCount).toBe(1);
    expect(read.rows[0]?.['$u.name']).toBe('Alice');
  });

  it('serializes expectMutation → expect_mutation on the wire', async () => {
    const { fetch, calls } = stubFetch({
      body: { query_name: 'q', row_count: 0, columns: [], rows: [] },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await og.queries.invoke('q', { expectMutation: false, branch: 'main' });
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.expect_mutation).toBe(false);
    expect(body.branch).toBe('main');
  });

  it('surfaces a kind-mismatch 400 as BadRequestError', async () => {
    const { fetch } = stubFetch({
      status: 400,
      body: { error: 'stored query is a mutation, not a read', code: 'bad_request' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await expect(
      og.queries.invoke('q', { expectMutation: false }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});
