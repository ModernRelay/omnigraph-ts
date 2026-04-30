import { describe, expect, it } from 'vitest';
import Omnigraph from '../src';
import { stubFetch } from './helpers';

describe('export streaming', () => {
  it('yields rows from NDJSON body', async () => {
    const ndjson =
      '{"type":"Person","data":{"name":"Alice","table_key":"a"}}\n' +
      '{"type":"Person","data":{"name":"Bob","table_key":"b"}}\n';
    const { fetch } = stubFetch({
      body: ndjson,
      headers: { 'content-type': 'application/x-ndjson' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const rows: unknown[] = [];
    for await (const r of og.export({ branch: 'main' })) {
      rows.push(r);
    }
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ type: 'Person', data: { name: 'Alice', tableKey: 'a' } });
    expect(rows[1]).toEqual({ type: 'Person', data: { name: 'Bob', tableKey: 'b' } });
  });

  it('handles trailing line without newline', async () => {
    const ndjson = '{"a":1}\n{"b":2}';
    const { fetch } = stubFetch({
      body: ndjson,
      headers: { 'content-type': 'application/x-ndjson' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const rows: unknown[] = [];
    for await (const r of og.export()) rows.push(r);
    expect(rows).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('skips empty lines', async () => {
    const ndjson = '{"a":1}\n\n\n{"b":2}\n';
    const { fetch } = stubFetch({
      body: ndjson,
      headers: { 'content-type': 'application/x-ndjson' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const rows: unknown[] = [];
    for await (const r of og.export()) rows.push(r);
    expect(rows).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
