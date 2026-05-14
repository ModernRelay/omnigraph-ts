import { describe, expect, it } from 'vitest';
import Omnigraph from '../src';
import { camelToSnake, snakeToCamel } from '../src/case';
import { stubFetch } from './helpers';

describe('opaque keys (GQ params, rows, columns)', () => {
  it('camelToSnake leaves opaque key values unchanged', () => {
    const out = camelToSnake(
      { querySource: 'q', params: { userId: 1, $varName: 'x' } },
      { opaqueKeys: new Set(['params']) },
    );
    expect(out).toEqual({
      query_source: 'q',
      params: { userId: 1, $varName: 'x' },
    });
  });

  it('snakeToCamel leaves opaque key values unchanged', () => {
    const out = snakeToCamel(
      { row_count: 1, rows: { user_id: 1 } },
      { opaqueKeys: new Set(['rows']) },
    );
    expect(out).toEqual({ rowCount: 1, rows: { user_id: 1 } });
  });

  it('og.read sends params with caller-supplied keys verbatim', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        query_name: 'q',
        target: { branch: 'main', snapshot: null },
        row_count: 0,
        columns: [],
        rows: [],
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    await og.read({
      branch: 'main',
      querySource: 'query q($userId: I32) { match { $u: User { id: $userId } } return { $u.name } }',
      params: { userId: 42, $extraName: 'x' },
    });
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.params).toEqual({ userId: 42, $extraName: 'x' });
  });

  it('og.change sends params with caller-supplied keys verbatim', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        actor_id: null,
        affected_edges: 0,
        affected_nodes: 1,
        branch: 'feat',
        query_name: 'm',
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    await og.change({
      branch: 'feat',
      querySource: 'mutation m($keyName: String) { ... }',
      params: { keyName: 'value' },
    });
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.params).toEqual({ keyName: 'value' });
  });

  it('og.read preserves rows shape on response (no camelization)', async () => {
    const { fetch } = stubFetch({
      body: {
        query_name: 'q',
        target: { branch: 'main', snapshot: null },
        row_count: 2,
        columns: ['user_id', 'full_name'],
        rows: [
          { user_id: 1, full_name: 'Alice' },
          { user_id: 2, full_name: 'Bob' },
        ],
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const r = await og.read({ branch: 'main', querySource: 'query q() { ... }' });
    expect(r.queryName).toBe('q');         // top-level keys still camelCased
    expect(r.rowCount).toBe(2);
    expect(r.columns).toEqual(['user_id', 'full_name']);  // opaque
    expect(r.rows).toEqual([                              // opaque
      { user_id: 1, full_name: 'Alice' },
      { user_id: 2, full_name: 'Bob' },
    ]);
  });
});

describe('null-prototype safety', () => {
  it('does not pollute Object.prototype via __proto__ key', () => {
    const malicious = JSON.parse('{"__proto__": {"polluted": true}}');
    const safe = snakeToCamel<Record<string, unknown>>(malicious);
    // The __proto__ key still appears on `safe` as an own property (not assigned
    // to Object.prototype). Verify no pollution leaked to {}.
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(safe)).toBe(null);
  });
});
