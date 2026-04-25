# omnigraph-ts

Generated TypeScript SDK for the [Omnigraph](https://github.com/ModernRelay/omnigraph) HTTP API.

This repo is the published source for the npm package `@modernrelay/omnigraph`.

## Layout

This is a pnpm workspace scaffolded so additional packages (e.g., an MCP
server) can be added under `packages/` without restructuring.

```
.
├── spec/openapi.json            # committed copy of upstream spec at pinned tag
├── scripts/                     # spec sync + drift checks
├── packages/sdk/                # @modernrelay/omnigraph
└── .github/workflows/           # CI + release
```

## Workflow when omnigraph cuts a new release

1. Bump `OMNIGRAPH_VERSION` in `package.json` (root) to match the omnigraph release tag (e.g., `0.4.0`).
2. `pnpm run sync-spec` — fetches `openapi.json` from `https://raw.githubusercontent.com/ModernRelay/omnigraph/v$OMNIGRAPH_VERSION/openapi.json` into `spec/openapi.json`.
3. `pnpm run generate` — regenerates `packages/sdk/src/generated/`.
4. Commit both `spec/openapi.json` and `packages/sdk/src/generated/`. PR shows the full upstream change.
5. Bump `packages/sdk/package.json#version` to match `OMNIGRAPH_VERSION`. Tag `vX.Y.Z`.
6. `release.yml` publishes `@modernrelay/omnigraph@X.Y.Z` to npm.

## Version alignment

`@modernrelay/omnigraph@X.Y.Z` is generated from omnigraph-server `X.Y.Z` and
is expected to be compatible with omnigraph-server `>=X.Y.Z, <X.(Y+1).0`. CI
asserts the bundled spec matches the pinned upstream tag — drift fails the
build, so a published SDK is always faithful to a real server release.

## Local dev

```bash
pnpm install
pnpm run sync-spec       # fetch spec at pinned version
pnpm run generate        # generate SDK from spec
pnpm run typecheck
pnpm run build
```

## Usage

```ts
import { createOmnigraphClient, listBranches } from '@modernrelay/omnigraph';

const client = createOmnigraphClient({
  baseUrl: 'http://localhost:8080',
  token: process.env.OMNIGRAPH_TOKEN,
});

const { data, error } = await listBranches();
if (error) throw error;
console.log(data.branches);
```

## License

MIT
