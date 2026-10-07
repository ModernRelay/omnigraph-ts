import type { Transport } from '../transport';
import type { GraphDiscovery, GraphInfo, GraphList } from '../types';
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
   * `ForbiddenError`. Use discover() for the actor's minimal graph inventory.
   *
   * Routing note: `/graphs` is a flat management endpoint and is **never**
   * rewritten under a `graphId` prefix.
   */
  async list(opts: CallOptions = {}): Promise<GraphInfo[]> {
    const r = await this.t.request<GraphList>('GET', '/graphs', {
      signal: opts.signal,
    });
    return r.graphs;
  }
  /** Discover graph identities granted to this actor, without storage or runtime metadata. */
  async discover(opts: CallOptions = {}): Promise<GraphDiscovery[]> {
    const r = await this.t.request<{ graphs: GraphDiscovery[] }>(
      'GET',
      '/graphs/discovery',
      { signal: opts.signal },
    );
    return r.graphs;
  }
}
