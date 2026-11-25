import type { Transport } from '../transport';
import type { CallOptions } from '../internals';
import type { OperationResult, OperationState } from '../types';

/**
 * The record's `outcome.moreDatasets` is keyed by `outcome` or
 * `outcome:reason` tokens (`deferred:gate_hold_limit`), not field names; keep
 * them verbatim.
 */
const OPAQUE_RESPONSE = new Set(['moreDatasets']);

const TERMINAL: ReadonlySet<string> = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
  'unsettled',
]);

/** Whether an operation state is final: nothing will change the record again. */
export function isTerminal(state: OperationState): boolean {
  return TERMINAL.has(state);
}

/**
 * Whether a reply is a receipt for `operationId`: a lookup envelope whose
 * `found` record names that id, or an `unknown` lookup where the route can
 * answer one (lookup and cancel; a submission always identifies its record).
 * One check serves every operation route.
 */
export function validOperationReceipt(
  reply: unknown,
  operationId: string,
  unknownAllowed: boolean,
): reply is OperationResult {
  if (!reply || typeof reply !== 'object') return false;
  const { lookup, inProgress, operation } = reply as Record<string, unknown>;
  if (typeof inProgress !== 'boolean') return false;
  if (lookup === 'unknown') return unknownAllowed && operation == null;
  if (lookup !== 'found' || !operation || typeof operation !== 'object')
    return false;
  const record = operation as Record<string, unknown>;
  return (
    record.operationId === operationId &&
    typeof record.state === 'string' &&
    !!record.outcome &&
    typeof record.outcome === 'object'
  );
}

export interface StartOptimizeInput {
  /**
   * The canonical ULID that names this run; mint it with `newOperationId()`
   * and keep it before submitting. After a lost response, look the id up
   * with `get()`; never resubmit under a new id.
   */
  operationId: string;
  /** Only these datasets, by type key (`node:Person`, `edge:Knows`), in this order. */
  datasets?: string[];
  /** How long writers to `main` wait at most, within the server's ceiling. */
  maxGateHoldMs?: number;
}

export interface WaitOptions {
  /** Delay between lookups. Defaults to 1000 ms. */
  intervalMs?: number;
  signal?: AbortSignal;
  ifActor?: string;
}

/**
 * Recorded operations (omnigraph-server 0.16+): work a cluster server runs on
 * a graph's `main` and records by a caller-chosen id. The server enables the
 * routes with `OMNIGRAPH_OPERATION_ROUTES=true`; each needs the `maintain`
 * action on `main`.
 */
export class OperationsResource {
  constructor(private readonly t: Transport) {}

  /**
   * Submit a recorded `optimize` run on `main`. Resolves with the record once
   * it is durably accepted (HTTP 202, `inProgress` or a non-terminal state)
   * or terminal (HTTP 200). While the record still holds the id, the same
   * id with the same request (same graph lifetime, branch, request and
   * principal: the request digest) returns that record without running
   * again; once the id is evicted (the record keeps the 32 newest terminal
   * operations) it is refused as expired. The same id with a different
   * request is a `ConflictError`, and another active operation a
   * `TooManyRequestsError` with `retryAfter`.
   */
  async optimize(
    input: StartOptimizeInput,
    opts: CallOptions = {},
  ): Promise<OperationResult> {
    const reply = await this.t.request<unknown>('POST', '/operations/optimize', {
      body: input,
      signal: opts.signal,
      ifActor: opts.ifActor,
      opaqueResponseKeys: OPAQUE_RESPONSE,
    });
    return this.receipt(
      reply,
      'POST',
      '/operations/optimize',
      input.operationId,
      false,
    );
  }

  /**
   * Look an operation up by its id, whatever its kind. `lookup: 'unknown'`
   * means the record does not hold the id; it does not prove the operation
   * never ran, and it is never a reason to resubmit under the same id. A
   * lookup may settle a publication in doubt, so it can answer 500
   * `outcome_unknown`; retrying the lookup is safe.
   */
  async get(
    operationId: string,
    opts: CallOptions = {},
  ): Promise<OperationResult> {
    const path = `/operations/${encodeURIComponent(operationId)}`;
    const reply = await this.t.request<unknown>(
      'GET',
      `/operations/${encodeURIComponent(operationId)}`,
      {
        signal: opts.signal,
        ifActor: opts.ifActor,
        opaqueResponseKeys: OPAQUE_RESPONSE,
      },
    );
    return this.receipt(reply, 'GET', path, operationId, true);
  }

  /**
   * Ask an operation to stop at its next safe boundary. Cancellation is best
   * effort: a terminal, unknown or `publishing` operation is returned
   * unchanged and no cancellation is requested for it. An `accepted` or
   * `running` one is asked to stop; it ends `cancelled`, or `succeeded`,
   * usually with a `reason` saying the cancellation arrived late.
   * omnigraph-server 0.16.0 gives no reason when the cancel lands as the run
   * finishes, so read the terminal record (`wait`) to know whether it was
   * cancelled.
   */
  async cancel(
    operationId: string,
    opts: CallOptions = {},
  ): Promise<OperationResult> {
    const path = `/operations/${encodeURIComponent(operationId)}/cancel`;
    const reply = await this.t.request<unknown>(
      'POST',
      `/operations/${encodeURIComponent(operationId)}/cancel`,
      {
        signal: opts.signal,
        ifActor: opts.ifActor,
        opaqueResponseKeys: OPAQUE_RESPONSE,
      },
    );
    return this.receipt(reply, 'POST', path, operationId, true);
  }

  /**
   * The one receipt check every operation route applies. An invalid reply is
   * an ApiContractError: outcome unknown after a submission or cancellation,
   * which may have written, and certain after a lookup.
   */
  private receipt(
    reply: unknown,
    method: 'GET' | 'POST',
    path: string,
    operationId: string,
    unknownAllowed: boolean,
  ): OperationResult {
    if (!validOperationReceipt(reply, operationId, unknownAllowed))
      throw this.t.invalidResponse(
        method,
        path,
        `Invalid receipt for operation ${operationId}`,
      );
    return reply;
  }

  /**
   * Look the operation up every `intervalMs` until its record is terminal or
   * the lookup answers `unknown`, and return that answer. Only the read route
   * is called; a failed lookup rejects at once and is never retried, though
   * retrying a lookup is always safe, `outcome_unknown` included. Bound the
   * wait with `signal` (for example `AbortSignal.timeout(...)`); stopping the
   * wait does not stop the operation, which keeps running on the server (use
   * `cancel`).
   */
  async wait(
    operationId: string,
    opts: WaitOptions = {},
  ): Promise<OperationResult> {
    const intervalMs = opts.intervalMs ?? 1_000;
    for (;;) {
      const result = await this.get(operationId, {
        signal: opts.signal,
        ifActor: opts.ifActor,
      });
      if (
        result.lookup === 'unknown' ||
        (result.operation && isTerminal(result.operation.state))
      )
        return result;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(done, intervalMs);
        function done() {
          opts.signal?.removeEventListener('abort', aborted);
          resolve();
        }
        function aborted() {
          clearTimeout(timer);
          reject(opts.signal!.reason);
        }
        if (opts.signal?.aborted) aborted();
        else opts.signal?.addEventListener('abort', aborted, { once: true });
      });
    }
  }
}
