import Omnigraph from './client';

export default Omnigraph;
export { Omnigraph };

export type {
  OmnigraphOptions,
  SnapshotInput,
  AccessInput,
  DiffInput,
} from './client';
export type {
  CallOptions,
  ConditionalCallOptions,
  ListCommitsInput,
  FetchLike,
} from './internals';
export type {
  BlobInput,
  BlobWriteInput,
  BlobPutInput,
} from './resources/blobs';
export type {
  PollChangesInput,
  ChangePageInput,
  ChangeFilterInput,
} from './resources/changes';

export type { BranchDiffInput, MergeBaseInput } from './resources/branches';

// The generated server pin and exact HTTP contract enforced by every client.
export {
  SERVER_VERSION,
  HTTP_API_CONTRACT,
  HTTP_API_CONTRACT_HEADER,
} from './version.gen';

// Errors — typed hierarchy. Catch the specific class you care about.
export {
  OmnigraphError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  MethodNotAllowedError,
  RequestTimeoutError,
  UnsupportedMediaTypeError,
  ConflictError,
  GoneError,
  PreconditionFailedError,
  PayloadTooLargeError,
  RangeNotSatisfiableError,
  FailedDependencyError,
  ServiceUnavailableError,
  TooManyRequestsError,
  InternalServerError,
  NetworkError,
  ConfigurationError,
  ApiContractError,
  GraphUnavailableError,
} from './errors';

// Public DTO types (camelCase). Inputs end in `Input`; outputs are bare nouns.
export type {
  Access,
  Diff,
  MergeBase,
  BlobWrite,
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
  // Graphs
  GraphInfo,
  GraphDiscovery,
  GraphAvailability,
  GraphStartupFailure,
  Deployment,
  DeploymentInput,
  DeploymentPlanInput,
  DeploymentStatus,
  Settings,
  GraphList,
  // Schema
  Schema,
  // Operations
  Change,
  MutationInput,
  ExportInput,
  Health,
  Readiness,
  BranchOutcome,
  SystemColumns,
  GraphBatchDeclaration,
  GraphBatchLoad,
  Ingest,
  IngestInput,
  LoadNdjsonInput,
  QueryInput,
  Read,
  ReadTarget,
  Snapshot,
  SnapshotDataset,
  // Stored queries
  Queries,
  QueryCatalogEntry,
  ParamDescriptor,
  InvokeQuery,
  InvokeQueryInput,
  // Conflict / errors / shared
  MergeConflict,
  PublishedDatasetVersionConflict,
  ErrorOutput,
  CommitChanges,
  ChangeFeed,
  ChangeBlock,
  ChangeCause,
  EntityChange,
  ChangeImage,
  ChangeBaseline,
  ChangeBaselineInput,
  ChangeBaselineRecord,
  ExportRecord,
  // Utility
  Camelize,
} from './types';

// Runtime enum constants — also valid as types via TS declaration merging.
// Use as values: `og.load({ ..., mode: LoadMode.MERGE })`.
// Use as types: `function check(c: ErrorCode) { ... }`.
export {
  BranchMergeOutcome,
  ErrorCode,
  AccessAction,
  CommitKind,
  CommitListing,
  DispositionAction,
  DispositionEffects,
  LoadMode,
  LoadEmbeddingGeneration,
  GraphAvailabilityAction,
  MergeConflictKind,
  ParamKind,
  EntityKind,
  ChangeOp,
  ChangeDiffRefusalReason,
} from './types';
