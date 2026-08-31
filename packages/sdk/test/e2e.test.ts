// End-to-end tests against a real omnigraph-server (cluster-only, 0.7.0+).
//
// Skipped unless OMNIGRAPH_E2E=1. Local quick-start (a local-filesystem
// cluster serving two graphs, alpha + beta):
//
//   dir=$(mktemp -d)
//   cp packages/sdk/test/fixtures/schema.pg "$dir/graph.pg"
//   cp packages/sdk/test/fixtures/queries.gq "$dir/queries.gq"
//   cat > "$dir/cluster.yaml" <<'YAML'
//   version: 1
//   metadata: { name: e2e }
//   state: { backend: cluster, lock: true }
//   graphs:
//     alpha: { schema: ./graph.pg, queries: [./queries.gq] }
//     beta:  { schema: ./graph.pg, queries: [./queries.gq] }
//   policies:
//     server: { file: ./server.policy.yaml, applies_to: [cluster] }
//     data:   { file: ./graph.policy.yaml,  applies_to: [alpha, beta] }
//   YAML
//   # server.policy.yaml grants `graph_list`; graph.policy.yaml grants the
//   # per-graph data actions (read/export/change/schema_apply/branch_*/invoke_query).
//   omnigraph lint --schema "$dir/graph.pg" --query "$dir/queries.gq"
//   omnigraph cluster import --config "$dir"
//   omnigraph cluster plan   --config "$dir"
//   omnigraph cluster apply  --config "$dir"
//   for g in alpha beta; do
//     omnigraph load --data packages/sdk/test/fixtures/data.jsonl --mode overwrite "$dir/graphs/$g.omni"
//   done
//   OMNIGRAPH_SERVER_BEARER_TOKEN=ci-token omnigraph-server --cluster "$dir" --bind 127.0.0.1:18080 &
//   OMNIGRAPH_E2E=1 OMNIGRAPH_BASE_URL=http://127.0.0.1:18080 OMNIGRAPH_TOKEN=ci-token \
//     OMNIGRAPH_GRAPH_ID=alpha pnpm --filter @modernrelay/omnigraph run test
//
// CI runs this in `.github/workflows/e2e.yml` against the omnigraph-server
// source pinned in the repo-root package.json (release tag or exact commit).

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Omnigraph, {
  BadRequestError,
  BranchMergeOutcome,
  LoadMode,
  NotFoundError,
  PreconditionFailedError,
  RangeNotSatisfiableError,
  SERVER_VERSION,
  UnauthorizedError,
  type ChangeBaselineRecord,
  type EntityChange,
} from '../src';

const E2E_ENABLED = process.env.OMNIGRAPH_E2E === '1';
const BASE_URL = process.env.OMNIGRAPH_BASE_URL ?? 'http://127.0.0.1:18080';
const TOKEN = process.env.OMNIGRAPH_TOKEN;
const GRAPH_ID = process.env.OMNIGRAPH_GRAPH_ID;
const FIXTURE_QUERIES = readFileSync(new URL('./fixtures/queries.gq', import.meta.url), 'utf8');

// Track branches to clean up after the suite — best-effort, since a recent
// merge can leave a branch flagged 'active' transiently. See MR-811 family.
const branchesToCleanup: string[] = [];
let og: Omnigraph;

function findPerson(branch: string, name: string) {
  return og.query({ query: FIXTURE_QUERIES, name: 'find_person', params: { name }, branch });
}

describe.skipIf(!E2E_ENABLED)('e2e: live omnigraph-server', () => {
  beforeAll(() => {
    // 0.7.0 is cluster-only: graph-scoped ops require a graphId. Fail loud
    // here rather than letting every test throw ConfigurationError.
    if (!GRAPH_ID) {
      throw new Error('OMNIGRAPH_E2E=1 requires OMNIGRAPH_GRAPH_ID (cluster-only server)');
    }
    og = new Omnigraph({ baseUrl: BASE_URL, token: TOKEN, graphId: GRAPH_ID });
  });

  afterAll(async () => {
    if (!og) return;
    for (const name of branchesToCleanup) {
      try {
        await og.branches.delete(name);
      } catch {
        // ignore — cleanup is best-effort
      }
    }
  });

  describe('connectivity', () => {
    it('GET /healthz returns ok', async () => {
      const h = await og.health();
      expect(h.status).toBe('ok');
      expect(typeof h.version).toBe('string');
    });

    it('SERVER_VERSION constant matches /healthz major.minor', async () => {
      const h = await og.health();
      const sdkMajorMinor = SERVER_VERSION.split('.').slice(0, 2).join('.');
      const serverMajorMinor = h.version.split('.').slice(0, 2).join('.');
      expect(serverMajorMinor).toBe(sdkMajorMinor);
    });
  });

  describe('graphs registry + cluster routing', () => {
    it('graphs.list returns the configured graph (and beta)', async () => {
      const graphs = await og.graphs.list();
      const ids = graphs.map((g) => g.graphId);
      expect(ids).toContain(GRAPH_ID);
      expect(ids).toContain('beta');
    });

    it('og.graph("beta") routes under /graphs/beta and returns a snapshot', async () => {
      const beta = og.graph('beta');
      const s = await beta.snapshot({ branch: 'main' });
      expect(s.graphBranch).toBe('main');
      expect(s.datasets.length).toBeGreaterThan(0);
    });
  });

  describe('snapshot', () => {
    it('GET /snapshot?branch=main returns node and edge entity counts', async () => {
      const s = await og.snapshot({ branch: 'main' });
      expect(s.graphBranch).toBe('main');
      expect(s.graphManifestVersion).toBeGreaterThan(0);
      const person = s.datasets.find((d) => d.typeName === 'Person' && d.entityKind === 'node');
      expect(person?.entityCount).toBe(4);
      const knows = s.datasets.find((d) => d.typeName === 'Knows' && d.entityKind === 'edge');
      expect(knows?.entityCount).toBe(3);
    });
  });

  describe('branches', () => {
    it('list contains main', async () => {
      const branches = await og.branches.list();
      expect(branches).toContain('main');
    });

    it('create + list + delete round-trip', async () => {
      const name = `e2e-create-${Date.now()}`;
      branchesToCleanup.push(name);
      await og.branches.create({ name, from: 'main' });
      const after = await og.branches.list();
      expect(after).toContain(name);
      await og.branches.delete(name);
      const after2 = await og.branches.list();
      expect(after2).not.toContain(name);
      branchesToCleanup.pop();
    });

    it('merge returns fast_forward when target unchanged', async () => {
      const src = `e2e-merge-src-${Date.now()}`;
      branchesToCleanup.push(src);
      await og.branches.create({ name: src, from: 'main' });
      const m = await og.branches.merge({ source: src, target: 'main' });
      expect([BranchMergeOutcome.FAST_FORWARD, BranchMergeOutcome.ALREADY_UP_TO_DATE]).toContain(m.outcome);
    });

    it('idempotent re-merge yields already_up_to_date', async () => {
      const src = `e2e-idempotent-${Date.now()}`;
      branchesToCleanup.push(src);
      await og.branches.create({ name: src, from: 'main' });
      await og.branches.merge({ source: src, target: 'main' });
      const m2 = await og.branches.merge({ source: src, target: 'main' });
      expect(m2.outcome).toBe(BranchMergeOutcome.ALREADY_UP_TO_DATE);
    });
  });

  describe('queries', () => {
    it('parameterized query returns matching row with camelCased fields', async () => {
      const r = await og.query({
        query:
          'query find($name: String) { match { $p: Person { name: $name } } return { $p.name, $p.age } }',
        name: 'find',
        params: { name: 'Alice' },
        branch: 'main',
      });
      expect(r.rows).toHaveLength(1);
      // Row keys are user-schema-driven and not camelized (opaque).
      const rows = r.rows as Record<string, unknown>[];
      const row = rows[0]!;
      const nameField = row['$p.name'] ?? row['p.name'] ?? row['name'];
      expect(nameField).toBe('Alice');
    });

    it('parameterless query returns multiple rows', async () => {
      const r = await og.query({
        query:
          'query adults() { match { $p: Person\n$p.age > 25 } return { $p.name, $p.age } }',
        name: 'adults',
        branch: 'main',
      });
      expect((r.rows as unknown[]).length).toBeGreaterThanOrEqual(2);
    });

    it('conditional mutation commits once, rejects stale heads, and reports no-op null', async () => {
      const branch = `e2e-mutate-${Date.now()}`;
      branchesToCleanup.push(branch);
      await og.branches.create({ name: branch, from: 'main' });
      const name = `e2e-frank-${Date.now()}`;
      const before = await findPerson(branch, name);
      expect(before.rows).toEqual([]);
      expect(before.graphCommitId).toEqual(expect.any(String));
      const ch = await og.mutate({
        query: FIXTURE_QUERIES,
        name: 'add_person',
        params: { name, age: 50 },
        branch,
      }, { ifGraphCommit: before.graphCommitId! });
      expect(ch.affectedNodes).toBe(1);
      expect(ch.commit).toMatchObject({ graphBranch: branch, parentCommitId: before.graphCommitId });
      expect(await og.commits.retrieve(ch.commit!.graphCommitId)).toEqual(ch.commit);
      const committed = await findPerson(branch, name);
      expect(committed.graphCommitId).toBe(ch.commit!.graphCommitId);
      expect(committed.rows).toEqual([{ name, age: 50 }]);

      const stale = og.mutate({
        query: FIXTURE_QUERIES, name: 'set_age', params: { name, age: 99 }, branch,
      }, { ifGraphCommit: before.graphCommitId! });
      await expect(stale).rejects.toBeInstanceOf(PreconditionFailedError);
      await expect(stale).rejects.toMatchObject({
        status: 412,
        preconditionFailure: { expected: before.graphCommitId, actual: ch.commit!.graphCommitId },
      });
      expect(await findPerson(branch, name)).toEqual(committed);

      const noOp = await og.mutate({
        query: FIXTURE_QUERIES, name: 'set_age', params: { name: 'e2e-missing-person', age: 99 }, branch,
      }, { ifGraphCommit: ch.commit!.graphCommitId });
      expect(noOp).toMatchObject({ affectedNodes: 0, affectedEdges: 0, commit: null });
      expect(await findPerson(branch, name)).toEqual(committed);
    });

    it('stored mutations use the conditional capability route', async () => {
      const branch = `e2e-stored-${Date.now()}`;
      branchesToCleanup.push(branch);
      await og.branches.create({ name: branch, from: 'main' });
      const before = await findPerson(branch, 'Alice');
      const changed = await og.queries.invoke('set_age', {
        params: { name: 'Alice', age: 31 }, branch, expectMutation: true,
      }, { ifGraphCommit: before.graphCommitId! });
      expect(changed).toMatchObject({ affectedNodes: 1 });
      if (!('affectedNodes' in changed)) throw new Error('stored mutation returned a read envelope');
      expect(await og.commits.retrieve(changed.commit!.graphCommitId)).toEqual(changed.commit);
      const committed = await findPerson(branch, 'Alice');
      expect(committed.rows).toEqual([{ name: 'Alice', age: 31 }]);
      expect(committed.graphCommitId).toBe(changed.commit!.graphCommitId);
      await expect(og.queries.invoke('set_age', {
        params: { name: 'Alice', age: 99 }, branch, expectMutation: true,
      }, { ifGraphCommit: before.graphCommitId! })).rejects.toBeInstanceOf(PreconditionFailedError);
      expect(await findPerson(branch, 'Alice')).toEqual(committed);
    });
  });

  describe('load', () => {
    // `from` is mandatory for a missing branch under 0.7.0 — without it the
    // server returns 404 (no implicit fork). This test passes `from: 'main'`.
    it('merge-mode forks a branch and writes rows', async () => {
      const branch = `e2e-load-${Date.now()}`;
      const name = `e2e-Carol-${Date.now()}`;
      branchesToCleanup.push(branch);
      const result = await og.load({
        branch,
        from: 'main',
        mode: LoadMode.MERGE,
        data: JSON.stringify({ type: 'Person', data: { name, age: 33 } }) + '\n',
      });
      expect(result.branch).toBe(branch);
      expect(result.nodes).toEqual([{ name: 'Person', entitiesLoaded: 1 }]);
      expect(result.edges).toEqual([]);
      expect(result.totalEntities).toBe(1);
      expect(result.commit?.graphBranch).toBe(branch);
      expect(await og.commits.retrieve(result.commit!.graphCommitId)).toEqual(result.commit);

      const r = await og.query({
        query:
          'query find($name: String) { match { $p: Person { name: $name } } return { $p.name, $p.age } }',
        name: 'find',
        params: { name },
        branch,
      });
      expect((r.rows as unknown[]).length).toBe(1);
      expect(r.graphCommitId).toBe(result.commit!.graphCommitId);
    });

    // New endpoint in server 0.9.0: strict bounded graph-level NDJSON batch.
    // This is the one place the raw x-ndjson request body meets a real
    // server — the unit test only proves the shape against our own mock.
    it('loadNdjson commits a strict graph batch and the rows are queryable', async () => {
      const branch = `e2e-ndjson-${Date.now()}`;
      const name = `e2e-Dave-${Date.now()}`;
      branchesToCleanup.push(branch);
      const result = await og.loadNdjson({
        branch,
        from: 'main',
        mode: LoadMode.MERGE,
        ndjson: JSON.stringify({ type: 'Person', data: { name, age: 44 } }) + '\n',
      });
      expect(result.branch).toBe(branch);
      expect(result.nodes).toEqual([{ name: 'Person', entitiesLoaded: 1 }]);
      expect(result.totalEntities).toBe(1);
      expect(await og.commits.retrieve(result.commit!.graphCommitId)).toEqual(result.commit);

      const r = await og.query({
        query:
          'query find($name: String) { match { $p: Person { name: $name } } return { $p.name, $p.age } }',
        name: 'find',
        params: { name },
        branch,
      });
      expect((r.rows as unknown[]).length).toBe(1);
      expect(r.graphCommitId).toBe(result.commit!.graphCommitId);
    });
  });

  describe('commits', () => {
    it('list returns the commit graph for main', async () => {
      const commits = await og.commits.list({ branch: 'main' });
      expect(Array.isArray(commits)).toBe(true);
      expect(commits.length).toBeGreaterThanOrEqual(1);
      const first = commits[0];
      expect(typeof first?.graphCommitId).toBe('string');
    });

    it('retrieve round-trips a commit id', async () => {
      const commits = await og.commits.list({ branch: 'main' });
      const id = commits[0]!.graphCommitId;
      const got = await og.commits.retrieve(id);
      expect(got.graphCommitId).toBe(id);
    });

    it('retrieve of bogus id throws NotFoundError', async () => {
      await expect(og.commits.retrieve('01HXXXXXXXXXXXXXXXXXXXXXXX')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('logical changes', () => {
    it('baselines nodes and edges, pages a commit, and checkpoints only complete feed pages', async () => {
      const branch = `e2e-feed-${Date.now()}`;
      const name = `e2e-friend-${Date.now()}`;
      branchesToCleanup.push(branch);
      await og.branches.create({ name: branch, from: 'main' });

      const baseline: ChangeBaselineRecord[] = [];
      for await (const record of og.changes.baseline({ branch })) baseline.push(record);
      const terminal = baseline.pop();
      if (!terminal || !('baseline' in terminal)) throw new Error('baseline has no terminal cursor');
      expect(baseline.every((record) => !('baseline' in record))).toBe(true);
      expect(baseline.some((record) => 'type' in record && record.type === 'Person')).toBe(true);
      expect(baseline.some((record) => 'edge' in record && record.edge === 'Knows')).toBe(true);
      const before = await findPerson(branch, name);
      expect(terminal.baseline.snapshotCommitId).toBe(before.graphCommitId);

      const changed = await og.mutate({
        query: FIXTURE_QUERIES, name: 'add_friend', params: { name, age: 28, from: 'Alice' }, branch,
      });
      expect(changed).toMatchObject({ affectedNodes: 1, affectedEdges: 1 });
      const commitId = changed.commit!.graphCommitId;

      const first = await og.commits.changes(commitId, { limit: 1 });
      expect(first.cause.graphCommitId).toBe(commitId);
      expect(first.changes).toHaveLength(1);
      expect(first.nextPageToken).toEqual(expect.any(String));
      const second = await og.commits.changes(commitId, { limit: 1, pageToken: first.nextPageToken! });
      expect(second.cause.graphCommitId).toBe(commitId);
      expect(second.changes).toHaveLength(1);
      expect(second.nextPageToken ?? null).toBeNull();
      const changes: EntityChange[] = [...first.changes, ...second.changes];
      expect(changes.find((change) => change.kind === 'node')).toMatchObject({
        id: name, op: 'insert', type: { name: 'Person' }, after: { properties: { name, age: 28 } },
      });
      expect(changes.find((change) => change.kind === 'edge')).toMatchObject({
        op: 'insert', type: { name: 'Knows' }, after: { endpoints: { from: 'Alice', to: name } },
      });

      const partial = await og.changes.poll({ branch, cursor: terminal.baseline.resumeCursor, limit: 1 });
      expect(partial.cursor ?? null).toBeNull(); // A page token is NOT a durable checkpoint.
      expect(partial.nextPageToken).toEqual(expect.any(String));
      expect(partial.blocks.flatMap((block) => block.changes)).toEqual(first.changes);
      const completed = await og.changes.poll({ branch, pageToken: partial.nextPageToken!, limit: 1 });
      expect(completed.nextPageToken ?? null).toBeNull();
      expect(completed.cursor).toEqual(expect.any(String));
      expect(completed.blocks.flatMap((block) => block.changes)).toEqual(second.changes);
      for (const block of [...partial.blocks, ...completed.blocks]) {
        expect(block.cause.graphCommitId).toBe(commitId);
      }
      const caughtUp = await og.changes.poll({ branch, cursor: completed.cursor! });
      expect(caughtUp).toMatchObject({ blocks: [], caughtUp: true });
    });
  });

  describe('managed Blob delivery', () => {
    it('GET/HEAD, ranges, and validators preserve byte and metadata semantics', async () => {
      const read = await findPerson('main', 'Alice');
      expect(read.graphCommitId).toEqual(expect.any(String));
      const selector = { entity: 'node' as const, type: 'Person', id: 'Alice', property: 'avatar', snapshot: read.graphCommitId! };
      const full = await og.blobs.get(selector);
      expect(full.status).toBe(200);
      expect(full.headers.get('content-type')).toBe('application/octet-stream');
      expect(full.headers.get('content-length')).toBe('11');
      expect(full.headers.get('accept-ranges')).toBe('bytes');
      const etag = full.headers.get('etag');
      // This header describes the resolved physical snapshot; it is opaque
      // evidence, NOT a graph commit id usable as the snapshot request value.
      const resolvedSnapshot = full.headers.get('omnigraph-snapshot-id');
      expect(etag).toMatch(/^".+"$/);
      expect(resolvedSnapshot).toEqual(expect.any(String));
      expect(await full.text()).toBe('Hello World');

      const head = await og.blobs.stat({ ...selector, range: 'bytes=1-4' });
      expect(head.status).toBe(200);
      expect(head.headers.get('content-length')).toBe('11'); // HEAD ignores Range.
      expect(head.headers.get('etag')).toBe(etag);
      expect(head.headers.get('omnigraph-snapshot-id')).toBe(resolvedSnapshot);
      expect(await head.text()).toBe('');

      const ranged = await og.blobs.get({ ...selector, range: 'bytes=1-4', ifRange: etag! });
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get('content-range')).toBe('bytes 1-4/11');
      expect(await ranged.text()).toBe('ello');
      const notModified = await og.blobs.get({ ...selector, ifNoneMatch: etag! });
      expect(notModified.status).toBe(304);
      expect(notModified.headers.get('etag')).toBe(etag);
      expect(await notModified.text()).toBe('');

      await expect(og.blobs.get({ ...selector, ifMatch: '"stale"' })).rejects.toBeInstanceOf(PreconditionFailedError);
      await expect(og.blobs.stat({ ...selector, ifMatch: '"stale"' })).rejects.toMatchObject({
        name: 'PreconditionFailedError', status: 412,
      });
      const unsatisfiable = og.blobs.get({ ...selector, range: 'bytes=99-' });
      await expect(unsatisfiable).rejects.toBeInstanceOf(RangeNotSatisfiableError);
      await expect(unsatisfiable).rejects.toMatchObject({ status: 416 });
    });
  });

  describe('schema', () => {
    it('get returns the persisted .pg source', async () => {
      const s = await og.schema.get();
      expect(typeof s.schemaSource).toBe('string');
      expect(s.schemaSource).toContain('node Person');
    });
  });

  describe('export', () => {
    it('streams rows as NDJSON via async iterator', async () => {
      let count = 0;
      for await (const _row of og.export({ branch: 'main' })) {
        count += 1;
        if (count > 100) break;
      }
      expect(count).toBeGreaterThanOrEqual(4);
    });
  });

  describe('error mapping', () => {
    it('bad token surfaces UnauthorizedError', async () => {
      // Skip when the server is unauthenticated (no token configured).
      if (!TOKEN) return;
      const bad = new Omnigraph({ baseUrl: BASE_URL, token: 'wrong-token', graphId: GRAPH_ID });
      await expect(bad.snapshot({ branch: 'main' })).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('malformed query surfaces BadRequestError', async () => {
      await expect(
        og.query({ query: 'this is not gq', name: 'broken', branch: 'main' }),
      ).rejects.toBeInstanceOf(BadRequestError);
    });
  });
});
