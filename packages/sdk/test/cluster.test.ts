import { describe, expect, it } from 'vitest';
import Omnigraph from '../src';
import type { DeploymentInput } from '../src';
import { stubFetch } from './helpers';

describe('cluster deployment API', () => {
  const deployment = {
    config_digest: 'sha256:value',
    graphs: { myGraph: { schema_source: 'schema', providerKey: 'Name' } },
    policy: { actor_ID: 'alice' },
  };
  it('sends a plan document unchanged and preserves every result key', async () => {
    const plan = {
      graph_steps: {
        myGraph: { schema_source: 'schema', propertyKey: 'user_name' },
      },
    };
    const { fetch, calls } = stubFetch({ body: plan });
    const og = new Omnigraph({
      baseUrl: 'http://x/prefix',
      graphId: 'ignored',
      fetch,
    });
    expect(await og.cluster.plan({ deployment })).toEqual(plan);
    expect(calls[0]?.url).toBe('http://x/prefix/cluster/plan');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ deployment });
  });

  it('exposes durable acceptance without confusing it with activation', async () => {
    const input: DeploymentInput = { deploymentId: 'd', deployment };
    const { fetch, calls } = stubFetch({
      status: 202,
      body: { deployment, active: false, in_progress: true },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    expect(await og.cluster.apply(input)).toEqual({
      deployment,
      active: false,
      inProgress: true,
    });
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      deployment_id: 'd',
      deployment,
    });
    expect(calls).toHaveLength(1);
  });

  it('observes the exact ID and cluster status with opaque ledger contents', async () => {
    const status = { last_result: { deployment_id: 'd', graph_ID: 'keep' } };
    const { fetch, calls } = stubFetch([
      { body: { deployment, active: true, in_progress: false } },
      { body: { status, active: true, in_progress: false } },
    ]);
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    expect(await og.cluster.getDeployment('a/b')).toEqual({
      deployment,
      active: true,
      inProgress: false,
    });
    expect(await og.cluster.status()).toEqual({
      status,
      active: true,
      inProgress: false,
    });
    expect(calls.map((c) => c.url)).toEqual([
      'http://x/cluster/deployments/a%2Fb',
      'http://x/cluster/deployments',
    ]);
  });
});

it.each([
  [503, 'service_unavailable', 'retry', 'ServiceUnavailableError'],
  // The engine's actions: service_unavailable retries, internal refreshes.
  [500, 'internal', 'refresh', 'InternalServerError'],
] as const)('a failed cluster control read (%s) is a certain refusal, not a conflict', async (status, code, action, name) => {
  // omnigraph-server 0.16 answers a failed read of cluster state with 503
  // (may pass) or 500 (repeats), effects none, where 0.15 answered 409.
  const { fetch, calls } = stubFetch({ status, body: { error: '[state_read_error] storage read failed', code, disposition: { effects: 'none', action } } });
  const og = new Omnigraph({ baseUrl: 'http://x', fetch });
  await expect(og.cluster.apply({ deploymentId: 'd', deployment: {} })).rejects.toMatchObject({ name, status, outcomeUnknown: false });
  expect(calls).toHaveLength(1);
});
