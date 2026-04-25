# @modernrelay/omnigraph

TypeScript SDK for the [Omnigraph](https://github.com/ModernRelay/omnigraph) HTTP API.

Generated from the upstream OpenAPI 3.1 spec via
[`@hey-api/openapi-ts`](https://heyapi.dev). Versions track the
omnigraph-server release they were generated from — `@modernrelay/omnigraph@X.Y.Z`
matches omnigraph-server `X.Y.Z`.

## Install

```sh
npm install @modernrelay/omnigraph
# or
pnpm add @modernrelay/omnigraph
```

## Usage

```ts
import { createOmnigraphClient, listBranches, read } from '@modernrelay/omnigraph';

createOmnigraphClient({
  baseUrl: 'http://localhost:8080',
  token: process.env.OMNIGRAPH_TOKEN,
});

const { data, error } = await listBranches();
if (error) throw error;
console.log(data.branches);

const result = await read({
  body: {
    query_source: 'query adults() { match { $p: Person  $p.age > 30 } return { $p.name } }',
  },
});
```

## What's exported

- `createOmnigraphClient(options)` — configure the shared client.
- One function per API operation (camelCase, derived from `operationId` in the spec).
- All request/response types.

The shape comes from hey-api's defaults; see the
[hey-api docs](https://heyapi.dev) for client interceptors, request/response
hooks, and per-call config.

## Operation naming

Operations track the OpenAPI `operationId` in camelCase. One name collides
with a TypeScript reserved word: `export` becomes `export_` (note the
trailing underscore). All other operations use their natural name.

## Multiple servers in one process

`createOmnigraphClient()` configures a shared singleton. If you need to
talk to multiple servers from the same process, use hey-api's per-call
override:

```ts
import { createClient } from '@hey-api/client-fetch';
import { listBranches } from '@modernrelay/omnigraph';

const eu = createClient({ baseUrl: 'https://eu.example' });
const us = createClient({ baseUrl: 'https://us.example' });

await listBranches({ client: eu });
await listBranches({ client: us });
```


## License

MIT
