import { describe, expect, it } from 'vitest';
import Omnigraph, { ServiceUnavailableError } from '../src';
import { stubFetch } from './helpers';

const body = (ready: boolean, status: 'serving' | 'draining') => ({
  ready,
  status,
  booted_serving_digest: 'f06d',
  state_revision: 2,
  state_cas: 'sha256:5fa4',
  served_graph_count: 1,
  quarantined_graph_count: 0,
  shutdown_grace_seconds: 30,
});

describe('readiness (GET /readyz, server v0.11+)', () => {
  it('returns a serving server camelized', async () => {
    const { fetch, calls } = stubFetch({ status: 200, body: body(true, 'serving') });
    const r = await new Omnigraph({ baseUrl: 'http://x', fetch }).readiness();
    expect(calls[0]?.url).toBe('http://x/readyz');
    expect(r).toMatchObject({ ready: true, status: 'serving', servedGraphCount: 1, quarantinedGraphCount: 0 });
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
