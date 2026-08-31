import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleasePin, readServerPin } from './server-pin.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const pin = readServerPin();
if (process.argv.includes('--release')) assertReleasePin(pin);

interface PackageJson {
  name?: string;
  version?: string;
  omnigraph?: { serverVersion?: string };
}

function readPackage(path: string): PackageJson {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageJson;
}

const rootPackagePath = join(ROOT, 'package.json');
const sdkPackagePath = join(ROOT, 'packages/sdk/package.json');
const mcpPackagePath = join(ROOT, 'packages/mcp/package.json');

const root = readPackage(rootPackagePath);
const sdk = readPackage(sdkPackagePath);
const mcp = readPackage(mcpPackagePath);

const serverVersion = root.omnigraph?.serverVersion;
const versions = [
  ['root omnigraph.serverVersion', serverVersion],
  ['packages/sdk package version', sdk.version],
  ['packages/mcp package version', mcp.version],
] as const;

const missing = versions.filter(([, version]) => !version);
if (missing.length > 0) {
  for (const [label] of missing) console.error(`${label} is missing`);
  process.exit(1);
}

const unique = new Set(versions.map(([, version]) => version));
if (unique.size !== 1) {
  console.error('Version mismatch: SDK/MCP package versions must match root omnigraph.serverVersion.');
  for (const [label, version] of versions) console.error(`  - ${label}: ${version}`);
  process.exit(1);
}

console.log(`Version check passed: all packages target omnigraph-server v${serverVersion} (${pin.ref})`);
