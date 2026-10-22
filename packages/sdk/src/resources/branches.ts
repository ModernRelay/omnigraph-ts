import { validMerge } from '../receipts';
import type { Transport } from '../transport';
import type {
  BranchCreate,
  BranchCreateInput,
  BranchDelete,
  BranchList,
  BranchMerge,
  BranchMergeInput,
  Diff,
  MergeBase,
} from '../types';
import type { CallOptions } from '../internals';
import type { ChangeFilterInput } from './changes';

export interface MergeBaseInput {
  source: string;
  target?: string;
}

export interface BranchDiffInput extends MergeBaseInput, ChangeFilterInput {}

export class BranchesResource {
  constructor(private readonly t: Transport) {}

  /** Review the net changes source made since its merge base with target. */
  diff(input: BranchDiffInput, opts: CallOptions = {}): Promise<Diff> {
    return this.t.request('GET', '/branches/diff', {
      query: {
        source: input.source,
        target: input.target,
        page_token: input.pageToken,
        limit: input.limit?.toString(),
        kind: input.kind,
        type: input.type,
        op: input.op,
      },
      signal: opts.signal,
      ifActor: opts.ifActor,
      opaqueResponseKeys: new Set(['properties']),
    });
  }

  mergeBase(input: MergeBaseInput, opts: CallOptions = {}): Promise<MergeBase> {
    return this.t.request('GET', '/branches/merge-base', {
      query: { source: input.source, target: input.target },
      signal: opts.signal,
      ifActor: opts.ifActor,
    });
  }

  /**
   * List all branches. Read-only.
   */
  async list(opts: CallOptions = {}): Promise<string[]> {
    const r = await this.t.request<BranchList>('GET', '/branches', {
      signal: opts.signal,
      ifActor: opts.ifActor,
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
      ifActor: opts.ifActor,
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
      target: input.target ?? 'main',
    };
    const result = await this.t.request<BranchMerge>(
      'POST',
      '/branches/merge',
      {
        body: normalized,
        signal: opts.signal,
        ifActor: opts.ifActor,
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
      { signal: opts.signal, ifActor: opts.ifActor },
    );
  }
}
