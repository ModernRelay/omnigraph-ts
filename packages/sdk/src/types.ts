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
  GraphBatchDeclarationOutput,
  GraphBatchLoadOutput,
  GraphInfo as GraphInfoOutput,
  GraphListOutput,
  HealthOutput,
  ReadinessOutput,
  BranchOutcomeOutput,
  SystemColumnsOutput,
  IngestOutput,
  IngestRequest,
  InvokeStoredQueryRequest,
  InvokeStoredQueryOutput,
  LoadMode,
  PublishedDatasetVersionConflictOutput,
  MergeConflictKind,
  MergeConflictOutput,
  ParamDescriptor as ParamDescriptorOutput,
  QueriesCatalogOutput,
  QueryCatalogEntry as QueryCatalogEntryOutput,
  QueryRequest,
  ReadOutput,
  ReadTargetOutput,
  SchemaOutput,
  SnapshotOutput,
  SnapshotDatasetOutput,
} from './generated/types.gen';

type CamelKey<S extends string> = S extends `${infer P}_${infer R}`
  ? `${P}${Capitalize<CamelKey<R>>}`
  : S;

export type Camelize<T> =
  T extends Array<infer U>
    ? Array<Camelize<U>>
    : T extends object
      ? { [K in keyof T as K extends string ? CamelKey<K> : K]: Camelize<T[K]> }
      : T;

// Outputs (responses): camelCase facing the caller.
export type Access = Camelize<import('./generated/types.gen').AccessOutput>;
export type Diff = Camelize<import('./generated/types.gen').DiffOutput>;
export type MergeBase = Camelize<
  import('./generated/types.gen').MergeBaseOutput
>;
export type BlobWrite = Camelize<
  import('./generated/types.gen').BlobWriteOutput
>;
export type BranchCreate = Camelize<BranchCreateOutput>;
export type BranchDelete = Camelize<BranchDeleteOutput>;
export type BranchList = Camelize<BranchListOutput>;
/**
 * A listed branch, including an unfinished create or pending retirement.
 * `head`, `fromCommitId` and `updatedAt` can be absent/null when there is no
 * readable tree. `retirementPending` marks a tombstone whose retirement can
 * be completed by deleting the branch; it does not imply the branch is readable.
 */
export type BranchDetail = Camelize<
  import('./generated/types.gen').BranchDetailOutput
>;
/**
 * `GET /branches?detailed=true`: every registered branch name, including
 * not-ready and retiring branches, and details for each branch the caller may
 * read, in the order of `branches`. A branch the caller may not read is listed
 * in `branches` alone. A permitted branch can still have no readable head.
 */
export interface BranchListDetailed {
  branches: string[];
  details: BranchDetail[];
}
export type BranchMerge = Camelize<BranchMergeOutput>;
export type Change = Camelize<ChangeOutput>;
export type Commit = Camelize<CommitOutput>;
export type CommitList = Camelize<CommitListOutput>;
export type GraphInfo = Camelize<GraphInfoOutput>;
export type GraphList = Camelize<GraphListOutput>;
export type Health = Camelize<HealthOutput>;
// Readiness with graph availability counts, returned for both 200 and 503.
export type Readiness = Camelize<ReadinessOutput>;
// The outcome of a branch statement run through POST /mutate.
export type BranchOutcome = Camelize<BranchOutcomeOutput>;
// The graph's identity column spellings from Schema.systemColumns.
export type SystemColumns = Camelize<SystemColumnsOutput>;
export type Ingest = Camelize<IngestOutput>;
// Strict graph-level NDJSON batch load (POST /load/ndjson).
export type GraphBatchLoad = Camelize<GraphBatchLoadOutput>;
export type GraphBatchDeclaration = Camelize<GraphBatchDeclarationOutput>;
export type Read = Camelize<ReadOutput>;
/**
 * How a read ordered by `nearest`, `bm25` or `rrf()` ranked its rows
 * (`Read.ranking`, omnigraph-server 0.15+): the search, the direction its
 * score orders rows, whether the search was exhaustive, and the returned
 * columns that hold the score.
 */
export type Ranking = Camelize<import('./generated/types.gen').RankingOutput>;
export type ReadTarget = Camelize<ReadTargetOutput>;
// Stored queries (GET /queries, POST /queries/{name}).
export type Queries = Camelize<QueriesCatalogOutput>;
export type QueryCatalogEntry = Camelize<QueryCatalogEntryOutput>;
export type ParamDescriptor = Camelize<ParamDescriptorOutput>;
// A stored query is read or mutation; the wire response is untagged
// (ReadOutput | ChangeOutput), so this camelizes to `Read | Change`.
export type InvokeQuery = Camelize<InvokeStoredQueryOutput>;
export type Schema = Camelize<SchemaOutput>;
export type Snapshot = Camelize<SnapshotOutput>;
export type SnapshotDataset = Camelize<SnapshotDatasetOutput>;
export type MergeConflict = Camelize<MergeConflictOutput>;
export type WriterFenced = Camelize<
  import('./generated/types.gen').WriterFencedOutput
>;
export type PublishedDatasetVersionConflict =
  Camelize<PublishedDatasetVersionConflictOutput>;

export type CommitChanges = Camelize<
  import('./generated/types.gen').CommitChangesOutput
>;
export type ChangeFeed = Camelize<
  import('./generated/types.gen').ChangeFeedOutput
>;
export type ChangeBlock = Camelize<
  import('./generated/types.gen').ChangeBlockOutput
>;
export type ChangeCause = Camelize<
  import('./generated/types.gen').ChangeCauseOutput
>;
export type EntityChange = Camelize<
  import('./generated/types.gen').EntityChangeOutput
>;
export type ChangeImage = Camelize<
  import('./generated/types.gen').ChangeImageOutput
>;
export type ChangeBaseline = Camelize<
  import('./generated/types.gen').ChangeBaselineOutput
>;
export type ChangeBaselineInput = Camelize<
  import('./generated/types.gen').ChangeBaselineRequest
>;
/**
 * Entity NDJSON envelopes; user property names inside data are never converted.
 * `id` is the entity identity, separate from an ordinary user property in data.
 */
export type ExportRecord =
  | { type: string; id: string; data: Record<string, unknown> }
  | {
      edge: string;
      id: string;
      from: string;
      to: string;
      data: Record<string, unknown>;
    };
/** The OpenAPI record describes the terminal envelope only; entities precede it. */
export type ChangeBaselineRecord =
  | ExportRecord
  | Camelize<import('./generated/types.gen').ChangeBaselineRecord>;

// Inputs (requests): camelCase from the caller, converted to snake_case on the wire.
export type BranchCreateInput = Camelize<BranchCreateRequest>;
export type BranchMergeInput = Camelize<BranchMergeRequest>;
export type MutationInput = Camelize<ChangeRequest>;
export type ExportInput = Camelize<ExportRequest>;
export type IngestInput = Camelize<IngestRequest>;
/**
 * Input for `loadNdjson` (`POST /load/ndjson`). The body is raw NDJSON —
 * the routing knobs travel as query parameters, so this is a hand-written
 * shape rather than a camelized wire DTO.
 */
export interface LoadNdjsonInput {
  /**
   * Strict graph-level NDJSON: each nonblank line is exactly one node
   * envelope `{"type":"<Node>","data":{...}}` or edge envelope
   * `{"edge":"<Edge>","from":"<src-id>","to":"<dst-id>","data":{...}}`.
   */
  ndjson: string;
  /** Target branch. Defaults to `main`. Without `from`, it must exist. */
  branch?: string;
  /** Parent branch used to create a missing target branch. */
  from?: string;
  /** How existing rows are handled. Defaults to `merge`. */
  mode?: LoadMode;
}
export type QueryInput = Camelize<QueryRequest>;
export type InvokeQueryInput = Camelize<InvokeStoredQueryRequest>;

// Enums and discriminators are unchanged (no snake-case keys to convert).
// Re-export both the runtime values (constant objects) and the types so
// callers can write `LoadMode.MERGE` and `mode: LoadMode` interchangeably.
export {
  ErrorCode,
  AccessAction,
  CommitKind,
  CommitListing,
  DispositionAction,
  DispositionEffects,
  BranchMergeOutcome,
  LoadMode,
  LoadEmbeddingGeneration,
  GraphAvailabilityAction,
  MergeConflictKind,
  ParamKind,
  EntityKind,
  ChangeOp,
  ChangeDiffRefusalReason,
  SearchFunction,
  RankOrder,
  OperationLookup,
} from './generated/types.gen';

// CamelErrorOutput is the camelCased version surfaced on OmnigraphError.body.
export type ErrorOutput = Camelize<import('./generated/types.gen').ErrorOutput>;

export type Settings = Camelize<
  import('./generated/types.gen').SettingsRequest
>;
export type GraphDiscovery = Camelize<
  import('./generated/types.gen').GraphDiscoveryEntry
>;
export type GraphAvailability =
  import('./generated/types.gen').GraphAvailability;
export type GraphStartupFailure = Camelize<
  import('./generated/types.gen').GraphStartupFailure
>;
/** Bundled configuration, using exact server keys and caller-owned graph/provider names. */
export interface DeploymentPlanInput {
  deployment: Record<string, unknown>;
}
export interface DeploymentInput extends DeploymentPlanInput {
  deploymentId: string;
}
export type Deployment = Camelize<
  import('./generated/types.gen').DeploymentOutput
>;
export type DeploymentStatus = Camelize<
  import('./generated/types.gen').DeploymentStatusOutput
>;

// Recorded operations (omnigraph-server 0.16+). The spec leaves the record an
// open object; these types describe the record the 0.16 server writes. Fields
// may be added; read unknown ones from the raw object.

/** `accepted` → `running` → `publishing` → one terminal state. */
export const OperationState = {
  ACCEPTED: 'accepted',
  RUNNING: 'running',
  /** A commit may have landed; only `main`'s history settles it. */
  PUBLISHING: 'publishing',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  INTERRUPTED: 'interrupted',
  /** Terminal with its publication unknown (`reason: graph_deleted`). */
  UNSETTLED: 'unsettled',
} as const;
export type OperationState =
  (typeof OperationState)[keyof typeof OperationState];

/** What an optimize run was asked to do; the request digest covers it. */
export interface OperationRequest {
  /** 0.16 records one kind. */
  kind: 'optimize';
  datasets?: string[];
  maxGateHoldMs?: number;
}

/** One dataset's outcome, as the engine reported it. */
export interface OperationDatasetOutcome {
  /** The dataset's type key, `node:<Type>` or `edge:<Type>`. */
  typeKey: string;
  /** `optimized`, `unchanged`, `deferred` or `failed`. */
  outcome: string;
  /** Why a `deferred` dataset was not started, or `index_failed` on an `optimized` one. */
  reason?: string;
  detail?: string;
  fragmentsRemoved: number;
  fragmentsAdded: number;
  durationMs: number;
  sourceBytes?: number;
}

/** An outcome after the graph commit, which never fails the operation. */
export interface OperationTailOutcome {
  outcome: string;
  detail?: string;
}

export interface OperationOutcome {
  kind: 'optimize';
  /** The resume position the server supplied for a full-catalog run. */
  startAt?: string;
  /** At most 1,024 datasets, in the run's visit order. */
  datasets?: OperationDatasetOutcome[];
  /** The datasets beyond the listed ones, counted by `outcome` or `outcome:reason` (keys verbatim). */
  moreDatasets?: Record<string, number>;
  resumeAt?: string;
  configurationClear?: OperationTailOutcome;
  artifact?: OperationTailOutcome;
}

/** A recorded operation, as `GET /operations/{id}` reports it. */
export interface Operation {
  /** The caller's canonical ULID. */
  operationId: string;
  requestDigest: string;
  graph: string;
  schemaIdentityDomain: string;
  /** The branch whose history settles the publication (`main`). */
  settlementBranch: string;
  request: OperationRequest;
  principal: string;
  acceptedAt: string;
  state: OperationState;
  nonce?: string;
  inputCommit?: string;
  inputManifestVersion?: number;
  /** The published graph commit, from the publisher's answer or from resolution. */
  publishedCommit?: string;
  /** Present while a `publishing` record's history walk is open. */
  resolution?: { cursor?: string; visited: number };
  outcome: OperationOutcome;
  timings?: { queuedMs?: number; gateHoldMs?: number; computeMs?: number };
  /** Why a terminal operation ended as it did, or where a resolution stopped. */
  reason?: string;
}

/** The answer of every operation route: the record, or `lookup: 'unknown'`. */
export interface OperationResult {
  lookup: import('./generated/types.gen').OperationLookup;
  /** Whether this server is running the operation now. */
  inProgress: boolean;
  /** Absent for an `unknown` lookup. */
  operation?: Operation | null;
}
