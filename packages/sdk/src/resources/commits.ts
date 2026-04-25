import type { Transport } from '../transport';
import type { Commit, CommitList } from '../types';
import type { CallOptions } from './branches';

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
}
