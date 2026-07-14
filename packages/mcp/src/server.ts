// MCP server exposing an Omnigraph database. Wraps `@modernrelay/omnigraph`
// in MCP tools (LLM-callable) and resources (LLM-readable). Designed for
// MCP SDK v1.x; the v2 split-package layout is a follow-up.
//
// Tools mutate or query the live database. Read-only tools (query, snapshot,
// branches.list, commits.list, schema.get, health) carry no destructive
// side effects. Mutating tools (mutate, load, branch create/delete/merge) are
// annotated with `destructiveHint: true` so MCP hosts can surface a
// confirmation UI. Schema is read-only here (`schema_get`): a cluster-managed
// graph evolves its schema via `omnigraph cluster apply`, not over HTTP.
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
import { COOKBOOK } from './best-practices.gen';
import { MCP_PACKAGE_VERSION } from './version.gen';

const INSTRUCTIONS = `Omnigraph is a versioned property graph. Reads are typed GQ queries; writes are server-orchestrated and branchable.

ALWAYS read \`omnigraph://schema\` (or call \`schema_get\`) FIRST, before any query, mutation, or load. Schema declares node/edge types, @key fields, non-nullable properties, edge directions, and casing. Writing without seeing the schema produces queries that lint-fail or silently corrupt data.

After schema, consult the matching best-practices resource for the task at hand:
  - omnigraph://best-practices/queries     — before .gq queries (query/mutate)
  - omnigraph://best-practices/data        — before load (mode selection, branch loop)
  - omnigraph://best-practices/schema      — to understand the .pg schema before writing
  - omnigraph://best-practices/remote-ops  — after any 504 or unexpected error
  - omnigraph://best-practices/search      — before nearest/bm25/rrf queries

Workflow norms (violating these breaks things or silently corrupts data):

1. .gq edges use lowerCamelCase even though the schema declares them PascalCase. No top-level \`mutation { }\` wrapper — every block is \`query name($p: T) { insert|update|delete ... }\`. Dispatch writes via \`mutate\`, not \`query\`.
2. Parameterize. Pass values via \`params\`, never interpolate into the query body. Declare typed params: \`query foo($slug: String) { ... }\`.
3. \`nearest\`, \`bm25\`, and \`rrf\` require a trailing \`limit N\` — they are ordering operators, not filters.
4. \`load mode: "merge"\` upserts by @key (idempotent — use this for at-least-once pipelines). \`"overwrite"\` truncates the branch. \`"append"\` fails on key collision.
5. Verify every write. \`commits_list\` head BEFORE and AFTER. If identical, the write did not land. 504s do not mean failure — the server may have committed after the proxy dropped the response.
6. Append-only types (Signal, Claim, Decision, Event, Interaction, Policy, Outcome, MarketingElement) duplicate on blind retry. Pointer types (Org, Person, Opportunity, Channel, Actor, ActionItem, Artifact, Meeting, Technology, Campaign, UseCase) dedupe via @key.
7. Risky/large writes: \`branches_create\` from main → \`load\` onto the branch → verify → \`branches_merge\` with \`deleteBranch: true\` (merges and cleans up the branch in one step; a deletion refusal is reported in the result, never fails the merge).
8. Schema is read-only over this MCP. \`schema_get\` returns the active .pg source; there is no \`schema_apply\` tool. A cluster-managed graph rejects HTTP schema apply (409) — schema changes go through \`omnigraph cluster apply\` (an operator/CLI action), not an agent tool.

Date format: ISO strings on \`mutate\` params; integer days-since-epoch in load JSONL \`Date\` fields. \`DateTime\` is ISO on both.

If you see \`sync_branch()\` in an error message, it is server-internal text, NOT a tool. Retry once; on persistent failure, fall back to \`load\` on a branch.

Depth: https://github.com/ModernRelay/omnigraph/tree/main/skills/omnigraph`;

export interface CreateServerOptions {
  baseUrl: string;
  token?: string;
  /** Default branch when a tool input omits one. */
  defaultBranch?: string;
  /**
   * Target graph id. Threaded into the underlying `Omnigraph` client so every
   * graph-scoped tool call routes under `/graphs/${graphId}/...`. Required
   * against omnigraph-server 0.7.0+ (cluster-only); the `bin` entrypoint
   * refuses to start without `OMNIGRAPH_GRAPH_ID`.
   */
  graphId?: string;
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

export function createOmnigraphMcpServer(opts: CreateServerOptions): McpServer {
  const og = new Omnigraph({
    baseUrl: opts.baseUrl,
    token: opts.token,
    fetch: opts.fetch,
    graphId: opts.graphId,
  });
  const defaultBranch = opts.defaultBranch ?? 'main';

  const server = new McpServer(
    {
      name: 'omnigraph-mcp',
      version: MCP_PACKAGE_VERSION,
    },
    {
      instructions: INSTRUCTIONS,
    },
  );

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
    'query',
    {
      title: 'Run GQ read query',
      description:
        'Run a parameterized .gq read query against a branch. Read-only. ' +
        'Canonical read endpoint as of server 0.6.0 (successor to `read`). ' +
        '`query` is the full query text. `params` is a free-form map matched ' +
        'by name to `$varName` placeholders in the query. Returns rows + columns; ' +
        'row keys are caller-defined and not transformed.',
      inputSchema: {
        query: z.string().min(1),
        name: z.string().optional(),
        params: z.record(z.unknown()).optional(),
        branch: z.string().optional(),
        snapshot: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, name, params, branch, snapshot }) => {
      // `branch` and `snapshot` are mutually exclusive per the spec. Only
      // apply the defaultBranch fallback when the caller has not pinned a
      // snapshot — otherwise we'd send both and the server would reject.
      const r = await og.query({
        query,
        name,
        params,
        branch: snapshot ? branch : (branch ?? defaultBranch),
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
    'graphs_list',
    {
      title: 'List registered graphs',
      description:
        'Return every graph the cluster exposes, alphabetically by graphId. ' +
        'The `/graphs` management surface is closed by default — the cluster ' +
        'must grant the `graph_list` action (a `cluster`-scoped policy bundle) ' +
        'or this returns 403 (ForbiddenError).',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const graphs = await og.graphs.list();
      return { content: jsonText({ graphs }) };
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
    'mutate',
    {
      title: 'Run GQ mutation',
      description:
        'Run a .gq mutation (insert/update/delete) against a branch. Canonical write ' +
        'endpoint as of server 0.6.0 (successor to `change`). Multi-statement mutations ' +
        'are atomic at the commit boundary. Returns affectedNodes / affectedEdges counts.',
      inputSchema: {
        query: z.string().min(1),
        name: z.string().optional(),
        params: z.record(z.unknown()).optional(),
        branch: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ query, name, params, branch }) => {
      const r = await og.mutate({
        query,
        name,
        params,
        branch: branch ?? defaultBranch,
      });
      return { content: jsonText(r) };
    },
  );

  server.registerTool(
    'load',
    {
      title: 'Bulk-load NDJSON',
      description:
        'Bulk-load NDJSON data into a branch. `mode: "merge"` upserts by @key (idempotent). ' +
        '`mode: "append"` is strict insert (errors on duplicate). `mode: "overwrite"` replaces all data. ' +
        'Without `from`, the target branch must already exist (a missing branch is a 404); pass `from` to fork-if-missing.',
      inputSchema: {
        branch: z.string().min(1),
        from: z.string().optional(),
        mode: LoadModeEnum,
        data: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ branch, from, mode, data }) => {
      const r = await og.load({ branch, from, mode, data });
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
      const r = await og.branches.create({ name, from: from ?? defaultBranch });
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
        'Merge `source` into `target` (default `main`). Idempotent: re-merging an already-merged branch yields outcome=already_up_to_date. ' +
        'Pass deleteBranch=true to delete the source branch after the merge lands — a deletion refusal is reported via branchDeleted/branchDeleteError in the result, never as an error.',
      inputSchema: {
        source: z.string().min(1),
        target: z.string().optional(),
        deleteBranch: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ source, target, deleteBranch }) => {
      const r = await og.branches.merge({
        source,
        target: target ?? defaultBranch,
        deleteBranch,
      });
      return { content: jsonText(r) };
    },
  );

  // NOTE: no `schema_apply` tool. omnigraph-server 0.7.0 is cluster-only, and a
  // cluster-managed graph rejects `POST /graphs/{id}/schema/apply` with 409 —
  // schema is evolved declaratively via `omnigraph cluster apply`, an operator
  // action outside the HTTP API this MCP wraps. Use `schema_get` to read the
  // active schema; route migrations through the cluster workflow.

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

  server.registerResource(
    'graphs',
    'omnigraph://graphs',
    {
      title: 'Graphs',
      description:
        'JSON array of registered graphs, each `{ graphId, uri }`. The `/graphs` ' +
        'management surface is closed by default — requires a `graph_list` policy grant.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const graphs = await og.graphs.list();
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(graphs, null, 2) },
        ],
      };
    },
  );

  // Best-practices references, vendored from omnigraph-cookbooks at build
  // time. Agents pull these on demand; resource bodies stay out of the
  // initial session context until `resources/read` is called.
  for (const entry of COOKBOOK) {
    server.registerResource(
      `best-practices/${entry.key}`,
      entry.uri,
      {
        title: entry.title,
        description: entry.description,
        mimeType: 'text/markdown',
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/markdown',
            text: entry.body,
          },
        ],
      }),
    );
  }

  // Index resource: a single small markdown that lists every cookbook
  // reference + its purpose. An agent that has not yet decided which
  // reference it needs can read this one cheap entry to orient.
  server.registerResource(
    'best-practices/index',
    'omnigraph://best-practices/index',
    {
      title: 'Best-practices index',
      description:
        'Lists every omnigraph://best-practices/* resource and what topic each covers. Read this first if you are not sure which deeper reference applies.',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      const lines = [
        '# Omnigraph best-practices index',
        '',
        'Vendored from https://github.com/ModernRelay/omnigraph/tree/main/skills/omnigraph.',
        '',
        '| Resource | Read before |',
        '|---|---|',
        ...COOKBOOK.map((e) => `| \`${e.uri}\` | ${e.description} |`),
      ];
      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text: lines.join('\n') }],
      };
    },
  );

  return server;
}
