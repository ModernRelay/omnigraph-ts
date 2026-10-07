import { camelToSnake, snakeToCamel } from './case';
import {
  ApiContractError,
  ConfigurationError,
  fromResponse,
  NetworkError,
  OmnigraphError,
} from './errors';
import { HTTP_API_CONTRACT, HTTP_API_CONTRACT_HEADER } from './version.gen';

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface TransportOptions {
  baseUrl: string;
  token?: string;
  fetch?: FetchLike;
  /**
   * Cluster graph id. All graph-scoped paths are rewritten to
   * `/graphs/${encodeURIComponent(graphId)}${path}` before being sent. Flat
   * management paths are exempt. A graph-scoped call without graphId throws
   * ConfigurationError before any request is sent.
   */
  graphId?: string;
}

// Public probes and metadata never receive the bearer credential.
const PUBLIC_PATHS = new Set([
  '/healthz',
  '/readyz',
  '/.well-known/oauth-protected-resource',
]);
function isRootPath(path: string): boolean {
  return (
    PUBLIC_PATHS.has(path) ||
    path === '/graphs' ||
    path === '/graphs/discovery' ||
    path.startsWith('/cluster/')
  );
}
function canWrite(method: string, path: string): boolean {
  return (
    !['GET', 'HEAD'].includes(method) &&
    !['/query', '/export', '/changes/baseline', '/cluster/plan'].includes(path)
  );
}

export interface RequestOptions {
  headers?: Record<string, string>;
  /** Explicit non-2xx successes (Blob 302 descriptors and 304 cache hits). */
  acceptedStatuses?: readonly number[];
  body?: unknown;
  /**
   * Raw request body sent verbatim with the given Content-Type, bypassing
   * the JSON + camelCase-to-snake_case pipeline. For non-JSON payloads such
   * as NDJSON (`POST /load/ndjson`). Mutually exclusive with `body`.
   */
  rawBody?: { content: string; contentType: string };
  query?: Record<string, string | string[] | undefined | null>;
  signal?: AbortSignal;
  /**
   * Top-level body keys whose values should be passed through verbatim
   * instead of having their nested keys camelCase-to-snake_case converted.
   * For free-form maps such as GQ `params`, where caller-controlled names
   * (e.g. `$userId`) must survive the boundary unchanged.
   */
  opaqueBodyKeys?: ReadonlySet<string>;
  /**
   * Top-level response keys whose values should be passed through verbatim
   * instead of having their nested keys snake_case-to-camelCase converted.
   * For free-form maps such as GQ `rows` and `columns`, whose key/value
   * shapes are user-schema-controlled.
   */
  opaqueResponseKeys?: ReadonlySet<string>;
  /** The endpoint returns an opaque JSON document, not an SDK DTO. */
  opaqueResponse?: boolean;
}

export class Transport {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: FetchLike;
  private readonly graphId?: string;

  constructor(opts: TransportOptions) {
    let root: URL;
    try {
      root = new URL(opts.baseUrl);
    } catch {
      throw new ConfigurationError({
        status: 0,
        message: 'baseUrl must be an absolute HTTP(S) server root',
        request: { method: 'HEAD', url: '<invalid-server-root>' },
      });
    }
    if (
      !['http:', 'https:'].includes(root.protocol) ||
      root.username ||
      root.password ||
      root.search ||
      root.hash
    ) {
      throw new ConfigurationError({
        status: 0,
        message:
          'baseUrl must be an HTTP(S) server root without credentials, query, or fragment',
        request: { method: 'HEAD', url: root.origin },
      });
    }
    this.baseUrl = root.toString().replace(/\/+$/, '');
    this.token = opts.token;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.graphId = opts.graphId;
  }

  /** Issue a JSON request; incomplete or invalid JSON never acknowledges a write. */
  async request<T = unknown>(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const response = await this.send(method, path, opts);
    try {
      const text = await response.text();
      if (!text) throw new Error('Missing JSON response body');
      const parsed = JSON.parse(text);
      return opts.opaqueResponse
        ? (parsed as T)
        : snakeToCamel<T>(parsed, { opaqueKeys: opts.opaqueResponseKeys });
    } catch {
      throw new NetworkError({
        status: response.status,
        message:
          'Response body was interrupted or invalid; do not automatically repeat writes',
        request: { method, url: this.buildUrl(path, opts.query) },
        requestDispatched: true,
        outcomeUnknown: canWrite(method, path),
      });
    }
  }

  async stream(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<Response> {
    return this.send(method, path, opts);
  }

  private async send(
    method: string,
    path: string,
    opts: RequestOptions,
  ): Promise<Response> {
    if (!this.graphId && !isRootPath(path)) {
      throw new ConfigurationError({
        status: 0,
        message:
          `graphId is required for graph-scoped operations ` +
          `(attempted ${method} ${path}). Pass { graphId } to new Omnigraph(...) or use ` +
          `og.graph(id). Cluster, graph discovery, and public probe operations need no graphId.`,
        request: { method, url: this.baseUrl + path },
      });
    }
    const url = this.buildUrl(path, opts.query);
    if (opts.body !== undefined && opts.rawBody !== undefined)
      throw new ConfigurationError({
        status: 0,
        message: 'body and rawBody are mutually exclusive',
        request: { method, url },
      });
    if (!PUBLIC_PATHS.has(path)) await this.discover(opts.signal);
    opts.signal?.throwIfAborted();
    const headers = new Headers(opts.headers);
    headers.set(HTTP_API_CONTRACT_HEADER, HTTP_API_CONTRACT);
    if (this.token && !PUBLIC_PATHS.has(path))
      headers.set('Authorization', `Bearer ${this.token}`);
    if (!headers.has('Accept'))
      headers.set('Accept', 'application/json, application/x-ndjson');
    let bodyInit: BodyInit | undefined;
    if (opts.rawBody !== undefined) {
      bodyInit = opts.rawBody.content;
      headers.set('Content-Type', opts.rawBody.contentType);
    } else if (opts.body !== undefined) {
      bodyInit = JSON.stringify(
        camelToSnake(opts.body, { opaqueKeys: opts.opaqueBodyKeys }),
      );
      if (!headers.has('Content-Type'))
        headers.set('Content-Type', 'application/json');
    }
    const init: RequestInit = {
      method,
      headers,
      body: bodyInit,
      signal: opts.signal,
      redirect: 'manual',
    };
    const requestMeta = { method, url };
    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (e) {
      if (
        !canWrite(method, path) &&
        e instanceof Error &&
        e.name === 'AbortError'
      )
        throw e;
      throw new NetworkError({
        status: 0,
        message:
          e instanceof Error && e.name === 'AbortError'
            ? 'Request cancelled after dispatch; reconcile writes before retrying'
            : 'HTTP transport failed after dispatch; reconcile writes before retrying',
        request: requestMeta,
        requestDispatched: true,
        outcomeUnknown: canWrite(method, path),
      });
    }
    if (
      path !== '/.well-known/oauth-protected-resource' &&
      response.headers.get(HTTP_API_CONTRACT_HEADER) !== HTTP_API_CONTRACT
    ) {
      await response.body?.cancel().catch(() => {});
      throw new ApiContractError({
        status: response.status,
        code: 'api_contract_mismatch',
        message: `Response must carry exactly one ${HTTP_API_CONTRACT_HEADER}: ${HTTP_API_CONTRACT}; reconcile writes before retrying`,
        request: requestMeta,
        requestDispatched: true,
        outcomeUnknown: canWrite(method, path),
      });
    }
    if (!response.ok && !opts.acceptedStatuses?.includes(response.status)) {
      const requestId = response.headers.get('X-Request-Id') ?? undefined;
      let body: unknown;
      let validErrorBody = false;
      try {
        const text = await response.text();
        body = snakeToCamel(JSON.parse(text));
        validErrorBody =
          body !== null &&
          typeof body === 'object' &&
          typeof (body as { error?: unknown }).error === 'string';
      } catch {
        // A status alone does not prove a write failed when its response is
        // truncated or malformed. Preserve that uncertainty below.
      }
      throw fromResponse({
        status: response.status,
        body,
        requestId,
        request: requestMeta,
        response,
        outcomeUnknown:
          canWrite(method, path) && (!validErrorBody || response.status >= 500),
      });
    }
    return response;
  }

  invalidResponse(
    method: string,
    path: string,
    message: string,
  ): ApiContractError {
    return new ApiContractError({
      status: 200,
      message: `${message}; effects are unknown; reconcile before retrying`,
      request: { method, url: this.buildUrl(path) },
      requestDispatched: true,
      outcomeUnknown: canWrite(method, path),
    });
  }

  private async discover(signal?: AbortSignal): Promise<void> {
    const bounded = AbortSignal.timeout(5_000);
    const discoverySignal = signal
      ? AbortSignal.any([signal, bounded])
      : bounded;
    try {
      const response = await this.stream('HEAD', '/healthz', {
        signal: discoverySignal,
      });
      await response.body?.cancel();
    } catch (cause) {
      const status = cause instanceof OmnigraphError ? cause.status : 0;
      const reason = discoverySignal.aborted
        ? 'cancelled or timed out'
        : 'failed (connection, TLS, status, or API contract)';
      throw new ApiContractError({
        status,
        code: 'api_contract_mismatch',
        message: `Server discovery ${reason}; expected ${HTTP_API_CONTRACT_HEADER}: ${HTTP_API_CONTRACT}; data request was not sent`,
        request: { method: 'HEAD', url: this.baseUrl + '/healthz' },
        requestDispatched: false,
        outcomeUnknown: false,
      });
    }
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    // Resource methods all pass leading-slash paths; this assertion catches
    // any future caller that forgets and would otherwise produce
    // `http://hostbranches` from `http://host` + `branches`.
    if (!path.startsWith('/')) {
      throw new Error(
        `Transport path must start with '/': got ${JSON.stringify(path)}`,
      );
    }
    // Rewrite graph-scoped paths under the configured `graphId`. Flat paths
    // (`/healthz`, `/graphs`) are exempt: prefixing them would break health
    // probes and the graph-registry endpoint that returns the prefix list.
    const resolvedPath =
      this.graphId && !isRootPath(path)
        ? `/graphs/${encodeURIComponent(this.graphId)}${path}`
        : path;
    const url = new URL(this.baseUrl + resolvedPath);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) {
          for (const item of v) url.searchParams.append(k, item);
        } else {
          url.searchParams.append(k, v);
        }
      }
    }
    return url.toString();
  }
}
