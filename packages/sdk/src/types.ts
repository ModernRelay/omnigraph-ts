// Public, camelCased re-shape of the auto-generated DTOs.
//
// The wire format is snake_case (`graph_commit_id`, `query_source`); the SDK
// applies snake_case ↔ camelCase at the boundary so callers write idiomatic
// TypeScript (`graphCommitId`, `querySource`).

import type {
  BranchCreateOutput,
  BranchCreateRequest,
  BranchDeleteOutput,
  BranchListOutput,
  BranchMergeOutcome,
  BranchMergeOutput,
  BranchMergeRequest,
  ChangeOutput,
  ChangeRequest,
  CommitListOutput,
  CommitOutput,
  ErrorCode,
  ExportRequest,
  HealthOutput,
  IngestOutput,
  IngestRequest,
  IngestTableOutput,
  LoadMode,
  MergeConflictKindOutput,
  MergeConflictOutput,
  ReadOutput,
  ReadRequest,
  ReadTargetOutput,
  RunListOutput,
  RunOutput,
  SchemaApplyOutput,
  SchemaApplyRequest,
  SchemaOutput,
  SnapshotOutput,
  SnapshotTableOutput,
} from './generated/types.gen';

type CamelKey<S extends string> = S extends `${infer P}_${infer R}`
  ? `${P}${Capitalize<CamelKey<R>>}`
  : S;

export type Camelize<T> = T extends Array<infer U>
  ? Array<Camelize<U>>
  : T extends object
  ? { [K in keyof T as K extends string ? CamelKey<K> : K]: Camelize<T[K]> }
  : T;

// Outputs (responses): camelCase facing the caller.
export type BranchCreate = Camelize<BranchCreateOutput>;
export type BranchDelete = Camelize<BranchDeleteOutput>;
export type BranchList = Camelize<BranchListOutput>;
export type BranchMerge = Camelize<BranchMergeOutput>;
export type Change = Camelize<ChangeOutput>;
export type Commit = Camelize<CommitOutput>;
export type CommitList = Camelize<CommitListOutput>;
export type Health = Camelize<HealthOutput>;
export type Ingest = Camelize<IngestOutput>;
export type IngestTable = Camelize<IngestTableOutput>;
export type Read = Camelize<ReadOutput>;
export type ReadTarget = Camelize<ReadTargetOutput>;
export type Run = Camelize<RunOutput>;
export type RunList = Camelize<RunListOutput>;
export type Schema = Camelize<SchemaOutput>;
export type SchemaApply = Camelize<SchemaApplyOutput>;
export type Snapshot = Camelize<SnapshotOutput>;
export type SnapshotTable = Camelize<SnapshotTableOutput>;
export type MergeConflict = Camelize<MergeConflictOutput>;

// Inputs (requests): camelCase from the caller, converted to snake_case on the wire.
export type BranchCreateInput = Camelize<BranchCreateRequest>;
export type BranchMergeInput = Camelize<BranchMergeRequest>;
export type ChangeInput = Camelize<ChangeRequest>;
export type ExportInput = Camelize<ExportRequest>;
export type IngestInput = Camelize<IngestRequest>;
export type ReadInput = Camelize<ReadRequest>;
export type SchemaApplyInput = Camelize<SchemaApplyRequest>;

// Enums and discriminators are unchanged (no snake-case keys to convert).
export type { ErrorCode, BranchMergeOutcome, LoadMode, MergeConflictKindOutput };

// CamelErrorOutput is the camelCased version surfaced on OmnigraphError.body.
export type ErrorOutput = Camelize<import('./generated/types.gen').ErrorOutput>;
