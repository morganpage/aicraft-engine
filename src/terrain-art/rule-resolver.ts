/**
 * Neighborhood-keyed whole-tile resolver.
 *
 * Given a rule set, resolve which whole source tile to paint for one logical
 * grid cell from its eight-neighbourhood. Memoized per rule set + neighbourhood
 * so a level of N cells with repeating shapes does at most ~47 rule matches
 * (one per distinct neighbourhood), not N.
 *
 * @module
 */

import { matchRule, type RuleNeighborhood } from './rule-tiles';
import type { TerrainArtRuleSet } from './types';

/** Build the length-9 observed neighbourhood for one cell from its 8 bits. */
const FULL = [1, 1, 1, 1, 1, 1, 1, 1, 1] as const;
const EMPTY = [0, 0, 0, 0, 0, 0, 0, 0, 0] as const;

/**
 * A memoized rule matcher: `neighborhood (length-9 of 0|1) → rule index | null`.
 *
 * Cells whose centre is `0` (empty) short-circuit to `null` without scanning
 * the rules, since every painting rule requires its centre to be `1`.
 */
export interface TerrainArtRuleResolver {
  (neighborhood: RuleNeighborhood): number | null;
}

export function createTerrainArtRuleResolver(ruleSet: Readonly<TerrainArtRuleSet>): TerrainArtRuleResolver {
  const cache = new Map<string, number | null>();
  return (neighborhood) => {
    if (neighborhood.length !== 9) return null;
    // An empty centre can never match a painting rule (centre is always `1`).
    if (neighborhood[4] === 0) return null;
    const key = neighborhood.join('');
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const result = matchRule(ruleSet, neighborhood);
    cache.set(key, result);
    return result;
  };
}

/** A fully-solid neighbourhood, for the interior-fill case. */
export const FULLY_SOLID_NEIGHBORHOOD: RuleNeighborhood = FULL;
/** A fully-empty neighbourhood. */
export const EMPTY_NEIGHBORHOOD: RuleNeighborhood = EMPTY;
