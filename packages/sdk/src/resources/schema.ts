import type { Transport } from '../transport';
import type { Schema, SchemaApply, SchemaApplyInput } from '../types';
import type { CallOptions } from './branches';

export interface GetSchemaInput {
  branch?: string;
}

export class SchemaResource {
  constructor(private readonly t: Transport) {}

  /**
   * Fetch the active schema for a branch. Read-only.
   */
  get(input: GetSchemaInput = {}, opts: CallOptions = {}): Promise<Schema> {
    return this.t.request<Schema>('GET', '/schema', {
      query: { branch: input.branch },
      signal: opts.signal,
    });
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
