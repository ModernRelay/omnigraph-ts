# @modernrelay/omnigraph

TypeScript client for **OmniGraph 0.14**, with typed errors, exact write receipts,
streaming exports, and cluster deployment APIs. Requires Node.js 22 or newer.

```sh
npm install @modernrelay/omnigraph
```

## Connect and query

```ts
import Omnigraph from '@modernrelay/omnigraph';

const og = new Omnigraph({
  baseUrl: 'http://127.0.0.1:8080', // server root
  graphId: 'alpha',
  token: process.env.OMNIGRAPH_TOKEN,
});

const result = await og.query({
  query: 'query find($name: String) { match { $p: Person { name: $name } } return { $p.name, $p.age } }',
  name: 'find',
  params: { name: 'Alice' },
  branch: 'main',
});
console.log(result.rows, result.graphCommitId);
```

Use the server root as `baseUrl`; select a graph with `graphId` or
`og.graph('beta')`. Graph-scoped methods refuse a missing graph before sending
requests. Server methods such as health, readiness, graph listing, and cluster
management do not require a graph ID.

The SDK checks discovery before authenticated data requests, sends
`Omnigraph-Http-Api: 0.14`, and checks the response contract before exposing data.
It supports only 0.14; upgrade the server and clients together. Proxies and
custom fetch implementations must preserve this response header. No redirects
or automatic request retries are performed.

Public fields use camelCase. User data stays unchanged: query parameters,
result row keys, entity properties, and captured deployment content retain
exact spelling.

## Write and verify

```ts
const changed = await og.mutate({
  query: 'query rename($old: String, $name: String) { update Person set { name: $name } where name = $old }',
  params: { old: 'Alice', name: 'Alicia' },
  branch: 'main',
}, { ifGraphCommit: result.graphCommitId! });

if (changed.commit) {
  console.log(changed.commit.graphCommitId); // this operation's publication
}
```

A successful mutation, load, or publishing merge returns its exact commit
receipt. A data mutation with `commit: null` is a successful no-op. Branch
create/delete return their effect without a commit; an already-up-to-date
merge also publishes no commit. GQ branch statements name their own branches
and must omit the request `branch`.

For read-modify-write, use the read's `graphCommitId` as `ifGraphCommit`.
HTTP 412 means the conditional write had no effects: re-read and reconsider.
The SDK never falls back to an unconditional write.

A timeout, abort, or lost response does not cancel an accepted server operation.
Reconcile intended content and relevant history before replaying a write.
Separately reading the branch head does not identify which writer committed.

```ts
await og.branches.create({ name: 'review', from: 'main' });
await og.load({
  branch: 'review',
  mode: 'merge',
  data: '{"type":"Person","data":{"name":"Bob","age":28}}\n',
});
const receipt = await og.branches.merge({ source: 'review', target: 'main' });
await og.branches.delete('review');
```

`merge` load mode upserts stable keys; it does not deduplicate requests.
`append` rejects key collisions; `overwrite` replaces supplied types.
A missing branch requires explicit `from`. Oversized loads return 413: split
into separate commits. `loadNdjson({ branch, mode, ndjson })` accepts the same
node/edge envelopes as a raw NDJSON body. Read the live schema before constructing
envelopes; explicit entity identity is top-level `id`.

## Read resources and stream data

```ts
await og.schema.get();
await og.snapshot({ branch: 'main' });
const { commits, headCommitId, nextPageToken } = await og.commits.list({ branch: 'main', limit: 100 });
await og.commits.retrieve(commitId);
await og.queries.list();
await og.queries.invoke('find_person', { params: { name: 'Alice' }, branch: 'main' });

for await (const record of og.export({ branch: 'main', typeNames: ['Person'] })) {
  // Consume incrementally. An early break closes the response.
}
```

Snapshots report `graphBranch`, `graphManifestVersion`, and `datasets`.
Published dataset versions identify the graph snapshot. Export returns NDJSON records. Network stream failures and malformed NDJSON
reject iteration. Consume to completion before treating an export as complete.

```ts
const page = await og.changes.poll({ branch: 'main', start: 'now', limit: 100 });
const diff = await og.commits.changes(commitId, { kind: ['node'], limit: 100 });
```

Change methods return one bounded page. Follow `nextPageToken` using `pageToken`,
keeping filters and branch unchanged and omitting `start`/`cursor`. Page tokens
are not durable cursors. Apply complete feed commit blocks idempotently by
`graphCommitId` and persist the terminal cursor with the applied data.

A 410 `changeFeedGap` requires `og.changes.baseline({ branch: 'main' })`. This
streams nodes and edges, followed by `{ baseline: { snapshotCommitId,
resumeCursor } }` only after clean completion. Install the complete snapshot
before saving the cursor. The SDK does not own consumer storage.

```ts
const selector = { entity: 'node' as const, type: 'Document', id: 'manual', property: 'content' };
const metadata = await og.blobs.stat(selector);
const bytes = await og.blobs.get({ ...selector, range: 'bytes=0-1023' });
```

Blob read methods return raw `Response` objects, preserving headers and streams.
GET may return 200, 206, 302 (external reference; never followed), or 304.
Both accept `branch` or commit-ID `snapshot`, `ifMatch`, and `ifNoneMatch`;
GET also accepts `range` and `ifRange`. HEAD failures have no JSON body.
The `Omnigraph-Snapshot-Id` response header is diagnostic identity, not a
snapshot request value. `blobs.put({ ...selector, data: new Uint8Array(...) })`
sends raw bytes, optionally guarded by `ifMatch`. `blobs.clear(selector)` sets a
nullable cell to null. Both return a JSON `BlobWrite` receipt; an already-null
clear returns `commit: null`. Neither operation is retried automatically.

## Live deployments

Schema, query, policy, provider, Blob-binding, and graph lifecycle changes use
cluster deployments. For normal operator workflows, use
`omnigraph cluster plan/apply --target NAME --config DIR` with a local configuration bundle.
Removing a graph declaration deletes its managed storage and history.

Integrations that already produce the server's captured deployment bundle can
use the SDK directly. The bundle contains frozen source bytes and their
identities; these methods do not parse YAML or open local files.

```ts
await og.cluster.plan({ deployment: capturedDeployment });
const accepted = await og.cluster.apply({ deploymentId, deployment: capturedDeployment });
const observed = await og.cluster.getDeployment(deploymentId);
const cluster = await og.cluster.status();
```

Allocate and retain the exact deployment ID before submission. Acceptance is
not activation: inspect `inProgress`, the durable `deployment` result, and
`active`. After a disconnect, observe the same ID; never resubmit just because
the response was lost. The SDK performs one data request per method and does not
poll or retry for you. Nested `deployment`, `plan`, and `status` documents keep
the server's exact wire keys.

## Errors and cancellation

```ts
import { ApiContractError, PreconditionFailedError, NetworkError } from '@modernrelay/omnigraph';

try {
  await og.query({ query: '...' }, { signal: AbortSignal.timeout(5_000) });
} catch (error) {
  if (error instanceof ApiContractError || error instanceof NetworkError) {
    console.error(error.requestDispatched, error.outcomeUnknown);
  } else if (error instanceof PreconditionFailedError) {
    console.error(error.preconditionFailure);
  } else throw error;
}
```

Methods accept an `AbortSignal`; authenticated operations also accept `ifActor` to require a particular credential identity before execution. Typed errors retain `status`, `code`,
`requestId`, and structured `body`. Discovery refusal sets
`requestDispatched: false`; a failure after a write was sent may set
`outcomeUnknown: true`. An HTTP status alone does not establish retry safety.

Inspect 409 details: merge/key conflicts require a decision;
`fullTextIndexRebuildRequired` needs operator maintenance. A 503 can mean a
known graph is loading or unavailable; 404 means the target is unknown.
`readiness()` returns readiness information even when its status is 503.
Use readiness, not liveness, for traffic admission.

## Authorization and upgrades

Credentials resolve actors at the server. Permissions come from the cluster's
Cedar policy. Graph listing requires `graph_list`; cluster deployment operations
require `config_manage`. A token does not imply write permission.

Schema changes use cluster deployments; `schema.apply()` and the old HTTP
compatibility routes are unavailable.
Existing data migration depends on its storage format; follow the authoritative
[upgrade guide](https://github.com/ModernRelay/omnigraph/blob/9d92f3970311d5229f55b1a1fc06b2d3fba30a55/docs/user/operations/upgrade.md).
The SDK does not convert stored graphs or legacy credentials.

`SERVER_VERSION` identifies the pinned server release. Package major/minor
tracks the server contract; patch releases are independent. Each client has
isolated configuration and supports a custom `fetch` for testing or tracing.

## Upgrading from 0.13

Upgrade server and client together. This candidate is pinned to the final 0.14
HTTP contract at `9d92f397`; npm publication remains blocked until the server's
stable tag exists and the temporary `serverRef` is removed.

- `commits.list()` now returns `{ commits, headCommitId?, nextPageToken? }`,
  preserving the server's page metadata. Use `listing: 'history'` (default),
  `'unpublished'`, or `'unattached'`; only history accepts `limit`/`pageToken`.
  Continue with the same branch and `pageToken`, retaining the returned head.
- `commits.publish(id)` returns the publication receipt. `commits.drop(id)`
  resolves to `undefined` on HTTP 204. Branch deletion and Blob clearing still
  return their JSON receipts; do not treat every DELETE as empty.
- `access({ branch, targetBranch })` returns `actorId`, `graphWide`, and scoped
  `actions`. `diff({ from, to })`, `branches.diff({ source, target })` and
  `branches.mergeBase({ source, target })` expose bounded review operations.
- `branches.create` accepts `fromCommit`; `branches.merge` accepts `dryRun`
  or `asCommit`. Branch names pass through exactly as written.
- Public enums now follow the specification: `EntityKind` replaces
  `BlobEntityKind`/`EntityKindOutput`, `ChangeOp` replaces `ChangeOpOutput`, and
  `MergeConflictKind` replaces `MergeConflictKindOutput`.
- Errors expose the server's `disposition` (effect knowledge and next action)
  alongside their precise `code`. Transport loss still reports uncertainty;
  neither that report nor a retry hint causes an automatic replay.

Use `oauthMetadataAtResourcePath('mcp')` for path-specific OAuth metadata;
these public requests never include credentials or actor preconditions.

## License

MIT
