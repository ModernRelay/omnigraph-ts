import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOmnigraphMcpServer } from '../src/server';

const enabled = process.env.OMNIGRAPH_E2E === '1';

describe.skipIf(!enabled)('MCP: live 0.13 server', () => {
  const client = new Client({ name: 'live-qualification', version: '1' });
  const server = createOmnigraphMcpServer({
    baseUrl: process.env.OMNIGRAPH_BASE_URL ?? 'http://127.0.0.1:18080',
    graphId: process.env.OMNIGRAPH_GRAPH_ID,
    token: process.env.OMNIGRAPH_TOKEN,
  });
  const decode = (result: unknown) => JSON.parse((result as { content: [{ text: string }] }).content[0].text);
  beforeAll(async () => {
    if (!process.env.OMNIGRAPH_E2E_CLUSTER_DIR || !process.env.OMNIGRAPH_E2E_SERVER_PID) {
      throw new Error('Run through pnpm test:e2e with its isolated local cluster fixture');
    }
    const [local, remote] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(remote), client.connect(local)]);
  });
  afterAll(async () => { await client.close(); await server.close(); });

  it('reads active schema and parameterized data through MCP and SDK contract admission', async () => {
    const schema = await client.readResource({ uri: 'omnigraph://schema' });
    expect((schema.contents[0] as { text: string }).text).toContain('bio: String?');
    const result = await client.callTool({ name: 'query', arguments: {
      query: 'query find($name: String) { match { $p: Person { name: $name } } return { $p.name as name } }',
      params: { name: 'Alice' },
    } });
    expect(result.isError).not.toBe(true);
    expect(decode(result)).toMatchObject({ rows: [{ name: 'Alice' }], graphCommitId: expect.any(String) });
  });

  it('returns exact write receipts, preserves stale-head refusal, and exposes no deployment tools', async () => {
    const branch = 'mcp-qualification';
    const created = await client.callTool({ name: 'branches_create', arguments: { name: branch } });
    expect(created.isError).not.toBe(true);
    try {
      const read = decode(await client.callTool({ name: 'query', arguments: {
        query: 'query all() { match { $p: Person } return { $p.name } }', branch,
      } }));
      const args = { query: 'query add($name: String) { insert Person { name: $name } }', params: { name: 'MCP' }, branch, ifGraphCommit: read.graphCommitId };
      const result = await client.callTool({ name: 'mutate', arguments: args });
      expect(result.isError).not.toBe(true);
      const commit = decode(result).commit;
      expect(commit.graphBranch).toBe(branch);
      expect(decode(await client.callTool({ name: 'commits_get', arguments: { commitId: commit.graphCommitId } }))).toEqual(commit);
      const stale = await client.callTool({ name: 'mutate', arguments: { ...args, params: { name: 'MCP-stale' } } });
      expect(stale.isError).toBe(true);
      expect(decode(stale)).toMatchObject({ status: 412, body: { preconditionFailure: { expected: read.graphCommitId, actual: commit.graphCommitId } } });
      const tools = (await client.listTools()).tools.map((tool) => tool.name);
      expect(tools).not.toContain('schema_apply');
      expect(tools).not.toContain('cluster_apply');
    } finally {
      expect((await client.callTool({ name: 'branches_delete', arguments: { name: branch } })).isError).not.toBe(true);
    }
  });
});
