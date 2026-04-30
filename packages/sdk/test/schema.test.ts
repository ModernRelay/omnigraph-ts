import { describe, expect, it } from 'vitest';
import Omnigraph from '../src';
import { stubFetch } from './helpers';

describe('schema resource', () => {
  it('get returns Schema with .source, sends GET /schema', async () => {
    const { fetch, calls } = stubFetch({
      body: { source: 'node Person { name: String @key }' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const r = await og.schema.get();
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://x/schema');
    expect(r.source).toContain('node Person');
  });

  it('apply sends POST /schema/apply with snake_case body', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        applied: true,
        manifest_version: 5,
        steps: [],
        supported: true,
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const r = await og.schema.apply({ schemaSource: 'node Foo { id: String @key }' });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://x/schema/apply');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      schema_source: 'node Foo { id: String @key }',
    });
    expect(r.applied).toBe(true);
    expect(r.manifestVersion).toBe(5);
  });

  it('apply returns applied=false on no-op', async () => {
    const { fetch } = stubFetch({
      body: { applied: false, manifest_version: 5, steps: [], supported: true },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const r = await og.schema.apply({ schemaSource: 'node Foo { id: String @key }' });
    expect(r.applied).toBe(false);
  });
});
