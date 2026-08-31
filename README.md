# omnigraph-ts

TypeScript packages for the [Omnigraph](https://github.com/ModernRelay/omnigraph) graph database.

## Packages

| Package | Purpose |
|---|---|
| **[`@modernrelay/omnigraph`](packages/sdk/)** | TypeScript SDK — instance-per-client, typed errors, camelCase types, streaming export. **Read this if you're building against omnigraph-server.** |
| **[`@modernrelay/omnigraph-mcp`](packages/mcp/)** | MCP server bridging Omnigraph to LLM hosts (Claude Desktop, …) over stdio. Wraps the SDK above. |

## Repo layout

```
.
├── spec/openapi.json            # committed copy of upstream OpenAPI at the pinned source
├── scripts/                     # spec sync, drift check, version-stamp generator
├── packages/
│   ├── sdk/                     # @modernrelay/omnigraph
│   └── mcp/                     # @modernrelay/omnigraph-mcp
└── .github/workflows/           # ci (build/typecheck/test/coverage), e2e (live server), release
```

## Server-version pin

The SDK targets the `omnigraph-server` version in **`package.json#omnigraph.serverVersion`**. By default, the source is the matching `vX.Y.Z` tag. Before a server release exists, **`omnigraph.serverRef`** may temporarily pin a full immutable commit SHA. The OpenAPI spec, MCP reference documents, and live CI server all use that same source. Branch names and abbreviated SHAs are rejected.

This branch targets the **upcoming 0.10.0**, including the unmerged [server PR #581](https://github.com/ModernRelay/omnigraph/pull/581) candidate at `d043cf148e37c4356deb497835db593a2c32d270`. It is not a published-server compatibility claim. Publishing is blocked while `serverRef` is present, both by the release workflow and each package's `prepublishOnly` hook.

`scripts/gen-version.ts` stamps the target version as `SERVER_VERSION`. CI checks that the bundled spec matches the pinned source byte for byte and runs live e2e tests against it: a checksum-verified release binary for tags, or a source build for commit pins.

### Versioning policy

`@modernrelay/omnigraph` matches `omnigraph-server` on **major.minor**; the **patch** is independent. A published `@modernrelay/omnigraph@X.Y.*` is built against `omnigraph-server@X.Y.*` and is expected to work against any `>=X.Y.0, <X.(Y+1).0`. The exact server version the SDK was generated from is always available at runtime as `import { SERVER_VERSION } from '@modernrelay/omnigraph'`.

In practice: server cuts `0.4.2`, SDK ships `0.4.0` (and `0.4.1`, `0.4.2`, … as SDK-side fixes land independently). When server cuts `0.5.0`, the SDK jumps to `0.5.0` regardless of where the `0.4.x` patch line ended. This keeps SDK release cadence decoupled from the server while still making major.minor compatibility self-documenting.

## Workflow when omnigraph cuts a new release

1. Bump `package.json#omnigraph.serverVersion` to the new tag (e.g., `0.10.0`). If upgrading from a source-pinned candidate, remove `omnigraph.serverRef` after the release tag exists.
2. `pnpm run sync-spec` — fetches the matching `openapi.json` into `spec/`.
3. `pnpm run generate` — regenerates `packages/sdk/src/generated/` and `packages/sdk/src/version.gen.ts`.
4. Commit `spec/openapi.json`, `packages/sdk/src/generated/`, `packages/sdk/src/version.gen.ts`, and the bumped `package.json`. The PR shows the full upstream change.
5. Bump `packages/sdk/package.json#version` (and `packages/mcp/package.json#version`) to match.
6. Run the full checks, including `pnpm run check-release`, against the released server; the final tag may differ from an earlier source-pinned candidate.
7. Tag `vX.Y.Z`. `release.yml` publishes both packages to npm (see [Releasing](#releasing)).

## Releasing

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which runs the full gate (release pin, drift, coverage, build, typecheck, test) on the tag SHA and then publishes both `@modernrelay/omnigraph` and `@modernrelay/omnigraph-mcp` with npm provenance. `check-release` rejects a source pin and verifies the spec against the released server tag. The dist-tag is derived from the tag name: `v1.2.3-alpha.1`, `-beta.x`, `-rc.x` ship under `next`; everything else under `latest`.

```sh
pnpm --filter @modernrelay/omnigraph version 0.4.0-alpha.1
pnpm --filter @modernrelay/omnigraph-mcp version 0.4.0-alpha.1
git commit -am "Release 0.4.0-alpha.1"
git tag -a v0.4.0-alpha.1 -m "Release 0.4.0-alpha.1"
git push --follow-tags
# then approve the `release` environment in the Actions UI.
```

One-time setup: add an npm `NPM_TOKEN` repo secret (use an Automation token to bypass 2FA in CI) and create a `release` GitHub Environment with required reviewers so a stray tag push cannot ship.

## Local dev

```sh
pnpm install
pnpm run check-drift     # asserts spec matches the pinned tag or immutable commit
pnpm run generate        # regenerates types + version stamp
pnpm run check-coverage  # asserts every spec op has an SDK binding
pnpm run build           # builds all workspace packages (SDK first, then MCP)
pnpm run typecheck       # runs after build so workspace types resolve
pnpm run test            # pin-tooling tests + mocked unit tests across all packages
pnpm run check-release  # release-only gate; intentionally fails with serverRef set

# Live e2e against a real cluster server (0.7.0 is cluster-only — boot it with
# `omnigraph-server --cluster <dir>`; see packages/sdk/test/e2e.test.ts header
# and .github/workflows/e2e.yml for the cluster.yaml + import/apply/load setup):
OMNIGRAPH_E2E=1 OMNIGRAPH_BASE_URL=http://127.0.0.1:8080 OMNIGRAPH_TOKEN=$TOKEN \
  OMNIGRAPH_GRAPH_ID=alpha pnpm --filter @modernrelay/omnigraph run test
```

CI runs the same sequence (see `.github/workflows/ci.yml` and `e2e.yml`). Its e2e job downloads the pinned release binary or builds the immutable source candidate, then runs the same cluster bootstrap and tests in either mode.

## License

MIT
