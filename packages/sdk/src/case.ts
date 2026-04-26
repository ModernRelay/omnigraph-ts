const snakeRe = /_([a-z0-9])/g;
const camelRe = /([A-Z])/g;

export function snakeToCamelKey(key: string): string {
  return key.replace(snakeRe, (_m, c: string) => c.toUpperCase());
}

export function camelToSnakeKey(key: string): string {
  return key.replace(camelRe, (_m, c: string) => `_${c.toLowerCase()}`);
}

export interface CaseOptions {
  /**
   * Keys whose values are passed through verbatim instead of recursed into.
   * The check is against the **transformed** key — e.g., on a request,
   * `opaqueKeys: ['params']` keeps the body key (already snake_case) opaque;
   * on a response, the same set keeps the response key (already snake_case)
   * opaque. Use for free-form maps where caller-controlled names must
   * survive the boundary unchanged (e.g., GQ `params` / `rows` / `columns`).
   */
  opaqueKeys?: ReadonlySet<string>;
}

export function snakeToCamel<T = unknown>(
  value: unknown,
  options: CaseOptions = {},
): T {
  return transform(value, snakeToCamelKey, options) as T;
}

export function camelToSnake<T = unknown>(
  value: unknown,
  options: CaseOptions = {},
): T {
  return transform(value, camelToSnakeKey, options) as T;
}

function transform(
  value: unknown,
  keyFn: (k: string) => string,
  options: CaseOptions,
): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => transform(v, keyFn, options));
  }
  if (typeof value !== 'object') return value;
  // Null-prototype accumulator: defends against `__proto__` / `constructor`
  // poisoning when transforming caller-supplied objects.
  const out = Object.create(null) as Record<string, unknown>;
  const opaque = options.opaqueKeys;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const newKey = keyFn(k);
    if (opaque?.has(newKey)) {
      out[newKey] = v;
    } else {
      out[newKey] = transform(v, keyFn, options);
    }
  }
  return out;
}
