import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Glob } from 'glob';
import ts from 'typescript';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SPEC = join(ROOT, 'spec/openapi.json');
const SDK_DIR = join(ROOT, 'packages/sdk/src');

interface SpecParameter {
  name: string;
  in: string;
}

interface SpecOperation {
  parameters?: SpecParameter[];
}

interface Spec {
  paths?: Record<string, Record<string, SpecOperation>>;
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

interface SpecEndpoint {
  method: string;
  path: string;
  queryParams: Set<string>;
}

const spec = JSON.parse(readFileSync(SPEC, 'utf8')) as Spec;

const expected: SpecEndpoint[] = [];
for (const [path, ops] of Object.entries(spec.paths ?? {})) {
  for (const [method, op] of Object.entries(ops)) {
    if (!HTTP_METHODS.has(method.toLowerCase())) continue;
    const queryParams = new Set(
      (op.parameters ?? [])
        .filter((p) => p.in === 'query')
        .map((p) => p.name),
    );
    expected.push({ method: method.toUpperCase(), path, queryParams });
  }
}

interface CallSite {
  method: string;
  path: string;
  queryKeys: Set<string>;
  file: string;
  line: number;
}

const calls: CallSite[] = [];
const parseDiagnostics: string[] = [];

const sourceFiles = await new Glob('**/*.ts', {
  cwd: SDK_DIR,
  ignore: ['generated/**'],
}).walk();

for (const file of sourceFiles) {
  if (file.endsWith('.d.ts')) continue;
  const fullPath = join(SDK_DIR, file);
  const source = readFileSync(fullPath, 'utf8');
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.ES2022,
    true,
  );

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        const methodName = callee.name.text;
        if (methodName === 'request' || methodName === 'stream') {
          const args = node.arguments;
          if (
            args.length >= 2 &&
            ts.isStringLiteral(args[0]!) &&
            (ts.isStringLiteral(args[1]!) || ts.isNoSubstitutionTemplateLiteral(args[1]!) || ts.isTemplateExpression(args[1]!))
          ) {
            const httpMethod = (args[0] as ts.StringLiteral).text;
            const path = pathLiteralText(args[1]!);
            const queryKeys = extractQueryKeys(args[2]);
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
            calls.push({
              method: httpMethod,
              path,
              queryKeys,
              file,
              line: line + 1,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function pathLiteralText(node: ts.Node): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    // Reconstruct as `/branches/${...}` for normalization later.
    let out = node.head.text;
    for (const span of node.templateSpans) {
      out += '${...}' + span.literal.text;
    }
    return out;
  }
  return '<unknown>';
}

function extractQueryKeys(node: ts.Expression | undefined): Set<string> {
  const keys = new Set<string>();
  if (!node || !ts.isObjectLiteralExpression(node)) return keys;
  for (const prop of node.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'query' &&
      ts.isObjectLiteralExpression(prop.initializer)
    ) {
      for (const queryProp of prop.initializer.properties) {
        if (ts.isPropertyAssignment(queryProp)) {
          if (ts.isIdentifier(queryProp.name)) keys.add(queryProp.name.text);
          else if (ts.isStringLiteral(queryProp.name)) keys.add(queryProp.name.text);
        } else if (ts.isShorthandPropertyAssignment(queryProp)) {
          keys.add(queryProp.name.text);
        } else if (ts.isSpreadAssignment(queryProp)) {
          // Spread breaks static analysis; flag and continue.
          parseDiagnostics.push(
            `spread in query object — coverage check can't validate`,
          );
        }
      }
    }
  }
  return keys;
}

function normalizePath(p: string): string {
  return p.replace(/\{[^}]+\}/g, '{}').replace(/\$\{[^}]*\}/g, '{}');
}

const errors: string[] = [];

const expectedByKey = new Map<string, SpecEndpoint>();
for (const e of expected) {
  expectedByKey.set(`${e.method} ${normalizePath(e.path)}`, e);
}

const seenInSdk = new Set<string>();

for (const c of calls) {
  const key = `${c.method} ${normalizePath(c.path)}`;
  seenInSdk.add(key);
  const spec = expectedByKey.get(key);
  if (!spec) {
    errors.push(
      `${c.file}:${c.line}: SDK calls ${c.method} ${c.path} but the spec defines no such operation`,
    );
    continue;
  }
  for (const qk of c.queryKeys) {
    if (!spec.queryParams.has(qk)) {
      const allowed =
        spec.queryParams.size === 0 ? '(none)' : [...spec.queryParams].sort().join(', ');
      errors.push(
        `${c.file}:${c.line}: ${c.method} ${c.path} sends query param '${qk}' — spec allows: ${allowed}`,
      );
    }
  }
}

for (const e of expected) {
  const key = `${e.method} ${normalizePath(e.path)}`;
  if (!seenInSdk.has(key)) {
    errors.push(`No SDK binding for spec operation ${e.method} ${e.path}`);
  }
}

if (errors.length > 0) {
  console.error('Coverage check failed:');
  for (const err of errors) console.error(`  - ${err}`);
  for (const d of parseDiagnostics) console.error(`  ! ${d}`);
  console.error(
    `\nSDK has ${calls.length} call sites; spec defines ${expected.length} operations.`,
  );
  process.exit(1);
}

console.log(
  `Coverage check passed: ${calls.length} call sites bound to ${expected.length} spec operations; query params validated.`,
);
