/**
 * 32-bit FNV-1a hash — the single implementation.
 *
 * This leaf module exists because three byte-identical copies had drifted
 * across `level/serialize.ts`, `cosmetics/generate.ts`, and
 * `terrain-art/storage.ts`, and their outputs are load-bearing: replay
 * share-codes and trace canaries (`replay/hash.ts`), terrain-art cache keys,
 * and cosmetics variant ids. The algorithm here is frozen exactly as those
 * copies implemented it — same offset basis, same prime, same UTF-16
 * `charCodeAt` iteration, same `Math.imul` mixing — so consolidation is
 * output-neutral by construction. The known-answer vectors in
 * `src/tests/hash-fnv1a.test.ts` pin it.
 *
 * Deterministic: pure integer math, no BigInt, no platform float quirks.
 *
 * @module
 */

/** FNV-1a 32-bit offset basis. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
/** FNV-1a 32-bit prime. */
const FNV_PRIME = 0x01000193;

/**
 * Hash a UTF-16 code-unit stream with FNV-1a.
 *
 * @example
 * ```ts
 * fnv1aHash('') === 2166136261;  // 0x811c9dc5, the offset basis
 * fnv1aHash('a') === 3826002220; // 0xe40c292c
 * ```
 *
 * @param text - Input string.
 * @returns Unsigned 32-bit digest in `[0, 2^32)`.
 */
export function fnv1aHash(text: string): number {
  let h = FNV_OFFSET_BASIS;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}
