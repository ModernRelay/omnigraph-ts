// The HTTP contract a spec requires: the one value of its `Omnigraph-Http-Api`
// header parameter. A server release does not imply its contract (0.15 and
// 0.16 still speak 0.14), so the spec is the only source of the header.

export const HTTP_API_CONTRACT_HEADER = 'Omnigraph-Http-Api';

interface SpecParameter {
  name?: unknown;
  in?: unknown;
  schema?: { enum?: unknown };
}

export function httpContract(spec: unknown): string {
  const paths = (spec as { paths?: Record<string, Record<string, { parameters?: SpecParameter[] }>> })?.paths;
  const values = new Set<string>();
  for (const ops of Object.values(paths ?? {})) {
    for (const op of Object.values(ops ?? {})) {
      for (const p of op?.parameters ?? []) {
        if (p.in !== 'header' || p.name !== HTTP_API_CONTRACT_HEADER) continue;
        const choices = p.schema?.enum;
        if (!Array.isArray(choices) || choices.length !== 1 || typeof choices[0] !== 'string')
          throw new Error(`${HTTP_API_CONTRACT_HEADER} must allow exactly one string value`);
        values.add(choices[0]);
      }
    }
  }
  if (values.size !== 1)
    throw new Error(`spec must require one ${HTTP_API_CONTRACT_HEADER} value, found ${JSON.stringify([...values])}`);
  return [...values][0];
}
