import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT_PKG = join(ROOT, 'package.json');
const SPEC_FILE = join(ROOT, 'spec/openapi.json');

const pkg = JSON.parse(readFileSync(ROOT_PKG, 'utf8')) as {
  omnigraph?: { serverVersion?: string };
};
const version = pkg.omnigraph?.serverVersion;
if (!version) {
  throw new Error(`omnigraph.serverVersion missing from ${ROOT_PKG}`);
}

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
