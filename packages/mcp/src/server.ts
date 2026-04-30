// MCP server exposing an Omnigraph database. Wraps `@modernrelay/omnigraph`
// in MCP tools (LLM-callable) and resources (LLM-readable). Designed for
// MCP SDK v1.x; the v2 split-package layout is a follow-up.
//
// Tools mutate or query the live database. Read-only tools (read, snapshot,
// branches.list, commits.list, schema.get, health) carry no destructive
// side effects. Mutating tools (change, ingest, schema.apply, branch
// create/delete/merge) are annotated with `destructiveHint: true` so MCP
// hosts can surface a confirmation UI.
//
// Resources are an alternative read surface — agents that prefer to *read*
// the schema or a branch snapshot rather than *call* a tool can use them.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  Omnigraph,
  type FetchLike,
  SERVER_VERSION as SDK_SERVER_VERSION,
} from '@modernrelay/omnigraph';
import { z } from 'zod';

export interface CreateServerOptions {
  baseUrl: string;
  token?: string;
  /** Default branch when a tool input omits one. */
  defaultBranch?: string;
  /** Custom fetch (for testing). */
  fetch?: FetchLike;
}

const LoadModeEnum = z.enum(['overwrite', 'append', 'merge']);

function jsonText(value: unknown) {
  return [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }];
}

function plainText(text: string) {
  return [{ type: 'text' as const, text }];
}

function errText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

export function createOmnigraphMcpServer(opts: CreateServerOptions): McpServer {
  const og = new Omnigraph({ baseUrl: opts.baseUrl, token: opts.token, fetch: opts.fetch });
  const defaultBranch = opts.defaultBranch ?? 'main';

  const server = new McpServer({
    name: 'omnigraph-mcp',
    version: '0.3.0',
  });

  // ---------- Tools: read-only -------------------------------------------

  server.registerTool(
    'health',
    {
      title: 'Server health',
      description:
        "Liveness probe. Returns the omnigraph-server's status and version. " +
        `The SDK was generated against omnigraph-server v${SDK_SERVER_VERSION}.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const h = await og.health();
      return { content: jsonText({ ...h, sdkServerVersion: SDK_SERVER_VERSION }) };
    },
  );

  server.registerTool(
    'snapshot',
    {
      title: 'Branch snapshot',
      description:
        'Return the current snapshot of a branch — every node/edge table with its row count. ' +
        'Useful for an agent to assess graph size before authoring a query.',
      inputSchema: { branch: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ branch }) => {
      const s = await og.snapshot({ branch: branch ?? defaultBranch });
      return { content: jsonText(s) };
    },
  );

  server.registerTool(
    'read',
    {
      title: 'Run GQ read query',
      description:
        'Run a parameterized .gq read query against a branch. Read-only. ' +
        '`querySource` is the full query text. `params` is a free-form map matched ' +
        'by name to `$varName` placeholders in the query. Returns rows + columns; ' +
        'row keys are caller-defined and not transformed.',
      inputSchema: {
        querySource: z.string().min(1),
        queryName: z.string().optional(),
        params: z.record(z.unknown()).optional(),
        branch: z.string().optional(),
        snapshot: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ querySource, queryName, params, branch, snapshot }) => {
      const r = await og.read({
        querySource,
        queryName,
        params,
        branch: branch ?? defaultBranch,
        snapshot,
      });
      return { content: jsonText(r) };
    },
  );

  server.registerTool(
    'schema_get',
    {
      title: 'Get current schema',
      description:
        'Return the active .pg schema source. Agents should consult this before authoring ' +
        'queries so they know which node/edge types and properties exist.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const s = await og.schema.get();
      return { content: plainText(s.schemaSource) };
    },
  );

  server.registerTool(
    'branches_list',
    {
      title: 'List branches',
      description: 'Return all user-visible branch names. Internal branches (run, schema-apply lock) are filtered out.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const list = await og.branches.list();
      return { content: jsonText({ branches: list }) };
    },
  );

  server.registerTool(
    'commits_list',
    {
      title: 'List commits',
      description: 'Return commits on a branch, most recent first. Each commit has graphCommitId, parentCommitId, etc.',
      inputSchema: { branch: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ branch }) => {
      const commits = await og.commits.list({ branch: branch ?? defaultBranch });
      return { content: jsonText({ commits }) };
    },
  );

  server.registerTool(
    'commits_get',
    {
      title: 'Get commit by id',
      description: 'Retrieve a single commit by its ULID-like graphCommitId.',
      inputSchema: { commitId: z.string().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ commitId }) => {
      const commit = await og.commits.retrieve(commitId);
      return { content: jsonText(commit) };
    },
  );

  // ---------- Tools: mutating --------------------------------------------

  server.registerTool(
    'change',
    {
      title: 'Run GQ mutation',
      description:
        'Run a .gq mutation (insert/update/delete) against a branch. Multi-statement mutations ' +
        'are atomic at the commit boundary. Returns affectedNodes / affectedEdges counts.',
      inputSchema: {
        querySource: z.string().min(1),
        queryName: z.string().optional(),
        params: z.record(z.unknown()).optional(),
        branch: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ querySource, queryName, params, branch }) => {
      const r = await og.change({
        querySource,
        queryName,
        params,
        branch: branch ?? defaultBranch,
      });
      return { content: jsonText(r) };
    },
  );

  server.registerTool(
    'ingest',
    {
      title: 'Bulk-ingest NDJSON',
      description:
        'Bulk-load NDJSON data into a branch. `mode: "merge"` upserts by @key (idempotent). ' +
        '`mode: "append"` is strict insert (errors on duplicate). `mode: "overwrite"` replaces all data.',
      inputSchema: {
        branch: z.string().min(1),
        from: z.string().optional(),
        mode: LoadModeEnum,
        data: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ branch, from, mode, data }) => {
      const r = await og.ingest({ branch, from, mode, data });
      return { content: jsonText(r) };
    },
  );

  server.registerTool(
    'branches_create',
    {
      title: 'Create branch',
      description: 'Create a new branch forked from `from` (default `main`). Throws ConflictError if name exists.',
      inputSchema: { name: z.string().min(1), from: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name, from }) => {
      const r = await og.branches.create({ name, from });
      return { content: jsonText(r) };
    },
  );

  server.registerTool(
    'branches_delete',
    {
      title: 'Delete branch',
      description: 'Delete a branch by name. Idempotent: deleting a non-existent branch is a no-op.',
      inputSchema: { name: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ name }) => {
      const r = await og.branches.delete(name);
      return { content: jsonText(r) };
    },
  );

  server.registerTool(
    'branches_merge',
    {
      title: 'Merge branch',
      description:
        'Merge `source` into `target` (default `main`). Idempotent: re-merging an already-merged branch yields outcome=already_up_to_date.',
      inputSchema: {
        source: z.string().min(1),
        target: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ source, target }) => {
      const r = await og.branches.merge({ source, target: target ?? defaultBranch });
      return { content: jsonText(r) };
    },
  );

  server.registerTool(
    'schema_apply',
    {
      title: 'Apply schema migration',
      description:
        'Apply a new .pg schema as a migration. Idempotent: applying an unchanged schema returns applied=false.',
      inputSchema: { schemaSource: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ schemaSource }) => {
      const r = await og.schema.apply({ schemaSource });
      return { content: jsonText(r) };
    },
  );

  // ---------- Resources --------------------------------------------------
  // A schema-shaped read surface for agents that prefer reading over calling.

  server.registerResource(
    'schema',
    'omnigraph://schema',
    {
      title: 'Schema (.pg source)',
      description: 'The active Omnigraph schema as .pg source.',
      mimeType: 'text/plain',
    },
    async (uri) => {
      const s = await og.schema.get();
      return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: s.schemaSource }] };
    },
  );

  server.registerResource(
    'branches',
    'omnigraph://branches',
    {
      title: 'Branches',
      description: 'JSON array of branch names.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const list = await og.branches.list();
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(list, null, 2) }],
      };
    },
  );

  // Suppress unused-import warning on errText when not referenced inline.
  void errText;

  return server;
}
