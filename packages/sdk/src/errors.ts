import type { ErrorCode, ErrorOutput, ManifestConflict, MergeConflict } from './types';

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

export class ConflictError extends OmnigraphError {
  readonly mergeConflicts?: MergeConflict[];
  /**
   * Set when the conflict is a publisher OCC rejection: the caller's pre-write
   * view of `tableKey` was at `expected`, but the manifest is now at `actual`.
   * Refresh and retry.
   */
  readonly manifestConflict?: ManifestConflict;

  constructor(ctx: OmnigraphErrorContext) {
    super(ctx);
    const body = ctx.body as ErrorOutput | undefined;
    this.mergeConflicts = body?.mergeConflicts;
    this.manifestConflict = body?.manifestConflict ?? undefined;
  }
}

export class TooManyRequestsError extends OmnigraphError {}
export class InternalServerError extends OmnigraphError {}
export class NetworkError extends OmnigraphError {}

const codeToClass: Record<ErrorCode, new (ctx: OmnigraphErrorContext) => OmnigraphError> = {
  bad_request: BadRequestError,
  unauthorized: UnauthorizedError,
  forbidden: ForbiddenError,
  not_found: NotFoundError,
  conflict: ConflictError,
  too_many_requests: TooManyRequestsError,
  internal: InternalServerError,
};

const statusToClass: Record<number, new (ctx: OmnigraphErrorContext) => OmnigraphError> = {
  400: BadRequestError,
  401: UnauthorizedError,
  403: ForbiddenError,
  404: NotFoundError,
  409: ConflictError,
  429: TooManyRequestsError,
  500: InternalServerError,
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
