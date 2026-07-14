import type {
  ErrorCode,
  ErrorOutput,
  ManifestConflict,
  MergeConflict,
  ReadSetConflict,
  RecoveryRequired,
} from './types';

export interface OmnigraphErrorContext {
  status: number;
  message: string;
  code?: ErrorCode | null;
  requestId?: string;
  request: { method: string; url: string };
  response?: Response;
  body?: ErrorOutput | unknown;
}

export abstract class OmnigraphError extends Error {
  readonly status: number;
  readonly code?: ErrorCode | null;
  readonly requestId?: string;
  readonly request: { method: string; url: string };
  readonly response?: Response;
  readonly body?: unknown;

  constructor(ctx: OmnigraphErrorContext) {
    super(ctx.message);
    this.name = new.target.name;
    this.status = ctx.status;
    this.code = ctx.code;
    this.requestId = ctx.requestId;
    this.request = ctx.request;
    this.response = ctx.response;
    this.body = ctx.body;
  }
}

export class BadRequestError extends OmnigraphError {}
export class UnauthorizedError extends OmnigraphError {}
export class ForbiddenError extends OmnigraphError {}
export class NotFoundError extends OmnigraphError {}
export class MethodNotAllowedError extends OmnigraphError {}

export class ConflictError extends OmnigraphError {
  readonly mergeConflicts?: MergeConflict[];
  /**
   * Set when the conflict is a publisher OCC rejection: the caller's pre-write
   * view of `tableKey` was at `expected`, but the manifest is now at `actual`.
   * Refresh and retry.
   */
  readonly manifestConflict?: ManifestConflict;
  /**
   * Set when the conflict is a coarse read-set rejection: `member` (a branch
   * identifier, graph head, or schema identity the write was prepared
   * against) changed between preparation and commit. Refresh and retry.
   */
  readonly readSetConflict?: ReadSetConflict;

  constructor(ctx: OmnigraphErrorContext) {
    super(ctx);
    const body = ctx.body as ErrorOutput | undefined;
    this.mergeConflicts = body?.mergeConflicts;
    this.manifestConflict = body?.manifestConflict ?? undefined;
    this.readSetConflict = body?.readSetConflict ?? undefined;
  }
}

export class TooManyRequestsError extends OmnigraphError {}
export class InternalServerError extends OmnigraphError {}

/**
 * 503 with a `recovery_required` body: a durable recovery intent overlaps the
 * requested operation and must be resolved (typically by the server's next
 * write or a read-write reopen) before a retry can succeed. Carries the
 * blocking recovery `operationId`. The body deliberately has no `code` —
 * `ErrorCode` is a closed wire contract, so the meaning rides in the
 * structured field.
 */
export class ServiceUnavailableError extends OmnigraphError {
  readonly recoveryRequired?: RecoveryRequired;

  constructor(ctx: OmnigraphErrorContext) {
    super(ctx);
    const body = ctx.body as ErrorOutput | undefined;
    this.recoveryRequired = body?.recoveryRequired ?? undefined;
  }
}

export class NetworkError extends OmnigraphError {}

/**
 * Thrown client-side, before any request is sent, when the client is
 * misconfigured for the target server. As of omnigraph-server 0.7.0 the server
 * is cluster-only: every graph-scoped operation is served under
 * `/graphs/{graphId}/…`, so a `graphId` must be configured. Only `health()`
 * and `graphs.list()` are graph-independent and work without one.
 *
 * `status` is 0 (no HTTP exchange occurred), like {@link NetworkError}.
 */
export class ConfigurationError extends OmnigraphError {}

const codeToClass: Record<ErrorCode, new (ctx: OmnigraphErrorContext) => OmnigraphError> = {
  bad_request: BadRequestError,
  unauthorized: UnauthorizedError,
  forbidden: ForbiddenError,
  not_found: NotFoundError,
  method_not_allowed: MethodNotAllowedError,
  conflict: ConflictError,
  too_many_requests: TooManyRequestsError,
  internal: InternalServerError,
};

const statusToClass: Record<number, new (ctx: OmnigraphErrorContext) => OmnigraphError> = {
  400: BadRequestError,
  401: UnauthorizedError,
  403: ForbiddenError,
  404: NotFoundError,
  405: MethodNotAllowedError,
  409: ConflictError,
  429: TooManyRequestsError,
  500: InternalServerError,
  503: ServiceUnavailableError,
};

export function fromResponse(args: {
  status: number;
  body: unknown;
  requestId?: string;
  request: { method: string; url: string };
  response: Response;
}): OmnigraphError {
  const body = args.body as ErrorOutput | undefined;
  const code = body?.code ?? null;
  const message = body?.error ?? `HTTP ${args.status}`;
  const Ctor =
    (code ? codeToClass[code] : undefined) ??
    statusToClass[args.status] ??
    InternalServerError;
  return new Ctor({
    status: args.status,
    message,
    code,
    requestId: args.requestId,
    request: args.request,
    response: args.response,
    body: args.body,
  });
}
