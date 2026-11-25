import { describe, expect, it } from 'vitest';
import Omnigraph, {
  BadRequestError,
  ConflictError,
  GoneError,
  PreconditionFailedError,
  PayloadTooLargeError,
  RangeNotSatisfiableError,
  FailedDependencyError,
  ServiceUnavailableError,
  ForbiddenError,
  GraphUnavailableError,
  InternalServerError,
  NotAdmittedError,
  MethodNotAllowedError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
} from '../src';
import { stubFetch } from './helpers';

const cases: Array<[number, string, unknown]> = [
  [400, 'bad_request', BadRequestError],
  [401, 'unauthorized', UnauthorizedError],
  [403, 'forbidden', ForbiddenError],
  [403, 'not_admitted', NotAdmittedError],
  [503, 'graph_unavailable', GraphUnavailableError],
  [404, 'not_found', NotFoundError],
  [405, 'method_not_allowed', MethodNotAllowedError],
  [409, 'conflict', ConflictError],
  [412, 'conflict', PreconditionFailedError],
  [413, 'bad_request', PayloadTooLargeError],
  [416, 'bad_request', RangeNotSatisfiableError],
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

  it('a refining code class is a subclass of its status class', async () => {
    const { fetch } = stubFetch({
      status: 403,
      body: { error: 'subject not admitted', code: 'not_admitted', disposition: { effects: 'none', action: 'fix' } },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const error = await og.snapshot().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotAdmittedError);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toMatchObject({ status: 403, code: 'not_admitted', outcomeUnknown: false });
  });

  it('a code whose class does not refine the status keeps the status class', async () => {
    // not_admitted is a 403 code; under another status it adds no detail.
    const { fetch } = stubFetch({ status: 401, body: { error: 'x', code: 'not_admitted' } });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const error = await og.health().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error).not.toBeInstanceOf(NotAdmittedError);
  });

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

  it('ConflictError exposes published dataset version details', async () => {
    const { fetch } = stubFetch({
      status: 409,
      body: {
        error: 'manifest version mismatch',
        code: 'conflict',
        published_dataset_version_conflict: {
          entity_kind: 'node', type_name: 'Person',
          actual_published_dataset_version: 7, expected_published_dataset_version: 5,
        },
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    try {
      await og.mutate({ query: 'insert Person { name: "x" }' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError);
      const err = e as ConflictError;
      expect(err.publishedDatasetVersionConflict).toEqual({
        entityKind: 'node', typeName: 'Person',
        actualPublishedDatasetVersion: 7, expectedPublishedDatasetVersion: 5,
      });
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
            entity_id: 'r1',
            entity_kind: 'node',
            type_name: 'Person',
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
      expect(err.mergeConflicts?.[0]).toMatchObject({ entityId: 'r1', entityKind: 'node', typeName: 'Person' });
    }
  });

  it.each([
    [410, GoneError, 'change_feed_gap', 'changeFeedGap', { first_unreadable_commit_id: 'c1' }, { firstUnreadableCommitId: 'c1' }],
    [412, PreconditionFailedError, 'precondition_failure', 'preconditionFailure', { expected: 'c1', actual: 'c2' }, { expected: 'c1', actual: 'c2' }],
    [413, PayloadTooLargeError, 'resource_limit', 'resourceLimit', { resource: 'entities', limit: 10, actual: 11 }, { resource: 'entities', limit: 10, actual: 11 }],
    [416, RangeNotSatisfiableError, 'blob_range', 'blobRange', { start: 10, end: 20, length: 5 }, { start: 10, end: 20, length: 5 }],
    [424, FailedDependencyError, 'external_blob_source', 'externalBlobSource', { uri: 's3://example/item', reason: 'unavailable' }, { uri: 's3://example/item', reason: 'unavailable' }],
    [503, ServiceUnavailableError, 'recovery_required', 'recoveryRequired', { operation_id: 'op1' }, { operationId: 'op1' }],
    [409, ConflictError, 'full_text_index_rebuild_required', 'fullTextIndexRebuildRequired', { index: 'Document_text', reason: 'uncertified' }, { index: 'Document_text', reason: 'uncertified' }],
    [409, ConflictError, 'change_diff_refusal', 'changeDiffRefusal', { graph_commit_id: 'c1', reason: 'parentless_commit' }, { graphCommitId: 'c1', reason: 'parentless_commit' }],
    [409, ConflictError, 'key_conflict', 'keyConflict', { entity_kind: 'node', type_name: 'Person', entity_id: 'a' }, { entityKind: 'node', typeName: 'Person', entityId: 'a' }],
    [409, ConflictError, 'read_set_conflict', 'readSetConflict', { member: 'graph_head', expected: 'a', actual: 'b' }, { member: 'graph_head', expected: 'a', actual: 'b' }],
  ] as const)('preserves structured HTTP %i details (%s)', async (status, cls, wireKey, publicKey, detail, expected) => {
    const { fetch, calls } = stubFetch({ status, body: { error: 'refused', [wireKey]: detail } });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const failure = await og.health().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(cls);
    expect(failure).toMatchObject({ [publicKey]: expected, body: { [publicKey]: expected } });
    expect(calls).toHaveLength(1);
  });
});

it('distinguishes known unavailable graphs from unknown graph 404s', async () => {
  const { fetch } = stubFetch({ status: 503, body: { error: 'graph is loading', code: 'graph_unavailable' } });
  const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
  await expect(og.query({ query: 'query q() {}' })).rejects.toMatchObject({ name: 'GraphUnavailableError', status: 503, code: 'graph_unavailable', outcomeUnknown: false });
});
