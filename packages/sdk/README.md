# @modernrelay/omnigraph

TypeScript SDK for the [Omnigraph](https://github.com/ModernRelay/omnigraph) HTTP API.

Generated DTO types from the upstream OpenAPI 3.1 spec, plus a hand-written
client that exposes a Stripe-style API: instance-per-client, resource
namespaces, throw-by-default typed errors, camelCase boundary, and
streaming exports.

Versions track the omnigraph-server release they were generated from —
`@modernrelay/omnigraph@X.Y.Z` matches omnigraph-server `X.Y.Z`.

## Install

```sh
npm install @modernrelay/omnigraph
# or
pnpm add @modernrelay/omnigraph
```

Requires Node 22+ (uses native `fetch` and `Response.body.getReader()`).

## Usage

```ts
import Omnigraph, {
  ConflictError,
  LoadMode,
  NotFoundError,
} from '@modernrelay/omnigraph';

const og = new Omnigraph({
  baseUrl: 'http://127.0.0.1:8080',
  token: process.env.OMNIGRAPH_TOKEN,
});

// Branches
const branches = await og.branches.list();                      // string[]
await og.branches.create({ name: 'feature', from: 'main' });
await og.branches.merge({ source: 'feature', target: 'main' });
await og.branches.delete('feature');

// Commits / runs / schema
const commits = await og.commits.list({ branch: 'main' });
const c = await og.commits.retrieve('cmt_01KQ...');             // (prefixed in v0.4.0+)
const runs = await og.runs.list();
await og.runs.publish(runId);
const schema = await og.schema.get();
await og.schema.apply({ schemaSource });

// Reads / mutations / streaming
const result = await og.read({
  branch: 'main',
  querySource: 'query q() { match { $a: Decision } return { $a.title } }',
});
await og.change({ branch: 'feature', querySource });
await og.ingest({ branch: 'feature', data: ndjson, mode: LoadMode.MERGE });

for await (const row of og.export({ branch: 'main' })) {
  console.log(row);
}

// Errors throw by default
try {
  await og.branches.create({ name: 'main' });
} catch (e) {
  if (e instanceof ConflictError) {
    // 409 — branch exists, merge conflict, etc.
    e.mergeConflicts;                                            // typed
  } else if (e instanceof NotFoundError) {
    // 404
  } else throw e;
}
```

## Designing for safe retry

Omnigraph is a database; idempotency is encoded in the schema, not in
per-request keys. The SDK does not ship `Idempotency-Key` headers — the
graph already has primary keys and unique constraints that dedup correctly
under retry, forever.

| Operation | Retry semantics |
|---|---|
| `og.branches.list()` / `og.commits.list()` / `og.runs.list()` / `og.schema.get()` / `og.read()` / `og.snapshot()` / `og.export()` / `og.health()` | Read-only. Always safe. |
| `og.branches.create({ name })` | Throws `ConflictError` on retry (branch exists). Catch and treat as success in at-least-once flows. |
| `og.branches.merge({ source, target })` | Naturally idempotent: a retry yields `outcome: 'already_up_to_date'`. |
| `og.branches.delete(name)` | Idempotent (delete-of-deleted is a no-op). |
| `og.schema.apply({ schemaSource })` | Idempotent: an unchanged schema returns `applied: false`. |
| `og.ingest({ data, mode: 'merge' })` | Idempotent. **Use this mode for at-least-once pipelines.** Requires `@key` constraints on the affected node/edge types. |
| `og.ingest({ data, mode: 'append' })` | **Not** idempotent — blind insert. Avoid for retry-prone callers. |
| `og.ingest({ data, mode: 'overwrite' })` | Idempotent: same input → same final state. |
| `og.change({ querySource })` | Depends on the query. `update X set ... where ...` is idempotent. `insert X { ... }` is idempotent only with `@unique` / `@key` constraints. |
| `og.runs.abort(id)` | Idempotent on already-aborted runs. |
| `og.runs.publish(id)` | Idempotent on already-published runs. |

If the operation isn't naturally idempotent (e.g., `og.change()` with blind
inserts), the right fix is in the schema — add `@unique` or `@key` — not
in the SDK.

## Cancellation

Every method accepts `signal: AbortSignal` for caller-driven deadlines:

```ts
const ac = new AbortController();
setTimeout(() => ac.abort(), 5000);
await og.read({ querySource }, { signal: ac.signal });
```

## Multi-server processes

Each `new Omnigraph(...)` is an isolated client. There is no global state.

```ts
const eu = new Omnigraph({ baseUrl: 'https://eu.example' });
const us = new Omnigraph({ baseUrl: 'https://us.example' });

await Promise.all([eu.branches.list(), us.branches.list()]);
```

## Custom fetch

Inject your own `fetch` for testing, tracing, or polyfills:

```ts
import Omnigraph from '@modernrelay/omnigraph';

const og = new Omnigraph({
  baseUrl: 'http://127.0.0.1:8080',
  fetch: (url, init) => {
    console.log('request', url);
    return globalThis.fetch(url, init);
  },
});
```

## License

MIT
