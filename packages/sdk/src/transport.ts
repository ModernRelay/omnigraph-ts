import { camelToSnake, snakeToCamel } from './case';
import { ConfigurationError, fromResponse, NetworkError } from './errors';

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
   * management paths (`/healthz`, `/graphs`) are exempt.
   *
   * Required when targeting omnigraph-server 0.7.0+ (cluster-only): a
   * graph-scoped request issued without a `graphId` throws
   * {@link ConfigurationError} before hitting the network.
   */
  graphId?: string;
}

// Paths that are flat management endpoints in every server mode. They must
// never be rewritten under a `graphId` prefix, even when one is configured.
//   - `/healthz` is unauthenticated and graph-independent.
//   - `/graphs`  is the registry endpoint that lists graphs themselves.
const FLAT_PATHS: ReadonlySet<string> = new Set(['/healthz', '/graphs']);

export interface RequestOptions {
  headers?: Record<string, string>;
  /** Blob descriptors must not be automatically followed to external origins. */
  redirect?: RequestRedirect;
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
}

export class Transport {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: FetchLike;
  private readonly graphId?: string;

  constructor(opts: TransportOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.graphId = opts.graphId;
  }

  /**
   * Issue a JSON request and parse the response as `T`.
   *
   * Empty-body contract: if the server returns 204, an empty body, or
   * `Content-Length: 0`, this resolves to `undefined as T`. No current
   * Omnigraph endpoint behaves that way, so resource methods that type
   * their return as `Promise<X>` are honoured. If a future endpoint adopts
   * 204, those resource signatures must change to `Promise<X | undefined>`.
   */
  async request<T = unknown>(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const response = await this.send(method, path, opts);
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return undefined as T;
    }
    const text = await response.text();
    if (!text) return undefined as T;
    const parsed = JSON.parse(text);
    return snakeToCamel<T>(parsed, { opaqueKeys: opts.opaqueResponseKeys });
  }

  async stream(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
    return this.send(method, path, opts);
  }

  private async send(
    method: string,
    path: string,
    opts: RequestOptions,
  ): Promise<Response> {
    // Cluster-only servers (0.7.0+) serve every graph-scoped operation under
    // `/graphs/{graphId}/…`. Refuse a graph-scoped call without a configured
    // graphId here, with an actionable message, instead of letting it hit a
    // non-existent flat route and surface as an opaque 404.
    if (!this.graphId && !FLAT_PATHS.has(path)) {
      throw new ConfigurationError({
        status: 0,
        message:
          `graphId is required for graph-scoped operations on omnigraph-server 0.7.0+ ` +
          `(attempted ${method} ${path}). Pass { graphId } to new Omnigraph(...) or use ` +
          `og.graph(id). Only health() and graphs.list() work without one.`,
        request: { method, url: this.baseUrl + path },
      });
    }
    const url = this.buildUrl(path, opts.query);
    const headers = new Headers(opts.headers);
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json, application/x-ndjson');
    let bodyInit: BodyInit | undefined;
    if (opts.rawBody !== undefined) {
      bodyInit = opts.rawBody.content;
      headers.set('Content-Type', opts.rawBody.contentType);
    } else if (opts.body !== undefined) {
      bodyInit = JSON.stringify(
        camelToSnake(opts.body, { opaqueKeys: opts.opaqueBodyKeys }),
      );
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    }
    const init: RequestInit = {
      method,
      headers,
      body: bodyInit,
      signal: opts.signal,
      redirect: opts.redirect,
    };
    const requestMeta = { method, url };
    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      throw new NetworkError({
        status: 0,
        message: e instanceof Error ? e.message : String(e),
        request: requestMeta,
      });
    }
    if (!response.ok && !opts.acceptedStatuses?.includes(response.status)) {
      const requestId = response.headers.get('X-Request-Id') ?? undefined;
      const text = await response.text().catch(() => '');
      let body: unknown;
      try {
        body = text ? snakeToCamel(JSON.parse(text)) : undefined;
      } catch {
        body = text || undefined;
      }
      throw fromResponse({
        status: response.status,
        body,
        requestId,
        request: requestMeta,
        response,
      });
    }
    return response;
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    // Resource methods all pass leading-slash paths; this assertion catches
    // any future caller that forgets and would otherwise produce
    // `http://hostbranches` from `http://host` + `branches`.
    if (!path.startsWith('/')) {
      throw new Error(`Transport path must start with '/': got ${JSON.stringify(path)}`);
    }
    // Rewrite graph-scoped paths under the configured `graphId`. Flat paths
    // (`/healthz`, `/graphs`) are exempt: prefixing them would break health
    // probes and the graph-registry endpoint that returns the prefix list.
    const resolvedPath =
      this.graphId && !FLAT_PATHS.has(path)
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
