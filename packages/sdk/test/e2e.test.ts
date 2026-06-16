// End-to-end tests against a real omnigraph-server (cluster-only, 0.7.0+).
//
// Skipped unless OMNIGRAPH_E2E=1. Local quick-start (a local-filesystem
// cluster serving two graphs, alpha + beta):
//
//   dir=$(mktemp -d)
//   cp packages/sdk/test/fixtures/schema.pg "$dir/graph.pg"
//   cat > "$dir/cluster.yaml" <<'YAML'
//   version: 1
//   metadata: { name: e2e }
//   state: { backend: cluster, lock: true }
//   graphs:
//     alpha: { schema: ./graph.pg }
//     beta:  { schema: ./graph.pg }
//   policies:
//     server: { file: ./server.policy.yaml, applies_to: [cluster] }
//     data:   { file: ./graph.policy.yaml,  applies_to: [alpha, beta] }
//   YAML
//   # server.policy.yaml grants `graph_list`; graph.policy.yaml grants the
//   # per-graph data actions (read/export/change/schema_apply/branch_*).
//   omnigraph cluster import --config "$dir"
//   omnigraph cluster apply  --config "$dir"
//   for g in alpha beta; do
//     omnigraph load --data packages/sdk/test/fixtures/data.jsonl --mode overwrite "$dir/graphs/$g.omni"
//   done
//   OMNIGRAPH_SERVER_BEARER_TOKEN=ci-token omnigraph-server --cluster "$dir" --bind 127.0.0.1:18080 &
//   OMNIGRAPH_E2E=1 OMNIGRAPH_BASE_URL=http://127.0.0.1:18080 OMNIGRAPH_TOKEN=ci-token \
//     OMNIGRAPH_GRAPH_ID=alpha pnpm --filter @modernrelay/omnigraph run test
//
// CI runs this in `.github/workflows/e2e.yml` against the omnigraph-server
// release pinned by `omnigraph.serverVersion` in the repo-root package.json.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Omnigraph, {
  BadRequestError,
  BranchMergeOutcome,
  LoadMode,
  NotFoundError,
  SERVER_VERSION,
  UnauthorizedError,
} from '../src';

const E2E_ENABLED = process.env.OMNIGRAPH_E2E === '1';
const BASE_URL = process.env.OMNIGRAPH_BASE_URL ?? 'http://127.0.0.1:18080';
const TOKEN = process.env.OMNIGRAPH_TOKEN;
const GRAPH_ID = process.env.OMNIGRAPH_GRAPH_ID;

// Track branches to clean up after the suite — best-effort, since a recent
// merge can leave a branch flagged 'active' transiently. See MR-811 family.
const branchesToCleanup: string[] = [];
let og: Omnigraph;

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
      expect(s.branch).toBe('main');
      expect(s.tables.length).toBeGreaterThan(0);
    });
  });

  describe('snapshot', () => {
    it('GET /snapshot?branch=main returns tables with row counts', async () => {
      const s = await og.snapshot({ branch: 'main' });
      expect(s.branch).toBe('main');
      expect(Array.isArray(s.tables)).toBe(true);
      expect(s.tables.length).toBeGreaterThan(0);
      const person = s.tables.find((t) => t.tableKey?.includes('Person'));
      expect(person?.rowCount).toBeGreaterThanOrEqual(4);
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

    it('mutate inserts a row on a fresh branch', async () => {
      const branch = `e2e-mutate-${Date.now()}`;
      branchesToCleanup.push(branch);
      await og.branches.create({ name: branch, from: 'main' });
      const ch = await og.mutate({
        query:
          'query addPerson($name: String, $age: I32) { insert Person { name: $name, age: $age } }',
        name: 'addPerson',
        params: { name: `e2e-frank-${Date.now()}`, age: 50 },
        branch,
      });
      expect((ch.affectedNodes ?? 0)).toBeGreaterThanOrEqual(1);
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
      expect(result.tables.length).toBeGreaterThan(0);

      const r = await og.query({
        query:
          'query find($name: String) { match { $p: Person { name: $name } } return { $p.name, $p.age } }',
        name: 'find',
        params: { name },
        branch,
      });
      expect((r.rows as unknown[]).length).toBe(1);
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
