import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const VERSION_FILE = join(ROOT, '.omnigraph-version');
const SPEC_FILE = join(ROOT, 'spec/openapi.json');

const version = readFileSync(VERSION_FILE, 'utf8').trim();
if (!version) {
  throw new Error(`empty .omnigraph-version`);
}

const url = `https://raw.githubusercontent.com/ModernRelay/omnigraph/v${version}/openapi.json`;
console.log(`fetching ${url}`);

const response = await fetch(url);
if (!response.ok) {
  throw new Error(`fetch failed: ${response.status} ${response.statusText}`);
}
const body = await response.text();

const parsed = JSON.parse(body);
if (parsed?.info?.version !== version) {
  throw new Error(
    `spec info.version (${parsed?.info?.version}) does not match pinned ${version}`,
  );
}

writeFileSync(SPEC_FILE, body);
console.log(`wrote ${SPEC_FILE} (${body.length} bytes, info.version=${version})`);
