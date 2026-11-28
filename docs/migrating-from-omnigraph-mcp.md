# Migrating from `@modernrelay/omnigraph-mcp`

The TypeScript MCP wrapper is retired. **0.17.1 is its final release and remains
installable.** Its [source and README](https://github.com/ModernRelay/omnigraph-ts/tree/v0.17.1/packages/mcp)
remain at the release tag. The [TypeScript SDK](../packages/sdk/README.md)
continues to be maintained.

These instructions target **native OmniGraph 0.17.1**. See its
[tagged MCP guide](https://github.com/ModernRelay/omnigraph/blob/v0.17.1/docs/user/operations/mcp.md)
for complete configuration, tool schemas and limits. Refresh cached tool schemas
after reconnecting.

## HTTP hosts

Replace the npm subprocess with the host's **Streamable HTTP** transport.

```text
URL: https://graphs.example.com/mcp
Authorization: Bearer <your credential>
```

Static and signed data tokens use that header. OAuth sign-in requires
operator-configured OIDC resource identity trust. Use that resource URL with the host's sign-in flow.

`/mcp` requires a credential source. Graph policies authorize each operation.
Direct HTTP MCP lists all tools. Remove `--mcp-allow-adhoc` and
`--mcp-allow-writes` before starting a 0.17.1 server.

## Stdio hosts

Install the native CLI and configure an existing authenticated server or managed
target. For a target named `staging` and a graph named `alpha`, configure the host as follows.

```json
{
  "mcpServers": {
    "omnigraph": {
      "command": "omnigraph",
      "args": ["mcp", "--target", "staging", "--graph", "alpha"]
    }
  }
}
```

The bridge uses the target's credentials, binds one graph and connects to its
existing `/mcp`. **The bridge defaults to read-only.** Add `"--write"` to `args` for write tools, subject to server policy.
See the [bridge guide](https://github.com/ModernRelay/omnigraph/blob/v0.17.1/docs/user/operations/mcp.md#connect-a-stdio-agent).

## Calls, resources and results

| npm wrapper | Native MCP |
|---|---|
| `schema_get` | `schema` returns the source in the JSON field `schema_source` |
| `graphs_list` | `graphs` returns graph IDs and names |
| `query`, `mutate` | `query` and `mutate` also accept a stored query or mutation by `name` |
| `OMNIGRAPH_GRAPH_ID` | `graph` argument (the stdio bridge supplies it) |
| `OMNIGRAPH_DEFAULT_BRANCH` | Explicit `branch` when not `main` |
| `commitId`, `pageToken`, `ifGraphCommit` | `commit_id`, `page_token`, `if_graph_commit` |
| `graphCommitId`, `nextPageToken` results | `graph_commit_id`, `next_page_token` |
| `omnigraph://schema`, `omnigraph://branches` | `omnigraph://graphs/{graph}/schema`, `omnigraph://graphs/{graph}/branches` |

Other existing tool names and best-practices URIs remain. Identity credentials
can discover graph names independently of data access. Static tokens need `graph_list` for discovery.

Native results include `structuredContent` plus a text copy. Tool refusals carry
`isError` and `{ "status": ..., "error": ... }`, with code and disposition inside
`error`. MCP-only refusals may omit `status`. Replace parsing of the wrapper's
`body`, `requestDispatched` and `outcomeUnknown` envelope. The TypeScript SDK
retains its camelCase API.

## JavaScript factory callers

Applications that embed `createOmnigraphMcpServer()` or use `CreateServerOptions`
can migrate to an MCP client connection over HTTP or a CLI child process. For
direct database calls, use the maintained TypeScript SDK.

During migration, callers can pin the final factory release.

```sh
npm install @modernrelay/omnigraph-mcp@0.17.1
```
