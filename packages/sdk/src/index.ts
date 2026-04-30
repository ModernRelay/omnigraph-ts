import Omnigraph from './client';

export default Omnigraph;
export { Omnigraph };

export type { OmnigraphOptions, SnapshotInput } from './client';
export type { CallOptions, ListCommitsInput, FetchLike } from './internals';

// Build-time pin: which omnigraph-server release this SDK was generated
// against. Compare against `og.health()` at startup if you want to detect
// a server / SDK version skew.
export { SERVER_VERSION } from './version.gen';

// Errors — typed hierarchy. Catch the specific class you care about.
export {
  OmnigraphError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InternalServerError,
  NetworkError,
  TimeoutError,
} from './errors';

// Public DTO types (camelCase). Inputs end in `Input`; outputs are bare nouns.
export type {
  // Branches
  BranchCreate,
  BranchCreateInput,
  BranchDelete,
  BranchList,
  BranchMerge,
  BranchMergeInput,
  // Commits
  Commit,
  CommitList,
  // Runs
  Run,
  RunList,
  // Schema
  Schema,
  SchemaApply,
  SchemaApplyInput,
  // Operations
  Change,
  ChangeInput,
  ExportInput,
  Health,
  Ingest,
  IngestInput,
  IngestTable,
  Read,
  ReadInput,
  ReadTarget,
  Snapshot,
  SnapshotTable,
  // Conflict / errors / shared
  MergeConflict,
  ErrorOutput,
  // Utility
  Camelize,
} from './types';

// Runtime enum constants — also valid as types via TS declaration merging.
// Use as values: `og.ingest({ ..., mode: LoadMode.MERGE })`.
// Use as types: `function check(c: ErrorCode) { ... }`.
export {
  BranchMergeOutcome,
  ErrorCode,
  LoadMode,
  MergeConflictKindOutput,
} from './types';
