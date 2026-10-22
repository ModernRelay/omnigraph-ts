import type { Transport } from '../transport';
import type {
  Commit,
  CommitChanges,
  CommitList,
  CommitListing,
} from '../types';
import type { CallOptions } from '../internals';
import type { ChangePageInput } from './changes';

export interface ListCommitsInput {
  branch?: string;
  listing?: CommitListing;
  /** History page size; unpublished and unattached listings are not paged. */
  limit?: number;
  pageToken?: string;
}

export class CommitsResource {
  constructor(private readonly t: Transport) {}

  /**
   * List commits, most recent first. Filter to a single branch with `branch`.
   * Read-only.
   */
  list(
    input: ListCommitsInput = {},
    opts: CallOptions = {},
  ): Promise<CommitList> {
    return this.t.request<CommitList>('GET', '/commits', {
      query: {
        branch: input.branch,
        listing: input.listing,
        limit: input.limit?.toString(),
        page_token: input.pageToken,
      },
      signal: opts.signal,
      ifActor: opts.ifActor,
    });
  }

  /** Publish an existing proposal; never replay automatically after a lost response. */
  publish(id: string, opts: CallOptions = {}): Promise<Commit> {
    return this.t.request<Commit>(
      'POST',
      `/commits/${encodeURIComponent(id)}/publish`,
      {
        signal: opts.signal,
        ifActor: opts.ifActor,
      },
    );
  }

  /** Drop an unpublished proposal or unattached chain. Success is an empty 204. */
  async drop(id: string, opts: CallOptions = {}): Promise<void> {
    const response = await this.t.stream(
      'DELETE',
      `/commits/${encodeURIComponent(id)}`,
      {
        signal: opts.signal,
        ifActor: opts.ifActor,
      },
    );
    if (response.status !== 204) {
      await response.body?.cancel();
      throw this.t.invalidResponse(
        'DELETE',
        `/commits/${encodeURIComponent(id)}`,
        'Commit drop did not return 204',
        response.status,
      );
    }
  }

  /**
   * Retrieve a single commit by id. Read-only.
   */
  retrieve(id: string, opts: CallOptions = {}): Promise<Commit> {
    return this.t.request<Commit>('GET', `/commits/${encodeURIComponent(id)}`, {
      signal: opts.signal,
      ifActor: opts.ifActor,
    });
  }

  /**
   * Read one page of logical entity changes relative to the first parent.
   * The page token continues this commit result; it is not a feed cursor.
   * A parentless commit or schema boundary is refused, never an empty diff.
   */
  changes(
    id: string,
    input: ChangePageInput = {},
    opts: CallOptions = {},
  ): Promise<CommitChanges> {
    return this.t.request<CommitChanges>(
      'GET',
      `/commits/${encodeURIComponent(id)}/changes`,
      {
        query: {
          page_token: input.pageToken,
          limit: input.limit?.toString(),
          kind: input.kind,
          type: input.type,
          op: input.op,
          set: input.set,
        },
        signal: opts.signal,
        ifActor: opts.ifActor,
        opaqueResponseKeys: new Set(['properties']),
      },
    );
  }
}
