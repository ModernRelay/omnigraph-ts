import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readServerPin } from './server-pin.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SPEC_FILE = join(ROOT, 'spec/openapi.json');

const { version, ref } = readServerPin();

const url = `https://raw.githubusercontent.com/ModernRelay/omnigraph/${ref}/openapi.json`;
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
