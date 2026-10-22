import type { CallOptions } from '../internals';
import { ndjsonIterator } from '../stream';
import type { Transport } from '../transport';
import type {
  ChangeBaselineInput,
  ChangeBaselineRecord,
  ChangeFeed,
  ChangeOp,
  EntityKind,
} from '../types';

/** Filters and continuation for one bounded page of logical entity changes. */
export interface ChangeFilterInput {
  /** Opaque continuation for this result, not a durable feed cursor. */
  pageToken?: string;
  /** Maximum changes in this page. Server default and ceiling apply. */
  limit?: number;
  kind?: EntityKind[];
  /** Accepted-schema type names. */
  type?: string[];
  op?: ChangeOp[];
}

export interface ChangePageInput extends ChangeFilterInput {
  /** Request-scope session settings in GQ spelling (name=value), repeated as set. */
  set?: string[];
}

export interface PollChangesInput extends ChangePageInput {
  /** Branch to follow. Defaults to `main`. */
  branch?: string;
  /** Durable cursor from a terminal page; exclusive with start/pageToken. */
  cursor?: string;
  /** Defaults to `now`; exclusive with cursor/pageToken. */
  start?: 'now' | 'beginning' | `after:${string}`;
}

const OPAQUE_PROPERTIES = new Set(['properties']);
const OPAQUE_BASELINE_DATA = new Set(['data']);

export class ChangesResource {
  constructor(private readonly t: Transport) {}

  /**
   * Read one bounded feed page. Follow nextPageToken within the captured
   * poll; persist cursor only from its terminal page, atomically with the
   * applied blocks. Delivery is at least once. A 410 requires a new baseline.
   */
  poll(
    input: PollChangesInput = {},
    opts: CallOptions = {},
  ): Promise<ChangeFeed> {
    return this.t.request<ChangeFeed>('GET', '/changes', {
      query: {
        branch: input.branch,
        cursor: input.cursor,
        start: input.start,
        page_token: input.pageToken,
        limit: input.limit?.toString(),
        kind: input.kind,
        type: input.type,
        op: input.op,
        set: input.set,
      },
      signal: opts.signal,
      ifActor: opts.ifActor,
      opaqueResponseKeys: OPAQUE_PROPERTIES,
    });
  }

  /**
   * Stream a pinned node/edge snapshot followed by one final { baseline }
   * record. Entity records use the load/export NDJSON shape; data is opaque.
   * The terminal record is not an entity. An interrupted stream has no usable
   * cursor: install the complete snapshot durably before saving resumeCursor.
   * kind/type filter the snapshot; op filters only the subsequent feed.
   *
   * Iterate once; the request starts lazily. Breaking or aborting cancels it.
   */
  baseline(
    input: ChangeBaselineInput = {},
    opts: CallOptions = {},
  ): AsyncIterable<ChangeBaselineRecord> {
    const t = this.t;
    return {
      async *[Symbol.asyncIterator]() {
        const response = await t.stream('POST', '/changes/baseline', {
          body: input,
          signal: opts.signal,
          ifActor: opts.ifActor,
        });
        let terminal: ChangeBaselineRecord | undefined;
        for await (const record of ndjsonIterator<ChangeBaselineRecord>(
          response,
          {
            opaqueKeys: OPAQUE_BASELINE_DATA,
          },
        )) {
          if (terminal !== undefined) {
            throw new Error(
              'Change baseline has records after its terminal record',
            );
          }
          if (record && typeof record === 'object' && 'baseline' in record) {
            if (
              typeof record.baseline?.snapshotCommitId !== 'string' ||
              typeof record.baseline?.resumeCursor !== 'string'
            ) {
              throw new Error('Change baseline has an invalid terminal record');
            }
            terminal = record;
          } else {
            yield record;
          }
        }
        if (terminal === undefined) {
          throw new Error('Change baseline ended without a terminal record');
        }
        // Do not expose the resume cursor until the stream ended successfully.
        yield terminal;
      },
    };
  }
}
