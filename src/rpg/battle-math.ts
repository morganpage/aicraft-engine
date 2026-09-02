/**
 * Integer-only battle math.
 *
 * Every formula uses explicit floor points and integer ratios, so results
 * never depend on floating evaluation order. Changing any constant or
 * formula here is a battle-rules version change (`RPG_RULES_VERSION`) and
 * requires golden-transcript updates.
 */

import type { IntegerRatio } from './types';

/** Basis-point ceiling (100%). */
export const BASIS_POINTS_MAX = 10000;

/** Default critical-hit chance in basis points (10%). */
export const DEFAULT_CRITICAL_CHANCE_BP = 1000;

/** Critical multiplier as an integer ratio: `3/2`. */
export const CRITICAL_RATIO: Readonly<IntegerRatio> = { numerator: 3, denominator: 2 };

/** Damage variance range, inclusive integer percentages. */
export const VARIANCE_MIN_PERCENT = 90;
export const VARIANCE_MAX_PERCENT = 100;

/** Capture: basis points added for missing HP at 1 HP remaining. */
export const CAPTURE_MISSING_HP_BONUS_BP = 6000;
export const CAPTURE_CHANCE_MIN_BP = 500;
export const CAPTURE_CHANCE_MAX_BP = 9500;

/** Flee: base chance and modifiers. */
export const FLEE_BASE_BP = 5000;
export const FLEE_SPEED_FACTOR_BP = 250;
export const FLEE_ATTEMPT_BONUS_BP = 1000;
export const FLEE_CHANCE_MIN_BP = 1000;
export const FLEE_CHANCE_MAX_BP = 9500;

function coerceInt(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

/**
 * One attack's damage:
 * `scaledAttack = attack + 2 × level`;
 * `raw = max(1, floor(power × scaledAttack / max(1, 2 × defense)))`;
 * `damage = max(1, floor(raw × typeNum × critNum × variance / (typeDen × critDen × 100)))`.
 * Never throws; non-finite inputs coerce.
 */
export function computeBattleDamage(params: {
  readonly movePower: number;
  readonly attackerLevel: number;
  readonly attack: number;
  readonly defense: number;
  readonly typeEffectiveness: IntegerRatio;
  readonly critical: boolean;
  readonly variancePercent: number;
}): number {
  const level = Math.max(1, coerceInt(params.attackerLevel, 1));
  const attack = Math.max(0, coerceInt(params.attack, 0));
  const defense = Math.max(0, coerceInt(params.defense, 0));
  const power = Math.max(0, coerceInt(params.movePower, 0));
  const typeNum = coerceInt(params.typeEffectiveness.numerator, 1);
  const typeDen = Math.max(1, coerceInt(params.typeEffectiveness.denominator, 1));
  const critNum = params.critical ? CRITICAL_RATIO.numerator : 1;
  const critDen = params.critical ? CRITICAL_RATIO.denominator : 1;
  const variance = Math.min(VARIANCE_MAX_PERCENT, Math.max(VARIANCE_MIN_PERCENT, coerceInt(params.variancePercent, 100)));

  const scaledAttack = attack + 2 * level;
  const rawDamage = Math.max(1, Math.floor((power * scaledAttack) / Math.max(1, 2 * defense)));
  return Math.max(1, Math.floor((rawDamage * typeNum * critNum * variance) / (typeDen * critDen * 100)));
}

/**
 * Capture chance in basis points:
 * `bonus = floor((maxHp − currentHp) × 6000 / maxHp)`; chance is the sum of
 * species rate, item bonus, and missing-HP bonus clamped to `[500, 9500]`.
 */
export function computeCaptureChanceBasisPoints(params: {
  readonly speciesCatchBasisPoints: number;
  readonly itemBonusBasisPoints: number;
  readonly maxHp: number;
  readonly currentHp: number;
}): number {
  const maxHp = Math.max(1, coerceInt(params.maxHp, 1));
  const currentHp = Math.min(maxHp, Math.max(0, coerceInt(params.currentHp, 0)));
  const missingHpBonus = Math.floor(((maxHp - currentHp) * CAPTURE_MISSING_HP_BONUS_BP) / maxHp);
  const chance = coerceInt(params.speciesCatchBasisPoints, 0) + coerceInt(params.itemBonusBasisPoints, 0) + missingHpBonus;
  return Math.min(CAPTURE_CHANCE_MAX_BP, Math.max(CAPTURE_CHANCE_MIN_BP, chance));
}

/**
 * Flee chance in basis points:
 * `clamp(5000 + (playerSpeed − wildSpeed) × 250 + failedAttempts × 1000, 1000, 9500)`.
 */
export function computeFleeChanceBasisPoints(params: {
  readonly playerSpeed: number;
  readonly wildSpeed: number;
  readonly failedFleeAttempts: number;
}): number {
  const chance =
    FLEE_BASE_BP +
    (coerceInt(params.playerSpeed, 0) - coerceInt(params.wildSpeed, 0)) * FLEE_SPEED_FACTOR_BP +
    Math.max(0, coerceInt(params.failedFleeAttempts, 0)) * FLEE_ATTEMPT_BONUS_BP;
  return Math.min(FLEE_CHANCE_MAX_BP, Math.max(FLEE_CHANCE_MIN_BP, chance));
}
