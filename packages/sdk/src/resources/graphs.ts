import type { Transport } from '../transport';
import type { GraphInfo, GraphList } from '../types';
import type { CallOptions } from '../internals';

export class GraphsResource {
  constructor(private readonly t: Transport) {}

  /**
   * List every graph registered with the server, alphabetically by `graphId`.
   *
   * Multi-graph mode only. On a single-graph server this call returns 405 →
   * `MethodNotAllowedError`. When a token is configured the server-level
   * Cedar policy must authorize the `graph_list` action.
   *
   * Routing note: `/graphs` is a flat management endpoint and is **never**
   * rewritten under a `graphId` prefix.
   */
  async list(opts: CallOptions = {}): Promise<GraphInfo[]> {
    const r = await this.t.request<GraphList>('GET', '/graphs', { signal: opts.signal });
    return r.graphs;
  }
}
