// One hermetic fixture owner for CI and local SDK/MCP qualification.
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, mkdtempSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readServerPin } from './server-pin.js';

const root = resolve(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'omnigraph-sdk-e2e-'));
const cli = process.env.OMNIGRAPH_BIN ?? 'omnigraph';
const serverBin = process.env.OMNIGRAPH_SERVER_BIN ?? 'omnigraph-server';
const cliHome = join(dir, 'home');
const env: NodeJS.ProcessEnv = { ...process.env, OMNIGRAPH_HOME: cliHome };
delete env.OMNIGRAPH_PROFILE;
mkdirSync(cliHome);
const run = (...args: string[]) => execFileSync(cli, args, { env, encoding: 'utf8' });
const version = run('--version').split('\n')[0]?.trim().split(/\s+/)[1];
if (version !== readServerPin().version) throw new Error(`CLI ${version} does not match pinned ${readServerPin().version}`);
for (const file of ['schema.pg', 'queries.gq']) copyFileSync(join(root, 'packages/sdk/test/fixtures', file), join(dir, file));
writeFileSync(join(dir, 'server.policy.yaml'), `version: 1
groups:
  admins: [default]
rules:
  - id: manage
    allow:
      actors: { group: admins }
      actions: [config_manage]
  - id: list
    allow:
      actors: { group: admins }
      actions: [graph_list]
`);
writeFileSync(join(dir, 'graph.policy.yaml'), `version: 1
groups:
  admins: [default]
  readers: [reader]
rules:
  - id: admins
    allow:
      actors: { group: admins }
      actions: [read, export, change, schema_apply, branch_create, branch_delete, branch_merge, invoke_query]
  - id: readers
    allow:
      actors: { group: readers }
      actions: [read]
`);
writeFileSync(join(dir, 'cluster.yaml'), `version: 1
graphs:
  alpha:
    schema: ./schema.pg
    queries: [./queries.gq]
  beta:
    schema: ./schema.pg
    queries: [./queries.gq]
policies:
  server:
    file: ./server.policy.yaml
    applies_to: [cluster]
  data:
    file: ./graph.policy.yaml
    applies_to: [alpha, beta]
`);
run('lint', '--schema', join(dir, 'schema.pg'), '--query', join(dir, 'queries.gq'));
run('cluster', 'plan', '--config', dir, '--as', 'default', '--json');
run('cluster', 'apply', '--config', dir, '--as', 'default', '--json');
// No server or concurrent writer exists yet. Each direct CLI process has exited;
// release its exact persisted lock before the next owner starts.
function unlock() {
  const status = JSON.parse(run('cluster', 'status', '--config', dir, '--json'));
  const lock = status.state_observations.lock_id;
  if (lock) run('cluster', 'force-unlock', '--config', dir, lock, '--json');
}
unlock();
for (const graph of ['alpha', 'beta']) {
  run('--as', 'default', 'load', '--data', join(root, 'packages/sdk/test/fixtures/data.jsonl'), '--mode', 'overwrite', join(dir, 'graphs', `${graph}.omni`));
  unlock();
}
const socket = createServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const address = socket.address();
if (!address || typeof address === 'string') throw new Error('no local test port');
const baseUrl = `http://127.0.0.1:${address.port}`;
await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
const log = openSync(join(dir, 'server.log'), 'a');
const server = spawn(serverBin, ['--cluster', dir, '--bind', `127.0.0.1:${address.port}`], {
  env: { ...env, OMNIGRAPH_SERVER_BEARER_TOKENS_JSON: JSON.stringify({ default: 'ci-token', reader: 'reader-token' }) },
  stdio: ['ignore', log, log],
});
let passed = false;
try {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const ready = await fetch(`${baseUrl}/readyz`, { signal: AbortSignal.timeout(1_000) }).catch(() => undefined);
    if (ready?.ok) break;
    if (server.exitCode !== null || server.signalCode !== null || Date.now() > deadline) throw new Error(`server did not become ready: ${readFileSync(join(dir, 'server.log'), 'utf8')}`);
    await delay(100);
  }
  const testEnv = { ...env, OMNIGRAPH_E2E: '1', OMNIGRAPH_BASE_URL: baseUrl,
    OMNIGRAPH_TOKEN: 'ci-token', OMNIGRAPH_GRAPH_ID: 'alpha', OMNIGRAPH_E2E_CLUSTER_DIR: dir,
    OMNIGRAPH_BIN: cli, OMNIGRAPH_E2E_SERVER_PID: String(server.pid) };
  for (const pkg of ['sdk', 'mcp']) {
    const child = spawn(process.execPath, [join(root, `packages/${pkg}/node_modules/vitest/vitest.mjs`), 'run', 'test/e2e.test.ts'], {
      cwd: join(root, `packages/${pkg}`), env: testEnv, stdio: 'inherit',
    });
    const [code] = await once(child, 'exit');
    if (code !== 0) throw new Error(`${pkg} live tests failed with ${code}`);
  }
  passed = true;
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    const exit = once(server, 'exit');
    server.kill('SIGTERM');
    await Promise.race([exit, delay(10_000, undefined, { ref: false })]);
    if (server.exitCode === null && server.signalCode === null) { server.kill('SIGKILL'); await exit; }
  }
  if (passed) rmSync(dir, { recursive: true, force: true });
  else console.error(`Fixture and server log retained at ${dir}`);
}
