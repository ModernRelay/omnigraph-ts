import { describe, expect, it } from 'vitest';
import Omnigraph, { ServiceUnavailableError } from '../src';
import { stubFetch } from './helpers';

const body = (ready: boolean, status: 'serving' | 'loading' | 'draining') => ({
  ready,
  status,
  booted_serving_digest: 'f06d',
  state_revision: 2,
  state_cas: 'sha256:5fa4',
  served_graph_count: 1,
  ready_graph_count: ready ? 1 : 0,
  loading_graph_count: status === 'loading' ? 1 : 0,
  blocked_graph_count: 0,
  shutdown_grace_seconds: 30,
});

describe('readiness (GET /readyz, 0.13)', () => {
  it('returns a serving server camelized', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: body(true, 'serving') });
    const r = await new Omnigraph({ baseUrl: 'http://x', fetch }).readiness();
    expect(calls[0]?.url).toBe('http://x/readyz');
    expect(r).toMatchObject({ ready: true, status: 'serving', servedGraphCount: 1, readyGraphCount: 1, loadingGraphCount: 0, blockedGraphCount: 0 });
  });

  it('returns a draining server (503) instead of throwing', async () => {
    const { fetch } = stubFetch({ status: 503, body: body(false, 'draining') });
    const r = await new Omnigraph({ baseUrl: 'http://x', fetch }).readiness();
    expect(r).toMatchObject({ ready: false, status: 'draining' });
  });

  it('is a flat path: never prefixed with the graph id', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: body(true, 'serving') });
    await new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch }).readiness();
    expect(calls[0]?.url).toBe('http://x/readyz');
  });

  it('still throws on other failures', async () => {
    const { fetch } = stubFetch({ status: 500, body: { error: 'boom' } });
    await expect(new Omnigraph({ baseUrl: 'http://x', fetch }).readiness()).rejects.not.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });
});

it('returns loading counts with 503 until startup opens settle', async () => {
  const { fetch } = stubFetch({ status: 503, body: body(false, 'loading') });
  const result = await new Omnigraph({ baseUrl: 'http://x', fetch }).readiness();
  expect(result).toMatchObject({ ready: false, status: 'loading', loadingGraphCount: 1, readyGraphCount: 0 });
});
