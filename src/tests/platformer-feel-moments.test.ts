import { describe, it, expect } from 'vitest';
import { createPlatformerState, stepPlatformer } from '../platformer/kernel';
import {
  DEFAULT_PLATFORMER_CONFIG,
  DEFAULT_PLAYER_HEIGHT,
  DEFAULT_PLAYER_WIDTH,
} from '../platformer/constants';
import { scalePlatformerConfig } from '../platformer/config-scale';
import { normalizedImpactFor } from '../platformer/feel-moments';
import type { Solid } from '../collision/types';
import type {
  FeelMoment,
  PlatformerConfig,
  PlatformerInput,
  PlatformerState,
} from '../platformer/types';
import type { PolledEdge } from '../input/types';

/**
 * Phase D2 — the structured feel-moment channel (`state.moments`).
 *
 * The headline is FEEL-INVARIANCE: the hard-landing test must fire identically
 * at 8/16/32 px tiles. That falls out of `normalizedImpact` (a ratio against the
 * scaled `maxFallSpeed`), NOT a raw px/s threshold — the unscaled `prevVy > 520`
 * magic number (ISSUES §4.2) never fired at 8 px, and the contrast test below
 * documents exactly why.
 *
 * Also covered: dash bonks (horizontal AND vertical — ISSUES §4.4), one-shot
 * latch semantics, `dashEnded` terminal context (observation-only), grab latch +
 * stamina exhaustion pulses (ISSUES §5.2), spring/refill moments with the
 * compiled `super` semantic, and boolean/interaction back-compat.
 *
 * @module
 */

const DT = 1 / 60;

function idleEdge(): PolledEdge {
  return { held: false, pressed: false, released: false };
}
function holdEdge(): PolledEdge {
  return { held: true, pressed: false, released: false };
}
function pressEdge(): PolledEdge {
  return { held: true, pressed: true, released: false };
}

function idleInput(): PlatformerInput {
  return { moveX: 0, jump: idleEdge(), dash: null };
}
function inputWith(over: Partial<PlatformerInput>): PlatformerInput {
  return { moveX: 0, jump: idleEdge(), dash: null, ...over };
}

function findMoments(state: PlatformerState, kind: FeelMoment['kind']): FeelMoment[] {
  return state.moments.filter((m) => m.kind === kind);
}

/** Step with a fixed input until a predicate fires (or `max` ticks elapse). */
function stepUntil(
  initial: PlatformerState,
  input: PlatformerInput,
  pred: (s: PlatformerState) => boolean,
  solids: readonly Solid[],
  config: Readonly<PlatformerConfig> = DEFAULT_PLATFORMER_CONFIG,
  max = 600,
): PlatformerState {
  let state = initial;
  for (let i = 0; i < max; i++) {
    state = stepPlatformer(state, input, solids, DT, config).state;
    if (pred(state)) return state;
  }
  return state;
}

/**
 * Drop the actor `tiles` tiles onto a wide floor under the given config and
 * return the state on the landing tick (asserting exactly one landing moment).
 */
function dropAndLand(
  config: Readonly<PlatformerConfig>,
  scale: number,
  tiles: number,
): PlatformerState {
  const w = DEFAULT_PLAYER_WIDTH * scale;
  const h = DEFAULT_PLAYER_HEIGHT * scale;
  const dropPx = tiles * 16 * scale;
  const floorY = 200 * scale;
  const solids: Solid[] = [
    { id: 'floor', x: -400 * scale, y: floorY, width: 1000 * scale, height: 16 * scale },
  ];
  const initial = createPlatformerState(0, floorY - h - dropPx, config, w, h);
  const landed = stepUntil(
    initial,
    idleInput(),
    (s) => s.events.justLanded,
    solids,
    config,
  );
  expect(landed.events.justLanded).toBe(true);
  return landed;
}

describe('Phase D2 — feel moments', () => {
  // ===========================================================================
  // 1. FEEL-INVARIANCE (the headline). Drop 4 tiles (uncapped impact, ~0.60
  // normalized) and 25 tiles (terminal, 1.0) at 8/16/32 px. The scaled
  // discrete integration cancels the scale factor exactly, so normalizedImpact
  // agrees within float epsilon and `hard` agrees.
  // ===========================================================================
  it('normalizedImpact is feel-invariant across 8/16/32 px tiles (soft + hard drops)', () => {
    for (const tiles of [4, 25]) {
      const results = [8, 16, 32].map((tile) => {
        const scale = tile / 16;
        const config = scalePlatformerConfig(DEFAULT_PLATFORMER_CONFIG, scale);
        const landed = dropAndLand(config, scale, tiles);
        const moments = findMoments(landed, 'landing');
        expect(moments.length).toBe(1);
        const m = moments[0] as Extract<FeelMoment, { kind: 'landing' }>;
        return { tile, m, impact: m.impactSpeed };
      });

      const [r8, r16, r32] = results;
      // Ratio invariant (the guarantee).
      expect(r8.m.normalizedImpact).toBeCloseTo(r16.m.normalizedImpact, 9);
      expect(r32.m.normalizedImpact).toBeCloseTo(r16.m.normalizedImpact, 9);
      expect(r8.m.hard).toBe(r16.m.hard);
      expect(r32.m.hard).toBe(r16.m.hard);
      // Absolute speed DOES scale with the tile size — this is precisely why a
      // fixed px threshold cannot be invariant (documented contrast, ISSUES §4.2).
      expect(r8.impact).toBeCloseTo(r16.impact * 0.5, 6);
      expect(r32.impact).toBeCloseTo(r16.impact * 2, 6);

      if (tiles === 4) {
        // Uncapped drop: a meaningful sub-1 ratio, below the 0.72 threshold.
        expect(r16.m.normalizedImpact).toBeGreaterThan(0.4);
        expect(r16.m.normalizedImpact).toBeLessThan(0.72);
        expect(r16.m.hard).toBe(false);
        // The old approach at 8 px: impact8 ≈ impact16/2 ≈ 180 px/s — an
        // unscaled `prevVy > 520` gate would NOT fire at 8 px while the
        // normalized gate fires identically at every tile size.
        expect(r8.impact).toBeLessThan(520);
      } else {
        // Terminal drop: clamped at maxFallSpeed → ratio 1, hard.
        expect(r16.m.normalizedImpact).toBeCloseTo(1, 6);
        expect(r16.m.hard).toBe(true);
      }
    }
  });

  it('landing moment carries impactSpeed + the gravity-facing support id (ground)', () => {
    const landed = dropAndLand(DEFAULT_PLATFORMER_CONFIG, 1, 4);
    const m = findMoments(landed, 'landing')[0] as Extract<FeelMoment, { kind: 'landing' }>;
    expect(m.impactSpeed).toBeGreaterThan(0);
    expect(m.solidId).toBe('floor');
    // Consistent with the exported pure helper.
    expect(m.normalizedImpact).toBeCloseTo(
      normalizedImpactFor(m.impactSpeed, DEFAULT_PLATFORMER_CONFIG),
      12,
    );
  });

  it('negative gravity lands on the ceiling with the same positive magnitude', () => {
    const inverted: PlatformerConfig = {
      ...DEFAULT_PLATFORMER_CONFIG,
      gravity: -DEFAULT_PLATFORMER_CONFIG.gravity,
    };
    const dropPx = 4 * 16;
    // "Floor" is now a ceiling whose underside the actor rises onto.
    const ceiling: Solid = { id: 'ceil', x: -400, y: -20, width: 1000, height: 20 };
    const initial = createPlatformerState(0, 0 + dropPx, inverted); // top lands at y=0
    const landed = stepUntil(
      initial,
      idleInput(),
      (s) => s.events.justLanded,
      [ceiling],
      inverted,
    );
    expect(landed.events.justLanded).toBe(true);
    const moments = findMoments(landed, 'landing');
    expect(moments.length).toBe(1);
    const m = moments[0] as Extract<FeelMoment, { kind: 'landing' }>;
    // Gravity-facing support id is the CEILING id under negative gravity.
    expect(m.solidId).toBe('ceil');
    expect(m.impactSpeed).toBeGreaterThan(0);
    expect(m.normalizedImpact).toBeCloseTo(
      normalizedImpactFor(m.impactSpeed, inverted),
      12,
    );
    // Same drop as the positive-gravity soft case → same normalized magnitude.
    const down = dropAndLand(DEFAULT_PLATFORMER_CONFIG, 1, 4);
    const downM = findMoments(down, 'landing')[0] as Extract<FeelMoment, { kind: 'landing' }>;
    expect(m.normalizedImpact).toBeCloseTo(downM.normalizedImpact, 6);
  });

  // ===========================================================================
  // 2. dashBonk — horizontal into a tall right wall (normalX = -1, correct
  // solidId, exactly one per axis per dash, latch resets on a new dash).
  // ===========================================================================
  it('horizontal dash into a tall right wall → one dashBonk, normalX=-1, solidId matches', () => {
    const floor: Solid = { id: 'floor', x: -200, y: 100, width: 800, height: 16 };
    const wall: Solid = { id: 'wall-r', x: 40, y: -60, width: 16, height: 220 };
    const solids = [floor, wall];
    // Body 16 wide at x=0 → right edge 16; wall at 40 → 24 px of run room.
    const initial = createPlatformerState(0, 100 - DEFAULT_PLAYER_HEIGHT);
    const input = inputWith({
      moveX: 1,
      dash: pressEdge(),
    });
    let state = initial;
    let bonks = 0;
    // Press tick + startup (3) + active (8) — one full dash cycle.
    for (let i = 0; i < 16; i++) {
      state = stepPlatformer(
        state,
        i === 0 ? input : inputWith({ moveX: 1 }),
        solids,
        DT,
      ).state;
      bonks += findMoments(state, 'dashBonk').filter((m) => (m as { normalX: number }).normalX !== 0).length;
    }
    expect(bonks).toBe(1);
  });

  it('pinned dash emits exactly one bonk; a new dash resets the latch', () => {
    const floor: Solid = { id: 'floor', x: -200, y: 100, width: 800, height: 16 };
    const wall: Solid = { id: 'wall-r', x: 40, y: -60, width: 16, height: 220 };
    const solids = [floor, wall];
    const initial = createPlatformerState(0, 100 - DEFAULT_PLAYER_HEIGHT);

    // --- First dash: bonk, then pinned to timeout. ---
    let state = initial;
    const bonkTicks: number[] = [];
    let ended: PlatformerState | null = null;
    for (let i = 0; i < 16; i++) {
      state = stepPlatformer(
        state,
        inputWith(i === 0 ? { moveX: 1, dash: pressEdge() } : { moveX: 1 }),
        solids,
        DT,
      ).state;
      const xb = findMoments(state, 'dashBonk').filter(
        (m) => (m as { normalX: number }).normalX !== 0,
      );
      if (xb.length > 0) {
        expect(xb.length).toBe(1);
        const m = xb[0] as Extract<FeelMoment, { kind: 'dashBonk' }>;
        expect(m.normalX).toBe(-1); // outward normal points back against the dash
        expect(m.normalY).toBe(0);
        expect(m.solidId).toBe('wall-r');
        bonkTicks.push(i);
      }
      if (findMoments(state, 'dashEnded').length > 0) ended = state;
    }
    // Exactly one bonk across the whole pinned dash.
    expect(bonkTicks.length).toBe(1);
    // The dash ended while pinned to the wall → terminal contact reported.
    expect(ended).not.toBeNull();
    const endM = findMoments(ended as PlatformerState, 'dashEnded')[0] as Extract<
      FeelMoment,
      { kind: 'dashEnded' }
    >;
    expect(endM.reason).toBe('timeout');
    expect(endM.terminalContact).toBe('wall');

    // --- Cooldown (0.3 s = 18 ticks), then a second dash bonks again. ---
    for (let i = 0; i < 18; i++) {
      state = stepPlatformer(state, inputWith({ moveX: 1 }), solids, DT).state;
    }
    let secondBonk = 0;
    for (let i = 0; i < 16; i++) {
      state = stepPlatformer(
        state,
        inputWith(i === 0 ? { moveX: 1, dash: pressEdge() } : { moveX: 1 }),
        solids,
        DT,
      ).state;
      secondBonk += findMoments(state, 'dashBonk').filter(
        (m) => (m as { normalX: number }).normalX !== 0,
      ).length;
    }
    expect(secondBonk).toBe(1);
  });

  it('upward dash into a ceiling → dashBonk normalY=+1 (the ISSUES §4.4 case)', () => {
    const floor: Solid = { id: 'floor', x: -200, y: 100, width: 800, height: 16 };
    const ceiling: Solid = { id: 'ceil', x: -200, y: 0, width: 800, height: 20 };
    const solids = [floor, ceiling];
    // Player top starts at y=50 → 30 px of rise room to the ceiling underside.
    const initial = createPlatformerState(0, 50);
    let state = initial;
    let yBonks = 0;
    for (let i = 0; i < 16; i++) {
      state = stepPlatformer(
        state,
        inputWith(i === 0 ? { moveY: -1, dash: pressEdge() } : { moveY: -1 }),
        solids,
        DT,
      ).state;
      const yb = findMoments(state, 'dashBonk').filter(
        (m) => (m as { normalY: number }).normalY !== 0,
      );
      if (yb.length > 0) {
        expect(yb.length).toBe(1);
        const m = yb[0] as Extract<FeelMoment, { kind: 'dashBonk' }>;
        expect(m.normalY).toBe(1); // ceiling's outward normal points down (+Y)
        expect(m.normalX).toBe(0);
        expect(m.solidId).toBe('ceil');
        yBonks += yb.length;
      }
    }
    expect(yBonks).toBe(1);
  });

  // ===========================================================================
  // 3. dashEnded — observation-only: timeout in open space reports 'none';
  // the dash duration/velocity traces are untouched (dash tests still pass).
  // ===========================================================================
  it('dash timeout in open air → dashEnded { reason: timeout, terminalContact: none }', () => {
    // Airborne over a void (a floor far below) — dash horizontally, no walls.
    const floor: Solid = { id: 'floor', x: -200, y: 1000, width: 800, height: 16 };
    const initial = createPlatformerState(0, 200);
    let state = initial;
    let sawEnd: Extract<FeelMoment, { kind: 'dashEnded' }> | null = null;
    for (let i = 0; i < 16; i++) {
      state = stepPlatformer(
        state,
        inputWith(i === 0 ? { moveX: 1, dash: pressEdge() } : { moveX: 1 }),
        [floor],
        DT,
      ).state;
      const e = findMoments(state, 'dashEnded');
      if (e.length > 0) {
        expect(e.length).toBe(1);
        sawEnd = e[0] as Extract<FeelMoment, { kind: 'dashEnded' }>;
      }
    }
    expect(sawEnd).not.toBeNull();
    expect(sawEnd?.reason).toBe('timeout');
    expect(sawEnd?.terminalContact).toBe('none');
  });

  // ===========================================================================
  // 4. grabLatch / staminaExhausted — one-tick pulses.
  // ===========================================================================
  it('grabLatch fires exactly once on engage (not while held) and carries the wall id', () => {
    // Wall-grab is OFF in the default config — enable it for this scenario.
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallGrabEnabled: true };
    // Tall wall at x=64; body 16 wide at x=46 → right edge 62, 2 px probe gap.
    const wall: Solid = { id: 'wall-g', x: 64, y: -100, width: 16, height: 400 };
    const floor: Solid = { id: 'floor', x: -200, y: 300, width: 800, height: 16 };
    const initial = createPlatformerState(46, 100, config);
    const grabInput = inputWith({ moveX: 1, grab: holdEdge() });
    let state = initial;
    const latchTicks: number[] = [];
    for (let i = 0; i < 12; i++) {
      state = stepPlatformer(state, grabInput, [wall, floor], DT, config).state;
      const l = findMoments(state, 'grabLatch');
      if (l.length > 0) {
        const m = l[0] as Extract<FeelMoment, { kind: 'grabLatch' }>;
        expect(m.solidId).toBe('wall-g');
        latchTicks.push(i);
      }
    }
    expect(latchTicks.length).toBe(1); // engage tick only — not while held
  });

  it('staminaExhausted fires once on the >0 → 0 crossing while grabbing', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallGrabEnabled: true };
    const wall: Solid = { id: 'wall-g', x: 64, y: -100, width: 16, height: 400 };
    const floor: Solid = { id: 'floor', x: -200, y: 300, width: 800, height: 16 };
    // Engage with ~2 ticks of cling stamina left (still-cost 10/s → 0.1667/tick).
    const base = createPlatformerState(46, 100, config);
    const initial: PlatformerState = {
      ...base,
      locomotion: { ...base.locomotion, stamina: 0.3 },
    };
    const grabInput = inputWith({ moveX: 1, grab: holdEdge() });
    let state = initial;
    const exhaustTicks: number[] = [];
    const latchTicks: number[] = [];
    for (let i = 0; i < 6; i++) {
      state = stepPlatformer(state, grabInput, [wall, floor], DT, config).state;
      if (findMoments(state, 'grabLatch').length > 0) latchTicks.push(i);
      if (findMoments(state, 'staminaExhausted').length > 0) exhaustTicks.push(i);
    }
    expect(latchTicks.length).toBe(1); // engage on tick 0
    expect(exhaustTicks.length).toBe(1); // the >0 → ≤0 crossing, once
    expect(exhaustTicks[0]).toBeGreaterThan(latchTicks[0]); // after engage
    // After exhaustion the grab is released; depleted ticks do NOT re-fire.
  });

  // ===========================================================================
  // 5. springLaunch / dashRefill — structured moments supersede interactions.
  // ===========================================================================
  it('spring bounce emits a springLaunch moment with solidId + compiled super flag', () => {
    const config = DEFAULT_PLATFORMER_CONFIG;
    const spring: Solid = {
      id: 'spring-1',
      x: 0,
      y: 100,
      width: 16,
      height: 16,
      spring: { launch: config.springBounceVy, super: false },
    };
    const superSpring: Solid = {
      id: 'super-1',
      x: 100,
      y: 100,
      width: 16,
      height: 16,
      spring: { launch: config.springSuperBounceVy, super: true },
    };
    const floor: Solid = { id: 'floor', x: -200, y: 400, width: 600, height: 16 };

    const mk = (springSolid: Solid) => {
      const base = createPlatformerState(springSolid.x, springSolid.y - 8);
      return { ...base, core: { ...base.core, vy: 200, onGround: false } };
    };

    let state = mk(spring);
    state = stepPlatformer(state, idleInput(), [spring, floor], DT, config).state;
    const m1 = findMoments(state, 'springLaunch');
    expect(m1.length).toBe(1);
    const sm1 = m1[0] as Extract<FeelMoment, { kind: 'springLaunch' }>;
    expect(sm1.solidId).toBe('spring-1');
    expect(sm1.super).toBe(false);
    // Back-compat: the interaction channel still fires alongside.
    expect(state.interactions).toEqual([{ kind: 'spring', entityId: 'spring-1' }]);

    state = mk(superSpring);
    state = stepPlatformer(state, idleInput(), [superSpring, floor], DT, config).state;
    const sm2 = findMoments(state, 'springLaunch')[0] as Extract<FeelMoment, { kind: 'springLaunch' }>;
    expect(sm2.solidId).toBe('super-1');
    expect(sm2.super).toBe(true); // super only for the compiled SuperSpring marker
  });

  it('dashRefill overlap emits a dashRefill moment with the solidId', () => {
    const crystal: Solid = {
      id: 'crystal-1',
      x: 0,
      y: 80,
      width: 16,
      height: 16,
      dashRefill: true,
    };
    const floor: Solid = { id: 'floor', x: -200, y: 400, width: 600, height: 16 };
    const base = createPlatformerState(0, 80);
    // Drain the dash budget so the refill has an observable effect.
    const initial: PlatformerState = {
      ...base,
      abilities: {
        ...base.abilities,
        dash: { ...(base.abilities.dash as object), dashesRemaining: 0 } as typeof base.abilities.dash,
      },
    };
    const state = stepPlatformer(initial, idleInput(), [crystal, floor], DT).state;
    const m = findMoments(state, 'dashRefill');
    expect(m.length).toBe(1);
    expect((m[0] as Extract<FeelMoment, { kind: 'dashRefill' }>).solidId).toBe('crystal-1');
    expect(state.interactions).toEqual([{ kind: 'dashRefill', entityId: 'crystal-1' }]);
  });

  // ===========================================================================
  // 6. Back-compat — the 9 booleans + interactions behave unchanged, and a
  // quiet tick carries the frozen empty moments array.
  // ===========================================================================
  it('booleans still fire on the same ticks and empty moments are reference-stable', () => {
    const floor: Solid = { id: 'floor', x: -200, y: 200, width: 800, height: 16 };
    const initial = createPlatformerState(0, 200 - DEFAULT_PLAYER_HEIGHT - 64);
    const landed = stepUntil(
      initial,
      idleInput(),
      (s) => s.events.justLanded,
      [floor],
    );
    // Boolean pulse on the same tick as the landing moment.
    expect(landed.events.justLanded).toBe(true);
    expect(findMoments(landed, 'landing').length).toBe(1);

    // Next quiet tick: booleans reset, moments frozen-empty (cheap-compare).
    const next = stepPlatformer(landed, idleInput(), [floor], DT).state;
    expect(next.events.justLanded).toBe(false);
    expect(next.moments.length).toBe(0);
    expect(next.moments).toEqual([]);
  });
});
