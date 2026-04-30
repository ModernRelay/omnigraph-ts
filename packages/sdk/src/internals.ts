// Per-call options threaded through every resource method and the
// top-level operations on the `Omnigraph` class. Lives here (rather than
// nested inside one resource) so the import path is stable.

export interface CallOptions {
  signal?: AbortSignal;
}

// Stable re-exports for consumer types that don't fit elsewhere.
export type { ListCommitsInput } from './resources/commits';
export type { FetchLike } from './transport';
