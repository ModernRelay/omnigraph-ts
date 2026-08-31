import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { SERVER_VERSION } from '@modernrelay/omnigraph';
import { createOmnigraphMcpServer, type CreateServerOptions } from '../src/server';
import { MCP_PACKAGE_VERSION } from '../src/version.gen';

const COMMIT = {
  graph_commit_id: '01KQ',
  graph_branch: 'main',
  graph_manifest_version: 2,
  parent_commit_id: '01KP',
  merged_parent_commit_id: null,
  actor_id: null,
  created_at: 1714000000000000,
};
const CHANGE_BLOCK = {
  cause: { graph_commit_id: '01KQ', authored_branch: 'main', authored_at: 1714000000000000 },
  changes: [{
    kind: 'node', type: { id: 'person-life', name: 'Person' }, id: 'alice', op: 'update',
    before: { properties: { display_name: 'Alice', nested_data: { UserKey: 1 } } },
    after: { properties: { display_name: 'Alice Updated', nested_data: { UserKey: 2 } } },
  }],
};

function toolJson(result: Record<string, unknown>) {
  return JSON.parse((result.content as Array<{ type: string; text: string }>)[0]!.text);
}

// Recover the flat operation path from a (possibly graph-scoped) URL. The
// server is configured with a graphId, so the transport sends graph-scoped
// ops under /graphs/{id}/…; strip that prefix so the fakes below can match on
// `/read`, `/branches`, … unchanged. Flat paths (/healthz, /graphs) pass through.
function flatPath(url: string): string {
  return new URL(url).pathname.replace(/^\/graphs\/[^/]+/, '');
}

// A stub fetch that emulates a small slice of omnigraph-server. We don't
// want a real server in the unit tests; we just want to verify the MCP
// wiring (tool registration, schema, dispatch, response shape) works.
function fakeFetch(): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = flatPath(url);
    const method = init?.method ?? 'GET';
    const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      });

    if (method === 'GET' && path === '/healthz') {
      return respond(200, { status: 'ok', version: '0.10.0' });
    }
    if (method === 'GET' && path === '/snapshot') {
      return respond(200, {
        graph_branch: 'main',
        graph_manifest_version: 2,
        internal_schema_version: 6,
        datasets: [{ entity_kind: 'node', type_name: 'Person', entity_count: 4,
          dataset_path: 'nodes/Person', published_dataset_version: 1, native_dataset_branch: null }],
      });
    }
    if (method === 'GET' && path === '/branches') {
      return respond(200, { branches: ['main', 'feature'] });
    }
    if (method === 'GET' && path === '/schema') {
      return respond(200, { schema_source: 'node Person { name: String @key }' });
    }
    if (method === 'POST' && path === '/query') {
      return respond(200, {
        query_name: 'q',
        target: { branch: 'main', snapshot: null },
        row_count: 1,
        columns: ['$p.name'],
        rows: [{ '$p.name': 'Alice' }],
        graph_commit_id: '01KP',
      });
    }
    if (method === 'POST' && (path === '/mutate' || path === '/mutate/if-graph-commit')) {
      return respond(200, {
        actor_id: null,
        affected_edges: 0,
        affected_nodes: 1,
        branch: 'main',
        query_name: 'q',
        commit: COMMIT,
      });
    }
    if (method === 'POST' && path === '/load') {
      return respond(200, {
        uri: 'file:///graph', branch: 'main', branch_created: false, mode: 'merge',
        nodes: [{ name: 'Person', entities_loaded: 1 }], edges: [], total_entities: 1, commit: COMMIT,
      });
    }
    if (method === 'GET' && path === '/commits') {
      return respond(200, {
        commits: [COMMIT],
      });
    }
    return respond(404, { error: 'not found', code: 'not_found' });
  }) as unknown as typeof globalThis.fetch;
}

async function setup(opts: Partial<CreateServerOptions> = {}) {
  const server = createOmnigraphMcpServer({ baseUrl: 'http://x', graphId: 'g', fetch: fakeFetch(), ...opts });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { server, client };
}

describe('omnigraph-mcp server', () => {
  it('initializes and reports server info', async () => {
    const { client } = await setup();
    const info = client.getServerVersion();
    expect(info?.name).toBe('omnigraph-mcp');
    expect(info?.version).toBe(MCP_PACKAGE_VERSION);
  });

  it('lists every expected tool', async () => {
    const { client } = await setup();
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'branches_create',
        'branches_delete',
        'branches_list',
        'branches_merge',
        'changes_poll',
        'commits_changes',
        'commits_get',
        'commits_list',
        'graphs_list',
        'health',
        'load',
        'mutate',
        'query',
        'schema_get',
        'snapshot',
      ].sort(),
    );
  });

  it('annotates mutating tools with destructiveHint', async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get('load')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('branches_delete')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('branches_merge')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('snapshot')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('schema_get')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('changes_poll')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('commits_changes')?.annotations?.readOnlyHint).toBe(true);
  });

  it('calls the health tool and round-trips the SDK SERVER_VERSION', async () => {
    const { client } = await setup();
    const r = await client.callTool({ name: 'health', arguments: {} });
    const block = (r.content as Array<{ type: string; text: string }>)[0]!;
    const parsed = JSON.parse(block.text);
    expect(parsed.status).toBe('ok');
    expect(parsed.version).toBe('0.10.0');
    expect(parsed.sdkServerVersion).toBe(SERVER_VERSION);
  });

  it('calls the query tool and preserves opaque param keys', async () => {
    const { client } = await setup();
    const r = await client.callTool({
      name: 'query',
      arguments: {
        query: 'query q($name: String) { match { $p: Person { name: $name } } return { $p.name } }',
        name: 'q',
        params: { name: 'Alice', $internal: 1 },
        branch: 'main',
      },
    });
    const block = (r.content as Array<{ type: string; text: string }>)[0]!;
    const parsed = JSON.parse(block.text);
    expect(parsed.queryName).toBe('q');
    expect(parsed.rowCount).toBe(1);
    expect(parsed.rows[0]['$p.name']).toBe('Alice');
    expect(parsed.graphCommitId).toBe('01KP');
  });

  it('returns v0.10 snapshot vocabulary and exact load/commit receipts', async () => {
    const { client } = await setup();
    const snapshot = toolJson(await client.callTool({ name: 'snapshot', arguments: {} }));
    expect(snapshot).toEqual({
      graphBranch: 'main', graphManifestVersion: 2, internalSchemaVersion: 6,
      datasets: [{ entityKind: 'node', typeName: 'Person', entityCount: 4,
        datasetPath: 'nodes/Person', publishedDatasetVersion: 1, nativeDatasetBranch: null }],
    });
    const load = toolJson(await client.callTool({
      name: 'load', arguments: { branch: 'main', mode: 'merge', data: '{"type":"Person","data":{"name":"Alice"}}' },
    }));
    expect(load.totalEntities).toBe(1);
    expect(load.nodes).toEqual([{ name: 'Person', entitiesLoaded: 1 }]);
    expect(load.commit.graphCommitId).toBe('01KQ');
    const commits = toolJson(await client.callTool({ name: 'commits_list', arguments: {} }));
    expect(commits.commits[0]).toEqual(load.commit);
    expect(load.commit.graphManifestVersion).toBe(2);
    expect(load.commit.createdAt).toBe(1714000000000000);
  });

  it('routes conditional mutations exclusively through the dedicated endpoint', async () => {
    const requests: Array<{ path: string; header: string | null; body: unknown }> = [];
    const fallback = fakeFetch();
    const { client } = await setup({ fetch: async (input, init) => {
      requests.push({
        path: flatPath(String(input)),
        header: new Headers(init?.headers).get('Omnigraph-If-Graph-Commit'),
        body: JSON.parse(String(init?.body)),
      });
      return fallback(input, init);
    } });
    const result = await client.callTool({ name: 'mutate', arguments: {
      query: 'query q($newName: String) { update Person set { name: $newName } where name = "Alice" }',
      params: { newName: 'Alice Updated' }, ifGraphCommit: '01KP',
    } });
    expect(result.isError).not.toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe('/mutate/if-graph-commit');
    expect(requests[0]?.header).toBe('01KP');
    expect(requests[0]?.body).toEqual({
      query: 'query q($newName: String) { update Person set { name: $newName } where name = "Alice" }',
      params: { newName: 'Alice Updated' }, branch: 'main',
    });
    expect(toolJson(result).commit.graphCommitId).toBe('01KQ');
  });

  it('returns successful no-op mutations without claiming a commit', async () => {
    const { client } = await setup({ fetch: async () => new Response(JSON.stringify({
      branch: 'main', query_name: 'noop', affected_nodes: 0, affected_edges: 0, commit: null,
    }), { headers: { 'content-type': 'application/json' } }) });
    const result = await client.callTool({ name: 'mutate', arguments: { query: 'query noop() { delete Person where name = "absent" }' } });
    expect(result.isError).not.toBe(true);
    expect(toolJson(result).commit).toBeNull();
  });

  it.each([
    { status: 412, code: undefined, detail: { precondition_failure: { expected: '01KP', actual: '01KQ' } },
      field: 'preconditionFailure', value: { expected: '01KP', actual: '01KQ' }, tool: 'mutate', args: { query: 'query q() { insert Person { name: "Alice" } }', ifGraphCommit: '01KP' } },
    { status: 409, code: 'conflict', detail: { full_text_index_rebuild_required: { index: 'Person.name', reason: 'missing certificate' } },
      field: 'fullTextIndexRebuildRequired', value: { index: 'Person.name', reason: 'missing certificate' }, tool: 'query', args: { query: 'query q() { match { $p: Person } return { $p.name } }' } },
    { status: 410, code: undefined, detail: { change_feed_gap: { cursor: 'old', first_unreadable_commit_id: '01KP' } },
      field: 'changeFeedGap', value: { cursor: 'old', firstUnreadableCommitId: '01KP' }, tool: 'changes_poll', args: { cursor: 'old' } },
    { status: 404, code: 'not_found', detail: {}, field: undefined, value: undefined,
      tool: 'mutate', args: { query: 'query q() { insert Person { name: "Alice" } }', ifGraphCommit: '01KP' } },
  ])('preserves structured $status refusals without retries or credential objects', async ({ status, code, detail, field, value, tool, args }) => {
    let calls = 0;
    const { client } = await setup({ token: 'private-bearer-token', fetch: async (_input, init) => {
      calls++;
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer private-bearer-token');
      return new Response(JSON.stringify({ error: 'operation refused', code, ...detail }), {
        status, headers: { 'content-type': 'application/json', 'x-request-id': 'request-1' },
      });
    } });
    const result = await client.callTool({ name: tool, arguments: args });
    expect(result.isError).toBe(true);
    expect(calls).toBe(1);
    const parsed = toolJson(result);
    expect(parsed).toMatchObject({ status, error: 'operation refused', requestId: 'request-1' });
    if (field) expect(parsed.body[field]).toEqual(value);
    expect(parsed).not.toHaveProperty('request');
    expect(parsed).not.toHaveProperty('response');
    expect(JSON.stringify(parsed)).not.toContain('private-bearer-token');
    expect(JSON.stringify(parsed)).not.toContain('http://x');
  });

  it('reads bounded change pages with repeated filters and opaque user properties', async () => {
    const urls: URL[] = [];
    const { client } = await setup({ defaultBranch: 'review', fetch: async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      const body = url.pathname.includes('/commits/')
        ? { ...CHANGE_BLOCK, next_page_token: 'commit-page' }
        : url.searchParams.has('page_token')
          ? { blocks: [], cursor: 'durable-cursor', caught_up: true }
          : { blocks: [CHANGE_BLOCK], next_page_token: 'feed-page' };
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    } });
    const filters = { kind: ['node', 'edge'], type: ['Person', 'Knows'], op: ['update'], limit: 2 };
    const diff = toolJson(await client.callTool({ name: 'commits_changes', arguments: { commitId: 'commit/with slash', pageToken: 'first-page', ...filters } }));
    expect(urls[0]?.pathname).toBe('/graphs/g/commits/commit%2Fwith%20slash/changes');
    expect(urls[0]?.searchParams.get('page_token')).toBe('first-page');
    expect(diff.nextPageToken).toBe('commit-page');
    expect(diff.cause.graphCommitId).toBe('01KQ');
    expect(diff.changes[0].after.properties).toEqual(CHANGE_BLOCK.changes[0]!.after.properties);
    const page = toolJson(await client.callTool({ name: 'changes_poll', arguments: { start: 'after:01KP', ...filters } }));
    expect(page.nextPageToken).toBe('feed-page');
    expect(page.cursor).toBeUndefined();
    expect(urls).toHaveLength(2); // No hidden pagination loop.
    const terminal = toolJson(await client.callTool({ name: 'changes_poll', arguments: { pageToken: page.nextPageToken, ...filters } }));
    expect(terminal).toEqual({ blocks: [], cursor: 'durable-cursor', caughtUp: true });
    expect(urls[1]?.searchParams.get('start')).toBe('after:01KP');
    expect(urls[2]?.searchParams.has('start')).toBe(false);
    for (const url of urls) {
      expect(url.searchParams.getAll('kind')).toEqual(filters.kind);
      expect(url.searchParams.getAll('type')).toEqual(filters.type);
      expect(url.searchParams.getAll('op')).toEqual(filters.op);
    }
    expect(urls[1]?.searchParams.get('branch')).toBe('review');
    expect(urls[2]?.searchParams.get('branch')).toBe('review');
  });

  it('mutate tool accepts canonical query/name fields', async () => {
    let observedBody: Record<string, unknown> | undefined;
    const recordingFetch: typeof globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const path = flatPath(url);
      const method = init?.method ?? 'GET';
      if (method === 'POST' && path === '/mutate') {
        observedBody = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
        return new Response(
          JSON.stringify({ actor_id: null, affected_edges: 0, affected_nodes: 1, branch: 'main', query_name: 'q' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;

    const server = createOmnigraphMcpServer({ baseUrl: 'http://x', graphId: 'g', fetch: recordingFetch });
    const client = new Client({ name: 'test', version: '0.0.0' });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    await client.callTool({
      name: 'mutate',
      arguments: {
        query: 'query q() { insert X {} }',
        name: 'q',
        branch: 'main',
      },
    });
    expect(observedBody).toEqual({
      query: 'query q() { insert X {} }',
      name: 'q',
      branch: 'main',
    });
  });

  it('serves the schema resource with .pg source as text/plain', async () => {
    const { client } = await setup();
    const r = await client.readResource({ uri: 'omnigraph://schema' });
    const block = (r.contents as Array<{ uri: string; mimeType?: string; text?: string }>)[0]!;
    expect(block.mimeType).toBe('text/plain');
    expect(block.text).toContain('node Person');
  });

  it('serves the branches resource with JSON list', async () => {
    const { client } = await setup();
    const r = await client.readResource({ uri: 'omnigraph://branches' });
    const block = (r.contents as Array<{ uri: string; mimeType?: string; text?: string }>)[0]!;
    expect(block.mimeType).toBe('application/json');
    expect(JSON.parse(block.text!)).toEqual(['main', 'feature']);
  });

  it('exposes the vendored best-practices resources and the index', async () => {
    const { client } = await setup();
    const r = await client.listResources();
    const uris = r.resources.map((res) => res.uri).sort();
    expect(uris).toEqual(
      [
        'omnigraph://best-practices/data',
        'omnigraph://best-practices/index',
        'omnigraph://best-practices/queries',
        'omnigraph://best-practices/schema',
        'omnigraph://best-practices/search',
        'omnigraph://branches',
        'omnigraph://graphs',
        'omnigraph://schema',
      ].sort(),
    );

    // Read one body to confirm it carries the upstream cookbook content
    // through (smoke test for the build-time sync).
    const q = await client.readResource({ uri: 'omnigraph://best-practices/queries' });
    const body = (q.contents as Array<{ uri: string; mimeType?: string; text?: string }>)[0]!;
    expect(body.mimeType).toBe('text/markdown');
    expect(body.text?.length ?? 0).toBeGreaterThan(500);

    // Index lists every cookbook entry.
    const idx = await client.readResource({ uri: 'omnigraph://best-practices/index' });
    const idxText = (idx.contents as Array<{ uri: string; text?: string }>)[0]!.text!;
    for (const key of ['queries', 'data', 'schema', 'search']) {
      expect(idxText).toContain(`omnigraph://best-practices/${key}`);
    }
  });

  it('returns workflow instructions on initialize', async () => {
    const { client } = await setup();
    const instructions = client.getInstructions();
    expect(instructions).toBeTruthy();
    // Sentinel phrases the LLM-facing brief must keep.
    expect(instructions).toMatch(/ALWAYS read .*schema.* FIRST/);
    expect(instructions).toMatch(/best-practices/);
    expect(instructions).toContain('commit: null');
    expect(instructions).toContain('ifGraphCommit');
    expect(instructions).toContain('Do not retry every 409');
    expect(instructions).toContain('fullTextIndexRebuildRequired');
    expect(instructions).not.toContain('Retry once');
    expect(instructions).not.toContain('best-practices/remote-ops');
    expect(instructions).toContain('it is not request deduplication');
    expect(instructions).not.toContain('idempotent — use this');
  });

it('branches_create honours configured defaultBranch when `from` is omitted', async () => {
    let observedFrom: string | undefined;
    const recordingFetch: typeof globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const path = flatPath(url);
      const method = init?.method ?? 'GET';
      if (method === 'POST' && path === '/branches') {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
        observedFrom = body.from;
        return new Response(
          JSON.stringify({ uri: 's3://x', name: body.name, from: body.from, actor_id: null }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;

    const server = createOmnigraphMcpServer({
      baseUrl: 'http://x', graphId: 'g',
      defaultBranch: 'review-2026',
      fetch: recordingFetch,
    });
    const client = new Client({ name: 'test', version: '0.0.0' });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    await client.callTool({ name: 'branches_create', arguments: { name: 'feature' } });
    expect(observedFrom).toBe('review-2026');
  });

  it('query tool omits branch when snapshot is set (mutually exclusive)', async () => {
    let observedBody: Record<string, unknown> | undefined;
    const recordingFetch: typeof globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const path = flatPath(url);
      const method = init?.method ?? 'GET';
      if (method === 'POST' && path === '/query') {
        observedBody = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
        return new Response(
          JSON.stringify({
            query_name: 'q',
            target: { branch: null, snapshot: 'snap-1' },
            row_count: 0,
            columns: [],
            rows: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;

    const server = createOmnigraphMcpServer({
      baseUrl: 'http://x', graphId: 'g',
      defaultBranch: 'main',
      fetch: recordingFetch,
    });
    const client = new Client({ name: 'test', version: '0.0.0' });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    await client.callTool({
      name: 'query',
      arguments: { query: 'query q { match { $p: Person } return { $p.name } }', snapshot: 'snap-1' },
    });
    expect(observedBody?.snapshot).toBe('snap-1');
    expect(observedBody?.branch).toBeUndefined();
  });

  it('does not expose a schema_apply tool (cluster graphs reject HTTP schema apply)', async () => {
    const { client } = await setup();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain('schema_apply');
  });

  it('rejects calls with missing required input', async () => {
    const { client } = await setup();
    // query is required on `query`.
    const r = await client.callTool({ name: 'query', arguments: {} });
    expect(r.isError).toBe(true);
  });
});
