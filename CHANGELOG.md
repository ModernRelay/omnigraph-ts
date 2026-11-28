# Changelog

`@modernrelay/omnigraph` follows the major.minor of the `omnigraph-server`
release it is generated from and tested against. Through 0.17.1, the SDK and
`@modernrelay/omnigraph-mcp` shared one version. Earlier releases are described
in their GitHub release notes.

## Unreleased

### Removed

- Retired the TypeScript MCP wrapper and its workspace, build, test and release
  tooling. Future releases publish only `@modernrelay/omnigraph`; the SDK API
  is unchanged by this retirement.
- `@modernrelay/omnigraph-mcp@0.17.1` is the final MCP package release and remains
  installable. Use the native server's `/mcp` endpoint or `omnigraph mcp` for
  stdio hosts. The [migration guide](docs/migrating-from-omnigraph-mcp.md)
  covers authentication, tool schemas, resources, results and JavaScript
  factory callers. Historical package source remains at the
  [v0.17.1 tag](https://github.com/ModernRelay/omnigraph-ts/tree/v0.17.1/packages/mcp).

## 0.17.1

Targets omnigraph-server 0.17.1. The HTTP contract remains `0.14`.

### Changed

- Regenerated the OpenAPI types and version stamps from the stable 0.17.1
  release. Branch details now represent absent or null `head` and `updatedAt`
  values and expose `retirementPending`; listings may include branches that
  are not ready or are retiring.
- Added the `branch_exists`, `branch_deleted` and `branch_not_ready` error
  codes. These remain `ConflictError` responses, with the server's valid
  disposition determining effect certainty.
- Documented the 0.17.1 graph-discovery behavior: admitted identities can see
  registered graph names without data access. `graphs.list()` and MCP
  `graphs_list` still use the full catalog and require `graph_list`.
- Refreshed MCP cookbook content from the released server. Corrected guidance
  for nullable-to-required schema promotion and BM25 ranking without a limit;
  `nearest` and `rrf` still require a limit. The exposed resource topics and
  MCP tool routes are unchanged.

## 0.16.0

Targets omnigraph-server 0.16.0. The HTTP contract is still `0.14`.

### Added

- `og.operations`: `optimize`, `get`, `cancel` and `wait` for recorded
  operations, which a cluster server runs on a graph's `main` under an id the
  caller chooses (omnigraph#1282). `newOperationId()` mints the canonical
  ULID, `isTerminal()` and `OperationState` name the states, and `Operation`,
  `OperationOutcome`, `OperationTableOutcome` and `OperationResult` type the
  record with its per-dataset outcomes as `OperationDatasetOutcome`
  (omnigraph#1275, omnigraph#1418). The caller mints and keeps the id;
  `optimize` never mints one.
- `WriterFencedError`, a `ConflictError` for 409 `writer_fenced`, with the
  branch's writer epochs in `writerFenced` (omnigraph#1350). Its disposition
  decides `outcomeUnknown` (the intent of PR #25).
- `AccessAction.MAINTAIN` from the regenerated types.

### Fixed

- Every operation route accepts only a receipt for the id it was given: a
  lookup envelope whose `found` record names that id, or `unknown` where the
  route can answer it (lookup and cancel). Anything else is an
  `ApiContractError`, outcome unknown after a submission or cancellation.
- Whether a request may have written is judged on the body exactly as it is
  sent, never on the caller's object. `branches.merge` builds its request from
  the fields the route defines, so a stray `dry_run` cannot turn a dry run
  into a real merge that a lost answer reports as effect-free.
- A merge with `dryRun` is a read: a lost or interrupted answer is no longer
  `outcomeUnknown`. A reply that is not a dry-run receipt still is
  (CLI parity with omnigraph#1448).

### Server behaviour to know

- A graph with no applied policy now refuses reads (`ForbiddenError`) unless
  the server sets `OMNIGRAPH_ALLOW_READS_WITHOUT_POLICY=1`.
- A request setting above the server's resource budget is a `BadRequestError`
  (omnigraph#1327).
- Failed reads of cluster control state on the deployment routes answer 503
  or 500 with `effects: none`, no longer 409 (omnigraph#1357).
- A merge refused by its validation limit names the resource
  `branch-merge retained validation key bytes` (it was `… delta bytes`) and
  counts only the delta's keys (omnigraph#1433). `PayloadTooLargeError.resourceLimit`
  already carries the new name and numbers; match on the code, not the name.
- A recorded-operation lookup can answer 500 `outcome_unknown` when a
  settlement write it made has no definite answer; it is `outcomeUnknown`, and
  retrying the lookup is safe. `cancel` is best effort and returns a
  `publishing` operation unchanged.
- A conditional mutation that loses a race is a `PreconditionFailedError`, not
  a `@card` violation (omnigraph#1426); an overtaken update or delete reruns
  instead of failing with `readSetConflict` (omnigraph#1349).

### Changed

- `@modernrelay/omnigraph-mcp` is unchanged apart from its version. The
  server's own `/mcp` endpoint now covers every non-streaming operation;
  deprecating this package is tracked separately.

## 0.15.0

Targets omnigraph-server 0.15.0. The HTTP contract is still `0.14`.

### Fixed

- The `Omnigraph-Http-Api` header value now comes from the pinned spec, not
  from the server release's major.minor. Pinning 0.15 the old way would have
  sent `0.15`, which every 0.15 server refuses as `api_contract_mismatch`.

### Added

- `branches.listDetailed()`: each readable branch's head commit, the branch
  and commit it started from, and when it was created and last moved
  (`GET /branches?detailed=true`, omnigraph#1012).
- `Read.ranking` and the `SearchFunction` and `RankOrder` enums: how a read
  ordered by `nearest`, `bm25` or `rrf()` ranked its rows (omnigraph#1130).
- `NotAdmittedError`, a `ForbiddenError` for 403 `not_admitted`: a valid OIDC
  token whose subject the server does not admit. A refusal with
  `effects: none` is not `outcomeUnknown` (omnigraph#1185; the intent of
  PR #25).
- `bigint` values in request bodies are sent as exact decimal strings, so a
  `U64` parameter above `i64::MAX` binds (omnigraph#1102).
- `Access.clientId` (omnigraph#1196), `Settings.changeLineage`
  (omnigraph#1201) and `read_ns` in load profiles, from the regenerated types.

- An error response that says a write may have taken effect is
  `outcomeUnknown` on every route, reads included: code `outcome_unknown`
  always (whatever its disposition reads), and otherwise effects `unknown` or
  `partial`. Before, a GET could never be `outcomeUnknown`.

### Changed

- A class chosen by error code now replaces the status's class only when it
  refines it (`GraphUnavailableError`, `NotAdmittedError`).
- `@modernrelay/omnigraph-mcp` is unchanged apart from its version.
