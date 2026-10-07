import { describe, expect, it } from 'vitest';
import Omnigraph, { ForbiddenError } from '../src';
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

  it('throws ForbiddenError when graph_list is not granted (closed-by-default)', async () => {
    const { fetch } = stubFetch({
      status: 403,
      body: { error: 'graph_list not authorized', code: 'forbidden' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    await expect(og.graphs.list()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('attaches Authorization header when token is set', async () => {
    const { fetch, calls } = stubFetch({ body: { graphs: [] } });
    const og = new Omnigraph({ baseUrl: 'http://x', token: 'tok-1', fetch });
    await og.graphs.list();
    expect(calls[0]?.headers['authorization']).toBe('Bearer tok-1');
  });
});

describe('graph availability and discovery', () => {
  it('discovers minimal actor-visible identities without graph scope', async () => {
    const { fetch, calls } = stubFetch({ body: { graphs: [{ graph_id: 'my_graph', display_name: 'My graph' }] } });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'unused', fetch });
    expect(await og.graphs.discover()).toEqual([{ graphId: 'my_graph', displayName: 'My graph' }]);
    expect(calls[0]?.url).toBe('http://x/graphs/discovery');
  });

  it('retains runtime availability and failure details in the operator inventory', async () => {
    const { fetch } = stubFetch({ body: { graphs: [{ graph_id: 'g', uri: 'file:///g', state: 'blocked', read_available: false, write_available: false, action: 'operator_action', failure: { code: 'storage', message: 'unavailable' } }] } });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    expect((await og.graphs.list())[0]).toMatchObject({ state: 'blocked', readAvailable: false, writeAvailable: false, failure: { code: 'storage', message: 'unavailable' } });
  });
});
