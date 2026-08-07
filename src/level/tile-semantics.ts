/**
 * Generated-tile semantics — the canonical mapping from a generator's
 * tile-value integers to the platformer collision module's
 * {@link TileType}.
 *
 * Per the canonical implementation plan
 * (`docs/design/level-generation-quality-implementation-plan.md` §5.1),
 * `compileLevel` intentionally treats tiles as empty when no
 * `tileTypeMap` is provided. Generated levels therefore need explicit,
 * serializable tile semantics so the runtime, reachability, and
 * simulation all interpret the same tile values consistently.
 *
 * Determinism note: the semantics are plain readonly data — no closures,
 * no `Set`/`Map`. The same `GeneratedTileSemantics` object always
 * produces the same `tileTypeMap` function.
 *
 * @module
 */

import type { TileType } from '../collision/types';

/**
 * The set of tile-value integers a generator emits and how each maps to
 * the platformer collision module's {@link TileType}.
 *
 * The integers are generator-defined (e.g. `1 = solid`, `2 = passthrough`,
 * `0 = empty`); the semantics object is the contract that tells the
 * runtime how to interpret them.
 *
 * `solid` and `passthrough` are required to be non-overlapping; `0` is
 * conventionally empty but the semantics object does not enforce this
 * (a generator may choose any integer scheme).
 */
export interface GeneratedTileSemantics {
  /** Values compiled as fully solid. */
  readonly solid: readonly number[];
  /** Values compiled as one-way passthrough. */
  readonly passthrough: readonly number[];
  /**
   * Values treated as ladder (climb space) — not solid, not passthrough. These
   * map to `'empty'` for collision (they never form a blocking rect), but are
   * recorded so a runtime can overlay per-cell ladder solids separately. Ladders
   * must be disjoint from `solid` and `passthrough`; if a value appears in more
   * than one set, `solid`/`passthrough` win and `ladder` is ignored for it.
   * Optional — generators/levels without ladders omit it and behave as before.
   */
  readonly ladder?: readonly number[];
}

/**
 * Build a `tileTypeMap` function from a {@link GeneratedTileSemantics}
 * record. The returned function classifies a tile-value integer into a
 * {@link TileType}.
 *
 * Behavior:
 *  - Integers in `semantics.solid` → `'solid'`.
 *  - Integers in `semantics.passthrough` → `'passthrough'`.
 *  - All other integers (including `0`, missing values, integers in
 *    `semantics.ladder`, and integers in neither list) → `'empty'`.
 *    Ladder values are climb space, not collision: they resolve to `'empty'`
 *    here so they never form a blocking rect. A runtime overlays ladder cells
 *    separately as non-colliding `ladder: true` solids.
 *  - Non-integer or non-finite values → `'empty'`.
 *  - Never throws.
 *
 * Pure: the returned function is a reader; it never mutates `semantics`.
 *
 * @example
 * ```ts
 * import { createTileTypeMap } from 'aicraft-engine/src/level';
 *
 * const tileTypeMap = createTileTypeMap({
 *   solid: [1, 2],
 *   passthrough: [3],
 * });
 * tileTypeMap(1); // 'solid'
 * tileTypeMap(3); // 'passthrough'
 * tileTypeMap(0); // 'empty'
 * tileTypeMap(7); // 'empty'
 * ```
 *
 * @param semantics - Tile-value classification.
 * @returns A `(value: number) => TileType` classifier suitable for
 *          `compileLevel`'s `tileTypeMap` option.
 */
export function createTileTypeMap(
  semantics: Readonly<GeneratedTileSemantics>,
): (value: number) => TileType {
  const solidSet = new Set<number>();
  const passthroughSet = new Set<number>();

  if (semantics && Array.isArray(semantics.solid)) {
    for (const v of semantics.solid) {
      if (typeof v === 'number' && Number.isInteger(v)) solidSet.add(v);
    }
  }
  if (semantics && Array.isArray(semantics.passthrough)) {
    for (const v of semantics.passthrough) {
      if (typeof v === 'number' && Number.isInteger(v)) passthroughSet.add(v);
    }
  }
  // Ladder values are intentionally NOT added to either set — they resolve to
  // 'empty' (see the lookup below) so they never block. We don't need the set
  // for classification; it exists only for runtimes that want to read it back.

  return (value: number): TileType => {
    if (typeof value !== 'number' || !Number.isInteger(value)) return 'empty';
    if (solidSet.has(value)) return 'solid';
    if (passthroughSet.has(value)) return 'passthrough';
    return 'empty';
  };
}
