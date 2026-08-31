import type { CallOptions } from '../internals';
import type { Transport } from '../transport';
import type { BlobEntityKind } from '../types';

/** Select one Blob cell through logical graph identity, never a storage path. */
export interface BlobInput {
  entity: BlobEntityKind;
  type: string;
  id: string;
  property: string;
  /** Defaults to main. Mutually exclusive with snapshot. */
  branch?: string;
  /** Graph commit id (e.g. query.graphCommitId), not the opaque response header. Exclusive with branch. */
  snapshot?: string;
  /** Strong entity-tag-list precondition (including `*`). */
  ifMatch?: string;
  /** Weak entity-tag-list comparison (including `*`). */
  ifNoneMatch?: string;
  /** One standard bytes range. Ignored by stat/HEAD. */
  range?: string;
  /** Strong entity tag; a mismatch serves the full body. Ignored by stat. */
  ifRange?: string;
}

function blobHeaders(input: BlobInput): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/octet-stream',
  };
  if (input.ifMatch !== undefined) headers['If-Match'] = input.ifMatch;
  if (input.ifNoneMatch !== undefined)
    headers['If-None-Match'] = input.ifNoneMatch;
  if (input.range !== undefined) headers.Range = input.range;
  if (input.ifRange !== undefined) headers['If-Range'] = input.ifRange;
  return headers;
}

/**
 * Read-only Blob delivery. Write Blob values using normal mutate/load calls.
 * Responses retain status, headers, and the byte stream without JSON parsing.
 * ETags are opaque validators, not content hashes.
 */
export class BlobsResource {
  constructor(private readonly t: Transport) {}

  /**
   * GET managed bytes (200/206), an external Location (302), or not-modified
   * metadata (304). Redirects are never followed: the external URI is not
   * authorized or proxied by Omnigraph. Inspect status before consuming bytes.
   * A 412/416 is an error; its response headers remain available on the error.
   */
  get(input: BlobInput, opts: CallOptions = {}): Promise<Response> {
    return this.t.stream('GET', '/blob', {
      query: {
        entity: input.entity,
        type: input.type,
        id: input.id,
        property: input.property,
        branch: input.branch,
        snapshot: input.snapshot,
      },
      headers: blobHeaders(input),
      redirect: 'manual',
      acceptedStatuses: [302, 304],
      signal: opts.signal,
    });
  }

  /**
   * HEAD metadata without payload bytes. Range/If-Range are ignored by the
   * server. A 302 exposes the external Location without following it; a 304
   * indicates the validator matched. HEAD error responses have no JSON body.
   */
  stat(input: BlobInput, opts: CallOptions = {}): Promise<Response> {
    return this.t.stream('HEAD', '/blob', {
      query: {
        entity: input.entity,
        type: input.type,
        id: input.id,
        property: input.property,
        branch: input.branch,
        snapshot: input.snapshot,
      },
      headers: blobHeaders(input),
      redirect: 'manual',
      acceptedStatuses: [302, 304],
      signal: opts.signal,
    });
  }
}
