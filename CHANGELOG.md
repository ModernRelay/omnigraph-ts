# Changelog

Both packages, `@modernrelay/omnigraph` and `@modernrelay/omnigraph-mcp`,
share one version, whose major.minor is the `omnigraph-server` release they are
generated from and tested against. Earlier releases are described in their
GitHub release notes.

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

### Changed

- A class chosen by error code now replaces the status's class only when it
  refines it (`GraphUnavailableError`, `NotAdmittedError`).
- `@modernrelay/omnigraph-mcp` is unchanged apart from its version.
