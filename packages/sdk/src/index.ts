import { client } from './generated/client.gen';

export * from './generated';

export interface OmnigraphClientOptions {
  baseUrl: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Configure the SDK's shared HTTP client. Call once at application start.
 *
 * @example
 * ```ts
 * import { createOmnigraphClient, listBranches } from '@modernrelay/omnigraph';
 *
 * createOmnigraphClient({
 *   baseUrl: 'http://localhost:8080',
 *   token: process.env.OMNIGRAPH_TOKEN,
 * });
 *
 * const { data, error } = await listBranches();
 * ```
 */
export function createOmnigraphClient(options: OmnigraphClientOptions) {
  client.setConfig({
    baseUrl: options.baseUrl,
    headers: options.token
      ? { Authorization: `Bearer ${options.token}` }
      : undefined,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return client;
}
