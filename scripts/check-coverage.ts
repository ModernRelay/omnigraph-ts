import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Glob } from 'glob';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SPEC = join(ROOT, 'spec/openapi.json');
const SDK_DIR = join(ROOT, 'packages/sdk/src');

interface SpecPaths {
  paths?: Record<string, Record<string, unknown>>;
}

const spec = JSON.parse(readFileSync(SPEC, 'utf8')) as SpecPaths;
const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

const expected: Array<{ method: string; path: string }> = [];
for (const [path, ops] of Object.entries(spec.paths ?? {})) {
  for (const method of Object.keys(ops)) {
    if (HTTP_METHODS.has(method.toLowerCase())) {
      expected.push({ method: method.toUpperCase(), path });
    }
  }
}

// Walk the SDK source for `transport.{request,stream}('METHOD', '/path'` calls.
const sourceFiles = await new Glob('**/*.ts', { cwd: SDK_DIR, ignore: ['generated/**'] }).walk();
const sources = sourceFiles
  .filter((p) => !p.endsWith('.d.ts'))
  .map((p) => readFileSync(join(SDK_DIR, p), 'utf8'))
  .join('\n');

const callRe = /\.(?:request|stream)(?:<[^>]*>)?\(\s*['"](GET|POST|PUT|DELETE|PATCH)['"]\s*,\s*[`'"]([^`'"]+)[`'"]/g;
const found = new Set<string>();
let m: RegExpExecArray | null;
while ((m = callRe.exec(sources))) {
  // Convert `${encodeURIComponent(id)}` style paths back to the OpenAPI form: /branches/{name}
  const rawPath = m[2]!.replace(/\$\{[^}]*\}/g, (_match) => '{}');
  found.add(`${m[1]} ${rawPath}`);
}

const missing: string[] = [];
for (const e of expected) {
  // Normalize the spec's `/branches/{name}` path to `/branches/{}` for comparison.
  const normalized = e.path.replace(/\{[^}]+\}/g, '{}');
  if (!found.has(`${e.method} ${normalized}`)) {
    missing.push(`${e.method} ${e.path}`);
  }
}

if (missing.length > 0) {
  console.error(`Coverage check failed. Missing facade bindings:`);
  for (const m of missing) console.error(`  - ${m}`);
  console.error(`\nFound ${found.size} bindings; expected ${expected.length}.`);
  process.exit(1);
}

console.log(`Coverage check passed: all ${expected.length} operations bound.`);
