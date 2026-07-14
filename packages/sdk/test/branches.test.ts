import { describe, expect, it } from 'vitest';
import Omnigraph, { ConflictError, NotFoundError } from '../src';
import { stubFetch } from './helpers';

describe('branches resource', () => {
  it('list returns string array, sends GET /branches', async () => {
    const { fetch, calls } = stubFetch({ body: { branches: ['main', 'feature'] } });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const result = await og.branches.list();
    expect(result).toEqual(['main', 'feature']);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://x/graphs/g/branches');
  });

  it('create sends POST with snake_case body', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        actor_id: null,
        from: 'main',
        name: 'feature',
        uri: 's3://bucket/repo',
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', token: 't', graphId: 'g', fetch });
    const r = await og.branches.create({ name: 'feature', from: 'main' });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://x/graphs/g/branches');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ name: 'feature', from: 'main' });
    expect(calls[0]?.headers['authorization']).toBe('Bearer t');
    expect(r.name).toBe('feature');
  });

  it('merge returns BranchMergeOutput camelCased', async () => {
    const { fetch } = stubFetch({
      body: {
        actor_id: null,
        outcome: 'fast_forward',
        source: 'feature',
        target: 'main',
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const r = await og.branches.merge({ source: 'feature', target: 'main' });
    expect(r.outcome).toBe('fast_forward');
  });

  it('merge with deleteBranch sends delete_branch and camelizes the delete result', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        actor_id: null,
        outcome: 'fast_forward',
        source: 'feature',
        target: 'main',
        branch_deleted: false,
        branch_delete_error: "descendant branch 'feature-child' still depends on it",
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const r = await og.branches.merge({
      source: 'feature',
      target: 'main',
      deleteBranch: true,
    });
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      source: 'feature',
      target: 'main',
      delete_branch: true,
    });
    // The merge landed; the refused deletion is data, not an error.
    expect(r.outcome).toBe('fast_forward');
    expect(r.branchDeleted).toBe(false);
    expect(r.branchDeleteError).toContain('feature-child');
  });

  it('delete escapes the branch name in path', async () => {
    const { fetch, calls } = stubFetch({
      body: { actor_id: null, name: 'a b/c', uri: 's3://x' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await og.branches.delete('a b/c');
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toBe('http://x/graphs/g/branches/a%20b%2Fc');
  });

  it('throws ConflictError on 409', async () => {
    const { fetch } = stubFetch({
      status: 409,
      body: { error: 'branch exists', code: 'conflict' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await expect(og.branches.create({ name: 'main' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('surfaces X-Request-Id on error', async () => {
    const { fetch } = stubFetch({
      status: 404,
      body: { error: 'not found', code: 'not_found' },
      headers: { 'X-Request-Id': '01ABC' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    try {
      await og.branches.delete('nonexistent');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NotFoundError);
      expect((e as NotFoundError).requestId).toBe('01ABC');
    }
  });
});
