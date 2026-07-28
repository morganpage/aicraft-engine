/**
 * Tests for `computeJumpArc` — jump-arc trajectory sampling.
 *
 * These tests verify that the joint trajectory evaluation agrees with
 * the documented simple formulas within reasonable bounds.
 *
 * Determinism: every test is a pure assertion (same input → same output).
 * No `Math.random`, no `Date.now()`, no global state.
 * Never-throw contract is verified via hostile inputs.
 */
import { describe, it, expect } from 'vitest';
import { computeJumpArc } from '../leveltest/trajectory';
import type { JumpArcConfig } from '../leveltest/trajectory';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';

// ---------------------------------------------------------------------------
// Reference config matching the default platformer kernel
// ---------------------------------------------------------------------------
const baseConfig: JumpArcConfig = {
  playerWidth: 16,
  playerHeight: 24,
  platformerConfig: DEFAULT_PLATFORMER_CONFIG,
};

const APEX_HEIGHT = DEFAULT_PLATFORMER_CONFIG.jump.apexHeight; // 48
const TIME_TO_APEX = DEFAULT_PLATFORMER_CONFIG.jump.timeToApex; // 0.28
const MOVE_SPEED = DEFAULT_PLATFORMER_CONFIG.moveSpeed; // 200
const DASH_SPEED = DEFAULT_PLATFORMER_CONFIG.dashSpeed; // 420
const DASH_DURATION = DEFAULT_PLATFORMER_CONFIG.dashDuration; // 0.12
const FLAT_MAX_DISTANCE = 2 * MOVE_SPEED * TIME_TO_APEX; // 112
const DASH_BOOST = DASH_SPEED * DASH_DURATION; // 50.4

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

describe('computeJumpArc', () => {
  // -----------------------------------------------------------------------
  // Flat jump (same Y)
  // -----------------------------------------------------------------------
  it('flat jump at same Y is feasible when gap within max distance', () => {
    const result = computeJumpArc(
      { x: 0, y: 280, width: 64 },
      { x: 96, y: 280, width: 64 },
      baseConfig,
    );
    // Gap = 96 - 64 = 32, which is < 112 → feasible
    expect(result.feasible).toBe(true);
    expect(result.horizontalDistance).toBe(32);
    expect(result.verticalDistance).toBe(0);
    expect(result.airtime).toBeCloseTo(2 * TIME_TO_APEX, 4); // symmetric flat jump
    expect(result.difficulty).toBeCloseTo(32 / FLAT_MAX_DISTANCE, 4);
    expect(result.requiresDash).toBe(false);
    expect(result.marginRemaining).toBeGreaterThan(0);
  });

  it('flat jump with zero gap (adjacent surfaces) is feasible', () => {
    const result = computeJumpArc(
      { x: 0, y: 280, width: 64 },
      { x: 64, y: 280, width: 64 },
      baseConfig,
    );
    expect(result.feasible).toBe(true);
    expect(result.horizontalDistance).toBe(0);
    expect(result.difficulty).toBe(0);
  });

  it('flat jump with overlapping surfaces is feasible', () => {
    const result = computeJumpArc(
      { x: 0, y: 280, width: 64 },
      { x: 32, y: 280, width: 64 },
      baseConfig,
    );
    expect(result.feasible).toBe(true);
    expect(result.horizontalDistance).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Step-up jump
  // -----------------------------------------------------------------------
  it('step-up jump is feasible when within apex height', () => {
    const stepUp = APEX_HEIGHT * 0.5;
    const result = computeJumpArc(
      { x: 0, y: 280, width: 64 },
      { x: 80, y: 280 - stepUp, width: 64 },
      baseConfig,
    );
    // Gap = 80 - 64 = 16
    // Step up = 24, which is < 48 apexHeight
    expect(result.feasible).toBe(true);
    expect(result.verticalDistance).toBe(-stepUp); // negative because landing is higher
    expect(result.airtime).toBeLessThan(2 * TIME_TO_APEX); // less airtime than flat
  });

  it('step-up at apex limit is feasible', () => {
    const result = computeJumpArc(
      { x: 0, y: 280, width: 64 },
      { x: 48, y: 280 - APEX_HEIGHT, width: 40 },
      baseConfig,
    );
    // Gap = 0 (surfaces overlap)
    // But verticalDistance = -48 = apexHeight, so airtime = timeToApex
    expect(result.feasible).toBe(true);
    expect(result.verticalDistance).toBe(-APEX_HEIGHT);
  });

  // -----------------------------------------------------------------------
  // Step-down jump
  // -----------------------------------------------------------------------
  it('step-down jump is feasible with more airtime than flat jump', () => {
    const stepDown = 48; // landing 48px below takeoff
    const result = computeJumpArc(
      { x: 0, y: 200, width: 64 },
      { x: 96, y: 200 + stepDown, width: 64 },
      baseConfig,
    );
    // Gap = 32
    // Step down = 48 → more fall distance → more airtime
    expect(result.feasible).toBe(true);
    expect(result.verticalDistance).toBe(stepDown);
    expect(result.airtime).toBeGreaterThan(2 * TIME_TO_APEX); // more airtime
  });

  // -----------------------------------------------------------------------
  // Too-far jump
  // -----------------------------------------------------------------------
  it('jump exceeding max flat distance requires dash but is feasible with it', () => {
    const gap = FLAT_MAX_DISTANCE + 20; // 132
    const result = computeJumpArc(
      { x: 0, y: 280, width: 64 },
      { x: 64 + gap, y: 280, width: 64 },
      baseConfig,
    );
    // Gap > flat max → requires dash
    expect(result.requiresDash).toBe(true);
    // Gap ≤ flat max + dash boost → feasible with dash
    expect(result.feasible).toBe(true);
    expect(result.horizontalDistance).toBe(gap);
    // Margin is referenced against the dash-extended limit, so positive
    expect(result.marginRemaining).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // Too-high jump
  // -----------------------------------------------------------------------
  it('jump exceeding apex height is not feasible', () => {
    const result = computeJumpArc(
      { x: 0, y: 280, width: 64 },
      { x: 48, y: 280 - APEX_HEIGHT - 16, width: 40 },
      baseConfig,
    );
    // Vertical distance = -(48 + 16) = -64 < -48 (apexHeight)
    // So it's too high
    expect(result.feasible).toBe(false);
    expect(result.verticalDistance).toBe(-(APEX_HEIGHT + 16));
  });

  // -----------------------------------------------------------------------
  // Dash-required jump
  // -----------------------------------------------------------------------
  it('jump between flat max and flat max + dash boost requires dash', () => {
    // Gap > FLAT_MAX_DISTANCE but ≤ FLAT_MAX_DISTANCE + DASH_BOOST
    const gap = FLAT_MAX_DISTANCE + DASH_BOOST * 0.5; // ~137.2
    const result = computeJumpArc(
      { x: 0, y: 280, width: 64 },
      { x: 64 + gap, y: 280, width: 64 },
      baseConfig,
    );
    expect(result.requiresDash).toBe(true);
    expect(result.feasible).toBe(true);
    expect(result.horizontalDistance).toBe(gap);
  });

  it('jump beyond flat max + dash boost is not feasible even with dash', () => {
    const gap = FLAT_MAX_DISTANCE + DASH_BOOST + 20; // 182.4 > 162.4
    const result = computeJumpArc(
      { x: 0, y: 280, width: 64 },
      { x: 64 + gap, y: 280, width: 64 },
      baseConfig,
    );
    expect(result.feasible).toBe(false);
    expect(result.requiresDash).toBe(false); // dash doesn't help either
  });

  // -----------------------------------------------------------------------
  // Safety margin
  // -----------------------------------------------------------------------
  it('safety margin increases difficulty and can make jump require dash', () => {
    // Gap 100 is < 112 flat max, so feasible without margin and no dash
    const gap = 100;
    const fromSurface = { x: 0, y: 280, width: 64 };
    const toSurface = { x: 64 + gap, y: 280, width: 64 };
    const withoutMargin = computeJumpArc(fromSurface, toSurface, baseConfig);
    expect(withoutMargin.feasible).toBe(true);
    expect(withoutMargin.requiresDash).toBe(false);

    // With safety margin 0.2, effective max without dash = 112 * 0.8 = 89.6 < 100
    // The jump now requires a dash to clear
    const withMargin = computeJumpArc(
      fromSurface, toSurface,
      { ...baseConfig, safetyMargin: 0.2 },
    );
    expect(withMargin.requiresDash).toBe(true);
    expect(withMargin.feasible).toBe(true);
  });

  it('safety margin of 0.5 makes flat max gap infeasible even with dash', () => {
    // gap = FLAT_MAX_DISTANCE = 112
    // With margin 0.5: effective max = 112 * 0.5 = 56, dash boost = 50.4 * 0.5 = 25.2
    // Total = 56 + 25.2 = 81.2 < 112 → not feasible
    const gap = FLAT_MAX_DISTANCE; // 112
    const result = computeJumpArc(
      { x: 0, y: 280, width: 64 },
      { x: 64 + gap, y: 280, width: 64 },
      { ...baseConfig, safetyMargin: 0.5 },
    );
    expect(result.requiresDash).toBe(false);
    expect(result.feasible).toBe(false);
  });

  it('safety margin of 0 behaves the same as omitted', () => {
    const omitted = computeJumpArc(
      { x: 0, y: 280, width: 64 },
      { x: 96, y: 280, width: 64 },
      baseConfig,
    );
    const zero = computeJumpArc(
      { x: 0, y: 280, width: 64 },
      { x: 96, y: 280, width: 64 },
      { ...baseConfig, safetyMargin: 0 },
    );
    expect(omitted.feasible).toBe(zero.feasible);
    expect(omitted.marginRemaining).toBeCloseTo(zero.marginRemaining, 4);
  });

  // -----------------------------------------------------------------------
  // Difficulty score
  // -----------------------------------------------------------------------
  it('difficulty is 0 for zero gap', () => {
    const result = computeJumpArc(
      { x: 0, y: 280, width: 64 },
      { x: 64, y: 280, width: 64 },
      baseConfig,
    );
    expect(result.difficulty).toBe(0);
  });

  it('difficulty is 1 for gap at flat max distance', () => {
    const result = computeJumpArc(
      { x: 0, y: 280, width: 64 },
      { x: 64 + FLAT_MAX_DISTANCE, y: 280, width: 64 },
      baseConfig,
    );
    expect(result.difficulty).toBeCloseTo(1, 4);
  });

  it('difficulty is clamped to [0, 1] for extreme gaps', () => {
    const hugeGap = FLAT_MAX_DISTANCE * 10;
    const result = computeJumpArc(
      { x: 0, y: 280, width: 64 },
      { x: 64 + hugeGap, y: 280, width: 64 },
      baseConfig,
    );
    expect(result.difficulty).toBe(1);
    expect(result.difficulty).toBeGreaterThanOrEqual(0);
    expect(result.difficulty).toBeLessThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // All result fields are finite
  // -----------------------------------------------------------------------
  it('all numeric result fields are finite', () => {
    const result = computeJumpArc(
      { x: 0, y: 280, width: 64 },
      { x: 96, y: 260, width: 64 },
      baseConfig,
    );
    expect(Number.isFinite(result.horizontalDistance)).toBe(true);
    expect(Number.isFinite(result.verticalDistance)).toBe(true);
    expect(Number.isFinite(result.airtime)).toBe(true);
    expect(Number.isFinite(result.difficulty)).toBe(true);
    expect(Number.isFinite(result.marginRemaining)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Non-finite inputs never throw
  // -----------------------------------------------------------------------
  it('NaN inputs never throw', () => {
    expect(() =>
      computeJumpArc(
        { x: NaN, y: 280, width: 64 },
        { x: 96, y: 280, width: 64 },
        baseConfig,
      ),
    ).not.toThrow();
  });

  it('Infinity inputs never throw', () => {
    expect(() =>
      computeJumpArc(
        { x: Infinity, y: 280, width: 64 },
        { x: 96, y: 280, width: 64 },
        baseConfig,
      ),
    ).not.toThrow();
  });

  it('negative width inputs never throw', () => {
    expect(() =>
      computeJumpArc(
        { x: 0, y: 280, width: -64 },
        { x: 96, y: 280, width: 64 },
        baseConfig,
      ),
    ).not.toThrow();
  });

  it('undefined safety margin never throws', () => {
    expect(() =>
      computeJumpArc(
        { x: 0, y: 280, width: 64 },
        { x: 96, y: 280, width: 64 },
        { ...baseConfig, safetyMargin: undefined },
      ),
    ).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // Determinism
  // -----------------------------------------------------------------------
  it('same inputs produce identical results', () => {
    const a = computeJumpArc(
      { x: 0, y: 280, width: 64 },
      { x: 96, y: 260, width: 48 },
      baseConfig,
    );
    const b = computeJumpArc(
      { x: 0, y: 280, width: 64 },
      { x: 96, y: 260, width: 48 },
      baseConfig,
    );
    expect(a).toEqual(b);
  });
});
