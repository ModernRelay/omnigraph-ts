const snakeRe = /_([a-z0-9])/g;
const camelRe = /([A-Z])/g;

// Naming assumptions (apply both directions):
//   - Caller-supplied camelCase humps acronyms (`userId`, `urlPath`), not
//     all-caps (`userID`, `URLPath`). All-caps would round-trip through
//     `camelToSnakeKey` as `user_i_d` / `_u_r_l_path` and the server would
//     reject. The OpenAPI spec is snake_case, so the camel side never
//     encounters acronyms in practice.
//   - Wire fields with leading underscores (e.g. `__manifest`) are server
//     internals and are not exposed in the public OpenAPI surface, so the
//     `__double` ambiguity is not exercised.
export function snakeToCamelKey(key: string): string {
  return key.replace(snakeRe, (_m, c: string) => c.toUpperCase());
}

export function camelToSnakeKey(key: string): string {
  return key.replace(camelRe, (_m, c: string) => `_${c.toLowerCase()}`);
}

export interface CaseOptions {
  /**
   * Top-level keys whose values are passed through verbatim instead of
   * recursed into. Use for free-form maps where caller-controlled names
   * must survive the boundary unchanged (e.g., GQ `params`, response
   * `rows` / `columns`).
   *
   * Match against the **post-transform** key. For names that are identical
   * in both cases (e.g. `params`, `rows`), either spelling works.
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
