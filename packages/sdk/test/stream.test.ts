import { describe, expect, it } from 'vitest';
import Omnigraph from '../src';
import { stubFetch } from './helpers';

describe('export streaming', () => {
  it('yields rows from NDJSON body, preserving user-schema keys inside `data`', async () => {
    // `data` is user-schema-controlled. Keys like `first_name` or `table_key`
    // are caller-defined and must survive the snake/camel boundary unchanged,
    // so that `og.ingest()` of the exported NDJSON round-trips byte-for-byte.
    const ndjson =
      '{"type":"Person","data":{"first_name":"Alice","is_active":true}}\n' +
      '{"edge":"WorksAt","from":"Alice","to":"Acme","data":{"start_year":2020}}\n';
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
    expect(rows[0]).toEqual({
      type: 'Person',
      data: { first_name: 'Alice', is_active: true },
    });
    expect(rows[1]).toEqual({
      edge: 'WorksAt',
      from: 'Alice',
      to: 'Acme',
      data: { start_year: 2020 },
    });
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
