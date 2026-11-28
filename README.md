# omnigraph-ts

TypeScript SDK for the [Omnigraph](https://github.com/ModernRelay/omnigraph) graph database.

[`@modernrelay/omnigraph`](packages/sdk/README.md) provides typed clients and
errors, camelCase types and streaming export for applications using
`omnigraph-server`.
The TypeScript MCP wrapper is retired. **`@modernrelay/omnigraph-mcp@0.17.1`
is its final release and remains installable.** Connect MCP hosts to the native
server's `/mcp` endpoint or the `omnigraph mcp` stdio bridge. See the
[migration guide](docs/migrating-from-omnigraph-mcp.md) for authentication,
tool and result changes, and programmatic callers.

## Repo layout

```
.
├── spec/openapi.json            # committed copy of upstream OpenAPI at the pinned source
├── scripts/                     # spec sync, drift check, version-stamp generator
├── packages/sdk/                # @modernrelay/omnigraph
├── docs/                        # migration guidance
└── .github/workflows/           # ci (build/typecheck/test/coverage), e2e (live server), release
```

## Server-version pin

The SDK targets the `omnigraph-server` version in **`package.json#omnigraph.serverVersion`**. By default, the source is the matching `vX.Y.Z` tag. Before a server release exists, **`omnigraph.serverRef`** may temporarily pin a full immutable commit SHA. The OpenAPI spec and live CI server use that source. Branch names and abbreviated SHAs are rejected.

The **v0.17** line is generated from and tested against `omnigraph-server` **v0.17.1** and enforces its exact HTTP contract (`0.14`). Upgrade the CLI, server, and client integrations together; see [the SDK guide](packages/sdk/README.md). Development source pins remain supported, but block publishing through both the release workflow and the SDK's `prepublishOnly` hook.

`scripts/gen-version.ts` stamps the target version as `SERVER_VERSION`. CI checks that the bundled spec matches the pinned source byte for byte and runs live e2e tests against it: a checksum-verified release binary for tags, or a source build for commit pins.

### Versioning policy

`@modernrelay/omnigraph` matches `omnigraph-server` on **major.minor**; the **patch** is independent. A published `@modernrelay/omnigraph@X.Y.*` is built against `omnigraph-server@X.Y.*` and is expected to work against any `>=X.Y.0, <X.(Y+1).0`. The exact server version the SDK was generated from is always available at runtime as `import { SERVER_VERSION } from '@modernrelay/omnigraph'`.

The server release and the HTTP contract are separate numbers. Every request sends, and every response must carry, the `Omnigraph-Http-Api` value that the pinned `spec/openapi.json` requires; `scripts/gen-version.ts` reads it from the spec as `HTTP_API_CONTRACT`. Server releases 0.15, 0.16 and 0.17 retain contract `0.14`. A matching contract is required but does not guarantee identical features or authorization behavior: later routes and fields require the release that introduced them, and graph discovery changed between 0.17.0 and 0.17.1. The live compatibility gate exercises the exact pinned release.

## Workflow when omnigraph cuts a new release

1. Bump `package.json#omnigraph.serverVersion` and `packages/sdk/package.json#version`. Remove a temporary `omnigraph.serverRef` once the release tag exists.
2. `pnpm run sync-spec` — fetch the released `openapi.json` into `spec/`.
3. `pnpm run generate` — regenerate SDK types and its version stamp.
4. Commit the pin, SDK version, spec, generated types, and `packages/sdk/src/version.gen.ts` together.
5. Run the full checks, including `pnpm run check-release` and `pnpm run test:e2e`, against the released binaries.
6. Tag `vX.Y.Z` after review. `release.yml` publishes the SDK to npm after approval.

## Releasing

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which runs the full gate (release pin, drift, coverage, build, typecheck, test) on the tag SHA and then publishes `@modernrelay/omnigraph` with npm provenance. `check-release` rejects a source pin and verifies the spec against the released server tag. The dist-tag is derived from the tag name: `v1.2.3-alpha.1`, `-beta.x`, `-rc.x` ship under `next`; everything else under `latest`.

One-time setup: add a publish-capable npm `NPM_TOKEN` repo secret suitable for CI and create a `release` GitHub Environment with required reviewers so a stray tag push cannot ship.

## Local dev

```sh
pnpm install
pnpm run check-drift     # asserts spec matches the pinned tag or immutable commit
pnpm run generate        # regenerates types + version stamp
pnpm run check-coverage  # asserts every spec op has an SDK binding
pnpm run build           # builds the SDK
pnpm run typecheck       # runs after build so workspace types resolve
pnpm run test            # pin-tooling tests + mocked SDK unit tests
pnpm run check-release  # release-only gate; intentionally fails with serverRef set

# Isolated live cluster using released binaries on PATH:
pnpm run test:e2e
```

CI runs the same sequence (see `.github/workflows/ci.yml` and `e2e.yml`). Its e2e job downloads the pinned release binary or builds the immutable source candidate, then runs `test:e2e`. This creates a fresh local cluster, waits for readiness, runs SDK live tests, and stops the server. Set `OMNIGRAPH_BIN` and `OMNIGRAPH_SERVER_BIN` to select explicit binaries; failed runs retain their fixture/log directory for diagnosis.

## License

MIT
