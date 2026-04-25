import type { Transport } from '../transport';
import type { Run, RunList } from '../types';
import type { CallOptions } from './branches';

export interface ListRunsInput {
  branch?: string;
}

export class RunsResource {
  constructor(private readonly t: Transport) {}

  /**
   * List runs. Filter to a single branch with `branch`. Read-only.
   */
  async list(input: ListRunsInput = {}, opts: CallOptions = {}): Promise<Run[]> {
    const r = await this.t.request<RunList>('GET', '/runs', {
      query: { branch: input.branch },
      signal: opts.signal,
    });
    return r.runs;
  }

  /**
   * Retrieve a single run by id. Read-only.
   */
  retrieve(id: string, opts: CallOptions = {}): Promise<Run> {
    return this.t.request<Run>('GET', `/runs/${encodeURIComponent(id)}`, {
      signal: opts.signal,
    });
  }

  /**
   * Abort a running run. Returns the updated run state. **Destructive** —
   * the run's branch is detached. Idempotent on already-aborted runs.
   */
  abort(id: string, opts: CallOptions = {}): Promise<Run> {
    return this.t.request<Run>(
      'POST',
      `/runs/${encodeURIComponent(id)}/abort`,
      { signal: opts.signal },
    );
  }

  /**
   * Publish a completed run, merging its branch into the target.
   * **Destructive** to the target branch on success.
   */
  publish(id: string, opts: CallOptions = {}): Promise<Run> {
    return this.t.request<Run>(
      'POST',
      `/runs/${encodeURIComponent(id)}/publish`,
      { signal: opts.signal },
    );
  }
}
