import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readServerPin } from './server-pin.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SPEC_FILE = join(ROOT, 'spec/openapi.json');

const { version, ref } = readServerPin();

const local = readFileSync(SPEC_FILE, 'utf8');

const url = `https://raw.githubusercontent.com/ModernRelay/omnigraph/${ref}/openapi.json`;
const response = await fetch(url);
if (!response.ok) {
  throw new Error(`fetch failed: ${response.status} ${response.statusText}`);
}
const upstream = await response.text();
if (JSON.parse(upstream)?.info?.version !== version) {
  throw new Error(`upstream spec info.version does not match pinned ${version}`);
}

if (local !== upstream) {
  console.error(
    `spec drift: spec/openapi.json does not match upstream at ${ref}.\n` +
      `Run \`pnpm run sync-spec\` and regenerate the SDK.`,
  );
  process.exit(1);
}

console.log(`spec/openapi.json matches upstream at ${ref} (server ${version})`);
