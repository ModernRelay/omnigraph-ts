import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const ROOT_PKG = join(ROOT, 'package.json');
const SPEC_FILE = join(ROOT, 'spec/openapi.json');

const pkg = JSON.parse(readFileSync(ROOT_PKG, 'utf8')) as {
  omnigraph?: { serverVersion?: string };
};
const version = pkg.omnigraph?.serverVersion;
if (!version) {
  throw new Error(`omnigraph.serverVersion missing from ${ROOT_PKG}`);
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
