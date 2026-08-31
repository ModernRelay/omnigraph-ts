import type { ErrorCode, ErrorOutput } from './types';

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
  get mergeConflicts() {
    return (this.body as ErrorOutput | undefined)?.mergeConflicts;
  }
  get publishedDatasetVersionConflict() {
    return (
      (this.body as ErrorOutput | undefined)?.publishedDatasetVersionConflict ??
      undefined
    );
  }
  get readSetConflict() {
    return (this.body as ErrorOutput | undefined)?.readSetConflict ?? undefined;
  }
  get keyConflict() {
    return (this.body as ErrorOutput | undefined)?.keyConflict ?? undefined;
  }
  get changeDiffRefusal() {
    return (
      (this.body as ErrorOutput | undefined)?.changeDiffRefusal ?? undefined
    );
  }
  /** This conflict needs operator maintenance, not a retry. */
  get fullTextIndexRebuildRequired() {
    return (
      (this.body as ErrorOutput | undefined)?.fullTextIndexRebuildRequired ??
      undefined
    );
  }
}

/** Retained change history is unavailable; recover through a baseline. */
export class GoneError extends OmnigraphError {
  get changeFeedGap() {
    return (this.body as ErrorOutput | undefined)?.changeFeedGap ?? undefined;
  }
}
/** Stale graph-head precondition (or a failed Blob If-Match). */
export class PreconditionFailedError extends OmnigraphError {
  get preconditionFailure() {
    return (
      (this.body as ErrorOutput | undefined)?.preconditionFailure ?? undefined
    );
  }
}
export class PayloadTooLargeError extends OmnigraphError {
  get resourceLimit() {
    return (this.body as ErrorOutput | undefined)?.resourceLimit ?? undefined;
  }
}
export class RangeNotSatisfiableError extends OmnigraphError {
  get blobRange() {
    return (this.body as ErrorOutput | undefined)?.blobRange ?? undefined;
  }
}
export class FailedDependencyError extends OmnigraphError {
  get externalBlobSource() {
    return (
      (this.body as ErrorOutput | undefined)?.externalBlobSource ?? undefined
    );
  }
}
export class ServiceUnavailableError extends OmnigraphError {
  get recoveryRequired() {
    return (
      (this.body as ErrorOutput | undefined)?.recoveryRequired ?? undefined
    );
  }
}

export class TooManyRequestsError extends OmnigraphError {}
export class InternalServerError extends OmnigraphError {}
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

const codeToClass: Record<
  ErrorCode,
  new (ctx: OmnigraphErrorContext) => OmnigraphError
> = {
  bad_request: BadRequestError,
  unauthorized: UnauthorizedError,
  forbidden: ForbiddenError,
  not_found: NotFoundError,
  method_not_allowed: MethodNotAllowedError,
  conflict: ConflictError,
  too_many_requests: TooManyRequestsError,
  internal: InternalServerError,
};

const statusToClass: Record<
  number,
  new (ctx: OmnigraphErrorContext) => OmnigraphError
> = {
  400: BadRequestError,
  401: UnauthorizedError,
  403: ForbiddenError,
  404: NotFoundError,
  405: MethodNotAllowedError,
  409: ConflictError,
  410: GoneError,
  412: PreconditionFailedError,
  413: PayloadTooLargeError,
  416: RangeNotSatisfiableError,
  424: FailedDependencyError,
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
  // Several v0.10 statuses deliberately retain an older broad code (e.g.
  // 413/416 use bad_request and Blob 412 uses conflict). Status is specific.
  const Ctor =
    statusToClass[args.status] ??
    (code && Object.hasOwn(codeToClass, code)
      ? codeToClass[code]
      : undefined) ??
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
