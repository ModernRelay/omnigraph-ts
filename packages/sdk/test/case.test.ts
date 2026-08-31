import { describe, expect, it } from 'vitest';
import { camelToSnake, snakeToCamel } from '../src/case';

describe('case boundary', () => {
  it('snakeToCamel transforms keys recursively', () => {
    const wire = {
      graph_commit_id: '01KQ',
      created_at: 1,
      merge_conflicts: [
        { type_name: 'Person', entity_id: 'r', kind: 'divergent_insert' },
      ],
      empty: null,
    };
    const camel = snakeToCamel<typeof wire>(wire);
    expect(camel).toEqual({
      graphCommitId: '01KQ',
      createdAt: 1,
      mergeConflicts: [{ typeName: 'Person', entityId: 'r', kind: 'divergent_insert' }],
      empty: null,
    });
  });

  it('camelToSnake transforms keys recursively', () => {
    const out = camelToSnake({
      querySource: 'q',
      params: null,
      branchName: 'main',
      schemaSource: 's',
      nested: { camelKey: 'v' },
    });
    expect(out).toEqual({
      query_source: 'q',
      params: null,
      branch_name: 'main',
      schema_source: 's',
      nested: { camel_key: 'v' },
    });
  });

  it('snakeToCamel handles arrays of primitives', () => {
    const out = snakeToCamel({ type_names: ['a', 'b', 'c'] });
    expect(out).toEqual({ typeNames: ['a', 'b', 'c'] });
  });
});
