import type { Transport } from '../transport';
import type {
  SavedQuery,
  SavedQueryDelete,
  SavedQueryList,
  SaveQueryInput,
} from '../types';
import type { CallOptions } from '../internals';

export class QueriesResource {
  constructor(private readonly t: Transport) {}

  /**
   * List every saved query. Each entry includes the full `.gq` source
   * and the declared parameter signature, so callers do not need a
   * follow-up `get` to render or invoke them.
   */
  async list(opts: CallOptions = {}): Promise<SavedQuery[]> {
    const r = await this.t.request<SavedQueryList>('GET', '/queries', {
      signal: opts.signal,
    });
    return r.queries;
  }

  /**
   * Retrieve a saved query by name. Throws `NotFoundError` if absent.
   */
  get(name: string, opts: CallOptions = {}): Promise<SavedQuery> {
    return this.t.request<SavedQuery>(
      'GET',
      `/queries/${encodeURIComponent(name)}`,
      { signal: opts.signal },
    );
  }

  /**
   * Insert or overwrite a saved query. The `.gq` source must declare
   * exactly one `query <name>(...)` block whose name matches `name` —
   * the server uses that 1:1 mapping to keep saved queries unambiguous
   * for downstream callers like the MCP server.
   */
  save(name: string, input: SaveQueryInput, opts: CallOptions = {}): Promise<SavedQuery> {
    return this.t.request<SavedQuery>(
      'PUT',
      `/queries/${encodeURIComponent(name)}`,
      { body: input, signal: opts.signal },
    );
  }

  /**
   * Delete a saved query. Idempotent: deleting an absent query returns
   * `{ deleted: false }`.
   */
  delete(name: string, opts: CallOptions = {}): Promise<SavedQueryDelete> {
    return this.t.request<SavedQueryDelete>(
      'DELETE',
      `/queries/${encodeURIComponent(name)}`,
      { signal: opts.signal },
    );
  }
}
