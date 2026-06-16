#!/usr/bin/env node
// Stdio MCP server entrypoint. Reads OMNIGRAPH_BASE_URL / OMNIGRAPH_TOKEN /
// OMNIGRAPH_DEFAULT_BRANCH / OMNIGRAPH_GRAPH_ID from the environment;
// clients invoke this binary as a subprocess and speak JSON-RPC over
// stdin/stdout.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createOmnigraphMcpServer } from './server';

const baseUrl = process.env.OMNIGRAPH_BASE_URL;
if (!baseUrl) {
  console.error('OMNIGRAPH_BASE_URL is required.');
  process.exit(1);
}

// omnigraph-server 0.7.0+ is cluster-only: every graph-scoped tool is served
// under /graphs/{graphId}/…, so the MCP server must be pinned to one graph.
const graphId = process.env.OMNIGRAPH_GRAPH_ID;
if (!graphId) {
  console.error(
    'OMNIGRAPH_GRAPH_ID is required (omnigraph-server 0.7.0+ is cluster-only). ' +
      'Set it to the graph this server should operate on.',
  );
  process.exit(1);
}

const server = createOmnigraphMcpServer({
  baseUrl,
  token: process.env.OMNIGRAPH_TOKEN,
  defaultBranch: process.env.OMNIGRAPH_DEFAULT_BRANCH,
  graphId,
});

await server.connect(new StdioServerTransport());
