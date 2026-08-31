import { describe, expect, it } from 'vitest';
import Omnigraph, { ConflictError } from '../src';
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

  it('apply sends POST /schema/apply with snake_case body', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        applied: true,
        graph_manifest_version: 5,
        steps: [],
        supported: true,
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const r = await og.schema.apply({ schemaSource: 'node Foo { id: String @key }' });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://x/graphs/g/schema/apply');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      schema_source: 'node Foo { id: String @key }',
    });
    expect(r.applied).toBe(true);
    expect(r.graphManifestVersion).toBe(5);
  });

  it('apply returns applied=false on no-op', async () => {
    const { fetch } = stubFetch({
      body: { applied: false, graph_manifest_version: 5, steps: [], supported: true },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const r = await og.schema.apply({ schemaSource: 'node Foo { id: String @key }' });
    expect(r.applied).toBe(false);
  });

  it('apply serializes allowDataLoss → allow_data_loss on the wire', async () => {
    const { fetch, calls } = stubFetch({
      body: { applied: true, graph_manifest_version: 6, steps: [], supported: true },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await og.schema.apply({
      schemaSource: 'node Foo { id: String @key }',
      allowDataLoss: true,
    });
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      schema_source: 'node Foo { id: String @key }',
      allow_data_loss: true,
    });
  });

  it('apply omits allow_data_loss when allowDataLoss is unset', async () => {
    const { fetch, calls } = stubFetch({
      body: { applied: true, graph_manifest_version: 6, steps: [], supported: true },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await og.schema.apply({ schemaSource: 'node Foo { id: String @key }' });
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body).toEqual({ schema_source: 'node Foo { id: String @key }' });
    expect('allow_data_loss' in body).toBe(false);
  });

  it('maps a bare 409 (schema apply disabled for cluster graph) to ConflictError', async () => {
    // Server 0.7.0 refuses schema apply on a cluster-managed graph with a plain
    // 409 — no merge_conflicts / published_dataset_version_conflict payload. The conflict fields
    // must stay undefined, not throw.
    const { fetch } = stubFetch({
      status: 409,
      body: {
        error: 'schema apply disabled for cluster-backed serving',
        code: 'conflict',
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    try {
      await og.schema.apply({ schemaSource: 'node Foo { id: String @key }' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError);
      expect((e as ConflictError).mergeConflicts).toBeUndefined();
      expect((e as ConflictError).publishedDatasetVersionConflict).toBeUndefined();
    }
  });
});
