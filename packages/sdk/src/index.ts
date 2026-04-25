import Omnigraph from './client';

export default Omnigraph;
export { Omnigraph };

export type { OmnigraphOptions, SnapshotInput } from './client';
export type { CallOptions, ListCommitsInput, ListRunsInput, GetSchemaInput, FetchLike } from './internals';

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
  BranchMergeOutcome,
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
  MergeConflictKindOutput,
  ErrorCode,
  ErrorOutput,
  LoadMode,
  // Utility
  Camelize,
} from './types';
