/**
 * LDtk-style whole-tile auto-tiling rule matching.
 *
 * A rule is a 3×3 cell-match pattern (`TerrainArtRulePattern`) that, when it
 * matches a logical grid cell's eight-neighbourhood + self, paints one whole
 * source tile. Unlike the dual-grid quarter-tile model, no tile is ever sliced
 * or clipped to a coverage silhouette — each matched cell draws a complete tile
 * authored as a unit, which is how conventional tilesets (Kenney, etc.) are
 * designed to be used.
 *
 * Pattern cell values follow LDtk's encoding:
 *   `1` — this cell must be solid (carry the matched terrain value),
 *   `0` — this cell must be empty,
 *  `-1` — wildcard (don't care).
 *
 * The centre cell (index 4) is part of the match: rules whose centre is `0`
 * never fire on solid cells, and rules whose centre is `1` never fire on empty
 * ones. First match wins (LDtk ordering); `flipX`/`flipY` additionally test the
 * mirrored pattern so a single rule can cover symmetric cases.
 *
 * @module
 */

import type { TerrainArtRule, TerrainArtRulePattern, TerrainArtRuleSet } from './types';

/** Slot order: [NW, N, NE, W, C, E, SW, S, SE]. */
export const RULE_PATTERN_SIZE = 9;

/**
 * A length-9 observed neighbourhood: `1` where the neighbour is solid (connects
 * to the centre), `0` where empty. Built by the grid preparer from
 * `sampleTerrainNeighborhood`.
 */
export type RuleNeighborhood = readonly number[];

/**
 * Read a rule pattern slot, treating missing/short arrays as wildcards so a
 * malformed rule never throws — it just matches nothing.
 */
const slot = (pattern: TerrainArtRulePattern, index: number): number => {
  const value = pattern[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : -1;
};

/** Horizontally mirror a 3×3 grid in place (swap left/right columns). */
function mirrorX(pattern: TerrainArtRulePattern): number[] {
  return [
    slot(pattern, 2), slot(pattern, 1), slot(pattern, 0),
    slot(pattern, 5), slot(pattern, 4), slot(pattern, 3),
    slot(pattern, 8), slot(pattern, 7), slot(pattern, 6),
  ];
}

/** Vertically mirror a 3×3 grid (swap top/bottom rows). */
function mirrorY(pattern: TerrainArtRulePattern): number[] {
  return [
    slot(pattern, 6), slot(pattern, 7), slot(pattern, 8),
    slot(pattern, 3), slot(pattern, 4), slot(pattern, 5),
    slot(pattern, 0), slot(pattern, 1), slot(pattern, 2),
  ];
}

/** True when one (already-length-9) pattern agrees with the neighbourhood. */
function patternMatches(pattern: readonly number[], neighborhood: RuleNeighborhood): boolean {
  for (let index = 0; index < RULE_PATTERN_SIZE; index++) {
    const want = pattern[index]!;
    if (want === -1) continue; // wildcard
    if (neighborhood[index] !== want) return false;
  }
  return true;
}

/** All pattern variants a rule can match (itself plus any enabled mirrors). */
function ruleVariants(rule: Readonly<TerrainArtRule>): readonly (readonly number[])[] {
  const base = rule.pattern;
  const variants: number[][] = [base.length === RULE_PATTERN_SIZE ? [...base] : base.slice(0, RULE_PATTERN_SIZE)];
  if (rule.flipX) variants.push(mirrorX(base));
  if (rule.flipY) variants.push(mirrorY(base));
  if (rule.flipX && rule.flipY) variants.push(mirrorY(mirrorX(base)));
  return variants;
}

/**
 * Find the first rule whose pattern (or a mirrored variant) matches the given
 * neighbourhood. Returns the rule index, or `null` when nothing matches. Rule
 * order is significant: earlier rules take precedence, matching LDtk.
 */
export function matchRule(
  ruleSet: Readonly<TerrainArtRuleSet>,
  neighborhood: RuleNeighborhood,
): number | null {
  if (neighborhood.length !== RULE_PATTERN_SIZE) return null;
  for (let index = 0; index < ruleSet.rules.length; index++) {
    const rule = ruleSet.rules[index]!;
    for (const variant of ruleVariants(rule)) {
      if (variant.length === RULE_PATTERN_SIZE && patternMatches(variant, neighborhood)) return index;
    }
  }
  return null;
}

/** Count how many of a rule set's slots are non-wildcard (diagnostic / tests). */
export function ruleSpecificity(rule: Readonly<TerrainArtRule>): number {
  let count = 0;
  for (let index = 0; index < RULE_PATTERN_SIZE; index++) if (slot(rule.pattern, index) !== -1) count++;
  return count;
}
