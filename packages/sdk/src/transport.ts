import { camelToSnake, snakeToCamel } from './case';
import { fromResponse, NetworkError } from './errors';

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface TransportOptions {
  baseUrl: string;
  token?: string;
  fetch?: FetchLike;
}

export interface RequestOptions {
  body?: unknown;
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

  constructor(opts: TransportOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

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
    const url = this.buildUrl(path, opts.query);
    const headers = new Headers();
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
    headers.set('Accept', 'application/json, application/x-ndjson');
    let bodyInit: BodyInit | undefined;
    if (opts.body !== undefined) {
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
    if (!response.ok) {
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
    const url = new URL(this.baseUrl + path);
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
