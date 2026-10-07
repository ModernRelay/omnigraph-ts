import type { Transport } from '../transport';
import type { CallOptions } from '../internals';
import type {
  Deployment,
  DeploymentInput,
  DeploymentPlanInput,
  DeploymentStatus,
} from '../types';

const OPAQUE = new Set(['deployment', 'status']);

/** Cluster-wide configuration. Deployment documents retain their exact JSON keys. */
export class ClusterResource {
  constructor(private readonly t: Transport) {}

  /** Preview a bundled deployment without applying it. */
  plan(
    input: DeploymentPlanInput,
    opts: CallOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.t.request('POST', '/cluster/plan', {
      body: input,
      signal: opts.signal,
      opaqueBodyKeys: OPAQUE,
      opaqueResponse: true,
    });
  }

  /** Durable acceptance, not activation. Retain deploymentId and observe with getDeployment(). */
  apply(input: DeploymentInput, opts: CallOptions = {}): Promise<Deployment> {
    return this.t.request('POST', '/cluster/deployments', {
      body: input,
      signal: opts.signal,
      opaqueBodyKeys: OPAQUE,
      opaqueResponseKeys: OPAQUE,
    });
  }

  status(opts: CallOptions = {}): Promise<DeploymentStatus> {
    return this.t.request('GET', '/cluster/deployments', {
      signal: opts.signal,
      opaqueResponseKeys: OPAQUE,
    });
  }

  /** Observe the same ID after a timeout or disconnect; never replay a write automatically. */
  getDeployment(id: string, opts: CallOptions = {}): Promise<Deployment> {
    return this.t.request(
      'GET',
      `/cluster/deployments/${encodeURIComponent(id)}`,
      {
        signal: opts.signal,
        opaqueResponseKeys: OPAQUE,
      },
    );
  }
}
