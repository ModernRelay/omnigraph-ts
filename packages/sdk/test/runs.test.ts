import { describe, expect, it } from 'vitest';
import Omnigraph, { NotFoundError } from '../src';
import { stubFetch } from './helpers';

const RUN = {
  run_id: '01R',
  target_branch: 'main',
  run_branch: '__run__01R',
  base_snapshot_id: 'snap-1',
  base_manifest_version: 4,
  operation_hash: null,
  actor_id: null,
  status: 'running',
  published_snapshot_id: null,
  created_at: 1,
  updated_at: 2,
};

describe('runs resource', () => {
  it('list returns Run[] camelCased', async () => {
    const { fetch, calls } = stubFetch({ body: { runs: [RUN] } });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const result = await og.runs.list();
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://x/runs');
    expect(result).toHaveLength(1);
    expect(result[0]?.runId).toBe('01R');
    expect(result[0]?.targetBranch).toBe('main');
    expect(result[0]?.baseManifestVersion).toBe(4);
  });

  it('retrieve sends GET /runs/{id}', async () => {
    const { fetch, calls } = stubFetch({ body: RUN });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const r = await og.runs.retrieve('01R');
    expect(calls[0]?.url).toBe('http://x/runs/01R');
    expect(r.runId).toBe('01R');
  });

  it('abort sends POST /runs/{id}/abort and returns updated state', async () => {
    const aborted = { ...RUN, status: 'aborted' };
    const { fetch, calls } = stubFetch({ body: aborted });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const r = await og.runs.abort('01R');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://x/runs/01R/abort');
    expect(r.status).toBe('aborted');
  });

  it('publish sends POST /runs/{id}/publish', async () => {
    const published = { ...RUN, status: 'published', published_snapshot_id: 'snap-2' };
    const { fetch, calls } = stubFetch({ body: published });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    const r = await og.runs.publish('01R');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://x/runs/01R/publish');
    expect(r.publishedSnapshotId).toBe('snap-2');
  });

  it('retrieve maps 404 to NotFoundError', async () => {
    const { fetch } = stubFetch({
      status: 404,
      body: { error: 'run not found', code: 'not_found' },
    });
    const og = new Omnigraph({ baseUrl: 'http://x', fetch });
    await expect(og.runs.retrieve('bogus')).rejects.toBeInstanceOf(NotFoundError);
  });
});
