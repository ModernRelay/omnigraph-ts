import type { Transport } from '../transport';
import type { Commit, CommitChanges, CommitList } from '../types';
import type { CallOptions } from '../internals';
import type { ChangePageInput } from './changes';

export interface ListCommitsInput {
  branch?: string;
}

export class CommitsResource {
  constructor(private readonly t: Transport) {}

  /**
   * List commits, most recent first. Filter to a single branch with `branch`.
   * Read-only.
   */
  async list(input: ListCommitsInput = {}, opts: CallOptions = {}): Promise<Commit[]> {
    const r = await this.t.request<CommitList>('GET', '/commits', {
      query: { branch: input.branch },
      signal: opts.signal,
    });
    return r.commits;
  }

  /**
   * Retrieve a single commit by id. Read-only.
   */
  retrieve(id: string, opts: CallOptions = {}): Promise<Commit> {
    return this.t.request<Commit>(
      'GET',
      `/commits/${encodeURIComponent(id)}`,
      { signal: opts.signal },
    );
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
        },
        signal: opts.signal,
        opaqueResponseKeys: new Set(['properties']),
      },
    );
  }
}
