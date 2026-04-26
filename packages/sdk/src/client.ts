import { ndjsonIterator } from './stream';
import { Transport } from './transport';
import type { FetchLike } from './transport';
import { BranchesResource } from './resources/branches';
import type { CallOptions } from './resources/branches';
import { CommitsResource } from './resources/commits';
import { RunsResource } from './resources/runs';
import { SchemaResource } from './resources/schema';
import type {
  Change,
  ChangeInput,
  ExportInput,
  Health,
  Ingest,
  IngestInput,
  Read,
  ReadInput,
  Snapshot,
} from './types';

// GQ params are caller-controlled (matched by name to `$varName` in query
// source). Their wire-format keys must survive the camel<->snake boundary
// unchanged. Same for ReadOutput.rows / .columns: shapes are user-schema-driven.
const READ_OPAQUE_REQUEST = new Set(['params']);
const READ_OPAQUE_RESPONSE = new Set(['rows', 'columns']);
const CHANGE_OPAQUE_REQUEST = new Set(['params']);

export interface OmnigraphOptions {
  /** Base URL of the omnigraph-server. e.g. `http://127.0.0.1:8080`. */
  baseUrl: string;
  /** Bearer token. Optional for unauthenticated servers. */
  token?: string;
  /** Inject a custom fetch (testing, tracing, polyfills). */
  fetch?: FetchLike;
}

export interface SnapshotInput {
  branch?: string;
}

export default class Omnigraph {
  readonly branches: BranchesResource;
  readonly commits: CommitsResource;
  readonly runs: RunsResource;
  readonly schema: SchemaResource;

  private readonly t: Transport;

  constructor(opts: OmnigraphOptions) {
    this.t = new Transport(opts);
    this.branches = new BranchesResource(this.t);
    this.commits = new CommitsResource(this.t);
    this.runs = new RunsResource(this.t);
    this.schema = new SchemaResource(this.t);
  }

  /**
   * Liveness probe. Unauthenticated; safe to call from any caller.
   */
  health(opts: CallOptions = {}): Promise<Health> {
    return this.t.request<Health>('GET', '/healthz', { signal: opts.signal });
  }

  /**
   * Run a GQ read query. Read-only.
   */
  read(input: ReadInput, opts: CallOptions = {}): Promise<Read> {
    return this.t.request<Read>('POST', '/read', {
      body: input,
      signal: opts.signal,
      opaqueBodyKeys: READ_OPAQUE_REQUEST,
      opaqueResponseKeys: READ_OPAQUE_RESPONSE,
    });
  }

  /**
   * Run a GQ mutation. Returns counts of nodes/edges affected and produces
   * a new commit on success. **Destructive** — branch is updated atomically.
   *
   * **Idempotency**: design queries with `@unique` constraints or
   * `update ... where` clauses to allow safe retry. Blind `insert` without
   * unique keys can duplicate on retry.
   */
  change(input: ChangeInput, opts: CallOptions = {}): Promise<Change> {
    return this.t.request<Change>('POST', '/change', {
      body: input,
      signal: opts.signal,
      opaqueBodyKeys: CHANGE_OPAQUE_REQUEST,
    });
  }

  /**
   * Bulk-ingest NDJSON. **Use `mode: 'merge'` for at-least-once safety** —
   * ensures retries upsert by `@key` instead of duplicating rows.
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
   */
  export(input: ExportInput = {}, opts: CallOptions = {}): AsyncIterable<Record<string, unknown>> {
    const t = this.t;
    return {
      async *[Symbol.asyncIterator]() {
        const response = await t.stream('POST', '/export', {
          body: input,
          signal: opts.signal,
        });
        yield* ndjsonIterator<Record<string, unknown>>(response);
      },
    };
  }
}
