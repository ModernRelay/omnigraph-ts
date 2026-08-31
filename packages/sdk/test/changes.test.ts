import { describe, expect, it } from 'vitest';
import Omnigraph, { ConfigurationError } from '../src';
import { stubFetch } from './helpers';

describe('changes resource', () => {
  it('poll sends the full repeated filter scope and preserves image property keys', async () => {
    const properties = {
      first_name: 'Ada',
      nested_value: { raw_key: 1, camelKey: 2 },
    };
    const { fetch, calls } = stubFetch({
      body: {
        blocks: [
          {
            cause: {
              graph_commit_id: 'c',
              authored_branch: 'feature',
              authored_at: 123,
            },
            changes: [
              {
                kind: 'node',
                type: { id: 'type-id', name: 'Person' },
                id: 'p',
                op: 'insert',
                after: { properties },
              },
            ],
          },
        ],
        next_page_token: 'continuation',
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const result = await og.changes.poll({
      branch: 'feature/a',
      cursor: 'cursor+/=',
      limit: 12,
      kind: ['node', 'edge'],
      type: ['Person', 'Knows'],
      op: ['insert', 'delete'],
    });
    expect(calls[0]?.method).toBe('GET');
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/graphs/g/changes');
    expect(url.searchParams.get('branch')).toBe('feature/a');
    expect(url.searchParams.get('cursor')).toBe('cursor+/=');
    expect(url.searchParams.get('limit')).toBe('12');
    expect(url.searchParams.getAll('kind')).toEqual(['node', 'edge']);
    expect(url.searchParams.getAll('type')).toEqual(['Person', 'Knows']);
    expect(url.searchParams.getAll('op')).toEqual(['insert', 'delete']);
    expect(result.blocks[0]?.cause.graphCommitId).toBe('c');
    expect(result.blocks[0]?.changes[0]?.after?.properties).toEqual(properties);
    expect(result.nextPageToken).toBe('continuation');
    expect(result.cursor).toBeUndefined();
  });

  it('poll supports start and page-token requests without inventing a durable cursor', async () => {
    const { fetch, calls } = stubFetch([
      { body: { blocks: [], next_page_token: 'page' } },
      { body: { blocks: [], cursor: 'durable', caught_up: true } },
      { body: { blocks: [], cursor: 'now', caught_up: true } },
    ]);
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const first = await og.changes.poll({ start: 'after:c' });
    const last = await og.changes.poll({ pageToken: first.nextPageToken! });
    await og.changes.poll();
    expect(calls[0]?.url).toBe('http://x/graphs/g/changes?start=after%3Ac');
    expect(calls[1]?.url).toBe('http://x/graphs/g/changes?page_token=page');
    expect(calls[2]?.url).toBe('http://x/graphs/g/changes');
    expect(first.cursor).toBeUndefined();
    expect(last.cursor).toBe('durable');
    expect(last.caughtUp).toBe(true);
  });

  it('poll surfaces retention gaps and never retries them', async () => {
    const { fetch, calls } = stubFetch({
      status: 410,
      body: {
        error: 'Required history was reclaimed',
        change_feed_gap: { first_unreadable_commit_id: 'old', cursor: 'saved' },
      },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    await expect(og.changes.poll({ cursor: 'saved' })).rejects.toMatchObject({
      status: 410,
      body: {
        changeFeedGap: { firstUnreadableCommitId: 'old', cursor: 'saved' },
      },
    });
    expect(calls).toHaveLength(1);
  });

  it('requires a graph before issuing a feed request', async () => {
    const { fetch, calls } = stubFetch({ body: {} });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    await expect(og.changes.poll()).rejects.toBeInstanceOf(ConfigurationError);
    expect(calls).toHaveLength(0);
  });
});

describe('change baseline stream', () => {
  it('streams nodes and edges with opaque data before the typed terminal handshake', async () => {
    const records = [
      {
        type: 'Person',
        data: { first_name: 'Ada', nested_value: { raw_key: 1 } },
      },
      { edge: 'Knows', from: 'a', to: 'b', data: { since_year: 2020 } },
      { baseline: { snapshot_commit_id: 'c', resume_cursor: 'resume' } },
    ];
    const { fetch, calls } = stubFetch({
      body: records.map((r) => JSON.stringify(r)).join('\n'),
      headers: { 'content-type': 'application/x-ndjson' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const stream = og.changes.baseline({
      branch: 'feature',
      kind: ['node', 'edge'],
      type: ['Person', 'Knows'],
      op: ['update'],
    });
    expect(calls).toHaveLength(0);
    const actual = [];
    for await (const record of stream) actual.push(record);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://x/graphs/g/changes/baseline');
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      branch: 'feature',
      kind: ['node', 'edge'],
      type: ['Person', 'Knows'],
      op: ['update'],
    });
    expect(actual).toEqual([
      records[0],
      records[1],
      { baseline: { snapshotCommitId: 'c', resumeCursor: 'resume' } },
    ]);
  });

  it.each([
    [
      'missing terminal',
      '{"type":"Person","data":{}}\n',
      'ended without a terminal',
    ],
    [
      'invalid terminal',
      '{"baseline":{"snapshot_commit_id":"c"}}\n',
      'invalid terminal',
    ],
    [
      'non-final terminal',
      '{"baseline":{"snapshot_commit_id":"c","resume_cursor":"r"}}\n{"type":"Person","data":{}}\n',
      'after its terminal',
    ],
    [
      'duplicate terminal',
      '{"baseline":{"snapshot_commit_id":"c","resume_cursor":"r"}}\n{"baseline":{"snapshot_commit_id":"c","resume_cursor":"r"}}\n',
      'after its terminal',
    ],
  ])(
    'rejects %s without yielding a usable cursor',
    async (_name, body, error) => {
      const { fetch } = stubFetch({
        body,
        headers: { 'content-type': 'application/x-ndjson' },
      });
      const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
      const seen: unknown[] = [];
      const consume = async () => {
        for await (const record of og.changes.baseline()) seen.push(record);
      };
      await expect(consume()).rejects.toThrow(error);
      expect(seen.every((record) => !('baseline' in (record as object)))).toBe(
        true,
      );
    },
  );

  it('does not yield the cursor if transport fails after the terminal bytes arrive', async () => {
    const fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                '{"baseline":{"snapshot_commit_id":"c","resume_cursor":"r"}}\n',
              ),
            );
          },
          pull(controller) {
            controller.error(new Error('transfer interrupted'));
          },
        }),
      );
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    const seen: unknown[] = [];
    const consume = async () => {
      for await (const record of og.changes.baseline()) seen.push(record);
    };
    await expect(consume()).rejects.toThrow('transfer interrupted');
    expect(seen).toEqual([]);
  });

  it('cancels the response when the caller stops before completing the snapshot', async () => {
    let cancelled = false;
    const ac = new AbortController();
    const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBe(ac.signal);
      expect(init?.body).toBe('{}');
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('{"type":"Person","data":{}}\n'),
            );
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    };
    const og = new Omnigraph({ baseUrl: 'http://x', graphId: 'g', fetch });
    for await (const _record of og.changes.baseline({}, { signal: ac.signal }))
      break;
    expect(cancelled).toBe(true);
  });
});
