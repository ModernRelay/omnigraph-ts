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
        "OMNIGRAPH_DEFAULT_BRANCH": "main"
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
});
await server.connect(new StdioServerTransport());
```

## Surface

### Tools

Read-only (`readOnlyHint: true`):

| Tool | Purpose |
|---|---|
| `health` | Server liveness + version |
| `snapshot` | Snapshot of a branch (table list + row counts) |
| `read` | Run a `.gq` read query |
| `schema_get` | Active `.pg` schema source |
| `branches_list` | List user-visible branches |
| `commits_list` | List commits on a branch |
| `commits_get` | Retrieve a single commit |

Mutating (`destructiveHint: true` where appropriate — hosts should surface confirmation):

| Tool | Purpose |
|---|---|
| `change` | Run a `.gq` mutation |
| `ingest` | Bulk-ingest NDJSON (`mode: 'merge'` for idempotency) |
| `branches_create` | Create a new branch |
| `branches_delete` | Delete a branch |
| `branches_merge` | Merge `source` into `target` |
| `schema_apply` | Apply a schema migration |

### Resources

- `omnigraph://schema` — text/plain `.pg` source
- `omnigraph://branches` — application/json branch name list

## License

MIT
