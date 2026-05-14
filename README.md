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
├── spec/openapi.json            # committed copy of upstream OpenAPI at the pinned tag
├── scripts/                     # spec sync, drift check, version-stamp generator
├── packages/
│   ├── sdk/                     # @modernrelay/omnigraph
│   └── mcp/                     # @modernrelay/omnigraph-mcp
└── .github/workflows/           # ci (build/typecheck/test/coverage), e2e (live server), release
```

## Server-version pin

The SDK is built against a specific `omnigraph-server` release. The pin lives in **`package.json#omnigraph.serverVersion`** at the repo root and is the single source of truth — `scripts/sync-spec.ts` reads it to fetch the matching OpenAPI spec, and `scripts/gen-version.ts` writes it into `packages/sdk/src/version.gen.ts` so consumers can `import { SERVER_VERSION } from '@modernrelay/omnigraph'`.

`@modernrelay/omnigraph@X.Y.Z` is generated from `omnigraph-server@X.Y.Z` and is expected to work against any `>=X.Y.0, <X.(Y+1).0`. CI enforces drift in two ways: a structural check that the bundled spec matches the upstream tag exactly, and an end-to-end suite that runs against a live `omnigraph-server` of the pinned release.

## Workflow when omnigraph cuts a new release

1. Bump `package.json#omnigraph.serverVersion` to the new tag (e.g., `0.4.0`).
2. `pnpm run sync-spec` — fetches the matching `openapi.json` into `spec/`.
3. `pnpm run generate` — regenerates `packages/sdk/src/generated/` and `packages/sdk/src/version.gen.ts`.
4. Commit `spec/openapi.json`, `packages/sdk/src/generated/`, `packages/sdk/src/version.gen.ts`, and the bumped `package.json`. The PR shows the full upstream change.
5. Bump `packages/sdk/package.json#version` (and `packages/mcp/package.json#version`) to match.
6. Tag `vX.Y.Z`. `release.yml` publishes both packages to npm.

## Local dev

```sh
pnpm install
pnpm run check-drift     # asserts spec matches the pinned server tag
pnpm run generate        # regenerates types + version stamp
pnpm run check-coverage  # asserts every spec op has an SDK binding
pnpm run build           # builds all workspace packages (SDK first, then MCP)
pnpm run typecheck       # runs after build so workspace types resolve
pnpm run test            # mocked unit tests across all packages

# Live e2e against a real server (requires omnigraph-server v$(jq -r .omnigraph.serverVersion package.json) running):
OMNIGRAPH_E2E=1 OMNIGRAPH_BASE_URL=http://127.0.0.1:8080 OMNIGRAPH_TOKEN=$TOKEN pnpm --filter @modernrelay/omnigraph run test
```

CI runs the same sequence (see `.github/workflows/ci.yml` and `e2e.yml`) and downloads the pinned `omnigraph-server` release binary for the e2e job.

## License

MIT
