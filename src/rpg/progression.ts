/**
 * XP thresholds, level-ups, and automatic move learning.
 *
 * Balance envelope: level `L` begins at `10 × (L - 1)²` cumulative XP;
 * advancing from `L` requires reaching `10 × L²`. Max-HP growth preserves
 * missing HP (current HP gains exactly the max-HP delta, `3` per level).
 * Learnset entries at each new level are processed in ascending order:
 * learned automatically under four known moves, otherwise deferred with an
 * event — never silently replaced. All operations are pure and never throw.
 */

import { RPG_LEVEL_CAP, RPG_MAX_MOVES_PER_CREATURE } from './constants';
import type { CreatureInstance, SpeciesDefinition } from './creatures';
import { deriveMaxHp } from './creatures';
import type { RpgMoveId } from './types';

/** Progression events; structurally compatible with the battle event union. */
export type ProgressionEvent =
  | { readonly type: 'xpGained'; readonly creatureId: string; readonly amount: number }
  | { readonly type: 'levelGained'; readonly creatureId: string; readonly level: number }
  | { readonly type: 'moveLearned'; readonly creatureId: string; readonly moveId: RpgMoveId }
  | { readonly type: 'moveLearnDeferred'; readonly creatureId: string; readonly moveId: RpgMoveId };

/** Cumulative XP at which `level` begins: `10 × (level - 1)²`. */
export function xpForLevelStart(level: number): number {
  const safe = Number.isFinite(level) ? Math.floor(level) : 1;
  return 10 * (safe - 1) * (safe - 1);
}

/** Cumulative XP required to advance from `level`: `10 × level²`. */
export function xpThresholdToAdvance(level: number): number {
  const safe = Number.isFinite(level) ? Math.floor(level) : 1;
  return 10 * safe * safe;
}

export interface XpAwardResult {
  readonly creature: CreatureInstance;
  readonly events: readonly ProgressionEvent[];
}

/**
 * Grant XP and resolve all resulting level-ups. XP award per the balance
 * envelope is computed by the caller (`max(1, floor(yield × wildLevel /
 * recipientLevel))`); this function applies any non-negative integer
 * amount. Multiple level-ups in one award are supported, capped at
 * `RPG_LEVEL_CAP`. Never throws.
 */
export function grantXpAward(
  creature: CreatureInstance,
  species: SpeciesDefinition,
  amount: number,
): XpAwardResult {
  const events: ProgressionEvent[] = [];
  const safeAmount = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
  if (safeAmount === 0 || creature.level >= RPG_LEVEL_CAP) {
    if (safeAmount > 0) {
      events.push({ type: 'xpGained', creatureId: creature.id, amount: safeAmount });
      return { creature: { ...creature, xp: creature.xp + safeAmount }, events };
    }
    return { creature, events };
  }

  events.push({ type: 'xpGained', creatureId: creature.id, amount: safeAmount });
  let current: CreatureInstance = { ...creature, xp: creature.xp + safeAmount };
  let maxHp = deriveMaxHp(species.baseStats.hp, creature.level);

  while (current.level < RPG_LEVEL_CAP && current.xp >= xpThresholdToAdvance(current.level)) {
    const newLevel = current.level + 1;
    const newMaxHp = deriveMaxHp(species.baseStats.hp, newLevel);
    const hpGain = newMaxHp - maxHp;
    let moveIds = current.moveIds;
    for (const entry of species.learnset) {
      if (entry.level !== newLevel) continue;
      if (moveIds.includes(entry.moveId)) continue;
      if (moveIds.length < RPG_MAX_MOVES_PER_CREATURE) {
        moveIds = [...moveIds, entry.moveId];
        events.push({ type: 'moveLearned', creatureId: creature.id, moveId: entry.moveId });
      } else {
        events.push({ type: 'moveLearnDeferred', creatureId: creature.id, moveId: entry.moveId });
      }
    }
    maxHp = newMaxHp;
    current = {
      ...current,
      level: newLevel,
      currentHp: Math.min(newMaxHp, current.currentHp + Math.max(0, hpGain)),
      moveIds,
    };
    events.push({ type: 'levelGained', creatureId: creature.id, level: newLevel });
  }

  return { creature: current, events };
}
