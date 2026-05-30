import { describe, expect, it } from 'vitest';
import Omnigraph, { MethodNotAllowedError } from '../src';
import { stubFetch } from './helpers';

describe('graphs resource', () => {
  it('list sends GET /graphs and returns camelized entries', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        graphs: [
          { graph_id: 'alpha', uri: 's3://bucket/alpha' },
          { graph_id: 'beta', uri: 's3://bucket/beta' },
        ],
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const graphs = await og.graphs.list();
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://x/graphs');
    expect(graphs).toEqual([
      { graphId: 'alpha', uri: 's3://bucket/alpha' },
      { graphId: 'beta', uri: 's3://bucket/beta' },
    ]);
  });

  it('list is never prefixed by graphId — /graphs is a flat management route', async () => {
    const { fetch, calls } = stubFetch({ body: { graphs: [] } });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'alpha', fetch });
    await og.graphs.list();
    expect(calls[0]?.url).toBe('http://x/graphs');
  });

  it('throws MethodNotAllowedError when single-graph server returns 405', async () => {
    const { fetch } = stubFetch({
      status: 405,
      body: { error: 'method not allowed', code: 'method_not_allowed' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    await expect(og.graphs.list()).rejects.toBeInstanceOf(MethodNotAllowedError);
  });

  it('attaches Authorization header when token is set', async () => {
    const { fetch, calls } = stubFetch({ body: { graphs: [] } });
    const og = new Omnigraph({ baseUrl: 'http://x', token: 'tok-1', fetch });
    await og.graphs.list();
    expect(calls[0]?.headers['authorization']).toBe('Bearer tok-1');
  });
});
