import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const VERSION_FILE = join(ROOT, '.omnigraph-version');
const SPEC_FILE = join(ROOT, 'spec/openapi.json');

const version = readFileSync(VERSION_FILE, 'utf8').trim();
const local = readFileSync(SPEC_FILE, 'utf8');

const url = `https://raw.githubusercontent.com/ModernRelay/omnigraph/v${version}/openapi.json`;
const response = await fetch(url);
if (!response.ok) {
  throw new Error(`fetch failed: ${response.status} ${response.statusText}`);
}
const upstream = await response.text();

if (local !== upstream) {
  console.error(
    `spec drift: spec/openapi.json does not match upstream at v${version}.\n` +
      `Run \`pnpm run sync-spec\` and regenerate the SDK.`,
  );
  process.exit(1);
}

console.log(`spec/openapi.json matches upstream at v${version}`);
