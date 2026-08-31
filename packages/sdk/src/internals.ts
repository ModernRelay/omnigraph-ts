// Per-call options threaded through every resource method and the
// top-level operations on the `Omnigraph` class. Lives here (rather than
// nested inside one resource) so the import path is stable.

export interface CallOptions {
  signal?: AbortSignal;
}

/** Mutation-only options. The conditional route is never downgraded on failure. */
export interface ConditionalCallOptions extends CallOptions {
  /** Exact graphCommitId from the read that informed this mutation. */
  ifGraphCommit?: string;
}

// Stable re-exports for consumer types that don't fit elsewhere.
export type { ListCommitsInput } from './resources/commits';
export type { FetchLike } from './transport';
