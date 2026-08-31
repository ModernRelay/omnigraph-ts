import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface ServerPin {
  version: string;
  ref: string;
  sourcePinned: boolean;
}

/** A release tag by default; an immutable commit only for unreleased development. */
export function resolveServerPin(config: {
  serverVersion?: unknown;
  serverRef?: unknown;
}): ServerPin {
  const { serverVersion, serverRef } = config;
  if (
    typeof serverVersion !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(serverVersion)
  ) {
    throw new Error('omnigraph.serverVersion must be a semantic version');
  }
  if (serverRef !== undefined && (
    typeof serverRef !== 'string' || !/^[0-9a-f]{40}$/.test(serverRef)
  )) {
    throw new Error('omnigraph.serverRef must be a full lowercase 40-character commit SHA');
  }
  return {
    version: serverVersion,
    ref: serverRef ?? `v${serverVersion}`,
    sourcePinned: serverRef !== undefined,
  };
}

export function readServerPin(): ServerPin {
  const path = fileURLToPath(new URL('../package.json', import.meta.url));
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  return resolveServerPin(pkg.omnigraph ?? {});
}

export function assertReleasePin(pin: ServerPin): void {
  if (pin.sourcePinned) {
    throw new Error(
      'Cannot publish a source-pinned server candidate. After the server release is tagged, ' +
      'remove omnigraph.serverRef, sync the spec, regenerate, and rerun all checks.',
    );
  }
}
