import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createOmnigraphMcpServer } from '../src/server';

// A stub fetch that emulates a small slice of omnigraph-server. We don't
// want a real server in the unit tests; we just want to verify the MCP
// wiring (tool registration, schema, dispatch, response shape) works.
function fakeFetch(): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url).pathname;
    const method = init?.method ?? 'GET';
    const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      });

    if (method === 'GET' && path === '/healthz') {
      return respond(200, { status: 'ok', version: '0.3.0' });
    }
    if (method === 'GET' && path === '/snapshot') {
      return respond(200, {
        branch: 'main',
        snapshot_id: 'snap-1',
        tables: [{ table_key: 'node:Person', row_count: 4, table_version: 1, table_branch: null }],
      });
    }
    if (method === 'GET' && path === '/branches') {
      return respond(200, { branches: ['main', 'feature'] });
    }
    if (method === 'GET' && path === '/schema') {
      return respond(200, { schema_source: 'node Person { name: String @key }' });
    }
    if (method === 'POST' && path === '/read') {
      return respond(200, {
        query_name: 'q',
        target: { branch: 'main', snapshot: null },
        row_count: 1,
        columns: ['$p.name'],
        rows: [{ '$p.name': 'Alice' }],
      });
    }
    if (method === 'GET' && path === '/commits') {
      return respond(200, {
        commits: [
          {
            graph_commit_id: '01KQ',
            manifest_branch: null,
            manifest_version: 1,
            parent_commit_id: null,
            merged_parent_commit_id: null,
            actor_id: null,
            created_at: 1,
          },
        ],
      });
    }
    return respond(404, { error: 'not found', code: 'not_found' });
  }) as unknown as typeof globalThis.fetch;
}

async function setup() {
  const server = createOmnigraphMcpServer({ baseUrl: 'http://x', fetch: fakeFetch() });
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
    expect(info?.version).toBe('0.3.0');
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
        'change',
        'commits_get',
        'commits_list',
        'health',
        'ingest',
        'read',
        'schema_apply',
        'schema_get',
        'snapshot',
      ].sort(),
    );
  });

  it('annotates mutating tools with destructiveHint', async () => {
    const { client } = await setup();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get('change')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('ingest')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('branches_delete')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('branches_merge')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('schema_apply')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('read')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('snapshot')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('schema_get')?.annotations?.readOnlyHint).toBe(true);
  });

  it('calls the health tool and round-trips the SDK SERVER_VERSION', async () => {
    const { client } = await setup();
    const r = await client.callTool({ name: 'health', arguments: {} });
    const block = (r.content as Array<{ type: string; text: string }>)[0]!;
    const parsed = JSON.parse(block.text);
    expect(parsed.status).toBe('ok');
    expect(parsed.version).toBe('0.3.0');
    expect(parsed.sdkServerVersion).toBe('0.3.0');
  });

  it('calls the read tool and preserves opaque param keys', async () => {
    const { client } = await setup();
    const r = await client.callTool({
      name: 'read',
      arguments: {
        querySource: 'query q($name: String) { match { $p: Person { name: $name } } return { $p.name } }',
        queryName: 'q',
        params: { name: 'Alice', $internal: 1 },
        branch: 'main',
      },
    });
    const block = (r.content as Array<{ type: string; text: string }>)[0]!;
    const parsed = JSON.parse(block.text);
    expect(parsed.queryName).toBe('q');
    expect(parsed.rowCount).toBe(1);
    expect(parsed.rows[0]['$p.name']).toBe('Alice');
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

  it('rejects calls with missing required input', async () => {
    const { client } = await setup();
    // querySource is required on `read`.
    const r = await client.callTool({ name: 'read', arguments: {} });
    expect(r.isError).toBe(true);
  });
});
