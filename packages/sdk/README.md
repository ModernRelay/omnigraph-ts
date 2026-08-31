# @modernrelay/omnigraph

TypeScript client for the [Omnigraph](https://github.com/ModernRelay/omnigraph) graph database — typed property graphs with vector + full-text search, git-style branches, and a query language designed for hybrid retrieval over an HTTP API.

The SDK gives you idiomatic TypeScript on top of that: instance-per-client, camelCase types, throw-by-default typed errors, `AbortSignal` cancellation, and an async-iterator export stream. No `{ data, error }` discriminated unions, no string-keyed magic, no global state.

## Install

```sh
npm install @modernrelay/omnigraph
# or: pnpm add @modernrelay/omnigraph
```

Requires **Node 22+** (uses native `fetch` and web streams). Browser support depends on server CORS; browsers also hide manual cross-origin redirects, so inspecting external Blob descriptors requires a server-side runtime.

This branch prepares **v0.10** against an immutable, unmerged server candidate.
It is not a published release. The repository's source pin blocks publication
until the final server tag exists and its contract is revalidated.

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

> **`graphId` is required (server 0.7.0).** `omnigraph-server` is cluster-only: every graph-scoped operation is served under `/graphs/{graphId}/…`. A graph-scoped call without a `graphId` throws `ConfigurationError` before hitting the network. Only `og.health()` and `og.graphs.list()` work without one — use the latter to discover ids, then [`og.graph(id)`](#multi-graph-clusters). This SDK targets the matching server release (see [Server compatibility](#server-compatibility)); for a 0.6.x (flat-route) server, stay on `@modernrelay/omnigraph@0.6.x`.

Use **`og.query()`** (read), **`og.mutate()`** (write), and **`og.load()`** (bulk load). Deprecated aliases were removed from the SDK in v0.7; v0.10 does not promise compatibility with older server minor versions.

## What you can do

### Read

```ts
const { rows, columns, rowCount } = await og.query({
  branch: 'main',
  query: 'query top() { match { $p: Person } return { $p.name, $p.age } order { $p.age desc } limit 10 }',
  name: 'top',
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

Multi-statement mutations publish atomically. Successful mutations return an
exact `commit` receipt; `commit: null` means a successful no-op. Load methods
also return their exact commit, plus `nodes`, `edges`, and `totalEntities`.

### Conditional mutations

```ts
const read = await og.query({
  query: 'query person($name: String) { match { $p: Person { name: $name } } return { $p.age } }',
  params: { name: 'Alice' },
});
if (!read.graphCommitId) throw new Error('Read has no graph commit position');
await og.mutate({
  query: 'query birthday($name: String, $age: I32) { update Person set { age: $age } where name = $name }',
  params: { name: 'Alice', age: 31 },
}, { ifGraphCommit: read.graphCommitId });
```

The SDK uses `/mutate/if-graph-commit`, never an optional header on ordinary
`/mutate`. A stale position throws `PreconditionFailedError` (412) with
`preconditionFailure`; re-read and reconsider. An older server's 404 never
causes an unconditional retry. Stored mutations support the same second-option
field: `og.queries.invoke(name, input, { ifGraphCommit })`.

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
  mode: LoadMode.MERGE,  // upsert by @key; not request deduplication
  data: ndjsonString,
});
```

`og.load()` is the canonical bulk-load method. **Loading into a branch that doesn't exist requires `from`** (the base to fork from); without it the server returns `NotFoundError` (404) rather than implicitly forking from `main`.

For high-rate pipelines there is also `og.loadNdjson()` (server 0.9.0+), which posts the batch as a raw `application/x-ndjson` body instead of a JSON envelope — one strict, bounded graph-level batch per call, acknowledged only after its single graph commit is durably visible:

```ts
await og.loadNdjson({
  branch: 'ingest',
  from: 'main',           // same fork-if-missing rule as og.load()
  mode: LoadMode.MERGE,   // default; reconcile ambiguous outcomes before retry
  ndjson:
    '{"type":"Person","data":{"name":"Ada","age":30}}\n' +
    '{"type":"Person","data":{"name":"Grace","age":35}}\n' +
    '{"edge":"Knows","from":"Ada","to":"Grace","data":{}}\n',
});
```

Each nonblank line is exactly one node envelope (`{"type":...,"data":{...}}`) or edge envelope (`{"edge":...,"from":...,"to":...,"data":{...}}`). The batch is bounded like every keyed load — an oversized request is refused with a 413 before any durable effect; split it across calls.

### Stream a branch as NDJSON

```ts
for await (const row of og.export({ branch: 'main', typeNames: ['Person'] })) {
  // row keys reflect your schema verbatim
}
```

The iterator lazily issues `POST /export` on first iteration and cancels the upstream connection on early `break`.

### Inspect the schema

```ts
const { schemaSource } = await og.schema.get();    // .pg source
```

> **`og.schema.apply()` is rejected on a cluster-managed graph (409 → `ConflictError`).** A 0.7.0 server is cluster-only and evolves schema declaratively via `omnigraph cluster apply` (an operator action), not over HTTP. The method remains in the SDK as a faithful binding for `POST /schema/apply` (and surfaces the 409), but on a cluster server it will not migrate. Drive schema changes through the cluster workflow.

### Snapshots and commits

```ts
await og.snapshot({ branch: 'main' });
await og.commits.list({ branch: 'main' });
await og.commits.retrieve(commitId);
```

Snapshots expose `graphBranch`, `graphManifestVersion`, and `datasets`.
Each dataset reports `entityKind`, `typeName`, `entityCount`, `datasetPath`,
`publishedDatasetVersion`, and optional `nativeDatasetBranch`. The published
version is graph authority, not an observation of the current physical head.

### Entity changes and baselines

```ts
const diff = await og.commits.changes(commitId, { kind: ['node'], limit: 100 });
const page = await og.changes.poll({ branch: 'main', start: 'now' });
// Resume a later poll using the terminal page's cursor:
if (page.cursor) await og.changes.poll({ branch: 'main', cursor: page.cursor });
```

These return **one bounded page**, not an automatically accumulated history.
Follow `nextPageToken` with `pageToken`, preserving branch and filters; omit
`start` and `cursor` while continuing pages. Entity `properties` remain verbatim,
including underscore keys. Commit-diff page tokens are not feed cursors.
Apply feed blocks idempotently by `graphCommitId` and persist the terminal
cursor atomically with the applied data. HTTP 410 `GoneError.changeFeedGap`
requires a fresh baseline, not a retry of the same cursor.

`og.changes.baseline({ branch: 'main' })` streams typed `ChangeBaselineRecord`
values: node/edge export records followed by `{ baseline: { snapshotCommitId,
resumeCursor } }`. It exposes the terminal record only after clean stream
completion and rejects a missing or malformed terminal record. Install the
complete entity snapshot durably **before** saving its resume cursor. The SDK
does not own consumer storage or checkpoint durability.

### Blob bytes and metadata

```ts
const selector = { entity: 'node' as const, type: 'Document', id: 'manual', property: 'content' };
const metadata = await og.blobs.stat(selector); // HEAD, no payload
const response = await og.blobs.get({ ...selector, range: 'bytes=0-1023' });
if (response.status === 200 || response.status === 206) {
  // response.body is a ReadableStream; consume incrementally for large blobs.
} else if (response.status === 302) {
  // External reference only. Decide separately whether to access Location.
} else if (response.status === 304) {
  // Cached representation matched ifNoneMatch.
}
```

Both methods return the raw `Response`, preserve headers/ETags, and never
follow external redirects. Inputs support `branch` or `snapshot`, `ifMatch`,
and `ifNoneMatch`; GET also supports `range` and `ifRange`. `snapshot` takes a
graph commit ID, such as `query().graphCommitId`; the opaque
`Omnigraph-Snapshot-Id` response header is diagnostic identity, not a reusable
request value. A failed condition
or range throws a typed 412/416 error. HEAD errors have no JSON body, so inspect
the status and response headers. Write Blob values through normal mutate/load;
there is no Blob-write or full-text-index-rebuild HTTP endpoint.

## Errors

Methods throw typed errors on HTTP failure (Blob 302/304 are explicit successes).
Catch the specific class you care about:

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

New status-specific classes are `GoneError` (410), `PreconditionFailedError`
(412), `PayloadTooLargeError` (413), `RangeNotSatisfiableError` (416),
`FailedDependencyError` (424), and `ServiceUnavailableError` (503). They retain
their structured details, such as `resourceLimit` or `recoveryRequired`.
HTTP status takes priority over the server's older broad `code` values.

For 409s, inspect `ConflictError.publishedDatasetVersionConflict`,
`readSetConflict`, `keyConflict`, `mergeConflicts`, `changeDiffRefusal`, or
`fullTextIndexRebuildRequired`. A full-text rebuild refusal requires explicit
operator maintenance on the relevant branch; retrying search cannot repair it.

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

Published SDKs track server **major.minor**, with independent patch versions.
`SERVER_VERSION` identifies the exact source contract. CI checks that contract
and runs live e2e against the same release, or the exact immutable source pin
while an upcoming release is being prepared.

### Migrating from v0.9

No legacy-key aliases are fabricated; the public camelCase names follow v0.10.

| v0.9 | v0.10 |
|---|---|
| Snapshot `branch`, `manifestVersion`, `tables` | `graphBranch`, `graphManifestVersion`, `datasets` |
| `SnapshotTable` | `SnapshotDataset` |
| Snapshot entry `tableKey`, `rowCount`, `tablePath`, `tableVersion`, `tableBranch` | `entityKind` + `typeName`, `entityCount`, `datasetPath`, `publishedDatasetVersion`, `nativeDatasetBranch` |
| Load `tables`, `IngestTable` | `nodes`/`edges` of `GraphBatchDeclaration`, plus `totalEntities` |
| Declaration `rowsLoaded` | `entitiesLoaded` |
| Commit `manifestBranch`, `manifestVersion` | `graphBranch`, `graphManifestVersion` |
| Conflict `tableKey`, `rowId` | `entityKind`, `typeName`, `entityId` |
| `ManifestConflict`, `manifestConflict` | `PublishedDatasetVersionConflict`, `publishedDatasetVersionConflict` |
| Publisher conflict `expected`, `actual` | `expectedPublishedDatasetVersion`, `actualPublishedDatasetVersion` |
| Export `tableKeys` | Removed; use `typeNames` |

## Designing for safe retry

The SDK makes single-shot requests. There is no request-deduplication header.
Stable keys and deterministic upserts help make repeated data equivalent, but
they do not make every replay safe: a retry can overwrite intervening work,
publish another commit, or duplicate unkeyed entities.

A successful write's receipt proves its own publication. An unchanged branch
head does not prove a failed write, and an advanced head does not identify the
writer. After a timeout or lost response, reconcile intended content and commit
history before deciding whether to replay. For read-modify-write use the exact
read position and a conditional mutation. Treat 412 as a stale decision, 410 as
a required baseline reset, and a full-text 409 as required maintenance.

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
const eu = new Omnigraph({ baseUrl: 'https://eu.example', graphId: 'alpha' });
const us = new Omnigraph({ baseUrl: 'https://us.example', graphId: 'alpha' });

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
