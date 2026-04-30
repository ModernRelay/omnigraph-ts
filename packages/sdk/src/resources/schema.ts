import type { Transport } from '../transport';
import type { Schema, SchemaApply, SchemaApplyInput } from '../types';
import type { CallOptions } from '../internals';

export class SchemaResource {
  constructor(private readonly t: Transport) {}

  /**
   * Fetch the active schema. Read-only.
   *
   * The current `GET /schema` endpoint always returns the schema for the
   * default branch; per-branch schema retrieval is a follow-up.
   */
  get(opts: CallOptions = {}): Promise<Schema> {
    return this.t.request<Schema>('GET', '/schema', { signal: opts.signal });
  }

  /**
   * Apply a schema. Idempotent: applying an unchanged schema returns
   * `applied: false` with no commit.
   */
  apply(input: SchemaApplyInput, opts: CallOptions = {}): Promise<SchemaApply> {
    return this.t.request<SchemaApply>('POST', '/schema/apply', {
      body: input,
      signal: opts.signal,
    });
  }
}
