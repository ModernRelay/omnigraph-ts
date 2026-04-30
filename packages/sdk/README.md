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
  token: process.env.OMNIGRAPH_TOKEN, // optional; omit for unauthenticated dev
});

const { rows } = await og.read({
  branch: 'main',
  querySource: 'query find($name: String) { match { $p: Person { name: $name } } return { $p.name, $p.age } }',
  queryName: 'find',
  params: { name: 'Alice' },
});

console.log(rows); // → [{ '$p.name': 'Alice', '$p.age': 30 }]
```

That's the whole pattern: instantiate once, call methods, get typed responses.

## What you can do

### Read

```ts
const { rows, columns, rowCount } = await og.read({
  branch: 'main',
  querySource: 'query top($limit: I32) { ... order by $p.score desc limit $limit }',
  queryName: 'top',
  params: { limit: 10 },
});
```

`params` keys are caller-controlled — they survive the SDK's snake/camel boundary verbatim, so your `$varName` placeholders match.

### Mutate

```ts
const { affectedNodes, affectedEdges } = await og.change({
  branch: 'feature',
  querySource: 'query addPerson($name: String, $age: I32) { insert Person { name: $name, age: $age } }',
  queryName: 'addPerson',
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

### Bulk ingest

```ts
import { LoadMode } from '@modernrelay/omnigraph';

await og.ingest({
  branch: 'import-2026-04-30',
  from: 'main',
  mode: LoadMode.MERGE, // upsert by @key — safe to retry
  data: ndjsonString,
});
```

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
```

### Snapshots, commits, runs

```ts
await og.snapshot({ branch: 'main' });
await og.commits.list({ branch: 'main' });
await og.commits.retrieve(commitId);
await og.runs.list();
await og.runs.publish(runId);
```

## Errors

Every method throws a typed error subclass on non-2xx. Catch the specific class you care about:

```ts
import {
  Omnigraph,
  ConflictError,
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
  } else throw e;
}
```

Every error carries `status`, `code`, `requestId` (from the `X-Request-Id` response header), and the parsed response body for diagnostics.

## Cancellation

Every method accepts an `AbortSignal`:

```ts
const ac = new AbortController();
setTimeout(() => ac.abort(), 5_000);

await og.read({ branch: 'main', querySource: '...' }, { signal: ac.signal });
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
| `og.health()`, `og.snapshot()`, `og.read()`, `og.export()`, `og.branches.list()`, `og.commits.list()`, `og.commits.retrieve()`, `og.runs.list()`, `og.schema.get()` | Read-only — always safe. |
| `og.branches.create({ name })` | Throws `ConflictError` on retry (branch exists). Catch and treat as success. |
| `og.branches.merge({ source, target })` | Idempotent — re-merge yields `outcome: 'already_up_to_date'`. |
| `og.branches.delete(name)` | Idempotent — delete-of-deleted is a no-op. |
| `og.schema.apply({ schemaSource })` | Idempotent — unchanged schema returns `applied: false`. |
| `og.ingest({ data, mode: 'merge' })` | **Idempotent** — use this mode for at-least-once pipelines. Requires `@key` constraints. |
| `og.ingest({ data, mode: 'overwrite' })` | Idempotent — same input → same final state. |
| `og.ingest({ data, mode: 'append' })` | **Not idempotent** — blind insert. Avoid for retry-prone callers. |
| `og.change({ querySource })` | Depends on the query. `update X set ... where ...` is idempotent; `insert X { ... }` is idempotent only with `@unique` / `@key`. |
| `og.runs.abort(id)`, `og.runs.publish(id)` | Idempotent on already-terminal runs. |

If a `change` query isn't naturally idempotent, fix the schema (add `@unique` or `@key`) — not the SDK.

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
