import type { Transport } from '../transport';
import type { Run, RunList } from '../types';
import type { CallOptions } from './branches';

export class RunsResource {
  constructor(private readonly t: Transport) {}

  /**
   * List runs across all branches. Read-only.
   *
   * The current `GET /runs` endpoint does not support server-side branch
   * filtering; callers can post-filter `r.target_branch`. Add server-side
   * filtering in a follow-up if it becomes a hot path.
   */
  async list(opts: CallOptions = {}): Promise<Run[]> {
    const r = await this.t.request<RunList>('GET', '/runs', { signal: opts.signal });
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
