import type { Transport } from '../transport';
import type { GraphInfo, GraphList } from '../types';
import type { CallOptions } from '../internals';

export class GraphsResource {
  constructor(private readonly t: Transport) {}

  /**
   * List every graph registered with the cluster, alphabetically by `graphId`.
   *
   * `/graphs` is the server-scoped management surface, **closed by default in
   * every runtime state** (even unauthenticated). The cluster must apply a
   * `cluster`-scoped Cedar bundle granting the `graph_list` action against
   * `Omnigraph::Server::"root"`; without that grant this call fails 403 →
   * `ForbiddenError`. This and `health()` are the only methods that work
   * without a configured `graphId`.
   *
   * Routing note: `/graphs` is a flat management endpoint and is **never**
   * rewritten under a `graphId` prefix.
   */
  async list(opts: CallOptions = {}): Promise<GraphInfo[]> {
    const r = await this.t.request<GraphList>('GET', '/graphs', { signal: opts.signal });
    return r.graphs;
  }
}
