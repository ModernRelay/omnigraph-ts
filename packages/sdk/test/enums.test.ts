import { describe, expect, it } from 'vitest';
import Omnigraph, {
  BranchMergeOutcome,
  ErrorCode,
  LoadMode,
  MergeConflictKindOutput,
  type LoadMode as LoadModeType,
} from '../src';
import { stubFetch } from './helpers';

describe('runtime enum constants', () => {
  it('LoadMode values match the wire protocol', () => {
    expect(LoadMode.OVERWRITE).toBe('overwrite');
    expect(LoadMode.APPEND).toBe('append');
    expect(LoadMode.MERGE).toBe('merge');
  });

  it('ErrorCode values match the server enum', () => {
    expect(ErrorCode.UNAUTHORIZED).toBe('unauthorized');
    expect(ErrorCode.FORBIDDEN).toBe('forbidden');
    expect(ErrorCode.BAD_REQUEST).toBe('bad_request');
    expect(ErrorCode.NOT_FOUND).toBe('not_found');
    expect(ErrorCode.CONFLICT).toBe('conflict');
    expect(ErrorCode.INTERNAL).toBe('internal');
  });

  it('BranchMergeOutcome values match the wire protocol', () => {
    expect(BranchMergeOutcome.ALREADY_UP_TO_DATE).toBe('already_up_to_date');
    expect(BranchMergeOutcome.FAST_FORWARD).toBe('fast_forward');
    expect(BranchMergeOutcome.MERGED).toBe('merged');
  });

  it('MergeConflictKindOutput exposes all kinds', () => {
    expect(MergeConflictKindOutput.DIVERGENT_INSERT).toBe('divergent_insert');
    expect(MergeConflictKindOutput.UNIQUE_VIOLATION).toBe('unique_violation');
    expect(MergeConflictKindOutput.VALUE_CONSTRAINT_VIOLATION).toBe('value_constraint_violation');
  });

  it('enum constants pass typecheck when used as call-site values', async () => {
    const { fetch, calls } = stubFetch({
      body: {
        actor_id: null,
        base_branch: 'main',
        branch: 'feat',
        branch_created: false,
        mode: 'merge',
        tables: [],
        uri: 's3://x',
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    // Mode accepts LoadModeType; LoadMode.MERGE is the value.
    const mode: LoadModeType = LoadMode.MERGE;
    await og.ingest({ branch: 'feat', data: '{}\n', mode });
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(body.mode).toBe('merge');
  });
});
