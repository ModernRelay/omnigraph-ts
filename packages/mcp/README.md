# @modernrelay/omnigraph-mcp

MCP server exposing an [Omnigraph](https://github.com/ModernRelay/omnigraph) database to LLM clients via the [Model Context Protocol](https://modelcontextprotocol.io/). Built on `@modelcontextprotocol/sdk` v1.x and the `@modernrelay/omnigraph` SDK.

## Usage

### Claude Desktop / any MCP host with stdio

```json
{
  "mcpServers": {
    "omnigraph": {
      "command": "npx",
      "args": ["-y", "@modernrelay/omnigraph-mcp"],
      "env": {
        "OMNIGRAPH_BASE_URL": "http://127.0.0.1:8080",
        "OMNIGRAPH_TOKEN": "your-bearer-token",
        "OMNIGRAPH_DEFAULT_BRANCH": "main",
        "OMNIGRAPH_GRAPH_ID": "alpha"
      }
    }
  }
}
```

### Programmatic embedding

```ts
import { createOmnigraphMcpServer } from '@modernrelay/omnigraph-mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = createOmnigraphMcpServer({
  baseUrl: 'http://127.0.0.1:8080',
  token: process.env.OMNIGRAPH_TOKEN,
  graphId: 'alpha', // required — omnigraph-server 0.7.0 is cluster-only
});
await server.connect(new StdioServerTransport());
```

### Env vars

| Variable | Purpose |
|---|---|
| `OMNIGRAPH_BASE_URL` | Required. `omnigraph-server` URL. |
| `OMNIGRAPH_GRAPH_ID` | Required (server 0.7.0+ is cluster-only). Graph this server operates on — routes every graph-scoped call under `/graphs/${id}/...`. The `bin` entrypoint refuses to start without it. |
| `OMNIGRAPH_TOKEN` | Optional bearer token. Required against a server with auth enabled. |
| `OMNIGRAPH_DEFAULT_BRANCH` | Branch used when a tool input omits one. Defaults to `main`. |

## Surface

### Tools

Read-only (`readOnlyHint: true`):

| Tool | Purpose |
|---|---|
| `health` | Server liveness + version |
| `snapshot` | Snapshot of a branch (`datasets`, type names, entity counts, graph manifest version) |
| `query` | Run a `.gq` read query; returns the exact read's `graphCommitId` |
| `schema_get` | Active `.pg` schema source |
| `branches_list` | List user-visible branches |
| `commits_list` | List commits on a branch |
| `commits_get` | Retrieve a single commit |
| `commits_changes` | One bounded page of a commit's entity changes relative to its first parent |
| `changes_poll` | One bounded page of the branch's at-least-once change feed |
| `graphs_list` | List registered graphs in the cluster (requires a `graph_list` policy grant) |

Mutating (`destructiveHint: true` where appropriate — hosts should surface confirmation):

| Tool | Purpose |
|---|---|
| `mutate` | Run a `.gq` mutation; optional `ifGraphCommit` selects the conditional-write route |
| `load` | Bulk-load NDJSON (`mode: 'merge'` for upserts). Without `from`, a missing branch is a 404. |
| `branches_create` | Create a new branch |
| `branches_delete` | Delete a branch |
| `branches_merge` | Merge `source` into `target` |

There is **no `schema_apply` tool**: a cluster-managed graph rejects HTTP schema apply (409). Schema is read-only here (`schema_get`); evolve it via `omnigraph cluster apply`.

### v0.10 writes, errors, and change pages

Successful `mutate` and `load` results include the exact `commit` receipt from
publication. `mutate` returning `commit: null` means a successful no-op. Comparing
branch heads before and after is not a receipt: another writer may advance the
head, and a timed-out operation may still be running.

For read-modify-write, pass `query`'s `graphCommitId` as `mutate`'s
`ifGraphCommit` argument. The SDK uses `/mutate/if-graph-commit`; it never silently
falls back to an unconditional write. HTTP 412 with `body.preconditionFailure`
means no effects: re-read and reconsider the mutation.

SDK request failures set `isError: true` and return JSON with `error`, `status`, `code`,
`requestId` when available, and the structured server `body`. Request headers and
request/response objects are not included. No request is retried automatically.
A 409 is not one universal retry condition: `fullTextIndexRebuildRequired` needs
an operator's branch-scoped `rebuild-full-text-indexes`, `keyConflict` needs an
identity/operation decision, and merge conflicts need reconciliation.
`recoveryRequired` needs operator recovery. A lost response leaves the outcome
unknown; inspect intended content and relevant history before deciding to replay.

`commits_changes` accepts `commitId`, optional `pageToken`, `limit`, and array
filters `kind`, `type`, and `op`. `changes_poll` accepts the same filters plus
`branch` and exactly one of `start`, `cursor`, or `pageToken` (or none, meaning
`start: "now"`). Follow `nextPageToken` with unchanged branch/filters. Only a
terminal feed `cursor` is durable; apply complete commit blocks idempotently by
`graphCommitId` and persist that cursor with the applied data. A 410
`changeFeedGap` requires the SDK's streamed baseline/reset workflow. Full baseline
exports and binary Blob payloads are deliberately not buffered into MCP results.

### Resources

- `omnigraph://schema` — text/plain `.pg` source
- `omnigraph://branches` — application/json branch name list
- `omnigraph://graphs` — application/json `[{ graphId, uri }]` (requires a `graph_list` policy grant; the management surface is closed by default)
- `omnigraph://best-practices/index` — index of the bundled query, data, schema, and search references

Best-practice references are fetched from the same pinned upstream contract as
the SDK, not moving `main`. Operator/CLI examples are not additional MCP tools;
available types, properties, and vector dimensions come from the live schema.
The older `remote-ops` reference is intentionally excluded until its blanket
retry and branch-head verification advice is refreshed for v0.10. The write/error
rules above and the server's initialization instructions are authoritative for
this MCP version.

## License

MIT
