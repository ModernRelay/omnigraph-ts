type JsonLike =
  | null
  | string
  | number
  | boolean
  | JsonLike[]
  | { [key: string]: JsonLike };

const snakeRe = /_([a-z0-9])/g;
const camelRe = /([A-Z])/g;

export function snakeToCamelKey(key: string): string {
  return key.replace(snakeRe, (_m, c: string) => c.toUpperCase());
}

export function camelToSnakeKey(key: string): string {
  return key.replace(camelRe, (_m, c: string) => `_${c.toLowerCase()}`);
}

export function snakeToCamel<T = unknown>(value: unknown): T {
  return transform(value, snakeToCamelKey) as T;
}

export function camelToSnake<T = unknown>(value: unknown): T {
  return transform(value, camelToSnakeKey) as T;
}

function transform(value: unknown, keyFn: (k: string) => string): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => transform(v, keyFn));
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[keyFn(k)] = transform(v, keyFn);
  }
  return out;
}

export type { JsonLike };
