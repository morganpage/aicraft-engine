import { describe, it, expect } from 'vitest';
import {
  PLATFORMER_CONFIG_FIELD_UNITS,
  JUMP_CONFIG_FIELD_UNITS,
  scalePlatformerConfig,
  scaleJumpConfig,
  createPrecisionPlatformerConfig,
} from '../platformer/config-scale';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import { PRECISION_PLATFORMER } from '../platformer/presets';
import { createPlatformerState, stepPlatformer } from '../platformer/kernel';
import { DEFAULT_JUMP } from '../animation/jump';
import { DT, makeInput } from './platformer-trace-harness';
import type { PlatformerConfig } from '../platformer/types';
import type { Solid } from '../collision/types';

// ---------------------------------------------------------------------------
// Workstream D1 — unit-aware config scaling.
//
// These tests lock in three things:
//   1. The classification is EXHAUSTIVE (the mapped type compile-gates this; a
//      runtime sanity check backstops it against the default config object).
//   2. Pure scaling scales the right fields and copies the rest.
//   3. FEEL INVARIANCE: jump apex in tiles + dash travel in tiles are equal
//      across tile sizes 8 / 16 / 32 — the real acceptance criterion.
// ---------------------------------------------------------------------------

const EPS = 1e-9;

describe('config-scale: classification exhaustiveness (regression gate)', () => {
  it('PLATFORMER_CONFIG_FIELD_UNITS classifies every default-config key', () => {
    const classified = Object.keys(PLATFORMER_CONFIG_FIELD_UNITS);
    // Every key present in the default config must be classified.
    for (const key of Object.keys(DEFAULT_PLATFORMER_CONFIG) as (keyof PlatformerConfig)[]) {
      expect(classified, `missing classification for ${key}`).toContain(key);
    }
    // Optional fields absent from the default literal must also be classified
    // (the mapped type forces this at compile time; this is the runtime backstop).
    expect(classified).toContain('jumpEnabled');
    expect(classified).toContain('stepHeight');
    expect(classified).toContain('wallProbeDistance');
    expect(classified).toContain('groundDuckEnabled');
    expect(classified).toContain('squash');
  });

  it('JUMP_CONFIG_FIELD_UNITS classifies every JumpConfig key', () => {
    const classified = Object.keys(JUMP_CONFIG_FIELD_UNITS);
    for (const key of Object.keys(DEFAULT_JUMP)) {
      expect(classified, `missing classification for ${key}`).toContain(key);
    }
  });

  it('apexHeight is the only jump field classified as a distance', () => {
    const distances = Object.entries(JUMP_CONFIG_FIELD_UNITS)
      .filter(([, unit]) => unit === 'distance')
      .map(([key]) => key);
    expect(distances).toEqual(['apexHeight']);
  });
});

describe('config-scale: scalePlatformerConfig field units', () => {
  const base = PRECISION_PLATFORMER;

  it('halves velocities, accelerations, and distances at scale 0.5', () => {
    const s = scalePlatformerConfig(base, 0.5);
    // velocity
    expect(s.moveSpeed).toBeCloseTo(base.moveSpeed * 0.5, EPS);
    expect(s.maxFallSpeed).toBeCloseTo(base.maxFallSpeed * 0.5, EPS);
    expect(s.dashSpeed).toBeCloseTo(base.dashSpeed * 0.5, EPS);
    expect(s.wallJumpVx).toBeCloseTo(base.wallJumpVx * 0.5, EPS);
    expect(s.climbSpeed).toBeCloseTo(base.climbSpeed * 0.5, EPS);
    // mantle wave — hop velocities scale with the tile size
    expect(s.mantleHopVx).toBeCloseTo(base.mantleHopVx * 0.5, EPS);
    expect(s.mantleHopVy).toBeCloseTo(base.mantleHopVy * 0.5, EPS);
    // acceleration
    expect(s.gravity).toBeCloseTo(base.gravity * 0.5, EPS);
    expect(s.runAccel).toBeCloseTo(base.runAccel * 0.5, EPS);
    expect(s.duckFriction).toBeCloseTo(base.duckFriction * 0.5, EPS);
    expect(s.overspeedReduce).toBeCloseTo(base.overspeedReduce * 0.5, EPS);
    // distance
    expect(s.stepHeight).toBeCloseTo((base.stepHeight as number) * 0.5, EPS);
    expect(s.wallProbeDistance).toBeCloseTo((base.wallProbeDistance as number) * 0.5, EPS);
    expect(s.upwardCornerCorrection).toBeCloseTo(base.upwardCornerCorrection * 0.5, EPS);
    // mantle wave — clearances/inset are pixel distances
    expect(s.mantleApexClearance).toBeCloseTo(base.mantleApexClearance * 0.5, EPS);
    expect(s.mantleLandingInset).toBeCloseTo(base.mantleLandingInset * 0.5, EPS);
  });

  it('copies ratios, times, counts, and booleans unchanged at scale 0.5', () => {
    const s = scalePlatformerConfig(base, 0.5);
    // ratio
    expect(s.airAccelMultiplier).toBe(base.airAccelMultiplier);
    expect(s.endDashSpeedFactor).toBe(base.endDashSpeedFactor);
    expect(s.dodgeSlideSpeedMult).toBe(base.dodgeSlideSpeedMult);
    expect(s.duckSuperJumpYMult).toBe(base.duckSuperJumpYMult);
    // time
    expect(s.dashDuration).toBe(base.dashDuration);
    expect(s.dashStartupTime).toBe(base.dashStartupTime);
    expect(s.wallJumpLockTime).toBe(base.wallJumpLockTime);
    expect(s.superJumpGrace).toBe(base.superJumpGrace);
    expect(s.springVarJumpTime).toBe(base.springVarJumpTime);
    // mantle wave — durations are seconds (copied verbatim)
    expect(s.mantleAssistTime).toBe(base.mantleAssistTime);
    expect(s.climbJumpRegrabLockTime).toBe(base.climbJumpRegrabLockTime);
    // count
    expect(s.maxDashes).toBe(base.maxDashes);
    expect(s.maxDoubleJumps).toBe(base.maxDoubleJumps);
    expect(s.wallGrabMaxStamina).toBe(base.wallGrabMaxStamina);
    expect(s.staminaClimbJumpCost).toBe(base.staminaClimbJumpCost);
    expect(s.staminaUpCostPerSec).toBe(base.staminaUpCostPerSec);
    // boolean
    expect(s.dashEnabled).toBe(base.dashEnabled);
    expect(s.wallSlideEnabled).toBe(base.wallSlideEnabled);
    expect(s.wallGrabEnabled).toBe(base.wallGrabEnabled);
    expect(s.mantleEnabled).toBe(base.mantleEnabled);
  });

  it('scales jump.apexHeight but copies jump.timeToApex and pose fields', () => {
    const s = scalePlatformerConfig(base, 2);
    expect(s.jump.apexHeight).toBeCloseTo(base.jump.apexHeight * 2, EPS);
    expect(s.jump.timeToApex).toBe(base.jump.timeToApex);
    expect(s.jump.coyoteTime).toBe(base.jump.coyoteTime);
    expect(s.jump.jumpCutoffFactor).toBe(base.jump.jumpCutoffFactor);
    expect(s.jump.fallMultiplier).toBe(base.jump.fallMultiplier);
    expect(s.jump.landingSquashStiffness).toBe(base.jump.landingSquashStiffness);
  });

  it('squash is copied unchanged (dimensionless, render-only)', () => {
    const withSquash: PlatformerConfig = {
      ...base,
      squash: {
        easeRate: 1.75,
        fastFallRate: 8,
        launch: { scaleX: 0.6, scaleY: 1.4 },
        soft: { scaleX: 0.8, scaleY: 1.2 },
        wallJump: { scaleX: 1.4, scaleY: 0.6 },
        wallBonk: { scaleX: 1.5, scaleY: 0.5 },
        landing: { scaleX: 1.2, scaleY: 0.8 },
        fastFall: { scaleX: 0.5, scaleY: 1.5 },
      },
    };
    const s = scalePlatformerConfig(withSquash, 3);
    expect(s.squash).toBe(withSquash.squash); // same reference — untouched
  });

  it('doubles magnitudes at scale 2', () => {
    const s = scalePlatformerConfig(base, 2);
    expect(s.moveSpeed).toBeCloseTo(base.moveSpeed * 2, EPS);
    expect(s.gravity).toBeCloseTo(base.gravity * 2, EPS);
    expect(s.springBounceVy).toBeCloseTo(base.springBounceVy * 2, EPS);
    expect(s.superWallJumpVy).toBeCloseTo(base.superWallJumpVy * 2, EPS);
    expect(s.climbHopVx).toBeCloseTo(base.climbHopVx * 2, EPS);
  });

  it('keeps an omitted optional scalable field undefined (never NaN)', () => {
    // The scaler iterates the CLASSIFICATION keys (keyof PlatformerConfig),
    // not the config's OWN keys. So if a caller passes a config that OMITS an
    // optional scalable field (e.g. stepHeight, wallProbeDistance), the source
    // value is undefined and a naive `undefined * scale` would yield NaN —
    // silently corrupting behavior (e.g. `config.stepHeight` becoming NaN). The
    // guard must keep undefined undefined. (Shipped presets set these via the
    // DEFAULT_PLATFORMER_CONFIG spread, so the bug is latent; this locks it.)
    const config: PlatformerConfig = { ...PRECISION_PLATFORMER, stepHeight: undefined };
    expect(config.stepHeight).toBeUndefined();
    const s = scalePlatformerConfig(config, 2);
    expect(s.stepHeight).toBeUndefined(); // NOT NaN
    expect(Number.isNaN(s.stepHeight as number)).toBe(false);
    // A present scalable field still scales correctly.
    expect(s.moveSpeed).toBeCloseTo(config.moveSpeed * 2, EPS);
  });

  it('identity: scale 1 is deep-equal to the input', () => {
    const s = scalePlatformerConfig(base, 1);
    expect(s).toEqual(base);
  });

  it('scaleJumpConfig scales apexHeight only', () => {
    const s = scaleJumpConfig(DEFAULT_JUMP, 1.5);
    expect(s.apexHeight).toBeCloseTo(DEFAULT_JUMP.apexHeight * 1.5, EPS);
    expect(s.timeToApex).toBe(DEFAULT_JUMP.timeToApex);
    // every non-distance field is byte-identical
    for (const key of Object.keys(DEFAULT_JUMP) as (keyof typeof DEFAULT_JUMP)[]) {
      if (key === 'apexHeight') continue;
      expect(s[key]).toBe(DEFAULT_JUMP[key]);
    }
  });
});

describe('config-scale: createPrecisionPlatformerConfig', () => {
  it('at tileSize 16 reproduces the reference (scale 1)', () => {
    const c = createPrecisionPlatformerConfig({ tileSize: 16 });
    // No overrides → pure scale-1 copy of PRECISION.
    expect(c).toEqual(PRECISION_PLATFORMER);
  });

  it('scales magnitudes by tileSize/16 and preserves tile-unit feel by default', () => {
    const c8 = createPrecisionPlatformerConfig({ tileSize: 8 });
    expect(c8.moveSpeed).toBeCloseTo(PRECISION_PLATFORMER.moveSpeed * 0.5, EPS);
    expect(c8.jump.apexHeight).toBeCloseTo(PRECISION_PLATFORMER.jump.apexHeight * 0.5, EPS);
    expect(c8.jump.timeToApex).toBe(PRECISION_PLATFORMER.jump.timeToApex);
    expect(c8.dashDuration).toBe(PRECISION_PLATFORMER.dashDuration);
  });

  it('honors wallGrabEnabled / climbEnabled / coyoteTime overrides', () => {
    const c = createPrecisionPlatformerConfig({
      tileSize: 16,
      wallGrabEnabled: true,
      climbEnabled: true,
      coyoteTime: 0.2,
    });
    expect(c.wallGrabEnabled).toBe(true);
    expect(c.climbEnabled).toBe(true);
    expect(c.jump.coyoteTime).toBe(0.2);
  });

  it('re-pegs jump-relative impulses when jumpApexTiles is overridden', () => {
    // Default reference apex is 48 px at 16 px tiles = 3 tiles. Override to a
    // 6-tile apex (2x taller) at the same tile size / time. The jump launch
    // velocity doubles, so every jump-relative impulse must double too.
    const c = createPrecisionPlatformerConfig({ tileSize: 16, jumpApexTiles: 6 });
    expect(c.jump.apexHeight).toBe(6 * 16);
    expect(c.jump.timeToApex).toBe(PRECISION_PLATFORMER.jump.timeToApex);

    const ref = PRECISION_PLATFORMER;
    expect(c.wallJumpVy).toBeCloseTo(ref.wallJumpVy * 2, 5);
    expect(c.wallJumpVx).toBeCloseTo(ref.wallJumpVx * 2, 5);
    expect(c.superWallJumpVy).toBeCloseTo(ref.superWallJumpVy * 2, 5);
    expect(c.springBounceVy).toBeCloseTo(ref.springBounceVy * 2, 5);
    expect(c.springSuperBounceVy).toBeCloseTo(ref.springSuperBounceVy * 2, 5);
    expect(c.climbHopVy).toBeCloseTo(ref.climbHopVy * 2, 5);
    // mantle wave — the mantle hop velocities are jump-repegged with the family
    expect(c.mantleHopVx).toBeCloseTo(ref.mantleHopVx * 2, 5);
    expect(c.mantleHopVy).toBeCloseTo(ref.mantleHopVy * 2, 5);
    // Non-jump-relative magnitudes track moveSpeed (scale only) — unchanged at
    // tileSize 16 with no moveSpeed override.
    expect(c.moveSpeed).toBe(ref.moveSpeed);
    expect(c.dashSpeed).toBe(ref.dashSpeed);
  });

  it('re-peg preserves the spring : jump launch ratio across apex overrides', () => {
    // A normal spring should launch ~1.76x as high as a normal jump, both
    // before and after overriding the apex. Compare |springBounceVy| to the
    // derived jump launch velocity = 2*apexHeight/timeToApex.
    const ratioRef =
      Math.abs(PRECISION_PLATFORMER.springBounceVy) /
      (2 * PRECISION_PLATFORMER.jump.apexHeight) /
      (1 / PRECISION_PLATFORMER.jump.timeToApex);
    const c = createPrecisionPlatformerConfig({
      tileSize: 16,
      jumpApexTiles: 4,
      timeToApex: 0.35,
    });
    const newLaunchV = (2 * c.jump.apexHeight) / c.jump.timeToApex;
    const ratioNew = Math.abs(c.springBounceVy) / newLaunchV;
    expect(ratioNew).toBeCloseTo(ratioRef, 5);
  });

  it('re-peg is a no-op identity when neither apex nor time is overridden', () => {
    const c = createPrecisionPlatformerConfig({ tileSize: 32 });
    // 32px is a 2x scale; apex in tiles stays 3, so no re-peg path is taken and
    // impulses are just scaled (wallJumpVy = ref * 2).
    expect(c.wallJumpVy).toBeCloseTo(PRECISION_PLATFORMER.wallJumpVy * 2, EPS);
    expect(c.springBounceVy).toBeCloseTo(PRECISION_PLATFORMER.springBounceVy * 2, EPS);
  });
});

// ---------------------------------------------------------------------------
// Feel invariance — the real acceptance test (ISSUES.md §4.2 / plan §9 D1).
//
// Drive the full kernel (`stepPlatformer`) over a flat floor with a fixed input
// script at tile sizes 8 / 16 / 32, scaling the player body to 0.5 x 1.5 tiles.
// PEAK jump height expressed in TILES and dash horizontal travel in TILES must
// be equal across tile sizes (within ~0.05 tile). Because every world-space
// magnitude scales by `tileSize/16` while times and tick counts are unchanged,
// the tile-unit trajectory is identical to float precision.
// ---------------------------------------------------------------------------

const FEEL_TILE_SIZES = [8, 16, 32] as const;
const FEEL_EPSILON_TILES = 0.05;

interface FeelFixture {
  readonly config: PlatformerConfig;
  readonly playerWidth: number;
  readonly playerHeight: number;
  readonly floor: Solid;
  readonly startX: number;
  readonly startY: number;
}

/** Build a flat-floor fixture for one tile size, body scaled to 0.5 x 1.5 tiles. */
function feelFixture(tileSize: number): FeelFixture {
  const config = createPrecisionPlatformerConfig({ tileSize });
  const playerWidth = 0.5 * tileSize;
  const playerHeight = 1.5 * tileSize;
  const floorY = 20 * tileSize; // tile-aligned floor top
  const floor: Solid = {
    x: -500 * tileSize,
    y: floorY,
    width: 2000 * tileSize,
    height: 10 * tileSize,
  };
  const startX = 10 * tileSize;
  const startY = floorY - playerHeight; // feet resting on the floor
  return { config, playerWidth, playerHeight, floor, startX, startY };
}

/** Run the kernel long enough to settle the body onto the floor. */
function settle(fixture: FeelFixture, ticks: number): ReturnType<typeof createPlatformerState> {
  let state = createPlatformerState(
    fixture.startX,
    fixture.startY,
    fixture.config,
    fixture.playerWidth,
    fixture.playerHeight,
  );
  for (let i = 0; i < ticks; i += 1) {
    state = stepPlatformer(state, makeInput(), [fixture.floor], DT, fixture.config).state;
  }
  return state;
}

/** Measure peak jump height (full hop, jump held) expressed in TILES. */
function measureJumpApexTiles(tileSize: number): number {
  const fixture = feelFixture(tileSize);
  let state = settle(fixture, 6);
  const groundedY = state.core.y;
  let minY = state.core.y;
  // Press jump on tick 0, hold for the full rise; sample peak over the window.
  for (let i = 0; i < 60; i += 1) {
    const input = makeInput({ jump: i === 0 ? 'press' : 'hold' });
    state = stepPlatformer(state, input, [fixture.floor], DT, fixture.config).state;
    if (state.core.y < minY) minY = state.core.y;
  }
  return (groundedY - minY) / tileSize;
}

/** Measure horizontal dash travel (ground dash right) expressed in TILES. */
function measureDashTravelTiles(tileSize: number): number {
  const fixture = feelFixture(tileSize);
  let state = settle(fixture, 6);
  const xAtPress = state.core.x;
  // Dash right: press dash with moveX=1 on tick 0, then release moveX so the
  // only horizontal motion is the dash + its overspeed bleed-off.
  for (let i = 0; i < 30; i += 1) {
    const input = makeInput({
      moveX: i === 0 ? 1 : 0,
      dash: i === 0 ? 'press' : 'idle',
    });
    state = stepPlatformer(state, input, [fixture.floor], DT, fixture.config).state;
  }
  return (state.core.x - xAtPress) / tileSize;
}

describe('config-scale: feel invariance across 8 / 16 / 32 px tiles', () => {
  it('peak jump height in tiles is equal across tile sizes', () => {
    const peaks = FEEL_TILE_SIZES.map((ts) => measureJumpApexTiles(ts));
    // Report the measured values for the workstream report.
    // eslint-disable-next-line no-console
    console.log(`feel-invariance jump apex (tiles): ${FEEL_TILE_SIZES.map((ts, i) => `${ts}px=${peaks[i].toFixed(4)}`).join(', ')}`);
    const span = Math.max(...peaks) - Math.min(...peaks);
    expect(span).toBeLessThan(FEEL_EPSILON_TILES);
    // Sanity: the apex should be near the configured 3 tiles.
    for (const p of peaks) {
      expect(p).toBeGreaterThan(2.5);
      expect(p).toBeLessThan(3.5);
    }
  });

  it('dash horizontal travel in tiles is equal across tile sizes', () => {
    const travels = FEEL_TILE_SIZES.map((ts) => measureDashTravelTiles(ts));
    // eslint-disable-next-line no-console
    console.log(`feel-invariance dash travel (tiles): ${FEEL_TILE_SIZES.map((ts, i) => `${ts}px=${travels[i].toFixed(4)}`).join(', ')}`);
    const span = Math.max(...travels) - Math.min(...travels);
    expect(span).toBeLessThan(FEEL_EPSILON_TILES);
    // Sanity: a dash must actually move the player a few tiles.
    for (const t of travels) {
      expect(t).toBeGreaterThan(2);
    }
  });
});
