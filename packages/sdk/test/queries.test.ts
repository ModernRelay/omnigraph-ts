import { describe, expect, it } from 'vitest';
import Omnigraph, { NotFoundError } from '../src';
import { stubFetch } from './helpers';

describe('queries resource', () => {
  it('list returns the saved queries array, GET /queries', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        queries: [
          {
            name: 'find_person',
            description: 'by name',
            source: 'query find_person($name: String) { ... }',
            params: [{ name: 'name', type_name: 'String', nullable: false }],
            updated_at_us: '1747315200000000',
          },
        ],
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const result = await og.queries.list();
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('find_person');
    // The snake-case params field should arrive camelCased.
    expect(result[0]?.params[0]?.typeName).toBe('String');
    expect(result[0]?.updatedAtUs).toBe('1747315200000000');
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://x/queries');
  });

  it('get fetches by name and surfaces NotFoundError on 404', async () => {
    const { fetch: fetchOk, calls: callsOk } = stubFetch({
      body: {
        name: 'find_person',
        description: null,
        source: 'query find_person($name: String) { ... }',
        params: [{ name: 'name', type_name: 'String', nullable: false }],
        updated_at_us: '1747315200000000',
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch: fetchOk });
    const r = await og.queries.get('find_person');
    expect(r.name).toBe('find_person');
    expect(callsOk[0]?.url).toBe('http://x/queries/find_person');

    const { fetch: fetchMissing } = stubFetch({
      status: 404,
      body: { error: 'saved query not found', code: 'not_found' },
    });
    const og2 = new Omnigraph({ baseUrl: 'http://x', fetch: fetchMissing });
    await expect(og2.queries.get('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('save sends PUT with camel→snake body conversion', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        name: 'find_person',
        description: 'by name',
        source: 'query find_person($name: String) { ... }',
        params: [{ name: 'name', type_name: 'String', nullable: false }],
        updated_at_us: '1747315200000000',
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', token: 't', fetch });
    await og.queries.save('find_person', {
      source: 'query find_person($name: String) { ... }',
      description: 'by name',
    });
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.url).toBe('http://x/queries/find_person');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      source: 'query find_person($name: String) { ... }',
      description: 'by name',
    });
    expect(calls[0]?.headers['authorization']).toBe('Bearer t');
  });

  it('delete escapes the name and returns the deleted flag', async () => {
    const { fetch, calls } = stubFetch({ body: { name: 'a b', deleted: true } });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const r = await og.queries.delete('a b');
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toBe('http://x/queries/a%20b');
    expect(r.deleted).toBe(true);
  });
});
