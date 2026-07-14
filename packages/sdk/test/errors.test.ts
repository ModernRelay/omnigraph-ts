import { describe, expect, it } from 'vitest';
import Omnigraph, {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalServerError,
  MethodNotAllowedError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
  UnauthorizedError,
} from '../src';
import { stubFetch } from './helpers';

const cases: Array<[number, string, unknown]> = [
  [400, 'bad_request', BadRequestError],
  [401, 'unauthorized', UnauthorizedError],
  [403, 'forbidden', ForbiddenError],
  [404, 'not_found', NotFoundError],
  [405, 'method_not_allowed', MethodNotAllowedError],
  [409, 'conflict', ConflictError],
  [429, 'too_many_requests', TooManyRequestsError],
  [500, 'internal', InternalServerError],
];

describe('error dispatcher', () => {
  for (const [status, code, cls] of cases) {
    it(`maps status ${status} / code "${code}" → ${(cls as { name: string }).name}`, async () => {
      const { fetch } = stubFetch({ status, body: { error: 'boom', code } });
      const og = new Omnigraph({ baseUrl: 'http://x', fetch });
      await expect(og.health()).rejects.toBeInstanceOf(cls as new () => Error);
    });
  }

  it('falls back to status when code is missing', async () => {
    const { fetch } = stubFetch({ status: 404, body: { error: 'gone' } });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    await expect(og.health()).rejects.toBeInstanceOf(NotFoundError);
  });

  it('maps 405 without a body to MethodNotAllowedError', async () => {
    const { fetch } = stubFetch({ status: 405, body: '' });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    await expect(og.graphs.list()).rejects.toBeInstanceOf(MethodNotAllowedError);
  });

  it('ConflictError exposes manifestConflict when present', async () => {
    const { fetch } = stubFetch({
      status: 409,
      body: {
        error: 'manifest version mismatch',
        code: 'conflict',
        manifest_conflict: { actual: 7, expected: 5, table_key: 'Person' },
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    try {
      await og.mutate({ query: 'insert Person { name: "x" }' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError);
      const err = e as ConflictError;
      expect(err.manifestConflict).toEqual({ actual: 7, expected: 5, tableKey: 'Person' });
    }
  });

  it('ConflictError exposes readSetConflict when present', async () => {
    const { fetch } = stubFetch({
      status: 409,
      body: {
        error: 'read set changed',
        code: 'conflict',
        read_set_conflict: { member: 'graph_head:main', expected: '01A', actual: '01B' },
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    try {
      await og.mutate({ query: 'insert Person { name: "x" }' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError);
      const err = e as ConflictError;
      expect(err.readSetConflict).toEqual({
        member: 'graph_head:main',
        expected: '01A',
        actual: '01B',
      });
    }
  });

  it('maps a code-less 503 with recovery_required to ServiceUnavailableError', async () => {
    // The 503 body deliberately has no `code` (ErrorCode is a closed wire
    // contract), so the mapping must come from the status alone.
    const { fetch } = stubFetch({
      status: 503,
      body: {
        error: 'a durable recovery intent overlaps this write',
        recovery_required: { operation_id: '01JRECOVERY' },
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    try {
      await og.mutate({ query: 'insert Person { name: "x" }' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ServiceUnavailableError);
      const err = e as ServiceUnavailableError;
      expect(err.recoveryRequired).toEqual({ operationId: '01JRECOVERY' });
    }
  });

  it('ConflictError exposes mergeConflicts when present', async () => {
    const { fetch } = stubFetch({
      status: 409,
      body: {
        error: 'conflict',
        code: 'conflict',
        merge_conflicts: [
          {
            kind: 'divergent_update',
            message: 'two branches updated row 1',
            row_id: 'r1',
            table_key: 'Person',
          },
        ],
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    try {
      await og.branches.merge({ source: 'a', target: 'b' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError);
      const err = e as ConflictError;
      expect(err.mergeConflicts).toHaveLength(1);
      expect(err.mergeConflicts?.[0]?.kind).toBe('divergent_update');
    }
  });
});
