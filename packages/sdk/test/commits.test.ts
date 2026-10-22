import { describe, expect, it } from 'vitest';
import Omnigraph, { NotFoundError } from '../src';
import { stubFetch } from './helpers';

describe('commits resource', () => {
  it('list returns a page with camelCased fields, sends GET /commits', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        commits: [
          {
            graph_commit_id: '01KQ',
            graph_branch: null,
            graph_manifest_version: 2,
            parent_commit_id: null,
            merged_parent_commit_id: null,
            actor_id: null,
            created_at: 1777483011551924,
          },
        ],
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const result = await og.commits.list({ branch: 'main' });
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://x/graphs/g/commits?branch=main');
    expect(Array.isArray(result.commits)).toBe(true);
    expect(result.commits).toHaveLength(1);
    expect(result.commits[0]?.graphCommitId).toBe('01KQ');
    expect(result.commits[0]?.graphManifestVersion).toBe(2);
    expect(result.commits[0]?.createdAt).toBe(1777483011551924);
  });

  it('list omits branch query param when not given', async () => {
    const { fetch, calls } = stubFetch({ body: { commits: [] } });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await og.commits.list();
    expect(calls[0]?.url).toBe('http://x/graphs/g/commits');
  });

  it('retrieve sends GET /commits/{id} with URL-escaped id', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        graph_commit_id: '01KQ/X',
        graph_branch: null,
        graph_manifest_version: 1,
        parent_commit_id: null,
        merged_parent_commit_id: null,
        actor_id: null,
        created_at: 1,
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const r = await og.commits.retrieve('01KQ/X');
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://x/graphs/g/commits/01KQ%2FX');
    expect(r.graphCommitId).toBe('01KQ/X');
  });

  it('retrieve maps 404 to NotFoundError with X-Request-Id', async () => {
    const { fetch } = stubFetch({
      status: 404,
      body: { error: 'commit not found', code: 'not_found' },
      headers: { 'X-Request-Id': '01XYZ' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    try {
      await og.commits.retrieve('01BOGUS');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NotFoundError);
      expect((e as NotFoundError).requestId).toBe('01XYZ');
    }
  });

  it('changes encodes commit id and repeated filters while preserving entity properties', async () => {
    const properties = {
      first_name: 'Ada',
      nested_value: { userKey: 1, other_key: 2 },
    };
    const { fetch, calls } = stubFetch({
      body: {
        cause: {
          graph_commit_id: '01KQ/X',
          authored_branch: 'feature',
          authored_at: 123,
        },
        changes: [
          {
            kind: 'edge',
            type: { id: 'stable-type-id', name: 'Knows' },
            id: 'e',
            op: 'update',
            before: { properties, endpoints: { from: 'a', to: 'b' } },
            after: { properties, endpoints: { from: 'a', to: 'c' } },
          },
        ],
        next_page_token: 'opaque-page',
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const signal = new AbortController().signal;
    const result = await og.commits.changes(
      '01KQ/X',
      {
        pageToken: 'page+/=',
        limit: 50,
        kind: ['node', 'edge'],
        type: ['Person', 'Knows'],
        op: ['insert', 'update'],
        set: ['query_memory_bytes=67108864', 'history_release_bytes=65536'],
      },
      { signal },
    );
    expect(calls[0]?.method).toBe('GET');
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/graphs/g/commits/01KQ%2FX/changes');
    expect(url.searchParams.get('page_token')).toBe('page+/=');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.getAll('kind')).toEqual(['node', 'edge']);
    expect(url.searchParams.getAll('type')).toEqual(['Person', 'Knows']);
    expect(url.searchParams.getAll('op')).toEqual(['insert', 'update']);
    expect(url.searchParams.getAll('set')).toEqual(['query_memory_bytes=67108864', 'history_release_bytes=65536']);
    expect(result.cause.graphCommitId).toBe('01KQ/X');
    expect(result.nextPageToken).toBe('opaque-page');
    expect(result.changes[0]?.before?.properties).toEqual(properties);
    expect(result.changes[0]?.after?.endpoints).toEqual({ from: 'a', to: 'c' });
  });

  it('changes omits absent params and does not turn a schema refusal into an empty diff', async () => {
    const { fetch, calls } = stubFetch({
      status: 409,
      body: {
        error: 'Cannot cross schema boundary',
        code: 'conflict',
        change_diff_refusal: {
          graph_commit_id: 'c',
          reason: 'schema_boundary',
        },
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await expect(og.commits.changes('c')).rejects.toMatchObject({
      status: 409,
      body: {
        changeDiffRefusal: { graphCommitId: 'c', reason: 'schema_boundary' },
      },
    });
    expect(calls[0]?.url).toBe('http://x/graphs/g/commits/c/changes');
  });
});

it('preserves paged history metadata and sends only canonical listing selectors', async () => {
  const { fetch, calls } = stubFetch({ body: { commits: [], head_commit_id: 'head', next_page_token: 'next+/=' } });
  const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
  expect(await og.commits.list({ branch: 'main', listing: 'history', limit: 2, pageToken: 'old+/=' }))
    .toEqual({ commits: [], headCommitId: 'head', nextPageToken: 'next+/=' });
  expect(new URL(calls[0]!.url).searchParams.toString()).toBe('branch=main&listing=history&limit=2&page_token=old%2B%2F%3D');
});

it.each(['unpublished', 'unattached'] as const)('lists %s snapshots without legacy booleans', async (listing) => {
  const { fetch, calls } = stubFetch({ body: { commits: [] } });
  await new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch }).commits.list({ listing });
  expect(calls[0]!.url).toBe(`http://x/graphs/g/commits?listing=${listing}`);
});

it('publishes a proposal and accepts an empty 204 for drop without JSON parsing', async () => {
  const { fetch, calls } = stubFetch([{ body: { graph_commit_id: 'id/x', kind: 'published', published: true } }, { status: 204 }]);
  const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
  expect((await og.commits.publish('id/x', { ifActor: 'alice' })).kind).toBe('published');
  await expect(og.commits.drop('id/x')).resolves.toBeUndefined();
  expect(calls.map(c => [c.method, c.url, c.body])).toEqual([
    ['POST', 'http://x/graphs/g/commits/id%2Fx/publish', undefined],
    ['DELETE', 'http://x/graphs/g/commits/id%2Fx', undefined],
  ]);
  expect(calls[0]!.headers['omnigraph-if-actor']).toBe('alice');
});

it('refuses a non-204 commit-drop response without retrying an uncertain write', async () => {
  const { fetch, calls } = stubFetch({ status: 202, body: {} });
  await expect(new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch }).commits.drop('c'))
    .rejects.toMatchObject({ status: 202, requestDispatched: true, outcomeUnknown: true });
  expect(calls).toHaveLength(1);
});
