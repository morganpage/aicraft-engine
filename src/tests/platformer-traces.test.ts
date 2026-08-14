import { describe, it, expect } from 'vitest';
import { createPlatformerState } from '../platformer/kernel';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import { createJumpState } from '../animation/jump';
import type { Solid } from '../collision/types';
import type {
  JumpAbilityState,
  PlatformerConfig,
  PlatformerState,
} from '../platformer/types';
import {
  idleInput,
  makeInput,
  replayHashFor,
  runTrace,
  runTraceDetailed,
  traceHash,
} from './platformer-trace-harness';

/**
 * Platformer multi-tick baseline traces.
 *
 * Each scenario pins the behavior of `stepPlatformer` via three layers:
 *   1. `expect(trace).toMatchInlineSnapshot()` — the full per-tick trace.
 *   2. `expect(traceHash(trace)).toBe(<n>)` — a compact FNV-1a canary of the trace.
 *   3. `expect(replayHashFor(...)).toBe(<n>)` — a canary of the recorded replay.
 *
 * Phase 0b/0c/0d/0e authority collapse (this wave): `core.vy` is now the SINGLE
 * vertical authority. The kernel applies gravity exactly once (the apex-derived
 * `g_jump`, not `config.gravity`), and jump-class impulses flow as
 * `LaunchIntent`s through the kernel. This FIXED the double-jump and wall-jump
 * impulse-discard bugs (scenarios 1 + 2) and slightly shifted every other
 * trajectory (the old per-tick `+config.gravity*dt` offset is gone — an
 * intended feel change documented per-scenario). All inline snapshots, trace
 * hashes, and replay hashes were re-baselined for this; the per-scenario
 * comments call out the intended diff.
 *
 * Phase 1 (replay physics versioning): `replayHashFor` canaries were
 * re-baselined because `physicsVersion` is now a required `ReplayConfig`
 * field and flows through `canonicalize` into the hash (intended — a config
 * change MUST shift the replay hash). The `traceHash` canaries are UNCHANGED:
 * they hash the trace, not the config.
 *
 * Phase 3 (rate-based accel + decaying wall-slide): `applyHorizontalInput` is
 * now `approach`-based at `runAccel`/`overspeedReduce` rates (retiring the
 * dt-free `airControl` lerp), and the wall-slide clamp eases from
 * `wallSlideStartMax` toward `maxFallSpeed` over `wallSlideTime` with a
 * directional-intent gate. `physicsVersion` bumped 2→3. Scenarios 1/3/4 are
 * vertical-only → `traceHash` UNCHANGED, but every `replayHashFor` shifts
 * (config fields renamed/added + version). Scenario 2 (wall-jump) trace
 * CHANGED (decaying clamp + rate-based lockout + intent-held jump tick).
 * Scenario 5 (dash→ground) was EXTENDED past dash expiry to show the post-dash
 * `vx` BLEEDING toward `moveSpeed` at `overspeedReduce` (no longer an instant
 * clobber) — its trace + both hashes shifted.
 *
 * Phase 4 (moveY + 8-directional dash + fast-fall + end-dash velocity):
 * `PlatformerInput` was widened (the separate `climb` field removed, replaced
 * by unified `moveY`), the max-fall cap is now mutable (`locomotion.maxFallCurrent`
 * easing toward `fastMaxFallSpeed` while `moveY === 1`), wall-slide is suppressed
 * while `moveY === 1`, dash captures an 8-dir `(dirX, dirY)` with diagonal
 * normalization (÷ √2), and a non-downward dash sets an ABSOLUTE end-dash
 * velocity at expiry (`dashSpeed × endDashSpeedFactor`). `physicsVersion` bumped
 * 3→4. Scenarios 1/2/3/4 set no `moveY` and never reach terminal velocity, and
 * none dash, so their TRACES are UNCHANGED — only every `replayHashFor` shifts
 * (config gained `fastMaxFallSpeed`/`fastMaxAccel`/`endDashSpeedFactor`/
 * `endDashUpMult` + version). Scenario 5 (dash→ground) trace CHANGED: the
 * horizontal dash now ends at `endDashSpeed` (420 × 0.67 ≈ 281) instead of the
 * full `dashSpeed` (420), so the post-expiry overspeed bleed starts from a
 * lower vx and reaches `moveSpeed` sooner (tick 16 vs 18) — its trace + both
 * hashes shifted.
 *
 * Phase 5 (super jump / super wall jump / hyper / wavedash + ducking):
 * `LocomotionState` gained `ducking` / `lastDashDirX/Y` / `superJumpGraceTimer`
 * / `dashing`; `DashAbilityState` gained `dashStartedOnGround` / `hyperSlide`;
 * `PlatformerConfig` gained the super/hyper/duck fields; a new `dashTechAbility`
 * (stateless slice `'dashTech'`) joined the pipeline; `physicsVersion` bumped
 * 4→5. NONE of scenarios 1–5 trigger dash-tech (no down-diagonal ground dash, no
 * jump within super-jump grace after a horizontal dash, no straight-up dash into
 * a wall), and the ducking latch is never set, so every `traceHash` is UNCHANGED
 * — only every `replayHashFor` shifts (config gained the 8 super/hyper/duck
 * fields + the new `dashTech` ability slice + the two new `dash` slice fields in
 * the initial state + version). The dash-tech moves themselves are exercised in
 * `platformer-dash-tech.test.ts`.
 *
 * DEFERRED (add when the dependency lands):
 *   - "Grab holds against a wall (30 ticks)" — needs wall-grab ability → Wave 7.
 *     (LANDED in Phase 6 as scenario 6.)
 *
 * Phase 7 (upward CC + dash CC + wall-speed retention): three new collision-
 * time adjustments in the kernel's Step 6, all using pure probe/`aabbOverlap`
 * clearance tests. `PlatformerConfig` gained `upwardCornerCorrection` (8),
 * `dashCornerCorrection` (8), `wallSpeedRetentionTime` (0.06);
 * `LocomotionState` gained `retainedVx` + `wallSpeedRetentionTimer`;
 * `physicsVersion` bumped 6→7. NONE of scenarios 1–6 trigger CC or a
 * retention restore (no 1-tile ceiling lips, no dash-into-wall-with-lip, no
 * brief wall-brush that clears within 0.06s — and the wall-jump brush is
 * explicitly cancelled by the retention guard when the actor's vx flips sign
 * on the launch tick), so every `traceHash` is UNCHANGED; only every
 * `replayHashFor` shifts (3 new config fields + 2 new locomotion fields +
 * version). The CC + retention mechanisms themselves are exercised in
 * `platformer-corner-correction.test.ts`.
 *
 * Phase 7 wall-speed-retention FIX (no physicsVersion re-bump — still v7):
 * `LocomotionState` gained a third retention field, the per-brush latch
 * `wallSpeedRetaining`, which breaks the re-stash-at-expiry cycle (a sustained
 * brush used to re-stash the instant the timer hit 0, so retainedVx was never
 * truly discarded). The latch is part of the hashed initial state, so every
 * `replayHashFor` shifted again to its final fixed value; `traceHash` is
 * UNCHANGED (the latch is not part of a trace row). The fix itself is
 * exercised by the "sustained brush does NOT re-stash after the 0.06s window
 * expires" test in `platformer-corner-correction.test.ts`.
 *
 * Mantle wave (ledge mantle + direction-aware climb-jump; physicsVersion
 * 11→12): `LaunchSource` gained `'climbJump'` + `'mantle'`, `PlatformerEvents`
 * gained `climbJumpLaunched` + `mantled` (and `wallJumpLaunched` was
 * deliberately widened to include the away climb-hop), `WallGrabAbilityState`
 * gained `regrabTimer` + the `mantle` assist record, `LocomotionMode` gained
 * `'mantle'`, and `PlatformerConfig` gained the 7 mantle/climb-jump fields.
 * NONE of scenarios 1–7 grab+jump (scenario 6 only clings), so every
 * `traceHash` is UNCHANGED; every `replayHashFor` shifted (widened
 * config/events/state + version). The four new golden scenarios 8–11 pin the
 * mantle-era trajectories: neutral climb-jump + re-grab, away climb-hop, a
 * clear mantle + landing, and a blocked mantle under an overhang.
 */

// ---------------------------------------------------------------------------
// Shared geometry helpers (scenario-local literals preferred, but a couple of
// shapes recur — centralize only what is genuinely shared).
// ---------------------------------------------------------------------------

/** A simple 400-wide floor at y=300 (top surface). */
const FLOOR_300: Solid = { id: 'floor', x: 0, y: 300, width: 400, height: 16 };

/** Final world X of a trace (its last row). */
function finalX(trace: readonly { x: number }[]): number {
  return trace[trace.length - 1].x;
}

describe('platformer multi-tick baseline traces', () => {
  // =========================================================================
  // 1. Double-jump impulse persistence (Phase 0b fix).
  //
  // FIXED (was a known bug): the double-jump ability used to write its launch
  // impulse to `core.vy` for exactly one tick; the next tick the jump ability
  // re-derived `core.vy` from its own internally-tracked `JumpState.vy` (which
  // never saw the double jump) and the impulse was discarded. Phase 0b made
  // `core.vy` the single vertical authority: abilities emit a `LaunchIntent`
  // and the kernel applies the winner, so the impulse now PERSISTS — vy
  // continues from the new launch instead of reverting to the stale rising
  // trajectory. The trace below shows vy continuing smoothly downward (toward
  // 0 / apex) after the double-jump tick, not snapping back to the original
  // jump's vy.
  //
  // NOTE on timing: the spec table lists "(3 ticks)" but a ground jump spends
  // `anticipationDuration` (0.05 s ≈ 3 ticks) in the anticipating phase
  // before launching, AND the actor first reports `onGround=false` on the tick
  // AFTER launch. So the second press must land at least one tick past launch
  // to clear the double-jump `!core.onGround` guard. The script is sized to
  // actually reach the airborne window so the double-jump fires (verified via
  // the `doubleJumped` event count) and the persistence is observable.
  // =========================================================================
  it('double-jump impulse persists across ticks (single vy authority)', () => {
    const config: PlatformerConfig = {
      ...DEFAULT_PLATFORMER_CONFIG,
      doubleJumpEnabled: true,
      maxDoubleJumps: 1,
    };
    const solids: Solid[] = [FLOOR_300];
    const initial = createPlatformerState(100, 276, config);

    // tick0 ground-jump press; ticks1-4 hold through anticipation + launch
    // (launch lands on tick 3; the actor is first airborne on tick 4); tick5
    // second press in air (double jump); ticks6-7 hold. Jump is HELD
    // throughout so the only vy discontinuity is the double-jump discard, not
    // a variable-height cutoff.
    const inputs = [
      makeInput({ jump: 'press' }),
      makeInput({ jump: 'hold' }),
      makeInput({ jump: 'hold' }),
      makeInput({ jump: 'hold' }),
      makeInput({ jump: 'hold' }),
      makeInput({ jump: 'press' }),
      makeInput({ jump: 'hold' }),
      makeInput({ jump: 'hold' }),
    ];

    const { trace, events } = runTraceDetailed({ initial, inputs, solids, config });
    // The double-jump ability DOES fire (budget + airborne conditions met) —
    // the bug is that its impulse survives only this one tick.
    expect(events.filter((e) => e.doubleJumped).length).toBe(1);

    expect(trace).toMatchInlineSnapshot(`
      [
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "anticipating",
          "tick": 0,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 100,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "anticipating",
          "tick": 1,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 100,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "anticipating",
          "tick": 2,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 100,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "anticipating",
          "tick": 3,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 100,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 4,
          "vx": 0,
          "vy": -322.44898,
          "wallSliding": false,
          "x": 100,
          "y": 270.62585,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 5,
          "vx": 0,
          "vy": -322.44898,
          "wallSliding": false,
          "x": 100,
          "y": 265.251701,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 6,
          "vx": 0,
          "vy": -302.040816,
          "wallSliding": false,
          "x": 100,
          "y": 260.217687,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 7,
          "vx": 0,
          "vy": -281.632653,
          "wallSliding": false,
          "x": 100,
          "y": 255.52381,
        },
      ]
    `);
    expect(traceHash(trace)).toBe(245433877);
    // Phase 4: trace UNCHANGED (no moveY/dash, never reaches terminal velocity),
    // replay hash shifts because config gained fastMaxFallSpeed/fastMaxAccel/
    // endDashSpeedFactor/endDashUpMult and physicsVersion bumped 3→4.
    // Phase 5: trace UNCHANGED (no dash-tech triggered here), replay hash shifts
    // because config gained the super/hyper/duck fields and physicsVersion 4→5.
    // Phase 6: trace UNCHANGED (no grab), replay hash shifts (config gained the
    // wall-grab fields + new wallGrab ability slice + locomotion.stamina +
    // physicsVersion 5→6).
    // Phase 7: trace UNCHANGED (no CC/retention triggered — vertical-only,
    // no walls/ceilings), replay hash shifts (config gained
    // upwardCornerCorrection/dashCornerCorrection/wallSpeedRetentionTime +
    // locomotion.retainedVx/wallSpeedRetentionTimer/wallSpeedRetaining +
    // physicsVersion 6→7).
    // Phase 8: trace UNCHANGED (no spring/crystal solid — the spring detection
    // path is kernel-only and inert without a `spring` solid in `solids[]`),
    // replay hash shifts (config gained springBounceVy/springSuperBounceVy/
    // springVarJumpTime/springAutoJumpTime + new `interactions` field in the
    // initial state + physicsVersion 7→8; Phase 9 re-shifted (8→9 version
    // bump; moveX widened to number, digital trace unchanged); Phase 10
    // re-shifted (new groundDuckEnabled config field + 9→10 version; digital
    // trace unchanged).
    expect(replayHashFor(42, initial, inputs, config)).toBe(2415347297);
  });

  // =========================================================================
  // 2. Wall-jump impulse persistence (Phase 0b fix) — AWAY LEAP via the
  // post-slide grace window (physics v13).
  //
  // FIXED (was a known bug): same root cause as scenario 1. The wall-slide
  // ability used to set `core.vy = wallJumpVy` directly; the next tick the
  // jump ability overwrote `core.vy` with its stale falling-trajectory vy,
  // discarding the upward wall-jump impulse (vy flipped from strongly negative
  // to strongly positive one tick later). Phase 0b: the wall-jump now emits a
  // `LaunchIntent` the kernel applies, so the upward impulse PERSISTS — vy
  // stays negative (rising) for several ticks after the wall-jump instead of
  // snapping back to a fall.
  //
  // v13: the away leap now fires from the GRACE window. The slide disengages
  // the tick the direction leaves the wall, so the script releases INTO-wall
  // at tick 5 (grace arms, `wallJumpGraceTime` 0.1 s) and presses jump at
  // tick 6 with neutral input → the classic away-from-wall push. (Before v13
  // the script had to keep holding INTO the wall through the press — under
  // v13 that press is the straight-up hop of scenario 2b instead.)
  //
  // Setup: actor starts airborne flush against a right wall, holds into it,
  // falls until wall-slide engages and coyote expires, releases, then jumps.
  // =========================================================================
  it('wall-jump impulse persists across ticks (single vy authority)', () => {
    const config: PlatformerConfig = DEFAULT_PLATFORMER_CONFIG;
    const solids: Solid[] = [
      FLOOR_300,
      { id: 'wall-r', x: 200, y: 0, width: 16, height: 300 },
    ];
    // Right edge (184+16=200) flush against the wall; high enough to fall
    // several ticks (coyote expires) before the wall-jump.
    const initial = createPlatformerState(184, 100, config);

    // ticks0-4: hold INTO the wall + fall (wall-slide engages ~tick1; the
    // decaying clamp eases vy upward from wallSlideStartMax). tick5: RELEASE
    // the direction — the slide disengages and the post-slide grace window
    // arms (0.1 s ≈ 6 ticks). tick6: neutral direction + jump press → the
    // grace leap fires the classic away push. ticks7-11: stay neutral; the
    // wall-jump lockout (forceMoveX) carries vx, and vy stays negative
    // (rising) for several ticks — the impulse is NOT discarded.
    const inputs = [
      makeInput({ moveX: 1, jump: 'idle' }),
      makeInput({ moveX: 1, jump: 'idle' }),
      makeInput({ moveX: 1, jump: 'idle' }),
      makeInput({ moveX: 1, jump: 'idle' }),
      makeInput({ moveX: 1, jump: 'idle' }),
      makeInput({ moveX: 0, jump: 'idle' }),
      makeInput({ moveX: 0, jump: 'press' }),
      makeInput({ moveX: 0, jump: 'idle' }),
      makeInput({ moveX: 0, jump: 'idle' }),
      makeInput({ moveX: 0, jump: 'idle' }),
      makeInput({ moveX: 0, jump: 'idle' }),
      makeInput({ moveX: 0, jump: 'idle' }),
    ];

    const trace = runTrace({ initial, inputs, solids, config });

    expect(trace).toMatchInlineSnapshot(`
      [
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 0,
          "vx": 0,
          "vy": 20.408163,
          "wallSliding": false,
          "x": 184,
          "y": 100.340136,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 1,
          "vx": 0,
          "vy": 40.816327,
          "wallSliding": true,
          "x": 184,
          "y": 101.020408,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 2,
          "vx": 0,
          "vy": 61.22449,
          "wallSliding": true,
          "x": 184,
          "y": 102.040816,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 3,
          "vx": 0,
          "vy": 81.632653,
          "wallSliding": true,
          "x": 184,
          "y": 103.401361,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 4,
          "vx": 0,
          "vy": 102.040816,
          "wallSliding": true,
          "x": 184,
          "y": 105.102041,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 5,
          "vx": 0,
          "vy": 122.44898,
          "wallSliding": false,
          "x": 184,
          "y": 107.142857,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 6,
          "vx": -200,
          "vy": -359.591837,
          "wallSliding": false,
          "x": 180.666667,
          "y": 101.14966,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 7,
          "vx": -200,
          "vy": -100.979592,
          "wallSliding": false,
          "x": 177.333333,
          "y": 99.466667,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 8,
          "vx": -200,
          "vy": -49.959184,
          "wallSliding": false,
          "x": 174,
          "y": 98.634014,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 9,
          "vx": -200,
          "vy": 1.061224,
          "wallSliding": false,
          "x": 170.666667,
          "y": 98.651701,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 10,
          "vx": -200,
          "vy": 21.469388,
          "wallSliding": false,
          "x": 167.333333,
          "y": 99.009524,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 11,
          "vx": -200,
          "vy": 41.877551,
          "wallSliding": false,
          "x": 164,
          "y": 99.707483,
        },
      ]
    `);
    expect(traceHash(trace)).toBe(2645614738);
    expect(replayHashFor(42, initial, inputs, config)).toBe(4081963575);
  });

  // =========================================================================
  // 2b. Direction-aware into-wall wall-jump — STRAIGHT UP (physics v13).
  //
  // The bug this fixes: the wall-jump push used to always point AWAY from the
  // wall, ignoring input. Since the slide only stays engaged while holding
  // INTO the wall, sliding + jump ALWAYS flung the player off the wall it was
  // holding into — chimney-climbing a single wall was impossible. v13: a jump
  // made while sliding (into-wall by definition of the slide gate) launches
  // straight up (`vx = 0`, facing the wall). The kernel resolves
  // `forceMoveX = sign(0) = 0`, so the lockout PRESERVES vx ≈ 0 (no sideways
  // drift) while suppressing steering through `wallJumpLockTime` — a
  // committed vertical hop. vy stays negative (rising) for several ticks: the
  // upward impulse persists exactly like the away leap above.
  // =========================================================================
  it('into-wall wall-jump goes straight up (vx pinned at 0 through the lockout)', () => {
    const config: PlatformerConfig = DEFAULT_PLATFORMER_CONFIG;
    const solids: Solid[] = [
      FLOOR_300,
      { id: 'wall-r', x: 200, y: 0, width: 16, height: 300 },
    ];
    const initial = createPlatformerState(184, 100, config);

    // ticks0-5: hold INTO the wall + fall (slide engages ~tick1). tick6:
    // STILL holding into the wall, press jump → straight-up hop. ticks7-8:
    // keep holding in — the lockout suppresses steering, vx stays 0, the
    // actor rises flush beside the wall. ticks9-11: release; still airborne.
    const inputs = [
      makeInput({ moveX: 1, jump: 'idle' }),
      makeInput({ moveX: 1, jump: 'idle' }),
      makeInput({ moveX: 1, jump: 'idle' }),
      makeInput({ moveX: 1, jump: 'idle' }),
      makeInput({ moveX: 1, jump: 'idle' }),
      makeInput({ moveX: 1, jump: 'idle' }),
      makeInput({ moveX: 1, jump: 'press' }),
      makeInput({ moveX: 1, jump: 'idle' }),
      makeInput({ moveX: 1, jump: 'idle' }),
      makeInput({ moveX: 0, jump: 'idle' }),
      makeInput({ moveX: 0, jump: 'idle' }),
      makeInput({ moveX: 0, jump: 'idle' }),
    ];

    const trace = runTrace({ initial, inputs, solids, config });

    expect(trace).toMatchInlineSnapshot(`
      [
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 0,
          "vx": 0,
          "vy": 20.408163,
          "wallSliding": false,
          "x": 184,
          "y": 100.340136,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 1,
          "vx": 0,
          "vy": 40.816327,
          "wallSliding": true,
          "x": 184,
          "y": 101.020408,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 2,
          "vx": 0,
          "vy": 61.22449,
          "wallSliding": true,
          "x": 184,
          "y": 102.040816,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 3,
          "vx": 0,
          "vy": 81.632653,
          "wallSliding": true,
          "x": 184,
          "y": 103.401361,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 4,
          "vx": 0,
          "vy": 102.040816,
          "wallSliding": true,
          "x": 184,
          "y": 105.102041,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 5,
          "vx": 0,
          "vy": 122.44898,
          "wallSliding": true,
          "x": 184,
          "y": 107.142857,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 6,
          "vx": 0,
          "vy": -359.591837,
          "wallSliding": false,
          "x": 184,
          "y": 101.14966,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 7,
          "vx": 0,
          "vy": -100.979592,
          "wallSliding": false,
          "x": 184,
          "y": 99.466667,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 8,
          "vx": 0,
          "vy": -49.959184,
          "wallSliding": false,
          "x": 184,
          "y": 98.634014,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 9,
          "vx": 0,
          "vy": 1.061224,
          "wallSliding": false,
          "x": 184,
          "y": 98.651701,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 10,
          "vx": 0,
          "vy": 21.469388,
          "wallSliding": false,
          "x": 184,
          "y": 99.009524,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 11,
          "vx": 0,
          "vy": 41.877551,
          "wallSliding": false,
          "x": 184,
          "y": 99.707483,
        },
      ]
    `);
    expect(traceHash(trace)).toBe(3439204586);
    expect(replayHashFor(42, initial, inputs, config)).toBe(2779025927);
  });

  // =========================================================================
  // 3. Held vs tapped ground-jump apex (variable height).
  //
  // PASSES today for ground jump: the kernel's variable-height cutoff (applied
  // while `!jumpHeld`, rising, and inside the variable-jump window) makes a
  // tapped jump peak lower than a held jump. Phase 0b moved this from the jump
  // slice's internal integration to the kernel's single-authority gravity step,
  // so the absolute vy/x/y values shifted slightly from the old baseline (the
  // old per-tick `+config.gravity*dt` offset is gone) but the qualitative
  // relationship (held peaks higher than tapped) is preserved.
  //
  // Recorded expectation (asserted below + visible in trace rows): held apex
  // y < tapped apex y — the held jump reaches a SMALLER y (higher, since +Y is
  // down) than the tapped jump. Both traces are 20 ticks.
  // =========================================================================
  it('held ground jump peaks higher than tapped ground jump', () => {
    const config: PlatformerConfig = DEFAULT_PLATFORMER_CONFIG;
    const solids: Solid[] = [FLOOR_300];

    const heldInitial = createPlatformerState(50, 276, config);
    const heldInputs = [
      makeInput({ jump: 'press' }),
      ...Array.from({ length: 19 }, () => makeInput({ jump: 'hold' })),
    ];
    const heldTrace = runTrace({ initial: heldInitial, inputs: heldInputs, solids, config });

    const tappedInitial = createPlatformerState(50, 276, config);
    const tappedInputs = [
      makeInput({ jump: 'press' }),
      ...Array.from({ length: 19 }, () => makeInput({ jump: 'idle' })),
    ];
    const tappedTrace = runTrace({
      initial: tappedInitial,
      inputs: tappedInputs,
      solids,
      config,
    });

    // Held reaches higher (smaller min y) than tapped.
    const heldApexY = Math.min(...heldTrace.map((r) => r.y));
    const tappedApexY = Math.min(...tappedTrace.map((r) => r.y));
    expect(heldApexY).toBeLessThan(tappedApexY);

    expect(heldTrace).toMatchInlineSnapshot(`
      [
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "anticipating",
          "tick": 0,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "anticipating",
          "tick": 1,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "anticipating",
          "tick": 2,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "anticipating",
          "tick": 3,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 4,
          "vx": 0,
          "vy": -322.44898,
          "wallSliding": false,
          "x": 50,
          "y": 270.62585,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 5,
          "vx": 0,
          "vy": -302.040816,
          "wallSliding": false,
          "x": 50,
          "y": 265.591837,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 6,
          "vx": 0,
          "vy": -281.632653,
          "wallSliding": false,
          "x": 50,
          "y": 260.897959,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 7,
          "vx": 0,
          "vy": -261.22449,
          "wallSliding": false,
          "x": 50,
          "y": 256.544218,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 8,
          "vx": 0,
          "vy": -240.816327,
          "wallSliding": false,
          "x": 50,
          "y": 252.530612,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 9,
          "vx": 0,
          "vy": -220.408163,
          "wallSliding": false,
          "x": 50,
          "y": 248.857143,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 10,
          "vx": 0,
          "vy": -200,
          "wallSliding": false,
          "x": 50,
          "y": 245.52381,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 11,
          "vx": 0,
          "vy": -179.591837,
          "wallSliding": false,
          "x": 50,
          "y": 242.530612,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 12,
          "vx": 0,
          "vy": -159.183673,
          "wallSliding": false,
          "x": 50,
          "y": 239.877551,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 13,
          "vx": 0,
          "vy": -138.77551,
          "wallSliding": false,
          "x": 50,
          "y": 237.564626,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 14,
          "vx": 0,
          "vy": -118.367347,
          "wallSliding": false,
          "x": 50,
          "y": 235.591837,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 15,
          "vx": 0,
          "vy": -97.959184,
          "wallSliding": false,
          "x": 50,
          "y": 233.959184,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 16,
          "vx": 0,
          "vy": -77.55102,
          "wallSliding": false,
          "x": 50,
          "y": 232.666667,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 17,
          "vx": 0,
          "vy": -57.142857,
          "wallSliding": false,
          "x": 50,
          "y": 231.714286,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 18,
          "vx": 0,
          "vy": -36.734694,
          "wallSliding": false,
          "x": 50,
          "y": 231.102041,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 19,
          "vx": 0,
          "vy": -16.326531,
          "wallSliding": false,
          "x": 50,
          "y": 230.829932,
        },
      ]
    `);
    expect(tappedTrace).toMatchInlineSnapshot(`
      [
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "anticipating",
          "tick": 0,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "anticipating",
          "tick": 1,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "anticipating",
          "tick": 2,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "anticipating",
          "tick": 3,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 4,
          "vx": 0,
          "vy": -86.122449,
          "wallSliding": false,
          "x": 50,
          "y": 274.564626,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 5,
          "vx": 0,
          "vy": -35.102041,
          "wallSliding": false,
          "x": 50,
          "y": 273.979592,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 6,
          "vx": 0,
          "vy": 15.918367,
          "wallSliding": false,
          "x": 50,
          "y": 274.244898,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 7,
          "vx": 0,
          "vy": 36.326531,
          "wallSliding": false,
          "x": 50,
          "y": 274.85034,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 8,
          "vx": 0,
          "vy": 56.734694,
          "wallSliding": false,
          "x": 50,
          "y": 275.795918,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "falling",
          "tick": 9,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "landing",
          "tick": 10,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "landing",
          "tick": 11,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "landing",
          "tick": 12,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "landing",
          "tick": 13,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "landing",
          "tick": 14,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "landing",
          "tick": 15,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "landing",
          "tick": 16,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "landing",
          "tick": 17,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "grounded",
          "tick": 18,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "grounded",
          "tick": 19,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
      ]
    `);
    expect(traceHash(heldTrace)).toBe(436535184);
    expect(traceHash(tappedTrace)).toBe(3297098666);
    // Phase 4: vertical-only traces UNCHANGED, replay hashes shift (config +
    // physicsVersion 3→4).
    // Phase 5: traces UNCHANGED, replay hashes shift (config + physicsVersion 4→5).
    // Phase 6: traces UNCHANGED (no grab), replay hashes shift (wall-grab config +
    // slice + stamina + physicsVersion 5→6).
    // Phase 7: traces UNCHANGED (no CC/retention — vertical-only), replay
    // hashes shift (config + locomotion gained the Phase 7 fields incl. the
    // wallSpeedRetaining latch + version 6→7).
    // Phase 8: traces UNCHANGED (no spring/crystal solid), replay hashes shift
    // (config spring fields + interactions field + physicsVersion 7→8; Phase
    // 9 re-shifted via 8→9 version bump, digital trace unchanged); Phase 10
    // re-shifted (new groundDuckEnabled config field + 9→10 version; digital
    // trace unchanged).
    expect(replayHashFor(42, heldInitial, heldInputs, config)).toBe(2827976253);
    expect(replayHashFor(42, tappedInitial, tappedInputs, config)).toBe(3484848052);
  });

  // =========================================================================
  // 4. Buffered jump fires exactly once.
  //
  // Actor is falling (coyote expired), presses jump one tick before landing;
  // the jump-buffer window arms, and on the landing tick the buffered re-jump
  // fires. Asserts exactly ONE `justLaunched` event across the traced window —
  // i.e. the buffer neither drops nor double-fires.
  //
  // Timing note (see scenario 1): a literal "5 ticks" cannot reach a buffered
  // launch because `anticipationDuration` (≈3 ticks) must elapse between the
  // landing-tick buffer fire and the launch tick. The window is sized so the
  // single `justLaunched` lands inside it.
  //
  // The initial state is constructed with the jump slice already in the
  // `falling` phase with coyote EXPIRED, so the press buffers instead of
  // triggering a ground/coyote jump. This is a state the engine produces
  // naturally after a few airborne ticks; constructing it directly isolates
  // the buffer behavior without a long untraced fall.
  // =========================================================================
  it('buffered jump fires exactly one justLaunched', () => {
    const config: PlatformerConfig = DEFAULT_PLATFORMER_CONFIG;
    const solids: Solid[] = [{ id: 'floor', x: 0, y: 120, width: 200, height: 16 }];

    const base = createPlatformerState(50, 93, config); // feet at 117; floor top 120
    const fallingJump: JumpAbilityState = {
      kind: 'jump',
      jump: {
        ...createJumpState(config.jump),
        phase: 'falling',
        coyoteTimer: 0,
        vy: 100,
      },
    };
    const initial: PlatformerState = {
      ...base,
      core: { ...base.core, vy: 100 },
      abilities: { ...base.abilities, jump: fallingJump },
    };

    // tick0: buffer-arming press one tick before landing; ticks1-6: idle
    // (landing → buffered anticipating → launch).
    const inputs = [
      makeInput({ jump: 'press' }),
      idleInput(),
      idleInput(),
      idleInput(),
      idleInput(),
      idleInput(),
      idleInput(),
    ];

    const { trace, events } = runTraceDetailed({ initial, inputs, solids, config });
    expect(events.filter((e) => e.justLaunched).length).toBe(1);

    expect(trace).toMatchInlineSnapshot(`
      [
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 0,
          "vx": 0,
          "vy": 120.408163,
          "wallSliding": false,
          "x": 50,
          "y": 95.006803,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "falling",
          "tick": 1,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 96,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "anticipating",
          "tick": 2,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 96,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "anticipating",
          "tick": 3,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 96,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "anticipating",
          "tick": 4,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 96,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "anticipating",
          "tick": 5,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 96,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "rising",
          "tick": 6,
          "vx": 0,
          "vy": -86.122449,
          "wallSliding": false,
          "x": 50,
          "y": 94.564626,
        },
      ]
    `);
    expect(traceHash(trace)).toBe(2566087079);
    // Phase 4: trace UNCHANGED (vertical-only), replay hash shifts (config +
    // physicsVersion 3→4).
    // Phase 5: trace UNCHANGED, replay hash shifts (config + physicsVersion 4→5).
    // Phase 6: trace UNCHANGED (no grab), replay hash shifts (wall-grab config +
    // slice + stamina + physicsVersion 5→6).
    // Phase 7: trace UNCHANGED (no CC/retention — vertical-only), replay hash
    // shifts (config + locomotion gained the Phase 7 fields incl. the
    // wallSpeedRetaining latch + version 6→7).
    // Phase 8: trace UNCHANGED (no spring/crystal solid), replay hash shifts
    // (config spring fields + interactions field + physicsVersion 7→8; Phase
    // 9 re-shifted via 8→9 version bump, digital trace unchanged); Phase 10
    // re-shifted (new groundDuckEnabled config field + 9→10 version; digital
    // trace unchanged).
    expect(replayHashFor(42, initial, inputs, config)).toBe(2494056571);
  });

  // =========================================================================
  // 5. Dash → ground transition (overspeed BLEED at expiry — Phase 3 + end-dash
  //    velocity — Phase 4).
  //
  // BEFORE Phase 3: the dash ability overrode `vx` to `dirX * dashSpeed` each
  // active tick, and the tick the dash timer expired `vx` SNAPPED instantly
  // back to horizontal-input velocity (`moveSpeed` if moving, else 0) — a hard
  // clobber. The Phase 2b version of this scenario was only 10 ticks, which
  // ended MID-active-dash (the 3-tick startup freeze pushed expiry past the
  // window), so the clobber was never actually observed here.
  //
  // Phase 3 re-baseline: `applyHorizontalInput` is now rate-based. The window
  // is extended to 18 ticks so the dash EXPIRES inside it (startup ticks 0-2,
  // active ticks 3-10, expiry at tick 11). Holding direction across expiry, the
  // post-dash `vx` (above `moveSpeed 200`, same direction) BLEEDS back toward
  // `moveSpeed` at the `overspeedReduce` rate (890 px/s² ≈ 14.833/tick), NOT an
  // instant clobber to 200 — Celeste `RunReduce` (`Player.cs:2891`).
  //
  // Phase 4 re-baseline: a horizontal dash (`dirY === 0`) now sets an ABSOLUTE
  // end-dash velocity at expiry (`dashSpeed × endDashSpeedFactor` = 420 × 0.67
  // ≈ 281.4, Celeste `Player.cs:3625-3632`) instead of leaving the full
  // `dashSpeed` (420). The overspeed bleed therefore starts from ~281 (not 420):
  // tick 11 `vx: 266.567` (281.4 − 14.833), tick 12 `251.733`, … decaying
  // ~14.833/tick until it reaches `moveSpeed` (200) at tick 16. This is the
  // intended tech-enabling carry — Phase 5's super/hyper build on it. The dash
  // here is horizontal (no `moveY` supplied → `dirY === 0`), exercising the
  // end-dash path but not 8-directional aim (covered by platformer-dash tests).
  // =========================================================================
  it('dash overrides vx then bleeds overspeed toward moveSpeed at expiry (Phase 3 rate-based)', () => {
    const config: PlatformerConfig = DEFAULT_PLATFORMER_CONFIG;
    const solids: Solid[] = [FLOOR_300];
    const initial = createPlatformerState(50, 276, config);

    // tick0: dash press + hold right; ticks1-17: hold right. The press triggers
    // a 3-tick startup freeze (ticks 0-2), then the dash goes active from
    // tick 3 for `dashDuration` (0.12 s ≈ 7.2 ticks), expiring at tick 11 —
    // after which the held direction bleeds the overspeed vx toward moveSpeed.
    const inputs = [
      makeInput({ moveX: 1, dash: 'press' }),
      ...Array.from({ length: 17 }, () => makeInput({ moveX: 1 })),
    ];

    const trace = runTrace({ initial, inputs, solids, config });

    expect(trace).toMatchInlineSnapshot(`
      [
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "grounded",
          "tick": 0,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "grounded",
          "tick": 1,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "grounded",
          "tick": 2,
          "vx": 0,
          "vy": 0,
          "wallSliding": false,
          "x": 50,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0.12,
          "onGround": false,
          "phase": "grounded",
          "tick": 3,
          "vx": 420,
          "vy": 0,
          "wallSliding": false,
          "x": 57,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0.103333,
          "onGround": false,
          "phase": "grounded",
          "tick": 4,
          "vx": 420,
          "vy": 0,
          "wallSliding": false,
          "x": 64,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0.086667,
          "onGround": false,
          "phase": "grounded",
          "tick": 5,
          "vx": 420,
          "vy": 0,
          "wallSliding": false,
          "x": 71,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0.07,
          "onGround": false,
          "phase": "grounded",
          "tick": 6,
          "vx": 420,
          "vy": 0,
          "wallSliding": false,
          "x": 78,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0.053333,
          "onGround": false,
          "phase": "grounded",
          "tick": 7,
          "vx": 420,
          "vy": 0,
          "wallSliding": false,
          "x": 85,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0.036667,
          "onGround": false,
          "phase": "grounded",
          "tick": 8,
          "vx": 420,
          "vy": 0,
          "wallSliding": false,
          "x": 92,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0.02,
          "onGround": false,
          "phase": "grounded",
          "tick": 9,
          "vx": 420,
          "vy": 0,
          "wallSliding": false,
          "x": 99,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0.003333,
          "onGround": false,
          "phase": "grounded",
          "tick": 10,
          "vx": 420,
          "vy": 0,
          "wallSliding": false,
          "x": 106,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "grounded",
          "tick": 11,
          "vx": 266.566667,
          "vy": 0,
          "wallSliding": false,
          "x": 110.442778,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "grounded",
          "tick": 12,
          "vx": 251.733333,
          "vy": 0,
          "wallSliding": false,
          "x": 114.638333,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "grounded",
          "tick": 13,
          "vx": 236.9,
          "vy": 0,
          "wallSliding": false,
          "x": 118.586667,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "grounded",
          "tick": 14,
          "vx": 222.066667,
          "vy": 0,
          "wallSliding": false,
          "x": 122.287778,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "grounded",
          "tick": 15,
          "vx": 207.233333,
          "vy": 0,
          "wallSliding": false,
          "x": 125.741667,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "grounded",
          "tick": 16,
          "vx": 200,
          "vy": 0,
          "wallSliding": false,
          "x": 129.075,
          "y": 276,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": true,
          "phase": "grounded",
          "tick": 17,
          "vx": 200,
          "vy": 0,
          "wallSliding": false,
          "x": 132.408333,
          "y": 276,
        },
      ]
    `);
    expect(traceHash(trace)).toBe(3180216816);
    // Phase 5: trace UNCHANGED (horizontal dash, no dash-tech triggered), replay
    // hash shifts (config + physicsVersion 4→5).
    // Phase 6: trace UNCHANGED (no grab), replay hash shifts (wall-grab config +
    // slice + stamina + physicsVersion 5→6).
    // Phase 7: trace UNCHANGED (dash on open floor — no wall to trigger dash
    // CC, no ceiling, no wall brush), replay hash shifts (config + locomotion
    // gained the Phase 7 fields incl. the wallSpeedRetaining latch + version 6→7).
    // Phase 8: trace UNCHANGED (no spring/crystal solid), replay hash shifts
    // (config spring fields + interactions field + physicsVersion 7→8; Phase
    // 9 re-shifted via 8→9 version bump, digital trace unchanged); Phase 10
    // re-shifted (new groundDuckEnabled config field + 9→10 version; digital
    // trace unchanged).
    expect(replayHashFor(42, initial, inputs, config)).toBe(3922811632);
  });

  // =========================================================================
  // 6. Grab holds against a wall (30 ticks) — the §0e proof (Phase 6).
  //
  // This is the scenario deferred from Wave 0 (roadmap §0a table row "Grab
  // holds against a wall"). It proves the §0e guarantee: the wall-grab reads
  // wall presence from `probeWall` (a pure geometry query), NOT from
  // `core.contacts`, so the grab SURVIVES a pinned `vx = 0`. Under the old
  // contacts-based design, zeroing `vx` would clear the wall contact on the
  // tick after engage and the grab would release at tick 1 — the very defect
  // §0e exists to prevent. Here the actor clings for 30 straight ticks with
  // `vx === 0` and `vy === 0` (gravity is skipped in `'wallGrab'` mode), never
  // falling, still grabbing at tick 30.
  //
  // No inline row-snapshot: 30 near-identical cling rows are verbose and the
  // load-bearing assertion is the grab-state + the pinned velocities, checked
  // directly below.
  // =========================================================================
  it('grab holds against a wall for 30 ticks (probeWall survives vx=0 — §0e)', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallGrabEnabled: true };
    // Right wall flush against the body's right edge (body x=184, width 16 →
    // right edge 200 = wall left edge). No floor — the actor clings in mid-air,
    // which is the pure grab test (nothing supports it but the grab).
    const solids: Solid[] = [{ id: 'wall-r', x: 200, y: 0, width: 16, height: 300 }];
    const initial = createPlatformerState(184, 100, config); // facing=1 (right)

    // tick0: grab press; ticks1-29: grab held. No moveX (grab is enough — the
    // ability probes the facing side), no moveY (cling), no jump (no hop).
    const inputs = [
      makeInput({ grab: 'press' }),
      ...Array.from({ length: 29 }, () => makeInput({ grab: 'hold' })),
    ];

    const { trace, finalState } = runTraceDetailed({ initial, inputs, solids, config });

    // §0e proof: the grab pins vx=0 AND survives it. Every tick vx===0, and
    // the actor never moves (no fall, no drift) — gravity is skipped in
    // `'wallGrab'` mode and the ability pins vx/vy to 0 while clinging.
    expect(trace.every((r) => r.vx === 0)).toBe(true);
    expect(trace.every((r) => r.vy === 0)).toBe(true);
    expect(trace.every((r) => r.y === 100)).toBe(true);
    expect(trace.every((r) => r.x === 184)).toBe(true);
    // Still grabbing at tick 30 — the deferred §0a scenario's assertion.
    const wg = finalState.abilities['wallGrab'];
    expect(wg !== undefined && wg.kind === 'wallGrab' && wg.grabbing).toBe(true);
    expect(wg !== undefined && wg.kind === 'wallGrab' ? wg.side : null).toBe('right');
    // Stamina drained at the still-cling rate over 30 ticks but is NOT
    // exhausted (30 × 10/s × 1/60 = 5 < 110), so the grab holds.
    expect(finalState.locomotion.stamina).toBeCloseTo(110 - 30 * 10 * (1 / 60), 4);

    // Trace + replay canaries.
    // Phase 7: trace UNCHANGED (grab mode excludes all three Phase 7
    // mechanisms — retention is gated on `mode === 'normal'`, and grab is
    // `'wallGrab'`). Only replay hash shifts (config + locomotion gained the
    // Phase 7 fields incl. the wallSpeedRetaining latch + version 6→7).
    // Phase 8: trace UNCHANGED (no spring/crystal solid), replay hash shifts
    // (config spring fields + interactions field + physicsVersion 7→8; Phase
    // 9 re-shifted via 8→9 version bump, digital trace unchanged); Phase 10
    // re-shifted (new groundDuckEnabled config field + 9→10 version; digital
    // trace unchanged).
    expect(traceHash(trace)).toBe(2056703830);
    expect(replayHashFor(42, initial, inputs, config)).toBe(3897492110);
  });

  // =========================================================================
  // 7. Spring into jump slice (3 ticks) — the deferred §0a scenario (Phase 8).
  //
  // This is the scenario deferred from Wave 0 (roadmap §0a table row "Spring
  // into jump slice"). It proves the §0b fix covers environmental launches:
  // a spring's LaunchIntent lands on `core.vy` and the impulse PERSISTS to
  // tick 2 — NOT discarded by the jump slice (the exact analogue of the
  // double-jump / wall-jump discard bug pre-Phase-0b). Before Phase 0b, a
  // spring's vy would have been overwritten by the jump ability's stale
  // internal trajectory on the tick after the bounce.
  //
  // Proof form: the actor descends onto a spring solid, the spring fires on
  // tick 0 (vy > 0 gate), and `core.vy` at tick 0/1/2 follows the clean
  // `launch + n·(g_jump·dt)` progression (held jump → full gravity in the
  // var-jump window). If the impulse were discarded, the arithmetic
  // progression would break at tick 1 or 2.
  // =========================================================================
  it('spring into jump slice (launch survives to tick 2 — §0b)', () => {
    const config: PlatformerConfig = DEFAULT_PLATFORMER_CONFIG;
    // A spring trigger volume (NON-BLOCKING — the resolvers skip it). The
    // actor starts overlapping it with vy > 0 so the spring fires on tick 0.
    const solids: Solid[] = [
      { id: 'spring-trace', x: 50, y: 200, width: 16, height: 16, spring: { launch: config.springBounceVy } },
      // Floor far below so the actor does not land during the 3-tick window.
      { id: 'floor', x: -200, y: 600, width: 800, height: 16 },
    ];
    // Body (16×24) at y=192 → bottom 216, overlapping the spring volume
    // [200, 216]. vy = +200 (descending) so the spring's gate fires.
    const base = createPlatformerState(50, 192, config);
    const initial: PlatformerState = { ...base, core: { ...base.core, vy: 200, onGround: false } };

    // Hold jump through the trace so the variable-jump window applies FULL
    // gravity (no cutoff) — the clean per-tick `+g_jump·dt` progression is the
    // persistence proof. The spring opens `springVarJumpTime` (0.2s = 12
    // ticks), covering the whole 3-tick window.
    const inputs = [
      makeInput({ jump: 'hold' }),
      makeInput({ jump: 'hold' }),
      makeInput({ jump: 'hold' }),
    ];

    const trace = runTrace({ initial, inputs, solids, config });

    // The clean `launch + n·perTick` progression — the §0b persistence proof.
    const launch = config.springBounceVy;
    const gJump = (2 * config.jump.apexHeight) / (config.jump.timeToApex * config.jump.timeToApex);
    const perTick = gJump * (1 / 60);
    // Tick 0: spring fired → vy = launch + one gravity step.
    expect(trace[0].vy).toBeCloseTo(launch + perTick, 4);
    // Tick 1: +perTick (NOT a stale reversion — the impulse survived).
    expect(trace[1].vy).toBeCloseTo(launch + 2 * perTick, 4);
    // Tick 2: +perTick again (launch survived to tick 2 — the scenario's name).
    expect(trace[2].vy).toBeCloseTo(launch + 3 * perTick, 4);

    expect(trace).toMatchInlineSnapshot(`
      [
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 0,
          "vx": 0,
          "vy": -439.591837,
          "wallSliding": false,
          "x": 50,
          "y": 184.673469,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 1,
          "vx": 0,
          "vy": -419.183673,
          "wallSliding": false,
          "x": 50,
          "y": 177.687075,
        },
        {
          "climbing": false,
          "dashTimer": 0,
          "onGround": false,
          "phase": "falling",
          "tick": 2,
          "vx": 0,
          "vy": -398.77551,
          "wallSliding": false,
          "x": 50,
          "y": 171.040816,
        },
      ]
    `);
    expect(traceHash(trace)).toBe(1833000202);
    // Phase 9 re-shifted via 8→9 version bump; digital trace unchanged.
    // Phase 10 re-shifted (new groundDuckEnabled config field + 9→10 version;
    // digital trace unchanged).
    expect(replayHashFor(42, initial, inputs, config)).toBe(3769366339);
  });
});

  // =========================================================================
  // 8. Neutral climb-jump + re-grab (mantle wave — direction-aware grab+jump).
  //
  // Grab a mid-wall wall, press jump with NO directional input: the actor
  // launches STRAIGHT UP (`source: 'climbJump'`, vx=0, facing the wall) with
  // the seconds-based re-grab lock armed. It rises beside the wall, cannot
  // re-cling while the lock counts down, then chains a fresh grab once it
  // expires — all with x never moving (the straight-up proof).
  // =========================================================================
  it('neutral climb-jump rises straight up then re-grabs after the lock', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallGrabEnabled: true };
    const solids: Solid[] = [{ id: 'wall-r', x: 200, y: 0, width: 16, height: 300 }];
    const initial = createPlatformerState(184, 100, config); // facing=1 (right)

    const inputs = [
      makeInput({ grab: 'press' }), // t0: engage
      makeInput({ grab: 'hold', jump: 'press' }), // t1: NEUTRAL grab+jump
      ...Array.from({ length: 23 }, () => makeInput({ grab: 'hold' })),
    ];

    const { trace, events, finalState } = runTraceDetailed({ initial, inputs, solids, config });

    // Straight-up climb-jump pulse; the widened wall-jump pulse does NOT fire.
    expect(events[1].climbJumpLaunched).toBe(true);
    expect(events[1].wallJumpLaunched).toBe(false);
    // Perfectly vertical: x never moves for the whole trace.
    expect(trace.every((r) => r.x === 184)).toBe(true);
    // The launch rises (vy negative after the launch tick), then re-clings.
    expect(trace[1].vy).toBeLessThan(0);
    const wg = finalState.abilities['wallGrab'];
    expect(wg !== undefined && wg.kind === 'wallGrab' && wg.grabbing).toBe(true);
    // Re-grab chained ABOVE the start (rose during the lock window).
    expect(finalState.core.y).toBeLessThan(100);
    // The climb-jump pulse lasts exactly one tick.
    expect(events.filter((e) => e.climbJumpLaunched).length).toBe(1);

    expect(traceHash(trace)).toBe(2990474143);
    expect(replayHashFor(42, initial, inputs, config)).toBe(2307623331);
  });

  // =========================================================================
  // 9. Away climb-hop (mantle wave — the unchanged branch, widened pulse).
  //
  // Same wall, jump pressed with AWAY input: the pre-mantle up-and-away
  // climb-hop trajectory is preserved (`climbHop` + climbHopForceTime
  // forced-move), and — the deliberate widening — it now reports through
  // `wallJumpLaunched`.
  // =========================================================================
  it('away climb-hop keeps the up-and-away trajectory and reports as a wall jump', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallGrabEnabled: true };
    const solids: Solid[] = [{ id: 'wall-r', x: 200, y: 0, width: 16, height: 300 }];
    const initial = createPlatformerState(184, 100, config);

    const inputs = [
      makeInput({ grab: 'press' }),
      makeInput({ grab: 'hold', jump: 'press', moveX: -1 }), // AWAY
      ...Array.from({ length: 23 }, () => makeInput({ moveX: -1 })),
    ];

    const { trace, events } = runTraceDetailed({ initial, inputs, solids, config });

    // The widened pulse fires for the away hop (and ONLY it).
    expect(events[1].wallJumpLaunched).toBe(true);
    expect(events[1].climbJumpLaunched).toBe(false);
    expect(events.filter((e) => e.wallJumpLaunched).length).toBe(1);
    // Up-and-away: pushed left off the wall, rising at the launch tick.
    expect(trace[1].vx).toBeLessThan(0);
    expect(trace[1].vy).toBeLessThan(0);
    expect(finalX(trace)).toBeLessThan(184);

    expect(traceHash(trace)).toBe(2422085024);
    expect(replayHashFor(42, initial, inputs, config)).toBe(3527304441);
  });

  // =========================================================================
  // 10. Clear mantle + landing (mantle wave — the continuous assisted hop).
  //
  // Grab near the lip, hold Up: the mantle launches a multi-tick assisted
  // ballistic hop. The actor rises BESIDE the wall (x pinned by the ordinary
  // X resolver while the body overlaps the wall's Y band), crosses the lip
  // only once its feet clear the wall top, and lands on top through the
  // normal Y resolver. No tick ever writes a position — every per-tick move
  // is integrated velocity + resolver contact correction.
  // =========================================================================
  it('clear mantle rises, crosses after the feet clear, and lands on the ledge', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallGrabEnabled: true };
    // The wall's TOP edge (y=0) is the ledge being mantled onto.
    const solids: Solid[] = [{ id: 'ledge', x: 200, y: 0, width: 16, height: 300 }];
    // Head 2 px below the lip — inside the pre-emptive climb-up reach.
    const initial = createPlatformerState(184, 2, config);

    const inputs = [
      makeInput({ grab: 'press' }), // t0: engage (cling at y=2)
      makeInput({ grab: 'hold', moveY: -1 }), // t1: grab + Up → mantle launch
      makeInput({ grab: 'hold', moveY: -1 }), // t2: assist rising
      ...Array.from({ length: 47 }, () => makeInput({})), // fly + land + stand
    ];

    const { trace, events, finalState } = runTraceDetailed({ initial, inputs, solids, config });

    // The mantle pulse fired exactly once, on the launch tick.
    expect(events[1].mantled).toBe(true);
    expect(events.filter((e) => e.mantled).length).toBe(1);
    // Launch tick: x pinned beside the wall (no destination snap).
    expect(trace[1].x).toBe(184);
    // Rising phase: multiple ticks pinned at the wall X while y strictly falls.
    const pinnedRiseTicks = trace.filter((r) => r.x === 184 && r.vy < 0).length;
    expect(pinnedRiseTicks).toBeGreaterThanOrEqual(5);
    // The first moving tick crossed ONLY after the feet cleared the wall top.
    const firstMove = trace.findIndex((r) => r.x > 184);
    expect(firstMove).toBeGreaterThan(3);
    expect(trace[firstMove].y + 24).toBeLessThanOrEqual(0);
    // Landed on TOP of the ledge with the correct ground contact.
    expect(finalState.core.onGround).toBe(true);
    expect(finalState.core.contacts.groundId).toBe('ledge');
    expect(finalState.core.y).toBeCloseTo(-24, 5);
    // Edge-anchored finish marker ≈ 192 (200 - 16 + 8): the assist stopped
    // there; bounded drift carries the actor a couple more px. Never a snap,
    // never width-proportional.
    expect(Math.abs(finalX(trace) - 192)).toBeLessThanOrEqual(5);
    // Per-tick displacement bounded by integrated velocity (+resolver slack):
    // the no-discontinuity guarantee across the whole hop.
    for (let i = 1; i < trace.length; i++) {
      expect(Math.abs(trace[i].x - trace[i - 1].x)).toBeLessThanOrEqual(
        config.mantleHopVx * (1 / 60) + 0.5,
      );
      expect(Math.abs(trace[i].y - trace[i - 1].y)).toBeLessThanOrEqual(
        config.maxFallSpeed * (1 / 60) + 0.5,
      );
    }

    expect(traceHash(trace)).toBe(4269679983);
    expect(replayHashFor(42, initial, inputs, config)).toBe(4077574831);
  });

  // =========================================================================
  // 11. Blocked mantle under an overhang (mantle wave — conservative decline).
  //
  // Same lip, but a solid overhang sits above the ledge crossing corridor.
  // The preflight route check declines the mantle (no launch, no teleport);
  // the actor keeps climbing and is stopped by the overhang through the
  // ordinary Y resolver — it never embeds in or tunnels through it.
  // =========================================================================
  it('blocked mantle under an overhang declines safely and never tunnels', () => {
    const config: PlatformerConfig = { ...DEFAULT_PLATFORMER_CONFIG, wallGrabEnabled: true };
    const solids: Solid[] = [
      { id: 'ledge', x: 200, y: 0, width: 16, height: 300 },
      // Overhang floating above the lip, inside the rise column + landing
      // AABB (blocks the preflight) AND low enough that the blocked climb's
      // feet stay below the wall top (the grab legitimately persists).
      { id: 'overhang', x: 186, y: -20, width: 16, height: 4 },
    ];
    const initial = createPlatformerState(184, 2, config);

    const inputs = [
      makeInput({ grab: 'press' }),
      ...Array.from({ length: 24 }, () => makeInput({ grab: 'hold', moveY: -1 })),
    ];

    const { trace, events, finalState } = runTraceDetailed({ initial, inputs, solids, config });

    // No mantle ever fired — the conservative decline.
    expect(events.every((e) => !e.mantled)).toBe(true);
    const wg = finalState.abilities['wallGrab'];
    expect(wg !== undefined && wg.kind === 'wallGrab' && wg.grabbing).toBe(true);
    // The climb continued up the wall but was stopped by the overhang (the
    // body top cannot pass its underside at y=-16 ⇒ body y clamps at -16).
    expect(Math.min(...trace.map((r) => r.y))).toBeGreaterThanOrEqual(-16);
    // X never moved off the wall (no horizontal launch, no snap).
    expect(trace.every((r) => r.x === 184)).toBe(true);

    expect(traceHash(trace)).toBe(1369465528);
    expect(replayHashFor(42, initial, inputs, config)).toBe(2027573966);
  });
