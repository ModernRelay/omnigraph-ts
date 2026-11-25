import { describe, expect, it } from 'vitest';
import Omnigraph, {
  ConflictError,
  isTerminal,
  newOperationId,
  NetworkError,
  OperationState,
  TooManyRequestsError,
} from '../src';
import { stubFetch } from './helpers';

const ID = '01JC0000000000000000000000';

function record(state: string, extra: Record<string, unknown> = {}) {
  return {
    operation_id: ID, request_digest: 'sha256:x', graph: 'g', schema_identity_domain: 'd',
    settlement_branch: 'main', request: { kind: 'optimize', max_gate_hold_ms: 30000 },
    principal: 'act-ops', accepted_at: '2026-11-25T00:00:00Z', state,
    outcome: { kind: 'optimize' }, timings: {}, ...extra,
  };
}

describe('operation ids', () => {
  it('mints canonical ULIDs carrying the given time', () => {
    // The ULID spec's example: 1469918176385 ms encodes as 01ARYZ6S41 (the ulid reference README).
    const id = newOperationId(1469918176385);
    expect(id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(id.slice(0, 10)).toBe('01ARYZ6S41');
    expect(newOperationId()).not.toBe(newOperationId());
    expect(newOperationId(Date.now())[0]).toBe('0');
  });

  it('refuses a time outside 48 bits', () => {
    expect(() => newOperationId(2 ** 48)).toThrow(RangeError);
    expect(() => newOperationId(-1)).toThrow(RangeError);
  });
});

describe('operations resource', () => {
  it('optimize posts the request in snake case and keeps outcome tokens verbatim', async () => {
    const { fetch, calls } = stubFetch({
      status: 202,
      body: {
        lookup: 'found', in_progress: true,
        operation: record('succeeded', {
          published_commit: 'c9',
          outcome: {
            kind: 'optimize',
            datasets: [{ type_key: 'node:Person', outcome: 'optimized', reason: 'index_failed', detail: 'boom',
              fragments_removed: 3, fragments_added: 1, duration_ms: 12, source_bytes: 2048 }],
            more_datasets: { 'deferred:gate_hold_limit': 2 },
            configuration_clear: { outcome: 'cleared' },
          },
          timings: { queued_ms: 1, gate_hold_ms: 2, compute_ms: 3 },
        }),
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const r = await og.operations.optimize({ operationId: ID, datasets: ['node:Person'], maxGateHoldMs: 30000 });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://x/graphs/g/operations/optimize');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ operation_id: ID, datasets: ['node:Person'], max_gate_hold_ms: 30000 });
    expect(r.inProgress).toBe(true);
    expect(r.operation?.state).toBe(OperationState.SUCCEEDED);
    expect(r.operation?.publishedCommit).toBe('c9');
    expect(r.operation?.request).toEqual({ kind: 'optimize', maxGateHoldMs: 30000 });
    expect(r.operation?.outcome.datasets?.[0]).toEqual({
      typeKey: 'node:Person', outcome: 'optimized', reason: 'index_failed', detail: 'boom',
      fragmentsRemoved: 3, fragmentsAdded: 1, durationMs: 12, sourceBytes: 2048,
    });
    expect(r.operation?.outcome.moreDatasets).toEqual({ 'deferred:gate_hold_limit': 2 });
    expect(r.operation?.timings).toEqual({ queuedMs: 1, gateHoldMs: 2, computeMs: 3 });
  });

  it('get and cancel address the id under the graph', async () => {
    const { fetch, calls } = stubFetch([
      { body: { lookup: 'unknown', in_progress: false } },
      { status: 202, body: { lookup: 'found', in_progress: true, operation: record('running') } },
    ]);
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    expect(await og.operations.get('a/b')).toEqual({ lookup: 'unknown', inProgress: false });
    expect(calls[0]).toMatchObject({ method: 'GET', url: 'http://x/graphs/g/operations/a%2Fb' });
    expect((await og.operations.cancel(ID)).operation?.state).toBe('running');
    expect(calls[1]).toMatchObject({ method: 'POST', url: `http://x/graphs/g/operations/${ID}/cancel` });
  });

  it('a lost submission is outcome unknown and is not retried', async () => {
    let posts = 0;
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch: async (_input, init) => {
      if (init?.method === 'HEAD') return new Response(null, { headers: { 'Omnigraph-Http-Api': '0.14' } });
      posts++;
      throw new TypeError('socket hang up');
    } });
    await expect(og.operations.optimize({ operationId: ID })).rejects.toMatchObject({ outcomeUnknown: true });
    await expect(og.operations.optimize({ operationId: ID })).rejects.toBeInstanceOf(NetworkError);
    expect(posts).toBe(2);
  });

  it('a lost lookup is not outcome unknown', async () => {
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch: async (_input, init) => {
      if (init?.method === 'HEAD') return new Response(null, { headers: { 'Omnigraph-Http-Api': '0.14' } });
      throw new TypeError('socket hang up');
    } });
    await expect(og.operations.get(ID)).rejects.toMatchObject({ outcomeUnknown: false });
  });

  it('maps admission refusals: another active operation and a reused id', async () => {
    const { fetch } = stubFetch([
      { status: 429, headers: { 'Retry-After': '5' }, body: { error: 'operation 01X is active', code: 'too_many_requests', disposition: { effects: 'none', action: 'retry' } } },
      { status: 409, body: { error: '[operation_request_mismatch] different request', code: 'conflict', disposition: { effects: 'none', action: 'fix' } } },
    ]);
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await expect(og.operations.optimize({ operationId: ID })).rejects.toMatchObject({ retryAfter: '5', outcomeUnknown: false });
    const reused = await og.operations.optimize({ operationId: ID, datasets: ['node:X'] }).catch((e: unknown) => e);
    expect(reused).toBeInstanceOf(ConflictError);
    expect(reused).not.toBeInstanceOf(TooManyRequestsError);
  });

  it('wait polls the lookup until the record is terminal', async () => {
    const { fetch, calls } = stubFetch([
      { body: { lookup: 'found', in_progress: true, operation: record('running') } },
      { body: { lookup: 'found', in_progress: true, operation: record('publishing') } },
      { body: { lookup: 'found', in_progress: false, operation: record('succeeded') } },
    ]);
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const r = await og.operations.wait(ID, { intervalMs: 1 });
    expect(r.operation?.state).toBe('succeeded');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'GET', 'GET']);
  });

  it('wait returns an unknown lookup and rejects on a failed lookup without retrying', async () => {
    const unknown = stubFetch({ body: { lookup: 'unknown', in_progress: false } });
    expect((await new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch: unknown.fetch }).operations.wait(ID)).lookup).toBe('unknown');
    const failing = stubFetch([
      { body: { lookup: 'found', in_progress: true, operation: record('running') } },
      { status: 503, body: { error: '[operation_record_read_error] x', code: 'service_unavailable', disposition: { effects: 'none', action: 'retry' } } },
    ]);
    await expect(new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch: failing.fetch }).operations.wait(ID, { intervalMs: 1 }))
      .rejects.toMatchObject({ status: 503, outcomeUnknown: false });
    expect(failing.calls).toHaveLength(2);
  });

  it('wait stops when its signal aborts', async () => {
    const { fetch } = stubFetch([{ body: { lookup: 'found', in_progress: true, operation: record('running') } }]);
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const controller = new AbortController();
    const waiting = og.operations.wait(ID, { intervalMs: 60_000, signal: controller.signal });
    setTimeout(() => controller.abort(new Error('stop')), 5);
    await expect(waiting).rejects.toThrow('stop');
  });

  it('isTerminal names the five final states', () => {
    expect(Object.values(OperationState).filter(isTerminal)).toEqual(['succeeded', 'failed', 'cancelled', 'interrupted', 'unsettled']);
  });
});

describe('operation receipts', () => {
  const found = (id: string) => ({ lookup: 'found', in_progress: false, operation: { ...record('succeeded'), operation_id: id } });
  type Call = (og: Omnigraph) => Promise<unknown>;
  const routes: Array<[string, Call, boolean, boolean]> = [
    // name, call, may write (an invalid reply is outcome unknown), unknown allowed
    ['optimize', (og) => og.operations.optimize({ operationId: ID }), true, false],
    ['get', (og) => og.operations.get(ID), false, true],
    ['cancel', (og) => og.operations.cancel(ID), true, true],
  ];

  it.each(routes.flatMap(([name, call, writes]) => [
    [name, 'an empty object', {}, call, writes],
    [name, 'another operation\'s record', found('01JC9999999999999999999999'), call, writes],
    [name, 'found without a record', { lookup: 'found', in_progress: false }, call, writes],
    [name, 'a record without a state', { lookup: 'found', in_progress: false, operation: { operation_id: ID, outcome: {} } }, call, writes],
    [name, 'no in_progress', { lookup: 'found', operation: record('succeeded') }, call, writes],
  ] as const))('%s refuses %s as its receipt', async (_name, _what, body, call, writes) => {
    const { fetch, calls } = stubFetch({ status: 200, body });
    const error = await call(new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch })).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'ApiContractError', requestDispatched: true, outcomeUnknown: writes });
    expect(calls).toHaveLength(1);
  });

  it.each(routes)('%s accepts unknown only where the route can answer it', async (_name, call, _writes, unknownAllowed) => {
    const { fetch } = stubFetch({ body: { lookup: 'unknown', in_progress: false } });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    if (unknownAllowed) await expect(call(og)).resolves.toMatchObject({ lookup: 'unknown' });
    else await expect(call(og)).rejects.toMatchObject({ name: 'ApiContractError', outcomeUnknown: true });
  });

  it('wait stops at an invalid receipt instead of reading a missing record', async () => {
    const { fetch } = stubFetch([{ body: { lookup: 'found', in_progress: true } }]);
    await expect(new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch }).operations.wait(ID, { intervalMs: 1 }))
      .rejects.toMatchObject({ name: 'ApiContractError', outcomeUnknown: false });
  });

  it('a lookup that leaves its settlement write in doubt is outcome unknown', async () => {
    // 0.16 answers a lookup whose resolution write has no definite answer with
    // 500 outcome_unknown; retrying the lookup is how to settle it.
    const doubt = { status: 500, body: { error: 'resolution write in doubt; retry the lookup', code: 'outcome_unknown', disposition: { effects: 'none', action: 'reconcile' } } };
    const { fetch } = stubFetch([doubt, doubt]);
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await expect(og.operations.get(ID)).rejects.toMatchObject({ status: 500, code: 'outcome_unknown', outcomeUnknown: true });
    await expect(og.operations.wait(ID)).rejects.toMatchObject({ outcomeUnknown: true });
  });
});
