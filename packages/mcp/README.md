# @modernrelay/omnigraph-mcp

MCP server for **OmniGraph 0.13**, using the TypeScript SDK over HTTP and stdio
with MCP hosts. Requires Node.js 22 or newer.

## Configure

```json
{
  "mcpServers": {
    "omnigraph": {
      "command": "npx",
      "args": ["-y", "@modernrelay/omnigraph-mcp@0.13"],
      "env": {
        "OMNIGRAPH_BASE_URL": "http://127.0.0.1:8080",
        "OMNIGRAPH_GRAPH_ID": "alpha",
        "OMNIGRAPH_TOKEN": "your-bearer-token"
      }
    }
  }
}
```

The URL must be the server root. `OMNIGRAPH_GRAPH_ID` is required;
`OMNIGRAPH_DEFAULT_BRANCH` defaults to `main`. A token is required when the
server enables authentication. Upgrade clients and server together: discovery
and every data response must advertise the exact 0.13 HTTP contract.

For programmatic use, pass `{ baseUrl, graphId, token?, defaultBranch?, fetch? }`
to `createOmnigraphMcpServer`, then connect an MCP transport.

## Tools and resources

| Tools | Purpose |
|---|---|
| `health`, `graphs_list` | Liveness and authorized graph listing |
| `schema_get`, `snapshot` | Active schema and branch datasets/counts |
| `query` | Parameterized GQ reads and exact `graphCommitId` |
| `commits_list`, `commits_get`, `commits_changes` | Commit history, receipts, bounded entity changes |
| `changes_poll` | One bounded change-feed page |
| `branches_list` | Branch names |
| `mutate`, `load` | Atomic mutations and bounded NDJSON batches |
| `branches_create`, `branches_delete`, `branches_merge` | Branch workflow |

Read-only tools carry `readOnlyHint`; mutating tools declare their side effects.
Schema and deployment writes remain operator-owned: use
`omnigraph cluster plan/apply --server …` for live configuration changes.

Resources expose `omnigraph://schema`, `omnigraph://branches`,
`omnigraph://graphs`, and `omnigraph://best-practices/index`. The index links
task-specific schema, query, data, search, and change-feed guidance. References
are bundled from an immutable upstream revision. Examples use illustrative
models; the live schema determines the actual types and properties.

## Write and error contract

Read the schema first and parameterize values. Successful mutations, loads,
and publishing merges return their own exact commit receipt. `commit: null`
on a data mutation means a successful no-op. Branch create/delete report an
`outcome` without a commit; an already-up-to-date merge publishes no commit.

For read-modify-write, pass the read's `graphCommitId` as `mutate.ifGraphCommit`.
A 412 refusal means no effects: re-read and reconsider. No unconditional
fallback is attempted.

The MCP never retries automatically. An abort or lost response does not cancel
an accepted server operation. Reconcile intended content and relevant history
before replaying; separately reading the head cannot identify the writer.
`load` mode `merge` upserts keys but does not deduplicate requests.

Errors set `isError: true` and return `error`, `status`, `code`, `requestId`,
structured `body`, and dispatch/outcome certainty when available. Request
objects and authorization headers are not serialized. A contract refusal
before dispatch says `requestDispatched: false`; `outcomeUnknown: true`
requires reconciliation. Merge/key conflicts need a decision, full-text
refusals need operator maintenance, and recovery refusals need recovery.

Change methods return one page. Follow `nextPageToken` with unchanged
branch/filters; only the terminal cursor is durable. Apply complete commit
blocks idempotently and persist the cursor with their data. A 410 gap requires
a complete SDK/operator baseline. Large baseline exports and binary Blob
payloads are not buffered into MCP results.

## License

MIT
