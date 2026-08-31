// Fetches the omnigraph-best-practices markdown references and bakes them
// into a generated TS module that the MCP server imports. The MCP exposes
// each file as a `omnigraph://best-practices/<topic>` resource so an LLM
// can pull the right reference on demand.
//
// Discovery is upstream-driven: we list the references/ directory on each
// run and require a matching curated entry in cookbook-descriptions.json
// for every file. If upstream adds a new reference without a matching
// description, the build fails loudly with a clear remediation message.
// If a description is stale (no longer matches upstream), the build also
// fails — we never ship descriptions for files that no longer exist.
//
// Why curated descriptions: the `description` is what the LLM reads at
// `resources/list` time to decide whether to pull a body. Auto-generated
// titles from filenames are too vague for that selection to be reliable.
// Hand-written guidance ("Read before authoring queries…") gives the LLM
// the cue it needs.
//
// Source of truth: the `omnigraph` skill references in ModernRelay/omnigraph @
// the same server pin as the OpenAPI spec (release tag or immutable candidate).
// Moved there from the retired ModernRelay/omnigraph-cookbooks repo. The
// generated TS module is gitignored; every build/typecheck regenerates it. CI
// builds always fetch fresh; the published npm tarball ships the bundled JS with
// the markdown inlined as string constants.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readServerPin } from '../../../scripts/server-pin.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(HERE);
const OUT = join(PKG_ROOT, 'src/best-practices.gen.ts');
const DESCRIPTIONS_PATH = join(PKG_ROOT, 'cookbook-descriptions.json');

const REPO = 'ModernRelay/omnigraph';
const REF = readServerPin().ref;
const REF_DIR = 'skills/omnigraph/references';

const LIST_URL = `https://api.github.com/repos/${REPO}/contents/${REF_DIR}?ref=${REF}`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${REF}/${REF_DIR}`;

interface CuratedDescription {
  title: string;
  description: string;
}

interface DescriptionsConfig {
  /** Files to expose as MCP resources, with LLM-facing descriptions. */
  exposed: Record<string, CuratedDescription>;
  /** Files intentionally not exposed; value is the reason. */
  skipped: Record<string, string>;
}

interface GithubContentItem {
  name: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
}

function constId(key: string): string {
  // queries -> QUERIES_MD, remote-ops -> REMOTE_OPS_MD
  return `${key.toUpperCase().replace(/-/g, '_')}_MD`;
}

async function listUpstream(): Promise<string[]> {
  const res = await fetch(LIST_URL, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    throw new Error(`list ${LIST_URL}: ${res.status} ${res.statusText}`);
  }
  const items = (await res.json()) as GithubContentItem[];
  return items
    .filter((i) => i.type === 'file' && i.name.endsWith('.md'))
    .map((i) => i.name.replace(/\.md$/, ''))
    .sort();
}

async function fetchBody(key: string): Promise<string> {
  const url = `${RAW_BASE}/${key}.md`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

const upstream = await listUpstream();
const config = JSON.parse(readFileSync(DESCRIPTIONS_PATH, 'utf8')) as DescriptionsConfig;

const exposedKeys = new Set(Object.keys(config.exposed));
const skippedKeys = new Set(Object.keys(config.skipped));
const knownKeys = new Set([...exposedKeys, ...skippedKeys]);
const remote = new Set(upstream);

const unaccounted = upstream.filter((k) => !knownKeys.has(k));
const staleExposed = [...exposedKeys].filter((k) => !remote.has(k));
const staleSkipped = [...skippedKeys].filter((k) => !remote.has(k));
// A file declared in both sections is a contradictory state: the union
// hides it from the unaccounted check, then `exposed` silently wins at
// fetch time and the `skipped` reason becomes dead config. Fail loud so
// the maintainer picks one.
const contradictory = [...exposedKeys].filter((k) => skippedKeys.has(k));

if (
  unaccounted.length > 0 ||
  staleExposed.length > 0 ||
  staleSkipped.length > 0 ||
  contradictory.length > 0
) {
  const lines: string[] = ['cookbook-descriptions.json is out of sync with upstream:'];
  if (unaccounted.length > 0) {
    lines.push(
      '',
      'New files upstream without a curated description or explicit skip:',
      ...unaccounted.map((k) => `  + ${k}.md`),
      '',
      `  → in ${DESCRIPTIONS_PATH}, either:`,
      '      - add to "exposed" with { title, description } if the file is',
      '        useful to an LLM operating through the MCP. The description is',
      '        what the LLM reads at resources/list time to decide whether',
      '        to pull the body; write it for that audience.',
      '      - or add to "skipped" with a one-line reason explaining why',
      '        it is not actionable via the HTTP API the MCP wraps.',
    );
  }
  if (staleExposed.length > 0 || staleSkipped.length > 0) {
    lines.push('', 'Entries that no longer exist upstream:');
    for (const k of staleExposed) lines.push(`  - exposed.${k} (file gone)`);
    for (const k of staleSkipped) lines.push(`  - skipped.${k} (file gone)`);
    lines.push('', `  → remove these from ${DESCRIPTIONS_PATH}`);
  }
  if (contradictory.length > 0) {
    lines.push(
      '',
      'Entries declared in BOTH "exposed" and "skipped":',
      ...contradictory.map((k) => `  ! ${k}`),
      '',
      `  → in ${DESCRIPTIONS_PATH}, remove from one section.`,
    );
  }
  throw new Error(lines.join('\n'));
}

const exposedKeysSorted = upstream.filter((k) => exposedKeys.has(k));
const fetched = await Promise.all(
  exposedKeysSorted.map(async (key) => ({
    key,
    constId: constId(key),
    ...config.exposed[key]!,
    body: await fetchBody(key),
  })),
);

const exports = fetched
  .map((f) => `export const ${f.constId} = ${JSON.stringify(f.body)};`)
  .join('\n\n');

const indexLines = fetched
  .map(
    (f) =>
      `  { key: ${JSON.stringify(f.key)}, uri: ${JSON.stringify(
        `omnigraph://best-practices/${f.key}`,
      )}, title: ${JSON.stringify(f.title)}, description: ${JSON.stringify(
        f.description,
      )}, body: ${f.constId} },`,
  )
  .join('\n');

const out = `// AUTO-GENERATED by packages/mcp/scripts/sync-cookbook.ts. Do not edit by hand.
// Source: ${RAW_BASE}
//
// Discovery: every \`.md\` under the upstream references/ directory.
// Descriptions: packages/mcp/cookbook-descriptions.json (curated).
//
// Regenerated on every build/typecheck/test via the prebuild/pretypecheck/
// pretest hooks in packages/mcp/package.json. The committed file is
// .gitignored — what ships in the npm tarball is the bundled JS with these
// strings inlined.

${exports}

export interface CookbookEntry {
  readonly key: string;
  readonly uri: string;
  readonly title: string;
  readonly description: string;
  readonly body: string;
}

export const COOKBOOK: readonly CookbookEntry[] = [
${indexLines}
] as const;
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);
const totalBytes = fetched.reduce((n, f) => n + f.body.length, 0);
console.log(
  `wrote ${OUT} (${fetched.length} files, ${totalBytes} chars of markdown, ${out.length} chars total)`,
);
