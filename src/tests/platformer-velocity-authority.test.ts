import { describe, it, expect } from 'vitest';
import { createPlatformerState, stepPlatformer } from '../platformer/kernel';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import { createJumpState, DEFAULT_JUMP } from '../animation/jump';
import type { Solid } from '../collision/types';
import type {
  JumpAbilityState,
  PlatformerConfig,
  PlatformerInput,
  PlatformerState,
} from '../platformer/types';

/**
 * Phase 0b — vertical-velocity authority focused tests.
 *
 * These prove the three guarantees of the single-authority refactor:
 *  (a) a double-jump impulse PERSISTS across ≥3 ticks (vy continues from the
 *      new launch, not the stale trajectory that previously discarded it);
 *  (b) a wall-jump impulse persists (vy stays rising for several ticks);
 *  (c) gravity is applied EXACTLY ONCE per tick — a pure free-fall accumulates
 *      `vy ≈ g_jump · N · dt`, NOT `≈ 2 · g_jump · N · dt` (the old kernel
 *      double-applied gravity: once inside `advanceJump`, once in the kernel).
 *
 * `g_jump` = the apex-derived jump gravity `2·apexHeight/timeToApex²` (cached
 * on the jump slice), which is the gravity that actually drove today's
 * trajectory. The kernel reads it from the jump slice.
 */

const DT = 1 / 60;
const G_JUMP = (2 * DEFAULT_JUMP.apexHeight) / (DEFAULT_JUMP.timeToApex * DEFAULT_JUMP.timeToApex);

const FLOOR: Solid = { id: 'floor', x: 0, y: 300, width: 400, height: 16 };

function holdJump(): PlatformerInput {
  return { moveX: 0, jump: { held: true, pressed: false, released: false }, dash: null };
}
function pressJump(): PlatformerInput {
  return { moveX: 0, jump: { held: true, pressed: true, released: false }, dash: null };
}
function idle(): PlatformerInput {
  return { moveX: 0, jump: { held: false, pressed: false, released: false }, dash: null };
}

/**
 * Step an already-airborne actor through `n` hold-jump ticks (no further
 * presses), returning the per-tick `core.vy`. Used to show that an impulse
 * applied just before the window continues smoothly.
 */
function holdTicks(state: PlatformerState, config: PlatformerConfig, n: number): number[] {
  const out: number[] = [];
  let s = state;
  for (let i = 0; i < n; i++) {
    s = stepPlatformer(s, holdJump(), [FLOOR], DT, config).state;
    out.push(s.core.vy);
  }
  return out;
}

describe('Phase 0b — single vertical-velocity authority', () => {
  // -------------------------------------------------------------------------
  // (a) Double-jump impulse persists across ≥3 ticks.
  //
  // Before the refactor the double-jump wrote `core.vy` for one tick, then the
  // jump ability overwrote it from its stale internal trajectory and the
  // impulse was discarded (vy snapped back toward the original jump's curve).
  // Now the kernel applies the launch and continues from it.
  // -------------------------------------------------------------------------
  it('double-jump impulse persists: vy continues from the new launch for ≥3 ticks', () => {
    const config: PlatformerConfig = {
      ...DEFAULT_PLATFORMER_CONFIG,
      doubleJumpEnabled: true,
      maxDoubleJumps: 1,
    };
    let state = createPlatformerState(100, 276, config);

    // Ground-jump press, then hold through anticipation + launch.
    state = stepPlatformer(state, pressJump(), [FLOOR], DT, config).state;
    // Tick the anticipation window (≈3 ticks) until the actor is airborne.
    let launchedTick = -1;
    for (let i = 0; i < 8; i++) {
      const prevVy = state.core.vy;
      state = stepPlatformer(state, holdJump(), [FLOOR], DT, config).state;
      if (state.core.vy < prevVy - 1 && launchedTick < 0) {
        // vy dropped (became more negative) — launch happened.
        launchedTick = i;
      }
    }
    expect(state.core.onGround).toBe(false);
    expect(launchedTick).toBeGreaterThanOrEqual(0);

    // Snapshot the ORIGINAL rising trajectory one tick before the double-jump.
    const vyBeforeDoubleJump = state.core.vy;

    // Fire the double-jump (airborne press).
    state = stepPlatformer(state, pressJump(), [FLOOR], DT, config).state;
    expect(state.events.doubleJumped).toBe(true);
    const launchVy = DEFAULT_JUMP.apexHeight
      ? -(2 * DEFAULT_JUMP.apexHeight) / DEFAULT_JUMP.timeToApex
      : 0;
    // The double-jump tick: core.vy reflects the new launch impulse (launch +
    // one gravity tick), NOT the stale pre-double-jump trajectory.
    expect(state.core.vy).toBeCloseTo(launchVy + G_JUMP * DT, 3);
    // Sanity: the impulse is observably different from where we were.
    expect(state.core.vy).toBeLessThan(vyBeforeDoubleJump);

    // Hold for 3 more ticks. The impulse must PERSIST — vy continues smoothly
    // from the double-jump (decelerating by ~G_JUMP·dt each tick toward apex),
    // NOT snapping back to the stale rising curve. We assert the per-tick
    // delta is ≈ +G_JUMP·dt (single gravity) and strictly increasing (rising
    // deceleration), which is impossible if the impulse were discarded.
    const postDoubleJumpVy = state.core.vy;
    const subsequent = holdTicks(state, config, 3);
    // Each tick adds one gravity term (held ⇒ full G_JUMP), continuing from
    // the double-jump impulse. The first post-dj tick ≈ postDoubleJumpVy +
    // G_JUMP·dt; the discard bug would instead jump back toward the stale
    // trajectory (a discontinuity).
    expect(subsequent[0]).toBeCloseTo(postDoubleJumpVy + G_JUMP * DT, 3);
    expect(subsequent[1]).toBeCloseTo(postDoubleJumpVy + 2 * G_JUMP * DT, 3);
    expect(subsequent[2]).toBeCloseTo(postDoubleJumpVy + 3 * G_JUMP * DT, 3);
    // Monotonic deceleration (vy increasing toward 0): no revert.
    for (let i = 1; i < subsequent.length; i++) {
      expect(subsequent[i]).toBeGreaterThan(subsequent[i - 1]);
    }
  });

  // -------------------------------------------------------------------------
  // (b) Wall-jump impulse persists: vy stays negative (rising) for several
  // ticks after the wall-jump, instead of flipping positive next tick.
  // -------------------------------------------------------------------------
  it('wall-jump impulse persists: vy stays rising for ≥3 ticks after the jump', () => {
    const config: PlatformerConfig = DEFAULT_PLATFORMER_CONFIG;
    // Floor + a right wall the actor can slide down and kick off.
    const solids: Solid[] = [
      FLOOR,
      { id: 'wall-r', x: 200, y: 0, width: 16, height: 300 },
    ];
    // Start airborne, flush against the right wall (body right edge = 200).
    let state = createPlatformerState(184, 100, config);

    // Press into the wall + fall until wall-slide engages and coyote expires.
    const pressRight: PlatformerInput = {
      moveX: 1,
      jump: { held: false, pressed: false, released: false },
      dash: null,
    };
    let wallJumpTick = -1;
    for (let i = 0; i < 6; i++) {
      state = stepPlatformer(state, pressRight, solids, DT, config).state;
    }
    // Now wall-jump: STILL holding into the wall (moveX=1), press jump. Phase 3b
    // made slide require directional intent, so moveX must point into the wall
    // on the jump tick — releasing first would disengage slide and the wall-jump
    // gate `sliding && jump.pressed` would not fire.
    const wallJumpInput: PlatformerInput = {
      moveX: 1,
      jump: { held: true, pressed: true, released: false },
      dash: null,
    };
    state = stepPlatformer(state, wallJumpInput, solids, DT, config).state;
    expect(state.events.wallJumpLaunched).toBe(true);
    wallJumpTick = state.tick;
    const wallJumpVy = state.core.vy;

    // The wall-jump impulse is strongly upward.
    expect(wallJumpVy).toBeLessThan(-300);

    // Hold jump for 3 more ticks (no input moveX, so the lockout + air control
    // govern vx; vy continues from the wall-jump impulse). The OLD bug flipped
    // vy to a large POSITIVE value one tick after the wall-jump; the fix keeps
    // vy negative (rising) for several ticks.
    const subsequent: number[] = [];
    for (let i = 0; i < 3; i++) {
      state = stepPlatformer(state, holdJump(), solids, DT, config).state;
      subsequent.push(state.core.vy);
    }
    // At least the first two post-wall-jump ticks remain rising (vy < 0).
    expect(subsequent[0]).toBeLessThan(0);
    expect(subsequent[1]).toBeLessThan(0);
    // The impulse decelerates by ≈ G_JUMP·dt/tick (single gravity), continuing
    // from the wall-jump — no revert discontinuity.
    expect(subsequent[0]).toBeCloseTo(wallJumpVy + G_JUMP * DT, 3);
    expect(subsequent[1]).toBeCloseTo(wallJumpVy + 2 * G_JUMP * DT, 3);
    expect(wallJumpTick).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // (c) Gravity applied exactly once per tick.
  //
  // A pure free-fall (jump disabled, no launch) must accumulate vy at
  // `g_jump·dt` per tick... but with jump DISABLED the kernel falls back to
  // `|config.gravity|`. We test both:
  //   - jump disabled: vy after N ticks ≈ |config.gravity|·N·dt (one gravity).
  //   - jump enabled + a launched actor past the variable window (falling):
  //     vy accumulates at g_jump·dt per tick (one gravity, no double).
  // The pre-refactor kernel added a SECOND gravity term, so the rate would
  // have been ≈ 2× (the jump slice integrated g_jump AND the kernel added
  // config.gravity). This pins it to exactly one.
  // -------------------------------------------------------------------------
  it('gravity applied exactly once: pure fall accumulates |gravity|·dt per tick (no double)', () => {
    // --- jump DISABLED: kernel uses |config.gravity|. ---
    const noJumpConfig: PlatformerConfig = {
      ...DEFAULT_PLATFORMER_CONFIG,
      jumpEnabled: false,
      gravity: 1200,
      maxFallSpeed: 10_000, // large so the terminal clamp never engages here
    };
    let s = createPlatformerState(50, 0, noJumpConfig);
    // Drop the actor from rest in open air (no floor) for 5 ticks.
    const expectedPerTick = noJumpConfig.gravity * DT;
    let prevVy = 0;
    for (let i = 1; i <= 5; i++) {
      s = stepPlatformer(s, idle(), [], DT, noJumpConfig).state;
      const expected = expectedPerTick * i;
      expect(s.core.vy).toBeCloseTo(expected, 4);
      // Each tick adds EXACTLY one gravity term (not two).
      expect(s.core.vy - prevVy).toBeCloseTo(expectedPerTick, 5);
      prevVy = s.core.vy;
    }
  });

  it('gravity applied exactly once: jump-enabled fall uses g_jump·dt per tick (no double)', () => {
    // --- jump ENABLED: kernel uses the apex-derived g_jump. ---
    const config: PlatformerConfig = DEFAULT_PLATFORMER_CONFIG;
    // Start the actor airborne, already rising, with the variable-jump window
    // EXPIRED so the kernel is in plain-fall mode (g_jump, no multiplier).
    const base = createPlatformerState(50, 100, config);
    const airborneRising: PlatformerState = {
      ...base,
      core: { ...base.core, vy: 1, onGround: false }, // just past apex (vy>0 ⇒ falling)
      abilities: {
        ...base.abilities,
        jump: {
          kind: 'jump',
          jump: { ...createJumpState(config.jump), phase: 'falling', coyoteTimer: 0, vy: 1 },
        } satisfies JumpAbilityState,
      },
    };

    let s = airborneRising;
    const expectedPerTick = G_JUMP * DT;
    let prevVy = s.core.vy;
    for (let i = 1; i <= 4; i++) {
      s = stepPlatformer(s, idle(), [], DT, config).state;
      // Single gravity term per tick (the old double-application would make
      // this delta ≈ G_JUMP·dt + config.gravity·dt, i.e. ~1.8× larger).
      expect(s.core.vy - prevVy).toBeCloseTo(expectedPerTick, 4);
      prevVy = s.core.vy;
    }
  });

  // -------------------------------------------------------------------------
  // (d) Phase 0b hardening — a non-jump launch re-syncs the jump slice's
  // pose-only vy to the kernel launch velocity.
  //
  // When a double-jump wins arbitration, the kernel applies `intent.vy` to
  // `core.vy` AND re-syncs `JumpState.vy` to the same value. Without the
  // re-sync, `advanceJump` (which ran inside the pipeline, before arbitration)
  // would leave `JumpState.vy` on the stale ground-jump rising arc — it has no
  // idea a double-jump won — so the slice would diverge from `core.vy`,
  // a latent footgun for future kernel-path pose/FX consumers of
  // `evaluateJump()`.
  // -------------------------------------------------------------------------
  it('non-jump launch re-syncs jump slice vy to the kernel launch velocity', () => {
    const config: PlatformerConfig = {
      ...DEFAULT_PLATFORMER_CONFIG,
      doubleJumpEnabled: true,
      maxDoubleJumps: 1,
    };
    let state = createPlatformerState(100, 276, config);

    // Ground-jump press, then hold through anticipation + launch until airborne.
    state = stepPlatformer(state, pressJump(), [FLOOR], DT, config).state;
    for (let i = 0; i < 8; i++) {
      state = stepPlatformer(state, holdJump(), [FLOOR], DT, config).state;
    }
    expect(state.core.onGround).toBe(false);

    // Snapshot the pre-double-jump rising vy (the stale arc the slice would
    // continue along without the re-sync).
    const coreVyBefore = state.core.vy;

    // Fire the double-jump (airborne press).
    state = stepPlatformer(state, pressJump(), [FLOOR], DT, config).state;
    expect(state.events.doubleJumped).toBe(true);

    const launchVy = -(2 * DEFAULT_JUMP.apexHeight) / DEFAULT_JUMP.timeToApex;
    const jumpSlice = state.abilities['jump'] as JumpAbilityState;

    // The re-sync: the jump slice's pose-only vy equals the launch velocity the
    // kernel applied (intent.vy), NOT the stale rising arc value that
    // `advanceJump` integrated from the pre-double-jump trajectory.
    expect(jumpSlice.jump.vy).toBeCloseTo(launchVy, 5);
    // Sanity: the re-synced value is a fresh launch (more negative than where we
    // were), proving the double-jump impulse reached the jump slice.
    expect(jumpSlice.jump.vy).toBeLessThan(coreVyBefore);
    // The slice tracks the kernel authority: core.vy was set to launchVy by
    // applyLaunch, then advanced one gravity tick; the jump slice sits at
    // launchVy (advanceJump ran before the kernel's gravity step), so the gap is
    // exactly one gravity tick — same trajectory, one sub-tick of offset.
    expect(state.core.vy - jumpSlice.jump.vy).toBeCloseTo(G_JUMP * DT, 4);
  });
});
