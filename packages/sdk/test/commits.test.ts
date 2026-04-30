import { describe, expect, it } from 'vitest';
import Omnigraph, { NotFoundError } from '../src';
import { stubFetch } from './helpers';

describe('commits resource', () => {
  it('list returns Commit[] with camelCased fields, sends GET /commits', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        commits: [
          {
            graph_commit_id: '01KQ',
            manifest_branch: null,
            manifest_version: 2,
            parent_commit_id: null,
            merged_parent_commit_id: null,
            actor_id: null,
            created_at: 1777483011551924,
          },
        ],
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const result = await og.commits.list({ branch: 'main' });
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://x/commits?branch=main');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]?.graphCommitId).toBe('01KQ');
    expect(result[0]?.manifestVersion).toBe(2);
    expect(result[0]?.createdAt).toBe(1777483011551924);
  });

  it('list omits branch query param when not given', async () => {
    const { fetch, calls } = stubFetch({ body: { commits: [] } });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    await og.commits.list();
    expect(calls[0]?.url).toBe('http://x/commits');
  });

  it('retrieve sends GET /commits/{id} with URL-escaped id', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        graph_commit_id: '01KQ/X',
        manifest_branch: null,
        manifest_version: 1,
        parent_commit_id: null,
        merged_parent_commit_id: null,
        actor_id: null,
        created_at: 1,
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const r = await og.commits.retrieve('01KQ/X');
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://x/commits/01KQ%2FX');
    expect(r.graphCommitId).toBe('01KQ/X');
  });

  it('retrieve maps 404 to NotFoundError with X-Request-Id', async () => {
    const { fetch } = stubFetch({
      status: 404,
      body: { error: 'commit not found', code: 'not_found' },
      headers: { 'X-Request-Id': '01XYZ' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    try {
      await og.commits.retrieve('01BOGUS');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NotFoundError);
      expect((e as NotFoundError).requestId).toBe('01XYZ');
    }
  });
});
