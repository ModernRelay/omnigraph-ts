import { validMerge } from '../receipts';
import type { Transport } from '../transport';
import type {
  BranchCreate,
  BranchCreateInput,
  BranchDelete,
  BranchList,
  BranchListDetailed,
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
   * List all branches with each readable branch's head commit, the branch and
   * commit it started from, and when it was created and last moved
   * (`GET /branches?detailed=true`, omnigraph-server 0.15+). Read-only. Each
   * listed branch costs the server a read of its latest version; no commit
   * history is read. Times are Unix epoch microseconds.
   */
  async listDetailed(opts: CallOptions = {}): Promise<BranchListDetailed> {
    const r = await this.t.request<BranchList>('GET', '/branches', {
      query: { detailed: 'true' },
      signal: opts.signal,
      ifActor: opts.ifActor,
    });
    if (!Array.isArray(r?.details))
      throw this.t.invalidResponse(
        'GET',
        '/branches',
        'Branch listing omitted details; the server must be omnigraph-server 0.15 or newer',
      );
    return { branches: r.branches, details: r.details };
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
   *
   * With `dryRun`, the merge is classified and validated but nothing is
   * written, so a lost answer is not `outcomeUnknown`; a reply that is not a
   * dry-run receipt is, since it may mean a merge landed.
   */
  async merge(
    input: BranchMergeInput,
    opts: CallOptions = {},
  ): Promise<BranchMerge> {
    // The request is built from the fields the route defines, so the body
    // sent, the classification and the receipt check all see one request.
    const payload: BranchMergeInput = {
      source: input.source,
      target: input.target ?? 'main',
    };
    if (input.asCommit !== undefined) payload.asCommit = input.asCommit;
    if (input.deleteBranch !== undefined)
      payload.deleteBranch = input.deleteBranch;
    if (input.dryRun !== undefined) payload.dryRun = input.dryRun;
    if (input.settings !== undefined) payload.settings = input.settings;
    const result = await this.t.request<BranchMerge>(
      'POST',
      '/branches/merge',
      {
        body: payload,
        signal: opts.signal,
        ifActor: opts.ifActor,
        // A dry run writes nothing, judged on the serialized body; a reply
        // that is not a dry-run receipt still fails validMerge below with
        // effects unknown.
        readsWhen: (wire) =>
          (wire as { dry_run?: unknown } | null)?.dry_run === true,
      },
    );
    if (!validMerge(result, payload))
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
