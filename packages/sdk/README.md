# @modernrelay/omnigraph

TypeScript client for the [Omnigraph](https://github.com/ModernRelay/omnigraph) graph database — typed property graphs with vector + full-text search, git-style branches, and a query language designed for hybrid retrieval over an HTTP API.

The SDK gives you idiomatic TypeScript on top of that: instance-per-client, camelCase types, throw-by-default typed errors, `AbortSignal` cancellation, and an async-iterator export stream. No `{ data, error }` discriminated unions, no string-keyed magic, no global state.

## Install

```sh
npm install @modernrelay/omnigraph
# or: pnpm add @modernrelay/omnigraph
```

Requires **Node 22+** (uses native `fetch` and web streams). Works in Bun and Deno; browser compatibility depends on whether your `omnigraph-server` is reachable from the browser context (CORS).

## First call

```ts
import Omnigraph from '@modernrelay/omnigraph';

const og = new Omnigraph({
  baseUrl: 'http://127.0.0.1:8080',
  graphId: 'alpha',                   // required — every graph-scoped call routes under /graphs/alpha/…
  token: process.env.OMNIGRAPH_TOKEN, // optional; omit for unauthenticated dev
});

const { rows } = await og.query({
  branch: 'main',
  query: 'query find($name: String) { match { $p: Person { name: $name } } return { $p.name, $p.age } }',
  name: 'find',
  params: { name: 'Alice' },
});

console.log(rows); // → [{ '$p.name': 'Alice', '$p.age': 30 }]
```

That's the whole pattern: instantiate once (with a `graphId`), call methods, get typed responses.

> **`graphId` is required (server 0.7.0).** `omnigraph-server` is cluster-only: every graph-scoped operation is served under `/graphs/{graphId}/…`. A graph-scoped call without a `graphId` throws `ConfigurationError` before hitting the network. Only `og.health()` and `og.graphs.list()` work without one — use the latter to discover ids, then [`og.graph(id)`](#multi-graph-clusters). This SDK major.minor targets a 0.7.x server; for a 0.6.x (flat-route) server, stay on `@modernrelay/omnigraph@0.6.x`.

> **Removed in this release: `og.read`, `og.change`, `og.ingest`.** This major release drops the deprecated aliases for a single canonical surface — use **`og.query()`** (read), **`og.mutate()`** (write), and **`og.load()`** (bulk-load). Field names are `query` / `name` (not `querySource` / `queryName`). The server still serves the old `/read`, `/change`, `/ingest` routes as shims, so a 0.6.x-era SDK keeps working — but this SDK no longer calls them.

## What you can do

### Read

```ts
const { rows, columns, rowCount } = await og.query({
  branch: 'main',
  query: 'query top($limit: I32) { ... order by $p.score desc limit $limit }',
  name: 'top',
  params: { limit: 10 },
});
```

`params` keys are caller-controlled — they survive the SDK's snake/camel boundary verbatim, so your `$varName` placeholders match.

### Mutate

```ts
const { affectedNodes, affectedEdges } = await og.mutate({
  branch: 'feature',
  query: 'query addPerson($name: String, $age: I32) { insert Person { name: $name, age: $age } }',
  name: 'addPerson',
  params: { name: 'Alice', age: 30 },
});
```

Multi-statement mutations execute atomically inside a single commit.

### Branch and merge

```ts
await og.branches.create({ name: 'feature', from: 'main' });
// ... mutate `feature` ...
const { outcome } = await og.branches.merge({ source: 'feature', target: 'main' });
// outcome: 'fast_forward' | 'merged' | 'already_up_to_date'
await og.branches.delete('feature');
```

### Bulk load

```ts
import { LoadMode } from '@modernrelay/omnigraph';

await og.load({
  branch: 'import-2026-04-30',
  from: 'main',          // required to fork a missing branch — without it a missing branch is a 404
  mode: LoadMode.MERGE,  // upsert by @key — safe to retry
  data: ndjsonString,
});
```

`og.load()` is the canonical (and only) bulk-load method. **Loading into a branch that doesn't exist requires `from`** (the base to fork from); without it the server returns `NotFoundError` (404) rather than implicitly forking from `main`.

### Stream a branch as NDJSON

```ts
for await (const row of og.export({ branch: 'main' })) {
  // row keys reflect your schema verbatim
}
```

The iterator lazily issues `POST /export` on first iteration and cancels the upstream connection on early `break`.

### Inspect the schema

```ts
const { schemaSource } = await og.schema.get();    // .pg source
await og.schema.apply({ schemaSource: nextSchema }); // migrate

// Hard-drop column data instead of soft-dropping it (defaults to false; matches
// the CLI's --allow-data-loss). Soft drops remain reversible via time travel;
// hard drops are not. Use only when the migration plan includes intentional
// data deletions you've already reviewed.
await og.schema.apply({ schemaSource: nextSchema, allowDataLoss: true });
```

### Snapshots and commits

```ts
await og.snapshot({ branch: 'main' });
await og.commits.list({ branch: 'main' });
await og.commits.retrieve(commitId);
```

## Errors

Every method throws a typed error subclass on non-2xx. Catch the specific class you care about:

```ts
import {
  Omnigraph,
  ConflictError,
  MethodNotAllowedError,
  NotFoundError,
  UnauthorizedError,
  BadRequestError,
} from '@modernrelay/omnigraph';

try {
  await og.branches.create({ name: 'main' });
} catch (e) {
  if (e instanceof ConflictError) {
    // 409 — branch exists or merge conflict
    e.mergeConflicts; // typed MergeConflict[] when applicable
  } else if (e instanceof NotFoundError) {
    // 404
  } else if (e instanceof MethodNotAllowedError) {
    // 405
  } else throw e;
}
```

Every error carries `status`, `code`, `requestId` (from the `X-Request-Id` response header), and the parsed response body for diagnostics.

`ConfigurationError` is the one error thrown **client-side, before any request** — it means a graph-scoped method was called without a `graphId` configured (see [the required-`graphId` note](#first-call)). Its `status` is `0`, like `NetworkError`.

## Cancellation

Every method accepts an `AbortSignal`:

```ts
const ac = new AbortController();
setTimeout(() => ac.abort(), 5_000);

await og.query({ branch: 'main', query: '...' }, { signal: ac.signal });
```

## Server compatibility

The SDK is built against a specific `omnigraph-server` release. The pinned version is exposed at runtime so you can detect drift early:

```ts
import { Omnigraph, SERVER_VERSION } from '@modernrelay/omnigraph';

const og = new Omnigraph({ baseUrl: process.env.OG_URL! });
const { version } = await og.health();

const sdkMm = SERVER_VERSION.split('.').slice(0, 2).join('.');
const srvMm = version.split('.').slice(0, 2).join('.');
if (sdkMm !== srvMm) {
  throw new Error(`SDK targets server ${SERVER_VERSION}, but server reports ${version}`);
}
```

`@modernrelay/omnigraph@X.Y.Z` is built from `omnigraph-server@X.Y.Z` and is expected to work against any `>=X.Y.0, <X.(Y+1).0`. CI fetches the OpenAPI spec at the pinned tag, regenerates types, and runs the SDK's e2e suite against a live `omnigraph-server` of the same release — a published SDK is always faithful to a real server build.

## Designing for safe retry

Omnigraph is a database; idempotency belongs in the schema (`@key`, `@unique`), not in `Idempotency-Key` headers. The SDK ships single-shot requests; pick mutations that are idempotent under retry.

| Operation | Retry semantics |
|---|---|
| `og.health()`, `og.snapshot()`, `og.query()`, `og.export()`, `og.branches.list()`, `og.commits.list()`, `og.commits.retrieve()`, `og.schema.get()`, `og.graphs.list()` | Read-only — always safe. |
| `og.branches.create({ name })` | Throws `ConflictError` on retry (branch exists). Catch and treat as success. |
| `og.branches.merge({ source, target })` | Idempotent — re-merge yields `outcome: 'already_up_to_date'`. |
| `og.branches.delete(name)` | Idempotent — delete-of-deleted is a no-op. |
| `og.schema.apply({ schemaSource })` | Idempotent — unchanged schema returns `applied: false`. |
| `og.load({ data, mode: 'merge' })` | **Idempotent** — use this mode for at-least-once pipelines. Requires `@key` constraints. |
| `og.load({ data, mode: 'overwrite' })` | Idempotent — same input → same final state. |
| `og.load({ data, mode: 'append' })` | **Not idempotent** — blind insert. Avoid for retry-prone callers. |
| `og.mutate({ query })` | Depends on the query. `update X set ... where ...` is idempotent; `insert X { ... }` is idempotent only with `@unique` / `@key`. |

If a mutation isn't naturally idempotent, fix the schema (add `@unique` or `@key`) — not the SDK.

## Cluster graphs

`omnigraph-server` 0.7.0 is **cluster-only**: it hosts one or more graphs side-by-side under `/graphs/{graphId}/…`, declared in a `cluster.yaml`. Pick the graph with `graphId` (required for every graph-scoped call):

```ts
const og = new Omnigraph({
  baseUrl: 'http://127.0.0.1:8080',
  graphId: 'alpha',          // every graph-scoped call routes under /graphs/alpha/...
  token: process.env.OMNIGRAPH_TOKEN,
});

await og.snapshot();         // → GET /graphs/alpha/snapshot
await og.query({ /* … */ }); // → POST /graphs/alpha/query
```

Use `og.graph(id)` to fan out across graphs from one parent client. It returns a new client that shares `baseUrl`, `token`, and `fetch`; the parent is untouched:

```ts
await Promise.all([
  og.graph('alpha').snapshot(),
  og.graph('beta').snapshot(),
]);
```

Don't fold the id into `baseUrl` (e.g. `http://host/graphs/alpha`) — that breaks the flat endpoints `og.health()` and `og.graphs.list()`, which the SDK intentionally never prefixes (and which are the only two methods that work without a `graphId`).

### Listing graphs

```ts
const graphs = await og.graphs.list();
// → [{ graphId: 'alpha', uri: '…' }, { graphId: 'beta', uri: '…' }]
```

`GET /graphs` is the server-scoped management surface — it is **closed by default in every runtime state** (even unauthenticated). The cluster must apply a `cluster`-scoped Cedar bundle granting the `graph_list` action against `Omnigraph::Server::"root"`; without that grant the call fails 403. `og.health()` (`/healthz`) is the only always-open endpoint.

### Auth (server 0.7.0, cluster-managed)

Authorization is Cedar policy declared in the cluster's `cluster.yaml` `policies:` section, with each bundle bound to scopes via `applies_to` (a graph id for per-graph rules, or the literal `cluster` for server-scoped `graph_list`).

- **Token without policy default-denies non-read actions.** If a token is configured but no bundle grants a given action, the server returns 403. Grant exactly the actions the SDK caller will issue: per-graph `read`, `export`, `change`, `schema_apply`, `branch_create`, `branch_delete`, `branch_merge`, `invoke_query`; and server-scoped `graph_list` for `og.graphs.list()`.
- **Unauthenticated (open) mode** must be explicit on the server (`--unauthenticated`). It opens the data plane but **not** the `graph_list` management surface, which always requires an explicit cluster policy bundle.

## Multiple clients in one process

Each `new Omnigraph(...)` is an isolated client. There is no shared state.

```ts
const eu = new Omnigraph({ baseUrl: 'https://eu.example' });
const us = new Omnigraph({ baseUrl: 'https://us.example' });

await Promise.all([eu.branches.list(), us.branches.list()]);
```

## Custom fetch (testing, tracing, polyfills)

```ts
import Omnigraph from '@modernrelay/omnigraph';

const og = new Omnigraph({
  baseUrl: 'http://127.0.0.1:8080',
  fetch: (url, init) => {
    console.log('→', init?.method ?? 'GET', url);
    return globalThis.fetch(url, init);
  },
});
```

## License

MIT
