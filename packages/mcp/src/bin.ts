#!/usr/bin/env node
// Stdio MCP server entrypoint. Reads OMNIGRAPH_BASE_URL / OMNIGRAPH_TOKEN /
// OMNIGRAPH_DEFAULT_BRANCH from the environment; clients invoke this binary
// as a subprocess and speak JSON-RPC over stdin/stdout.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createOmnigraphMcpServer } from './server';

const baseUrl = process.env.OMNIGRAPH_BASE_URL;
if (!baseUrl) {
  console.error('OMNIGRAPH_BASE_URL is required.');
  process.exit(1);
}

const server = createOmnigraphMcpServer({
  baseUrl,
  token: process.env.OMNIGRAPH_TOKEN,
  defaultBranch: process.env.OMNIGRAPH_DEFAULT_BRANCH,
});

await server.connect(new StdioServerTransport());
