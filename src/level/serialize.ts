/**
 * Canonical JSON serialization (RFC 8785-ish) and 32-bit FNV-1a hashing.
 *
 * Used for share-code generation and clear-check replay verification. Both
 * exports are independently importable and testable. Neither is required for
 * editor / runtime / replay flows in v1 — they exist for future share-code
 * and verified-replay features.
 *
 * @module
 */

/** FNV-1a 32-bit offset basis. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
/** FNV-1a 32-bit prime. */
const FNV_PRIME = 0x01000193;

/**
 * Canonicalize a value into a deterministic JSON string.
 *
 * Conforms to RFC 8785 where practical:
 *  - Object keys sorted recursively (UTF-16 code unit order — matches RFC
 *    8785 for ASCII keys, which is all level data uses).
 *  - No insignificant whitespace.
 *  - Non-finite numbers (`NaN`, `+Infinity`, `-Infinity`) serialized as
 *    `null`.
 *  - Unsupported types (`function`, `symbol`, `bigint`, `undefined`) are
 *    dropped from object fields (matching `JSON.stringify`'s treatment of
 *    `undefined` and functions), and serialized as `null` at top level or
 *    inside arrays.
 *
 * Deterministic: the same input produces byte-identical output across JS
 * engines.
 *
 * **Never throws.** Circular references produce `null` at the cycle point —
 * the function detects the cycle via a path-scoped `Set` of visited objects
 * and replaces the back-edge with `null`.
 *
 * @example
 * ```ts
 * canonicalize({ b: 2, a: 1 }) === canonicalize({ a: 1, b: 2 }); // true
 * canonicalize(NaN) === 'null';                                  // true
 * canonicalize({ x: Infinity }) === '{"x":null}';                // true
 * ```
 *
 * @param value - Any value.
 * @returns A canonical JSON string. Never throws.
 */
export function canonicalize(value: unknown): string {
  const seen = new Set<unknown>();

  const normalize = (v: unknown): unknown => {
    if (v === null) return null;
    const t = typeof v;
    if (t === 'boolean') return v;
    if (t === 'number') return Number.isFinite(v) ? v : null;
    if (t === 'string') return v;
    if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') {
      return null;
    }
      if (t === 'object') {
        if (seen.has(v)) return null;
        seen.add(v);
        let out: unknown;
        if (Array.isArray(v)) {
          out = v.map((item) => normalize(item));
        } else {
          const obj: Record<string, unknown> = {};
          const keys = Object.keys(v as Record<string, unknown>).sort();
          for (const k of keys) {
            const val = (v as Record<string, unknown>)[k];
            const valType = typeof val;
            if (
              valType === 'undefined' ||
              valType === 'function' ||
              valType === 'symbol' ||
              valType === 'bigint'
            ) {
              continue;
            }
            obj[k] = normalize(val);
          }
          out = obj;
        }
        seen.delete(v);
        return out;
      }
    return null;
  };

  try {
    return JSON.stringify(normalize(value));
  } catch {
    return 'null';
  }
}

/**
 * Compute the 32-bit FNV-1a hash of a string.
 *
 * Pure and deterministic. Returns an unsigned 32-bit integer in `[0, 2^32)`.
 * Uses `Math.imul` for 32-bit multiply correctness.
 *
 * @example
 * ```ts
 * fnv1a('') === 2166136261;   // 0x811c9dc5, the FNV offset basis
 * fnv1a('a') === 3826002220;  // 0xe40c292c
 * ```
 *
 * @param text - Input string.
 * @returns Unsigned 32-bit FNV-1a hash.
 */
export function fnv1a(text: string): number {
  let h = FNV_OFFSET_BASIS;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}
