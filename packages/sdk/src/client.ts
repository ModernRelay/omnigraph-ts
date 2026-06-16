import { ndjsonIterator } from './stream';
import { Transport } from './transport';
import type { FetchLike } from './transport';
import { BranchesResource } from './resources/branches';
import type { CallOptions } from './internals';
import { CommitsResource } from './resources/commits';
import { GraphsResource } from './resources/graphs';
import { QueriesResource } from './resources/queries';
import { SchemaResource } from './resources/schema';
import type {
  Change,
  ChangeInput,
  ExportInput,
  Health,
  Ingest,
  IngestInput,
  MutationInput,
  QueryInput,
  Read,
  ReadInput,
  Snapshot,
} from './types';

// GQ params are caller-controlled (matched by name to `$varName` in query
// source). Their wire-format keys must survive the camel<->snake boundary
// unchanged. Same for ReadOutput.rows / .columns: shapes are user-schema-driven.
const OPAQUE_PARAMS = new Set(['params']);
const OPAQUE_READ_RESPONSE = new Set(['rows', 'columns']);
// Export NDJSON rows are `{ type, data }` (or `{ edge, from, to, data }`).
// `data` contains the user-schema-driven properties whose keys must round-trip
// through ingest unchanged — keep verbatim. The envelope keys (`type`, `edge`,
// `from`, `to`) are SDK/wire-defined and already match in both cases.
const OPAQUE_EXPORT_ROW = new Set(['data']);

function normalizeChangeInput(input: ChangeInput): MutationInput {
  const record = input as Record<string, unknown>;
  const hasCanonical = record.query !== undefined || record.name !== undefined;
  const hasLegacy = record.querySource !== undefined || record.queryName !== undefined;
  if (hasCanonical && hasLegacy) {
    throw new TypeError('og.change() accepts either query/name or querySource/queryName, not both');
  }
  if (hasLegacy) {
    if (typeof record.querySource !== 'string' || record.querySource.length === 0) {
      throw new TypeError('og.change() requires querySource when using legacy querySource/queryName fields');
    }
    return {
      query: record.querySource,
      name: record.queryName as string | null | undefined,
      params: record.params,
      branch: record.branch as string | null | undefined,
    };
  }
  if (typeof record.query !== 'string' || record.query.length === 0) {
    throw new TypeError('og.change() requires query when using canonical query/name fields');
  }
  return input as MutationInput;
}

export interface OmnigraphOptions {
  /** Base URL of the omnigraph-server. e.g. `http://127.0.0.1:8080`. */
  baseUrl: string;
  /** Bearer token. Optional for unauthenticated servers. */
  token?: string;
  /** Inject a custom fetch (testing, tracing, polyfills). */
  fetch?: FetchLike;
  /**
   * Target a specific graph in the cluster. Every graph-scoped call is sent
   * under `/graphs/${graphId}/...`. Flat paths (`/healthz`, `/graphs`) are
   * never prefixed.
   *
   * **Required** against omnigraph-server 0.7.0+ (cluster-only): a graph-scoped
   * call without a `graphId` throws {@link ConfigurationError}. Only
   * `og.health()` and `og.graphs.list()` work without one — use the latter to
   * discover graph ids, then `og.graph(id)`.
   *
   * Don't fold the id into `baseUrl` (e.g. `http://host/graphs/alpha`):
   * that breaks `og.health()` and `og.graphs.list()`. Use this option,
   * or `og.graph(id)` for a scoped clone.
   */
  graphId?: string;
}

export interface SnapshotInput {
  branch?: string;
}

export default class Omnigraph {
  readonly branches: BranchesResource;
  readonly commits: CommitsResource;
  readonly graphs: GraphsResource;
  readonly queries: QueriesResource;
  readonly schema: SchemaResource;

  private readonly t: Transport;
  private readonly opts: OmnigraphOptions;

  constructor(opts: OmnigraphOptions) {
    this.opts = opts;
    this.t = new Transport(opts);
    this.branches = new BranchesResource(this.t);
    this.commits = new CommitsResource(this.t);
    this.graphs = new GraphsResource(this.t);
    this.queries = new QueriesResource(this.t);
    this.schema = new SchemaResource(this.t);
  }

  /**
   * Return a new client scoped to `graphId`, sharing this client's
   * `baseUrl`, `token`, and `fetch`. The original client is untouched —
   * use this to fan out across graphs in a multi-graph cluster:
   *
   *     await og.graph('alpha').snapshot();
   *     await og.graph('beta').query({ query: '...' });
   */
  graph(graphId: string): Omnigraph {
    return new Omnigraph({ ...this.opts, graphId });
  }

  /**
   * Liveness probe. Unauthenticated; safe to call from any caller.
   */
  health(opts: CallOptions = {}): Promise<Health> {
    return this.t.request<Health>('GET', '/healthz', { signal: opts.signal });
  }

  /**
   * Run a GQ read query. Canonical read endpoint as of server 0.6.0
   * (successor to `read`). Read-only.
   *
   * Identical response shape to `og.read()`; the canonical field names are
   * `query` / `name` (vs. legacy `querySource` / `queryName`).
   */
  query(input: QueryInput, opts: CallOptions = {}): Promise<Read> {
    return this.t.request<Read>('POST', '/query', {
      body: input,
      signal: opts.signal,
      opaqueBodyKeys: OPAQUE_PARAMS,
      opaqueResponseKeys: OPAQUE_READ_RESPONSE,
    });
  }

  /**
   * Run a GQ mutation. Canonical write endpoint as of server 0.6.0
   * (successor to `change`). **Destructive** — branch is updated atomically.
   *
   * **Idempotency**: design queries with `@unique` constraints or
   * `update ... where` clauses to allow safe retry. Blind `insert` without
   * unique keys can duplicate on retry.
   */
  mutate(input: MutationInput, opts: CallOptions = {}): Promise<Change> {
    return this.t.request<Change>('POST', '/mutate', {
      body: input,
      signal: opts.signal,
      opaqueBodyKeys: OPAQUE_PARAMS,
    });
  }

  /**
   * Run a GQ read query. Read-only.
   *
   * @deprecated Server 0.6.0 introduces {@link Omnigraph.query} as the
   * canonical successor. `POST /read` still works but the server emits
   * `Deprecation: true` and `Link: </query>; rel="successor-version"`
   * response headers. Migrate to `og.query()`; the field names there are
   * `query` / `name` instead of `querySource` / `queryName`.
   */
  read(input: ReadInput, opts: CallOptions = {}): Promise<Read> {
    return this.t.request<Read>('POST', '/read', {
      body: input,
      signal: opts.signal,
      opaqueBodyKeys: OPAQUE_PARAMS,
      opaqueResponseKeys: OPAQUE_READ_RESPONSE,
    });
  }

  /**
   * Run a GQ mutation. Returns counts of nodes/edges affected and produces
   * a new commit on success. **Destructive** — branch is updated atomically.
   *
   * **Idempotency**: design queries with `@unique` constraints or
   * `update ... where` clauses to allow safe retry. Blind `insert` without
   * unique keys can duplicate on retry.
   *
   * @deprecated Server 0.6.0 introduces {@link Omnigraph.mutate} as the
   * canonical successor. `POST /change` still works but the server emits
   * `Deprecation: true` and `Link: </mutate>; rel="successor-version"`
   * response headers. Accepts both the old SDK fields (`querySource` /
   * `queryName`) and the canonical fields (`query` / `name`); the wire request
   * is normalized to the server 0.6 shape.
   */
  change(input: ChangeInput, opts: CallOptions = {}): Promise<Change> {
    return this.t.request<Change>('POST', '/change', {
      body: normalizeChangeInput(input),
      signal: opts.signal,
      opaqueBodyKeys: OPAQUE_PARAMS,
    });
  }

  /**
   * Bulk-load NDJSON into a branch. Canonical write-load endpoint as of
   * server 0.7.0 (successor to `ingest`). **Use `mode: 'merge'` for
   * at-least-once safety** — retries upsert by `@key` instead of duplicating
   * rows.
   *
   * **Branch creation is opt-in.** Without `from`, the target `branch` must
   * already exist — a missing branch is a {@link NotFoundError} (404), never an
   * implicit fork. Pass `from` to fork-if-missing.
   */
  load(input: IngestInput, opts: CallOptions = {}): Promise<Ingest> {
    return this.t.request<Ingest>('POST', '/load', { body: input, signal: opts.signal });
  }

  /**
   * Bulk-ingest NDJSON. Identical request/response shape to {@link Omnigraph.load}.
   *
   * @deprecated Server 0.7.0 introduces {@link Omnigraph.load} as the canonical
   * successor. `POST /ingest` still works (kept indefinitely as a shim) but the
   * server emits `Deprecation: true` and `Link: </load>; rel="successor-version"`
   * response headers. Migrate to `og.load()`; the shapes are identical.
   */
  ingest(input: IngestInput, opts: CallOptions = {}): Promise<Ingest> {
    return this.t.request<Ingest>('POST', '/ingest', { body: input, signal: opts.signal });
  }

  /**
   * Get a snapshot of the latest commit on a branch. Read-only.
   */
  snapshot(input: SnapshotInput = {}, opts: CallOptions = {}): Promise<Snapshot> {
    return this.t.request<Snapshot>('GET', '/snapshot', {
      query: { branch: input.branch },
      signal: opts.signal,
    });
  }

  /**
   * Stream the contents of a branch as NDJSON. Returns an async iterator —
   * iterate with `for await (const row of og.export(...))` to avoid buffering.
   *
   * **Iterate at most once.** The iterable lazily issues `POST /export` from
   * its `[Symbol.asyncIterator]()`, so a second iteration would re-hit the
   * server. Bind the iterator to a variable if you need to peek.
   *
   * **Cancellation.** Aborting `opts.signal` mid-iteration terminates the
   * fetch and lets the `for await` reject; the upstream connection is
   * cancelled in `ndjsonIterator`'s `finally`.
   *
   * The default row type is `Record<string, unknown>` (rows are
   * user-schema-driven). Pass an explicit `T` if your caller already
   * knows the row shape: `og.export<MyRow>({ branch: 'main' })`.
   */
  export<T = Record<string, unknown>>(
    input: ExportInput = {},
    opts: CallOptions = {},
  ): AsyncIterable<T> {
    const t = this.t;
    return {
      async *[Symbol.asyncIterator]() {
        const response = await t.stream('POST', '/export', {
          body: input,
          signal: opts.signal,
        });
        yield* ndjsonIterator<T>(response, { opaqueKeys: OPAQUE_EXPORT_ROW });
      },
    };
  }
}
