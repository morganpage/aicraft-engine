/**
 * Tests for physics constraint derivation.
 *
 * Tests cover:
 * - deriveMaxJumpDistance returns 2 * moveSpeed * timeToApex
 * - deriveMaxStepUp returns apexHeight
 * - derivePhysicsConstraints returns all fields
 * - Non-finite inputs → never throws, returns 0
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import {
  deriveMaxJumpDistance,
  deriveMaxStepUp,
  derivePhysicsConstraints,
} from '../levelgen';
import type { PlatformerConfig } from '../platformer/types';

/** A minimal valid PlatformerConfig for testing. */
const MINIMAL_CONFIG: PlatformerConfig = {
  gravity: 980,
  maxFallSpeed: 600,
  moveSpeed: 200,
  airControl: 0.65,
  jump: {
    apexHeight: 48,
    timeToApex: 0.28,
    jumpCutoffFactor: 0.4,
    fallMultiplier: 2.5,
    coyoteTime: 0.08,
    jumpBufferTime: 0.1,
    landingSquashMin: 0.7,
    landingSquashStiffness: 180,
    landingSquashDamping: 12,
    anticipationDuration: 0.05,
    anticipationSquash: 0.85,
    launchStretch: 1.15,
    airborneBlendRampUp: 4,
    airborneBlendRampDown: 4,
  },
  jumpEnabled: true,
  wallSlideEnabled: true,
  wallSlideSpeed: 60,
  wallJumpVx: 220,
  wallJumpVy: -380,
  wallJumpLockTime: 0.12,
  dashEnabled: true,
  dashSpeed: 420,
  dashDuration: 0.12,
  dashCooldown: 0.3,
  maxDashes: 1,
  doubleJumpEnabled: false,
  maxDoubleJumps: 0,
  climbEnabled: false,
  climbSpeed: 120,
};

/** Wrong config for overwrite-jump test. */
const FASTER_CONFIG: PlatformerConfig = {
  ...MINIMAL_CONFIG,
  moveSpeed: 300,
  jump: { ...MINIMAL_CONFIG.jump, timeToApex: 0.35, apexHeight: 64 },
};

describe('deriveMaxJumpDistance', () => {
  it('returns 2 * moveSpeed * timeToApex', () => {
    const dist = deriveMaxJumpDistance(MINIMAL_CONFIG);
    // 2 * 200 * 0.28 = 112
    expect(dist).toBeCloseTo(112, 5);
  });

  it('updates when config changes', () => {
    const dist = deriveMaxJumpDistance(FASTER_CONFIG);
    // 2 * 300 * 0.35 = 210
    expect(dist).toBeCloseTo(210, 5);
  });

  it('returns 0 for null/undefined config', () => {
    expect(deriveMaxJumpDistance(null as unknown as PlatformerConfig)).toBe(0);
    expect(deriveMaxJumpDistance(undefined as unknown as PlatformerConfig)).toBe(0);
  });

  it('returns 0 for non-finite moveSpeed', () => {
    const bad = { ...MINIMAL_CONFIG, moveSpeed: NaN };
    expect(deriveMaxJumpDistance(bad)).toBe(0);
  });

  it('returns 0 for non-finite timeToApex', () => {
    const bad = {
      ...MINIMAL_CONFIG,
      jump: { ...MINIMAL_CONFIG.jump, timeToApex: Infinity },
    };
    expect(deriveMaxJumpDistance(bad)).toBe(0);
  });

  it('returns 0 when jump config is missing', () => {
    const bad = { ...MINIMAL_CONFIG };
    delete (bad as any).jump;
    expect(deriveMaxJumpDistance(bad)).toBe(0);
  });

  it('is pure (same input → same output)', () => {
    const a = deriveMaxJumpDistance(MINIMAL_CONFIG);
    const b = deriveMaxJumpDistance(MINIMAL_CONFIG);
    expect(a).toBe(b);
  });
});

describe('deriveMaxStepUp', () => {
  it('returns apexHeight', () => {
    const stepUp = deriveMaxStepUp(MINIMAL_CONFIG);
    expect(stepUp).toBe(48);
  });

  it('returns apexHeight from custom config', () => {
    const stepUp = deriveMaxStepUp(FASTER_CONFIG);
    expect(stepUp).toBe(64);
  });

  it('returns 0 for null/undefined config', () => {
    expect(deriveMaxStepUp(null as unknown as PlatformerConfig)).toBe(0);
    expect(deriveMaxStepUp(undefined as unknown as PlatformerConfig)).toBe(0);
  });

  it('returns 0 for non-finite apexHeight', () => {
    const bad = {
      ...MINIMAL_CONFIG,
      jump: { ...MINIMAL_CONFIG.jump, apexHeight: NaN },
    };
    expect(deriveMaxStepUp(bad)).toBe(0);
  });

  it('returns 0 when jump config is missing', () => {
    const bad = { ...MINIMAL_CONFIG };
    delete (bad as any).jump;
    expect(deriveMaxStepUp(bad)).toBe(0);
  });

  it('is pure (same input → same output)', () => {
    const a = deriveMaxStepUp(MINIMAL_CONFIG);
    const b = deriveMaxStepUp(MINIMAL_CONFIG);
    expect(a).toBe(b);
  });
});

describe('derivePhysicsConstraints', () => {
  it('returns all fields', () => {
    const pc = derivePhysicsConstraints(MINIMAL_CONFIG, 16);
    expect(pc).toHaveProperty('maxJumpDistance');
    expect(pc).toHaveProperty('maxStepUp');
    expect(pc).toHaveProperty('maxGapWidth');
    expect(pc).toHaveProperty('maxStepUpTiles');
    expect(pc).toHaveProperty('dashBoost');
  });

  it('maxJumpDistance equals maxGapWidth', () => {
    const pc = derivePhysicsConstraints(MINIMAL_CONFIG, 16);
    expect(pc.maxGapWidth).toBe(pc.maxJumpDistance);
  });

  it('maxStepUpTiles is floor(maxStepUp / tileSize)', () => {
    const pc = derivePhysicsConstraints(MINIMAL_CONFIG, 16);
    expect(pc.maxStepUpTiles).toBe(3); // 48 / 16 = 3
  });

  it('dashBoost equals dashSpeed when dashEnabled', () => {
    const pc = derivePhysicsConstraints(MINIMAL_CONFIG, 16);
    expect(pc.dashBoost).toBe(420);
  });

  it('dashBoost is 0 when dash disabled', () => {
    const noDash = { ...MINIMAL_CONFIG, dashEnabled: false };
    const pc = derivePhysicsConstraints(noDash, 16);
    expect(pc.dashBoost).toBe(0);
  });

  it('handles non-finite tileSize gracefully', () => {
    const pc = derivePhysicsConstraints(MINIMAL_CONFIG, NaN);
    expect(pc.maxStepUpTiles).toBe(3); // defaults to 16
  });

  it('handles zero tileSize gracefully', () => {
    const pc = derivePhysicsConstraints(MINIMAL_CONFIG, 0);
    expect(pc.maxStepUpTiles).toBe(3); // defaults to 16
  });

  it('is pure (same input → same output)', () => {
    const a = derivePhysicsConstraints(MINIMAL_CONFIG, 16);
    const b = derivePhysicsConstraints(MINIMAL_CONFIG, 16);
    expect(a).toEqual(b);
  });
});
