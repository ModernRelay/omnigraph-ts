import { validMerge } from '../receipts';
import type { Transport } from '../transport';
import type {
  BranchCreate,
  BranchCreateInput,
  BranchDelete,
  BranchList,
  BranchMerge,
  BranchMergeInput,
} from '../types';
import type { CallOptions } from '../internals';

export class BranchesResource {
  constructor(private readonly t: Transport) {}

  /**
   * List all branches. Read-only.
   */
  async list(opts: CallOptions = {}): Promise<string[]> {
    const r = await this.t.request<BranchList>('GET', '/branches', {
      signal: opts.signal,
    });
    return r.branches;
  }

  /**
   * Create a new branch. Forks `name` off `from` (defaults to `main`).
   *
   * Throws `ConflictError` if `name` already exists. After an uncertain
   * outcome, inspect the branch before deciding whether to retry.
   */
  create(
    input: BranchCreateInput,
    opts: CallOptions = {},
  ): Promise<BranchCreate> {
    return this.t.request<BranchCreate>('POST', '/branches', {
      body: input,
      signal: opts.signal,
    });
  }

  /**
   * Merge `source` into `target` (defaults to `main`).
   *
   * Returns this merge's exact commit, or null when already up to date.
   * An optional source deletion can fail after a successful merge; inspect
   * branchDeleted and branchDeleteErrorDetails. Never retry an uncertain merge blindly.
   */
  async merge(
    input: BranchMergeInput,
    opts: CallOptions = {},
  ): Promise<BranchMerge> {
    const normalized = {
      ...input,
      source: input.source.trim(),
      target: (input.target ?? 'main').trim(),
    };
    const result = await this.t.request<BranchMerge>(
      'POST',
      '/branches/merge',
      {
        body: normalized,
        signal: opts.signal,
      },
    );
    if (!validMerge(result, normalized))
      throw this.t.invalidResponse(
        'POST',
        '/branches/merge',
        'Invalid merge receipt',
      );
    return result;
  }

  /**
   * Delete a branch by name. A missing branch returns NotFoundError (404).
   */
  delete(name: string, opts: CallOptions = {}): Promise<BranchDelete> {
    return this.t.request<BranchDelete>(
      'DELETE',
      `/branches/${encodeURIComponent(name)}`,
      { signal: opts.signal },
    );
  }
}
