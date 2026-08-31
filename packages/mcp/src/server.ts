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
  OmnigraphError,
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
  - omnigraph://best-practices/search      — before nearest/bm25/rrf queries

These references also contain operator/CLI examples, not additional MCP tools. The live schema determines available types, properties, and vector dimensions; example models and node names are not deployment guarantees. The write and error rules below are the v0.10 MCP contract.

Workflow norms (violating these breaks things or silently corrupts data):

1. .gq edges use lowerCamelCase even though the schema declares them PascalCase. No top-level \`mutation { }\` wrapper — every block is \`query name($p: T) { insert|update|delete ... }\`. Dispatch writes via \`mutate\`, not \`query\`.
2. Parameterize. Pass values via \`params\`, never interpolate into the query body. Declare typed params: \`query foo($slug: String) { ... }\`.
3. \`nearest\`, \`bm25\`, and \`rrf\` require a trailing \`limit N\` — they are ordering operators, not filters.
4. \`load mode: "merge"\` upserts stable keys; it is not request deduplication. Reconcile an ambiguous outcome before replaying. \`"overwrite"\` replaces supplied types. \`"append"\` fails on key collision.
5. Successful mutations and loads return an exact \`commit\` receipt. A mutation with \`commit: null\` is a successful no-op, not a failed write. A separate branch-head read cannot prove which writer committed. A timeout or lost response leaves the outcome unknown: verify the intended content and relevant commit history before considering a replay; never infer retry safety from an unchanged head or node type name.
6. For read-modify-write, use \`query.graphCommitId\` as \`mutate.ifGraphCommit\`. It selects the dedicated conditional-write route; HTTP 412 with \`preconditionFailure\` means no effects. Re-read and reconsider the change instead of blindly replaying it. Never fall back to an unconditional mutation when the conditional route is unavailable.
7. Risky/large writes: \`branches_create\` from main → \`load\` onto the branch → verify → \`branches_merge\` → \`branches_delete\`.
8. Schema is read-only over this MCP. \`schema_get\` returns the active .pg source; there is no \`schema_apply\` tool. A cluster-managed graph rejects HTTP schema apply (409) — schema changes go through \`omnigraph cluster apply\` (an operator/CLI action), not an agent tool.

Date format: ISO strings on \`mutate\` params; integer days-since-epoch in load JSONL \`Date\` fields. \`DateTime\` is ISO on both.

Errors carry \`status\`, \`code\`, and structured \`body\` details. Do not retry every 409: \`fullTextIndexRebuildRequired\` needs an operator's branch-scoped \`rebuild-full-text-indexes\` action, not another search; \`keyConflict\` needs an identity/operation decision; merge conflicts need reconciliation. \`recoveryRequired\` needs operator recovery before retry. \`sync_branch()\`, if mentioned, is server-internal text, not an MCP tool. This MCP never retries requests automatically.

\`commits_changes\` and \`changes_poll\` return one bounded page. Continue with \`nextPageToken\`, keeping branch and filters unchanged; a page token is not a durable cursor. Feed delivery is at-least-once: apply completed commit blocks idempotently by graphCommitId and persist the terminal cursor with the applied data. A 410 \`changeFeedGap\` requires a streamed baseline/reset through the SDK or operator workflow; this MCP does not buffer full baselines.

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

// Keep machine-readable server refusal details available to agents. The SDK's
// request/response objects can contain credentials and are never serialized.
async function toolResult<T>(run: () => Promise<T>, render: (value: T) => ReturnType<typeof jsonText> = jsonText) {
  try {
    return { content: render(await run()) };
  } catch (error) {
    if (!(error instanceof OmnigraphError)) throw error;
    return {
      isError: true,
      content: jsonText({
        error: error.message,
        status: error.status,
        code: error.code,
        requestId: error.requestId,
        body: error.body,
      }),
    };
  }
}

const ChangeFilters = {
  kind: z.array(z.enum(['node', 'edge'])).optional(),
  type: z.array(z.string().min(1)).optional(),
  op: z.array(z.enum(['insert', 'update', 'delete'])).optional(),
  pageToken: z.string().min(1).optional(),
  limit: z.number().int().positive().optional(),
};
const FeedStart = z.union([
  z.literal('now'),
  z.literal('beginning'),
  z.string().startsWith('after:').min(7).transform((value) => value as `after:${string}`),
]);

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
    async () => toolResult(async () => ({ ...(await og.health()), sdkServerVersion: SDK_SERVER_VERSION })),
  );

  server.registerTool(
    'snapshot',
    {
      title: 'Branch snapshot',
      description:
        'Return the current snapshot of a branch — node/edge datasets with type names and entity counts. ' +
        'Useful for an agent to assess graph size before authoring a query.',
      inputSchema: { branch: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ branch }) => toolResult(() => og.snapshot({ branch: branch ?? defaultBranch })),
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
        'row keys are caller-defined and not transformed. graphCommitId identifies the exact read ' +
        'snapshot and can be passed to mutate as ifGraphCommit.',
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
      return toolResult(() => og.query({
        query,
        name,
        params,
        branch: snapshot ? branch : (branch ?? defaultBranch),
        snapshot,
      }));
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
    async () => toolResult(() => og.schema.get(), (s) => plainText(s.schemaSource)),
  );

  server.registerTool(
    'branches_list',
    {
      title: 'List branches',
      description: 'Return all user-visible branch names. Internal branches (run, schema-apply lock) are filtered out.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => toolResult(async () => ({ branches: await og.branches.list() })),
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
    async () => toolResult(async () => ({ graphs: await og.graphs.list() })),
  );

  server.registerTool(
    'commits_list',
    {
      title: 'List commits',
      description: 'Return commits on a branch, most recent first. Each commit has graphCommitId, parentCommitId, etc.',
      inputSchema: { branch: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ branch }) => toolResult(async () => ({ commits: await og.commits.list({ branch: branch ?? defaultBranch }) })),
  );

  server.registerTool(
    'commits_get',
    {
      title: 'Get commit by id',
      description: 'Retrieve a single commit by its ULID-like graphCommitId.',
      inputSchema: { commitId: z.string().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ commitId }) => toolResult(() => og.commits.retrieve(commitId)),
  );

  server.registerTool(
    'commits_changes',
    {
      title: 'Inspect commit entity changes',
      description:
        'Read one bounded page of exact before/after entity changes relative to a commit\'s first parent. ' +
        'Continue with nextPageToken as pageToken, preserving filters; it is not a feed cursor.',
      inputSchema: { commitId: z.string().min(1), ...ChangeFilters },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ commitId, ...input }) => toolResult(() => og.commits.changes(commitId, input)),
  );

  server.registerTool(
    'changes_poll',
    {
      title: 'Poll entity change feed',
      description:
        'Read one bounded page from a branch\'s at-least-once change feed. ' +
        'cursor, start, and pageToken are mutually exclusive; omitted start means now. ' +
        'Keep filters unchanged across pages. Only a terminal cursor is durable; persist it with applied ' +
        'complete commit blocks. A 410 gap requires a streamed SDK/operator baseline reset.',
      inputSchema: {
        branch: z.string().optional(),
        cursor: z.string().min(1).optional(),
        start: FeedStart.optional(),
        ...ChangeFilters,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ branch, ...input }) => toolResult(() => og.changes.poll({ ...input, branch: branch ?? defaultBranch })),
  );

  // ---------- Tools: mutating --------------------------------------------

  server.registerTool(
    'mutate',
    {
      title: 'Run GQ mutation',
      description:
        'Run a .gq mutation (insert/update/delete) against a branch. Canonical write ' +
        'endpoint as of server 0.6.0 (successor to `change`). Multi-statement mutations ' +
        'are atomic at the commit boundary. Returns affectedNodes / affectedEdges counts and an exact ' +
        'commit receipt (null for a successful no-op). ifGraphCommit requires the branch head from a prior ' +
        'query and uses the dedicated conditional route; stale heads fail with 412 before effects.',
      inputSchema: {
        query: z.string().min(1),
        name: z.string().optional(),
        params: z.record(z.unknown()).optional(),
        branch: z.string().optional(),
        ifGraphCommit: z.string().min(1).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ query, name, params, branch, ifGraphCommit }) => toolResult(() => og.mutate({
        query,
        name,
        params,
        branch: branch ?? defaultBranch,
      }, { ifGraphCommit })),
  );

  server.registerTool(
    'load',
    {
      title: 'Bulk-load NDJSON',
      description:
        'Bulk-load NDJSON data into a branch. `mode: "merge"` upserts stable keys, not request deduplication. Reconcile ambiguous outcomes before replay. ' +
        '`mode: "append"` is strict insert (errors on duplicate). `mode: "overwrite"` replaces supplied types. ' +
        'Without `from`, the target branch must already exist (a missing branch is a 404); pass `from` to fork-if-missing. ' +
        'Returns an exact commit receipt. Oversized batches fail with 413; split them into separate commits.',
      inputSchema: {
        branch: z.string().min(1),
        from: z.string().optional(),
        mode: LoadModeEnum,
        data: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ branch, from, mode, data }) => toolResult(() => og.load({ branch, from, mode, data })),
  );

  server.registerTool(
    'branches_create',
    {
      title: 'Create branch',
      description: 'Create a new branch forked from `from` (default `main`). Throws ConflictError if name exists.',
      inputSchema: { name: z.string().min(1), from: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name, from }) => toolResult(() => og.branches.create({ name, from: from ?? defaultBranch })),
  );

  server.registerTool(
    'branches_delete',
    {
      title: 'Delete branch',
      description: 'Delete a branch by name. Idempotent: deleting a non-existent branch is a no-op.',
      inputSchema: { name: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ name }) => toolResult(() => og.branches.delete(name)),
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
    async ({ source, target }) => toolResult(() => og.branches.merge({ source, target: target ?? defaultBranch })),
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
