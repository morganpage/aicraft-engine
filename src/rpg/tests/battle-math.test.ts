import { describe, it, expect } from 'vitest';
import {
  computeBattleDamage,
  computeCaptureChanceBasisPoints,
  computeFleeChanceBasisPoints,
} from '../battle-math';

const NEUTRAL = { numerator: 1, denominator: 1 };

describe('computeBattleDamage', () => {
  it('follows the envelope formula with explicit floor points', () => {
    // scaledAttack = 10 + 2×4 = 18; raw = floor(6×18 / max(1, 2×8)) = floor(108/16) = 6
    expect(computeBattleDamage({
      movePower: 6, attackerLevel: 4, attack: 10, defense: 8,
      typeEffectiveness: NEUTRAL, critical: false, variancePercent: 100,
    })).toBe(6);
  });
  it('applies type effectiveness as an integer ratio', () => {
    // raw 6 → floor(6 × 2 / 1) = 12 super; floor(6 × 1 / 2) = 3 resist
    expect(computeBattleDamage({
      movePower: 6, attackerLevel: 4, attack: 10, defense: 8,
      typeEffectiveness: { numerator: 2, denominator: 1 }, critical: false, variancePercent: 100,
    })).toBe(12);
    expect(computeBattleDamage({
      movePower: 6, attackerLevel: 4, attack: 10, defense: 8,
      typeEffectiveness: { numerator: 1, denominator: 2 }, critical: false, variancePercent: 100,
    })).toBe(3);
  });
  it('applies the 3/2 critical multiplier and variance percentage', () => {
    // raw 6, crit: floor(6 × 3 / 2) = 9; variance 90: floor(6 × 90 / 100) = 5
    expect(computeBattleDamage({
      movePower: 6, attackerLevel: 4, attack: 10, defense: 8,
      typeEffectiveness: NEUTRAL, critical: true, variancePercent: 100,
    })).toBe(9);
    expect(computeBattleDamage({
      movePower: 6, attackerLevel: 4, attack: 10, defense: 8,
      typeEffectiveness: NEUTRAL, critical: false, variancePercent: 90,
    })).toBe(5);
  });
  it('floors at 1 damage regardless of defense', () => {
    expect(computeBattleDamage({
      movePower: 0, attackerLevel: 1, attack: 1, defense: 999,
      typeEffectiveness: { numerator: 1, denominator: 2 }, critical: false, variancePercent: 90,
    })).toBe(1);
  });
  it('never throws on non-finite input', () => {
    const damage = computeBattleDamage({
      movePower: Number.NaN, attackerLevel: Number.POSITIVE_INFINITY, attack: Number.NaN,
      defense: Number.NaN, typeEffectiveness: { numerator: Number.NaN, denominator: 0 },
      critical: false, variancePercent: Number.NaN,
    });
    expect(damage).toBeGreaterThanOrEqual(1);
  });
});

describe('computeCaptureChanceBasisPoints', () => {
  it('adds the missing-HP bonus with an explicit floor', () => {
    // max 24, current 6: bonus = floor(18 × 6000 / 24) = 4500
    expect(computeCaptureChanceBasisPoints({
      speciesCatchBasisPoints: 3000, itemBonusBasisPoints: 2000, maxHp: 24, currentHp: 6,
    })).toBe(9500);
  });
  it('clamps to [500, 9500]', () => {
    expect(computeCaptureChanceBasisPoints({
      speciesCatchBasisPoints: 0, itemBonusBasisPoints: 0, maxHp: 100, currentHp: 100,
    })).toBe(500);
    expect(computeCaptureChanceBasisPoints({
      speciesCatchBasisPoints: 9000, itemBonusBasisPoints: 9000, maxHp: 100, currentHp: 1,
    })).toBe(9500);
  });
});

describe('computeFleeChanceBasisPoints', () => {
  it('follows the speed and attempt escalation formula', () => {
    expect(computeFleeChanceBasisPoints({ playerSpeed: 10, wildSpeed: 10, failedFleeAttempts: 0 })).toBe(5000);
    expect(computeFleeChanceBasisPoints({ playerSpeed: 16, wildSpeed: 10, failedFleeAttempts: 0 })).toBe(6500);
    expect(computeFleeChanceBasisPoints({ playerSpeed: 10, wildSpeed: 16, failedFleeAttempts: 2 })).toBe(5500);
  });
  it('clamps to [1000, 9500]', () => {
    expect(computeFleeChanceBasisPoints({ playerSpeed: 0, wildSpeed: 50, failedFleeAttempts: 0 })).toBe(1000);
    expect(computeFleeChanceBasisPoints({ playerSpeed: 50, wildSpeed: 0, failedFleeAttempts: 9 })).toBe(9500);
  });
});
