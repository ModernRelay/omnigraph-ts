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
   * `ForbiddenError`. An admitted identity can use discover() for names only;
   * that inventory grants no access to graph data.
   *
   * Routing note: `/graphs` is a flat management endpoint and is **never**
   * rewritten under a `graphId` prefix.
   */
  async list(opts: CallOptions = {}): Promise<GraphInfo[]> {
    const r = await this.t.request<GraphList>('GET', '/graphs', {
      signal: opts.signal,
      ifActor: opts.ifActor,
    });
    return r.graphs;
  }
  /**
   * Discover all applied graph IDs and display names using an admitted
   * identity credential, without storage or runtime metadata. This inventory
   * is independent of graph permissions; static bearer tokens cannot use it.
   * Use access() on a graph to learn what the credential may do there.
   */
  async discover(opts: CallOptions = {}): Promise<GraphDiscovery[]> {
    const r = await this.t.request<{ graphs: GraphDiscovery[] }>(
      'GET',
      '/graphs/discovery',
      { signal: opts.signal, ifActor: opts.ifActor },
    );
    return r.graphs;
  }
}
