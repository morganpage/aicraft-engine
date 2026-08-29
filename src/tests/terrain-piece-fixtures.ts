/**
 * Test fixtures for the TE.1 prototype — the horizontal strip tile family.
 *
 * The Phase T spec calls this family "the single most important thing the sheet
 * must contain", because it is what makes end caps possible on a 1-row ledge.
 * A 16px ledge is exposed on top, bottom *and* both sides at once, which is
 * precisely the case the 9-role `TerrainTilesetRoleMap` has no tile for — the
 * reason the spec picks the rule-grid path instead.
 *
 * **No `flipX` on any rule, deliberately.** A left cap mirrored into a right
 * cap would halve the authored tiles, but `buildTerrainArtRuleAtlas` always
 * writes `mirroredX: false` ("left for the resolver to set when it picks a
 * mirror") and no resolver sets it. Authoring both caps keeps the prototype
 * independent of that unbuilt path.
 *
 * @module
 */

import type { TerrainKindDefinition, TerrainArtRuleSet } from '../terrain-art/types';

/** Rule indices, in rule-set order. First match wins, so order is significant. */
export const RULE_SINGLE = 0;
export const RULE_LEFT_END = 1;
export const RULE_RIGHT_END = 2;
export const RULE_MIDDLE = 3;

/** Human-readable names, index-aligned with the rule set — for test assertions. */
export const RULE_NAMES = ['single', 'left-end', 'right-end', 'middle'] as const;

/** `-1` is wildcard, `0` must be empty, `1` must be solid. Slots: [NW,N,NE, W,C,E, SW,S,SE]. */
export const STRIP_RULE_SET: TerrainArtRuleSet = Object.freeze({
  rules: Object.freeze([
    { pattern: Object.freeze([-1, -1, -1, 0, 1, 0, -1, -1, -1]), tile: Object.freeze({ col: 0, row: 0 }) },
    { pattern: Object.freeze([-1, -1, -1, 0, 1, 1, -1, -1, -1]), tile: Object.freeze({ col: 1, row: 0 }) },
    { pattern: Object.freeze([-1, -1, -1, 1, 1, 0, -1, -1, -1]), tile: Object.freeze({ col: 2, row: 0 }) },
    { pattern: Object.freeze([-1, -1, -1, 1, 1, 1, -1, -1, -1]), tile: Object.freeze({ col: 3, row: 0 }) },
  ]),
});

/**
 * One solid kind. `materialId` matters: `neighborhood()` only counts a
 * neighbour as connected when it resolves to the *same* material, so a
 * neighbour with no kind entry reads as air.
 */
export const STONE_KINDS: readonly TerrainKindDefinition[] = Object.freeze([
  Object.freeze({
    id: 'stone',
    label: 'Stone',
    tileValue: 1,
    collision: 'solid' as const,
    materialId: 'stone',
    connectGroup: 'stone',
    renderPriority: 0,
  }),
]);

/** Map a prepared grid's rule indices to names, row-major — readable assertions. */
export function ruleNamesOf(
  prepared: Readonly<{ cols: number; rows: number; tiles: readonly { ruleIndex: number }[] }>,
): string[] {
  return prepared.tiles.map((t) => (t.ruleIndex < 0 ? 'none' : RULE_NAMES[t.ruleIndex] ?? 'unknown'));
}
