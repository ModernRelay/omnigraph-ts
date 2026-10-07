import { describe, expect, it } from 'vitest';
import Omnigraph from '../src';
import { stubFetch } from './helpers';

describe('schema resource', () => {
  it('get returns Schema with .schemaSource, sends GET /schema', async () => {
    const { fetch, calls } = stubFetch({
      body: { schema_source: 'node Person { name: String @key }' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const r = await og.schema.get();
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://x/graphs/g/schema');
    expect(r.schemaSource).toContain('node Person');
  });

  it('has no schema.apply method; changes use cluster deployments', () => {
    const og = new Omnigraph({ baseUrl: 'http://x' });
    expect('apply' in og.schema).toBe(false);
  });
});
