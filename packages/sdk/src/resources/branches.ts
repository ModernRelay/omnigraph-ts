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
    const r = await this.t.request<BranchList>('GET', '/branches', { signal: opts.signal });
    return r.branches;
  }

  /**
   * Create a new branch. Forks `name` off `from` (defaults to `main`).
   *
   * **Idempotency**: throws `ConflictError` if `name` already exists. In
   * at-least-once flows, catch `ConflictError` and treat as success.
   */
  create(input: BranchCreateInput, opts: CallOptions = {}): Promise<BranchCreate> {
    return this.t.request<BranchCreate>('POST', '/branches', {
      body: input,
      signal: opts.signal,
    });
  }

  /**
   * Merge `source` into `target` (defaults to `main`).
   *
   * **Idempotency**: a retry on the same merge yields `outcome: "already_up_to_date"`.
   */
  merge(input: BranchMergeInput, opts: CallOptions = {}): Promise<BranchMerge> {
    return this.t.request<BranchMerge>('POST', '/branches/merge', {
      body: input,
      signal: opts.signal,
    });
  }

  /**
   * Delete a branch by name. Idempotent: deleting a non-existent branch is a no-op.
   */
  delete(name: string, opts: CallOptions = {}): Promise<BranchDelete> {
    return this.t.request<BranchDelete>(
      'DELETE',
      `/branches/${encodeURIComponent(name)}`,
      { signal: opts.signal },
    );
  }
}
