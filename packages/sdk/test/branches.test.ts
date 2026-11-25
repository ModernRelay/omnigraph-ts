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

  it('listDetailed sends detailed=true and camelCases each branch detail', async () => {
    const head = {
      graph_commit_id: 'c2', graph_manifest_version: 4, graph_branch: 'feature',
      parent_commit_id: 'c1', merged_parent_commit_id: null, actor_id: 'act-a',
      created_at: 1714000000000000, kind: 'published', published: true,
    };
    const { fetch, calls } = stubFetch({
      body: {
        branches: ['feature', 'main', 'secret'],
        details: [
          { name: 'feature', head, from: 'main', from_commit_id: 'c1', created_at: 1713000000000000, updated_at: 1714000000000000 },
          { name: 'main', head: { ...head, graph_branch: null }, updated_at: 1714000000000000 },
        ],
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const result = await og.branches.listDetailed();
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://x/graphs/g/branches?detailed=true');
    // A branch the caller may not read is listed without details.
    expect(result.branches).toEqual(['feature', 'main', 'secret']);
    expect(result.details.map((d) => d.name)).toEqual(['feature', 'main']);
    expect(result.details[0]).toMatchObject({
      from: 'main', fromCommitId: 'c1', createdAt: 1713000000000000, updatedAt: 1714000000000000,
      head: { graphCommitId: 'c2', graphBranch: 'feature' },
    });
    expect(result.details[1]?.from).toBeUndefined();
  });

  it('listDetailed refuses a listing without details as a contract failure', async () => {
    const { fetch } = stubFetch({ body: { branches: ['main'] } });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await expect(og.branches.listDetailed()).rejects.toMatchObject({
      name: 'ApiContractError', outcomeUnknown: false,
    });
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
          kind: 'published',
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
    kind: 'published',
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

  it('preserves branch names exactly before sending and validating', async () => {
    const { fetch, calls } = stubFetch({ body: { ...receipt, source: ' feature ', target: ' main ', commit: { ...commit, graph_branch: ' main ' } } });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const result = await og.branches.merge({
      source: ' feature ',
      target: ' main ',
    });
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      source: ' feature ',
      target: ' main ',
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
    { ...receipt, commit: { ...commit, kind: 'unpublished', published: false } },
    { ...receipt, commit: { ...commit, kind: 'published', published: false } },
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

it('branch review uses the scoped diff and merge-base routes', async () => {
  const { fetch, calls } = stubFetch([
    { body: { from_commit_id: 'a', to_commit_id: 'b', base_commit_id: 'a', changes: [{ after: { properties: { snake_case: 1 } } }] } },
    { body: { source: 'topic', target: 'main', source_commit_id: 'b', target_commit_id: 'a', merge_base: { graph_commit_id: 'a' } } },
  ]);
  const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
  expect((await og.branches.diff({ source: 'topic', target: 'main', limit: 1 })).changes[0]!.after!.properties).toEqual({ snake_case: 1 });
  expect((await og.branches.mergeBase({ source: 'topic', target: 'main' })).mergeBase.graphCommitId).toBe('a');
  expect(calls.map(c => c.url)).toEqual(['http://x/graphs/g/branches/diff?source=topic&target=main&limit=1', 'http://x/graphs/g/branches/merge-base?source=topic&target=main']);
});

it('accepts a dry-run receipt without requiring a publication and forwards fromCommit', async () => {
  const { fetch, calls } = stubFetch([{ body: { source: 'topic', target: 'main', outcome: 'fast_forward', dry_run: true, commit: null } }, { body: { name: 'copy', from: 'main', from_commit_id: 'c' } }]);
  const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
  expect((await og.branches.merge({ source: 'topic', dryRun: true })).commit).toBeNull();
  await og.branches.create({ name: 'copy', fromCommit: 'c' });
  expect(JSON.parse(calls[1]!.body!)).toEqual({ name: 'copy', from_commit: 'c' });
});


it('accepts the detached u64 version in a complete asCommit receipt without treating it as publication', async () => {
  const { fetch } = stubFetch({ body: { source: 'topic', target: 'main', outcome: 'merged', actor_id: 'alice', commit: {
    graph_commit_id: 'proposal', graph_manifest_version: 9223372036854776000, graph_branch: 'main',
    kind: 'unpublished', published: false, parent_commit_id: 'target', merged_parent_commit_id: 'source', actor_id: 'alice',
  } } });
  const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
  expect((await og.branches.merge({ source: 'topic', asCommit: true })).commit!.graphCommitId).toBe('proposal');
});

describe('dry-run merge classification', () => {
  const contract = { 'Omnigraph-Http-Api': '0.14' };
  const losing = (body?: string) => {
    let posts = 0;
    const fetch = async (_input: unknown, init?: RequestInit) => {
      if (init?.method === 'HEAD') return new Response(null, { headers: contract });
      posts++;
      if (body !== undefined) return new Response(body, { headers: { ...contract, 'content-type': 'application/json' } });
      throw new TypeError('socket hang up');
    };
    return { og: new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch: fetch as typeof globalThis.fetch }), posts: () => posts };
  };

  it('a dry run whose answer is lost has no effects; a merge stays uncertain', async () => {
    const dry = losing();
    await expect(dry.og.branches.merge({ source: 'topic', dryRun: true })).rejects.toMatchObject({
      name: 'NetworkError', requestDispatched: true, outcomeUnknown: false,
    });
    expect(dry.posts()).toBe(1);
    const real = losing();
    await expect(real.og.branches.merge({ source: 'topic' })).rejects.toMatchObject({ outcomeUnknown: true });
  });

  it('a dry run whose body is interrupted has no effects', async () => {
    await expect(losing('{"source":"topic",').og.branches.merge({ source: 'topic', dryRun: true }))
      .rejects.toMatchObject({ name: 'NetworkError', outcomeUnknown: false });
  });

  it('a dry run with a malformed error body has no effects', async () => {
    const { fetch } = stubFetch({ status: 500, body: 'not json' });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await expect(og.branches.merge({ source: 'topic', dryRun: true })).rejects.toMatchObject({ outcomeUnknown: false });
  });

  it('a reply that contradicts the dry run leaves effects unknown', async () => {
    const { fetch } = stubFetch({ body: {
      source: 'topic', target: 'main', outcome: 'fast_forward', dry_run: false, commit: null,
    } });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await expect(og.branches.merge({ source: 'topic', dryRun: true })).rejects.toMatchObject({
      name: 'ApiContractError', outcomeUnknown: true,
    });
  });
});

it('classifies a merge by the body it sends, not by inherited input properties', async () => {
  // A prototype getter is not copied into the request, so the server runs a
  // real merge; losing its answer must stay outcome unknown.
  class Options { source = 'topic'; get dryRun() { return true; } }
  const bodies: string[] = [];
  const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch: async (_input, init) => {
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'Omnigraph-Http-Api': '0.14' } });
    bodies.push(String(init?.body));
    throw new TypeError('socket hang up');
  } });
  await expect(og.branches.merge(new Options())).rejects.toMatchObject({ outcomeUnknown: true });
  expect(JSON.parse(bodies[0]!)).toEqual({ source: 'topic', target: 'main' });
});
