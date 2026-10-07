import { describe, expect, it } from 'vitest';
import Omnigraph, {
  ApiContractError,
  ConflictError,
  NotFoundError,
} from '../src';
import { stubFetch } from './helpers';

describe('branches resource', () => {
  it('list returns string array, sends GET /branches', async () => {
    const { fetch, calls } = stubFetch({
      body: { branches: ['main', 'feature'] },
    });
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
    const og = new Omnigraph({
      baseUrl: 'http://x',
      token: 't',
      graphId: 'g',
      fetch,
    });
    const r = await og.branches.create({ name: 'feature', from: 'main' });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://x/graphs/g/branches');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      name: 'feature',
      from: 'main',
    });
    expect(calls[0]?.headers['authorization']).toBe('Bearer t');
    expect(r.name).toBe('feature');
  });

  it('merge returns BranchMergeOutput camelCased', async () => {
    const { fetch } = stubFetch({
      body: {
        actor_id: null,
        outcome: 'fast_forward',
        commit: {
          graph_commit_id: 'merge-own',
          graph_manifest_version: 7,
          graph_branch: 'main',
          parent_commit_id: 'target-old',
          merged_parent_commit_id: 'source-tip',
        },
        source: 'feature',
        target: 'main',
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const r = await og.branches.merge({ source: 'feature', target: 'main' });
    expect(r.outcome).toBe('fast_forward');
    expect(r.commit?.graphCommitId).toBe('merge-own');
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
    await expect(og.branches.create({ name: 'main' })).rejects.toBeInstanceOf(
      ConflictError,
    );
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

describe('exact merge receipts', () => {
  const commit = {
    graph_commit_id: 'own-merge',
    graph_manifest_version: 5,
    graph_branch: null,
    parent_commit_id: 'target-before',
    merged_parent_commit_id: 'source-head',
    actor_id: 'alice',
  };
  const receipt = {
    source: 'feature',
    target: 'main',
    outcome: 'merged',
    commit,
    actor_id: 'alice',
  };

  it('normalizes branch names before sending and validating', async () => {
    const { fetch, calls } = stubFetch({ body: receipt });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const result = await og.branches.merge({
      source: ' feature ',
      target: ' main ',
    });
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      source: 'feature',
      target: 'main',
    });
    expect(result.commit?.graphCommitId).toBe('own-merge');
    expect(calls).toHaveLength(1);
  });

  it.each([
    { ...receipt, commit: undefined },
    { ...receipt, commit: null },
    { ...receipt, outcome: 'already_up_to_date' },
    { ...receipt, target: 'other' },
    { ...receipt, commit: { ...commit, merged_parent_commit_id: null } },
    { ...receipt, commit: { ...commit, graph_branch: 'other' } },
    { ...receipt, commit: { ...commit, actor_id: 'someone-else' } },
    { ...receipt, branch_deleted: true },
  ])(
    'rejects an incomplete or inconsistent receipt without replaying it',
    async (body) => {
      const { fetch, calls } = stubFetch({ body });
      const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
      await expect(
        og.branches.merge({ source: 'feature' }),
      ).rejects.toMatchObject({
        requestDispatched: true,
        outcomeUnknown: true,
      });
      expect(calls).toHaveLength(1);
    },
  );

  it('returns successful merge and failed optional deletion together', async () => {
    const { fetch } = stubFetch({
      body: {
        ...receipt,
        branch_deleted: false,
        branch_delete_error_details: {
          code: 'forbidden',
          error: 'deletion denied',
        },
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const result = await og.branches.merge({
      source: 'feature',
      deleteBranch: true,
    });
    expect(result.commit?.graphCommitId).toBe('own-merge');
    expect(result.branchDeleted).toBe(false);
    expect(result.branchDeleteErrorDetails?.code).toBe('forbidden');
  });

  it('requires the optional deletion result when requested', async () => {
    const { fetch } = stubFetch({ body: receipt });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await expect(
      og.branches.merge({ source: 'feature', deleteBranch: true }),
    ).rejects.toBeInstanceOf(ApiContractError);
  });
});
