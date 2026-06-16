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
| `snapshot` | Snapshot of a branch (table list + row counts) |
| `query` | Run a `.gq` read query (canonical; successor to `read`) |
| `read` | Legacy alias for `query`. Field names are still `querySource` / `queryName`; prefer `query`. |
| `schema_get` | Active `.pg` schema source |
| `branches_list` | List user-visible branches |
| `commits_list` | List commits on a branch |
| `commits_get` | Retrieve a single commit |
| `graphs_list` | List registered graphs in the cluster (requires a `graph_list` policy grant) |

Mutating (`destructiveHint: true` where appropriate — hosts should surface confirmation):

| Tool | Purpose |
|---|---|
| `mutate` | Run a `.gq` mutation (canonical; successor to `change`) |
| `change` | Legacy alias for `mutate`. Accepts either legacy `querySource` / `queryName` or canonical `query` / `name`; mixed field families are rejected. Prefer `mutate`. |
| `load` | Bulk-load NDJSON (canonical; `mode: 'merge'` for idempotency). Without `from`, a missing branch is a 404. |
| `ingest` | Deprecated alias of `load` (kept as a shim). Identical behavior; prefer `load`. |
| `branches_create` | Create a new branch |
| `branches_delete` | Delete a branch |
| `branches_merge` | Merge `source` into `target` |
| `schema_apply` | Apply a schema migration. Optional `allowDataLoss: true` hard-drops column data for destructive steps; leave unset unless the plan was reviewed. |

### Resources

- `omnigraph://schema` — text/plain `.pg` source
- `omnigraph://branches` — application/json branch name list
- `omnigraph://graphs` — application/json `[{ graphId, uri }]` (requires a `graph_list` policy grant; the management surface is closed by default)

## License

MIT
