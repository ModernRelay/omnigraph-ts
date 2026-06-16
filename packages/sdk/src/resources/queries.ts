import type { Transport } from '../transport';
import type { InvokeQuery, InvokeQueryInput, Queries } from '../types';
import type { CallOptions } from '../internals';

// Mirror client.ts: `params` keys are caller-controlled (matched by name to
// `$var` in the stored query) and a stored *read* returns opaque
// `rows`/`columns` — both must survive the camel<->snake boundary verbatim.
const OPAQUE_PARAMS = new Set(['params']);
const OPAQUE_READ_RESPONSE = new Set(['rows', 'columns']);

/**
 * The graph's server-side stored queries (the `queries:` registry). Distinct
 * from {@link Omnigraph.query}, which runs ad-hoc GQ source sent in the
 * request body — these operate on queries curated on the server by name.
 */
export class QueriesResource {
  constructor(private readonly t: Transport) {}

  /**
   * List the graph's exposed stored queries as a typed tool catalog — the
   * `mcp.expose == true` subset of the registry, each with its typed
   * parameters. Read-only; the catalog is graph-wide (branch independent).
   */
  list(opts: CallOptions = {}): Promise<Queries> {
    return this.t.request<Queries>('GET', '/queries', { signal: opts.signal });
  }

  /**
   * Invoke a curated server-side stored query by `name`. The source comes
   * from the registry, not the caller — pass only runtime inputs (`params`,
   * `branch`, `snapshot`). Returns a read envelope for a stored read or a
   * mutation envelope for a stored mutation (untagged: `Read | Change`).
   *
   * A `name` the caller lacks `invoke_query` for is indistinguishable from an
   * unknown one — both surface as `NotFoundError`.
   *
   * Pass `expectMutation: true` (or `false`) to assert the stored query's kind
   * (server 0.7.0+): the server rejects a mismatch with `BadRequestError`.
   * Omit it to skip the check.
   */
  invoke(
    name: string,
    input: InvokeQueryInput = {},
    opts: CallOptions = {},
  ): Promise<InvokeQuery> {
    return this.t.request<InvokeQuery>(
      'POST',
      `/queries/${encodeURIComponent(name)}`,
      {
        body: input,
        signal: opts.signal,
        opaqueBodyKeys: OPAQUE_PARAMS,
        opaqueResponseKeys: OPAQUE_READ_RESPONSE,
      },
    );
  }
}
