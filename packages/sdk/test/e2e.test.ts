// End-to-end tests against a real omnigraph-server.
//
// Skipped unless OMNIGRAPH_E2E=1. Local quick-start:
//
//   tmp=$(mktemp -d)
//   omnigraph init --schema packages/sdk/test/fixtures/schema.pg "$tmp/repo.omni"
//   omnigraph load --data packages/sdk/test/fixtures/data.jsonl --mode overwrite "$tmp/repo.omni"
//   OMNIGRAPH_SERVER_BEARER_TOKEN=ci-token omnigraph-server "$tmp/repo.omni" --bind 127.0.0.1:18080 &
//   OMNIGRAPH_E2E=1 OMNIGRAPH_BASE_URL=http://127.0.0.1:18080 OMNIGRAPH_TOKEN=ci-token \
//     pnpm --filter @modernrelay/omnigraph run test
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

// Track branches to clean up after the suite — best-effort, since a recent
// merge can leave a branch flagged 'active' transiently. See MR-811 family.
const branchesToCleanup: string[] = [];
let og: Omnigraph;

describe.skipIf(!E2E_ENABLED)('e2e: live omnigraph-server', () => {
  beforeAll(() => {
    og = new Omnigraph({ baseUrl: BASE_URL, token: TOKEN });
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
    it('parameterized read returns matching row with camelCased fields', async () => {
      const r = await og.read({
        querySource:
          'query find($name: String) { match { $p: Person { name: $name } } return { $p.name, $p.age } }',
        queryName: 'find',
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

    it('parameterless read returns multiple rows', async () => {
      const r = await og.read({
        querySource:
          'query adults() { match { $p: Person\n$p.age > 25 } return { $p.name, $p.age } }',
        queryName: 'adults',
        branch: 'main',
      });
      expect((r.rows as unknown[]).length).toBeGreaterThanOrEqual(2);
    });

    it('change inserts a row on a fresh branch', async () => {
      const branch = `e2e-change-${Date.now()}`;
      branchesToCleanup.push(branch);
      await og.branches.create({ name: branch, from: 'main' });
      const ch = await og.change({
        querySource:
          'query addPerson($name: String, $age: I32) { insert Person { name: $name, age: $age } }',
        queryName: 'addPerson',
        params: { name: `e2e-frank-${Date.now()}`, age: 50 },
        branch,
      });
      expect((ch.affectedNodes ?? 0)).toBeGreaterThanOrEqual(1);
    });
  });

  describe('ingest', () => {
    it('merge mode creates branch and writes rows', async () => {
      const branch = `e2e-ingest-${Date.now()}`;
      const dianaName = `e2e-Diana-${Date.now()}`;
      branchesToCleanup.push(branch);
      const result = await og.ingest({
        branch,
        from: 'main',
        mode: LoadMode.MERGE,
        data: JSON.stringify({ type: 'Person', data: { name: dianaName, age: 40 } }) + '\n',
      });
      expect(result.branch).toBe(branch);
      expect(result.tables.length).toBeGreaterThan(0);

      const r = await og.read({
        querySource:
          'query find($name: String) { match { $p: Person { name: $name } } return { $p.name, $p.age } }',
        queryName: 'find',
        params: { name: dianaName },
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
      const bad = new Omnigraph({ baseUrl: BASE_URL, token: 'wrong-token' });
      await expect(bad.snapshot({ branch: 'main' })).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('malformed query surfaces BadRequestError', async () => {
      await expect(
        og.read({ querySource: 'this is not gq', queryName: 'broken', branch: 'main' }),
      ).rejects.toBeInstanceOf(BadRequestError);
    });
  });
});
