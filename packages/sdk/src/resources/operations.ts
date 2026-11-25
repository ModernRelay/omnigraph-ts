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
   * or terminal (HTTP 200). Submitting the same id with the same request
   * returns the existing record without running again; the same id with a
   * different request is a `ConflictError`, and another active operation a
   * `TooManyRequestsError` with `retryAfter`.
   */
  optimize(
    input: StartOptimizeInput,
    opts: CallOptions = {},
  ): Promise<OperationResult> {
    return this.t.request('POST', '/operations/optimize', {
      body: input,
      signal: opts.signal,
      ifActor: opts.ifActor,
      opaqueResponseKeys: OPAQUE_RESPONSE,
    });
  }

  /**
   * Look an operation up by its id, whatever its kind. `lookup: 'unknown'`
   * means the record does not hold the id; it does not prove the operation
   * never ran, and it is never a reason to resubmit under the same id.
   */
  get(operationId: string, opts: CallOptions = {}): Promise<OperationResult> {
    return this.t.request(
      'GET',
      `/operations/${encodeURIComponent(operationId)}`,
      {
        signal: opts.signal,
        ifActor: opts.ifActor,
        opaqueResponseKeys: OPAQUE_RESPONSE,
      },
    );
  }

  /**
   * Ask an operation to stop at its next safe boundary. A terminal or unknown
   * operation is returned unchanged; a `publishing` one finishes its
   * publication and its record says the cancellation arrived late.
   */
  cancel(
    operationId: string,
    opts: CallOptions = {},
  ): Promise<OperationResult> {
    return this.t.request(
      'POST',
      `/operations/${encodeURIComponent(operationId)}/cancel`,
      {
        signal: opts.signal,
        ifActor: opts.ifActor,
        opaqueResponseKeys: OPAQUE_RESPONSE,
      },
    );
  }

  /**
   * Look the operation up every `intervalMs` until its record is terminal or
   * the lookup answers `unknown`, and return that answer. Only the read route
   * is called; a failed lookup rejects at once and is never retried. Bound
   * the wait with `signal` (for example `AbortSignal.timeout(...)`).
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
