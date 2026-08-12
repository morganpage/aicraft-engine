import { describe, it, expect } from 'vitest';
import { createPlatformerState, stepPlatformer } from '../platformer/kernel';
import { DEFAULT_PLATFORMER_CONFIG } from '../platformer/constants';
import {
  DT,
  idleInput,
  makeInput,
  runTrace,
} from './platformer-trace-harness';
import type { Solid } from '../collision/types';
import type { PlatformerConfig, PlatformerState } from '../platformer/types';

/**
 * Phase 7 — corner correction + wall-speed retention tests.
 *
 * Three collision-time mechanisms live in the kernel's Step 6, all using pure
 * probe / `aabbOverlap` clearance tests (never last-tick contacts):
 *
 *   - **Upward CC** (`upwardCornerCorrection = 8`, Celeste
 *     `UpwardCornerCorrection 4`, `Player.cs:2591, 2603`): when rising and
 *     bumping a ceiling corner, nudge horizontally (1px steps, input/facing
 *     direction first) up to 8px to slip past a 1-tile lip.
 *   - **Dash CC** (`dashCornerCorrection = 8`, Celeste `DashCornerCorrection 4`,
 *     `Player.cs:2408, 2511, 2524, 2668, 2682`): during a dash, when hitting a
 *     wall, nudge perpendicular (vertically for a horizontal dash, up then down)
 *     up to 8px to slip past a corner. A SEPARATE system from upward CC.
 *   - **Wall-speed retention** (`wallSpeedRetentionTime = 0.06`, Celeste
 *     `WallSpeedRetentionTime 0.06`, `Player.cs:54`): stash pre-collision `vx`
 *     on wall contact; restore it if the wall clears on that side within 0.06s.
 *
 * Both CC tolerances are pegged to tile size (`4/8 tile × 16px = 8px`), NOT
 * copied — the pegging rule forbids copying the Celeste `4` magnitude.
 */

// ---------------------------------------------------------------------------
// Shared geometry.
// ---------------------------------------------------------------------------

/** A 400-wide floor at y=300 (top surface). */
const FLOOR_300: Solid = { id: 'floor', x: 0, y: 300, width: 400, height: 16 };

/**
 * A 1-tile ceiling lip at x=40, y=240 (y-range [240,256], bottom at y=256).
 * A body at x=52 (width 16, right edge 68) overlaps the lip's x-range [40,56]
 * by 4px ([52,56]) — so a rising actor bonks the lip unless CC slips it ≥4px
 * right (to x=56, left edge flush with the lip's right edge → no x-overlap).
 */
const CEILING_LIP: Solid = { id: 'lip', x: 40, y: 240, width: 16, height: 16 };

/** A full-width ceiling at y=240 — no gap within any tolerance. */
const FULL_CEILING: Solid = { id: 'ceil', x: 0, y: 240, width: 400, height: 16 };

// ---------------------------------------------------------------------------
// Part A — Upward corner correction.
// ---------------------------------------------------------------------------

describe('upward corner correction', () => {
  it('slips past a 1-tile ceiling lip when a ≤8px nudge clears it', () => {
    // Actor at x=52, y=276 on the floor. Jump straight up (no moveX); the
    // default facing is +1 (right), so CC prefers to nudge right. The lip's
    // right edge is at x=56; nudging right by 4px puts the body's left edge at
    // 56 (= lip right edge) → strict AABB no longer overlaps → the actor slips.
    const initial = createPlatformerState(52, 276, DEFAULT_PLATFORMER_CONFIG);
    const inputs = [
      makeInput({ jump: 'press' }),
      ...Array.from({ length: 15 }, () => makeInput({ jump: 'hold' })),
    ];
    const trace = runTrace({
      initial,
      inputs,
      solids: [FLOOR_300, CEILING_LIP],
      config: DEFAULT_PLATFORMER_CONFIG,
    });

    // The actor's head approaches the lip bottom (y=256). Without CC it would
    // bonk there; with CC it slips right to x=56 and continues rising (the
    // apex reaches ~y=233, well above the lip bottom at 256).
    const minX = Math.min(...trace.map((r) => r.y));
    const maxX = Math.max(...trace.map((r) => r.x));
    // Slipped right (gained x) — the nudge fired.
    expect(maxX).toBe(56);
    // Continued rising past the lip (y dropped below the lip bottom 256).
    expect(minX).toBeLessThan(256);
    // The rising phase survives past the lip (still rising, not bonked, after
    // the slip tick). Find the slip tick (first row with x > 52) and confirm
    // vy is still negative (rising) there.
    const slipTick = trace.find((r) => r.x > 52);
    expect(slipTick).toBeDefined();
    expect(slipTick!.vy).toBeLessThan(0);
    expect(slipTick!.phase).toBe('rising');
  });

  it('does NOT teleport through a full-width ceiling (no gap within tolerance)', () => {
    // Same jump, but the ceiling spans the whole x-range — no nudge within 8px
    // can clear it. The actor must bonk and fall.
    const initial = createPlatformerState(52, 276, DEFAULT_PLATFORMER_CONFIG);
    const inputs = [
      makeInput({ jump: 'press' }),
      ...Array.from({ length: 15 }, () => makeInput({ jump: 'hold' })),
    ];
    const trace = runTrace({
      initial,
      inputs,
      solids: [FLOOR_300, FULL_CEILING],
      config: DEFAULT_PLATFORMER_CONFIG,
    });

    // x never changes (no nudge found a clear position).
    expect(trace.every((r) => r.x === 52)).toBe(true);
    // The actor bonks at the ceiling bottom (y=256) — never rises above it.
    const minY = Math.min(...trace.map((r) => r.y));
    expect(minY).toBe(256);
    // After the bonk, vy goes positive (falling).
    const falling = trace.filter((r) => r.vy > 0);
    expect(falling.length).toBeGreaterThan(0);
  });

  it('is disabled when upwardCornerCorrection = 0 (bonk, no slip)', () => {
    // The config gate: tolerance 0 → no CC sweep. Same lip geometry as the
    // passing case, but the actor bonks because CC is off.
    const config: PlatformerConfig = {
      ...DEFAULT_PLATFORMER_CONFIG,
      upwardCornerCorrection: 0,
    };
    const initial = createPlatformerState(52, 276, config);
    const inputs = [
      makeInput({ jump: 'press' }),
      ...Array.from({ length: 15 }, () => makeInput({ jump: 'hold' })),
    ];
    const trace = runTrace({
      initial,
      inputs,
      solids: [FLOOR_300, CEILING_LIP],
      config,
    });

    // x stays at 52 (no slip), y bonks at 256.
    expect(trace.every((r) => r.x === 52)).toBe(true);
    expect(Math.min(...trace.map((r) => r.y))).toBe(256);
  });

  it('is NOT applied while dashing (dash mode excludes upward CC)', () => {
    // Scope: upward CC is gated on `mode === 'normal'`. During a dash the mode
    // is `'dash'`, so upward CC must NOT fire — even if a ceiling corner could
    // be slipped. We construct a dash-active state rising into the same lip and
    // confirm the actor's x does not change (no nudge).
    const config = DEFAULT_PLATFORMER_CONFIG;
    const base = createPlatformerState(52, 270, config);
    // Build a dash-active state dashing straight up (dirX=0, dirY=-1). The dash
    // slice is in 'active' phase with ~plenty of timer; mode will resolve to
    // 'dash'. The actor at y=270 (body [270,294]) is below the lip bottom (256)
    // and will rise into it.
    const dashActive = {
      ...base.abilities['dash'],
      kind: 'dash' as const,
      phase: 'active' as const,
      startupTimer: 0,
      timer: 0.1,
      cooldown: 0,
      dashesRemaining: 0,
      dirX: 0,
      dirY: -1,
      beforeDashVx: 0,
      dashStartedOnGround: false,
      hyperSlide: false,
    };
    const initial: PlatformerState = {
      ...base,
      core: { ...base.core, vy: -config.dashSpeed },
      abilities: { ...base.abilities, dash: dashActive },
    };
    // Step several ticks — the dash drives the actor up into the lip.
    let state = initial;
    const xs: number[] = [];
    for (let i = 0; i < 6; i++) {
      state = stepPlatformer(state, idleInput(), [FLOOR_300, CEILING_LIP], DT, config).state;
      xs.push(state.core.x);
    }
    // Upward CC did not fire — x never changed (no horizontal nudge in dash).
    expect(xs.every((x) => x === 52)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Part C — Dash corner correction.
// ---------------------------------------------------------------------------

/**
 * A 1-tile wall lip at x=120, y=100 (y-range [100,116]). A body dashing right
 * at y=108 (body [108,132]) overlaps the lip's y-range [100,116] by 8px
 * ([108,116]). Dash CC nudges the body DOWN by 8px to y=116 (head flush with
 * the lip bottom → strict AABB no longer overlaps) so the dash continues past.
 */
const DASH_WALL_LIP: Solid = { id: 'dwall', x: 120, y: 100, width: 16, height: 16 };

describe('dash corner correction', () => {
  it('slips a horizontal dash past a wall lip (gains y, dash continues)', () => {
    // Actor at x=80, y=108 (airborne). Dash right; after the 3-tick freeze
    // the active dash drives the body right at dashSpeed (420 px/s ≈ 7px/tick).
    // Around tick 6 the right edge reaches the lip at x=120; without CC the
    // dash stops (vx→0 at x≈104). With CC the body is nudged down 8px to
    // y=116 (clear of the lip) and the dash continues well past the wall.
    const initial = createPlatformerState(80, 108, DEFAULT_PLATFORMER_CONFIG);
    const inputs = [
      makeInput({ moveX: 1, dash: 'press' }),
      ...Array.from({ length: 15 }, () => makeInput({ moveX: 1 })),
    ];
    const trace = runTrace({
      initial,
      inputs,
      solids: [FLOOR_300, DASH_WALL_LIP],
      config: DEFAULT_PLATFORMER_CONFIG,
    });

    const maxX = Math.max(...trace.map((r) => r.x));
    // The dash slipped past the wall and continued (x far beyond the wall left
    // edge at 120 — without CC the body would stop at x≈104, right edge 120).
    expect(maxX).toBeGreaterThan(130);
    // The nudge shifted the body down to y=116 (the lip's bottom edge) so it
    // cleared the lip. Confirm y reached 116 at the slip tick.
    const slipTick = trace.find((r) => r.y === 116);
    expect(slipTick).toBeDefined();
    // After the slip, the dash velocity was preserved (still moving right).
    expect(slipTick!.vx).toBe(DEFAULT_PLATFORMER_CONFIG.dashSpeed);
  });

  it('is disabled when dashCornerCorrection = 0 (dash stops at the wall)', () => {
    const config: PlatformerConfig = {
      ...DEFAULT_PLATFORMER_CONFIG,
      dashCornerCorrection: 0,
    };
    const initial = createPlatformerState(80, 108, config);
    const inputs = [
      makeInput({ moveX: 1, dash: 'press' }),
      ...Array.from({ length: 15 }, () => makeInput({ moveX: 1 })),
    ];
    const trace = runTrace({
      initial,
      inputs,
      solids: [FLOOR_300, DASH_WALL_LIP],
      config,
    });

    const maxX = Math.max(...trace.map((r) => r.x));
    // Without CC the dash bonks at the wall: the body's right edge is flush at
    // x+16=120 → x=104, and vx is zeroed.
    expect(maxX).toBe(104);
    // After the bonk the dash velocity is gone (vx=0 for the remaining ticks).
    const bonked = trace.filter((r) => r.x === 104 && r.vx === 0);
    expect(bonked.length).toBeGreaterThan(0);
  });

  it('is NOT applied when not dashing (walking into the wall stops normally)', () => {
    // Same wall, but the actor walks right (no dash). mode='normal' → dash CC
    // (gated on mode==='dash') does not fire. The actor walks into the wall
    // and stops at x=104 (right edge flush at 120). No vertical nudge.
    // A floor at y=132 supports the actor (feet at 132, body [108,132]).
    const floor132: Solid = { id: 'floor132', x: 0, y: 132, width: 400, height: 16 };
    const initial = createPlatformerState(80, 108, DEFAULT_PLATFORMER_CONFIG);
    const inputs = Array.from({ length: 15 }, () => makeInput({ moveX: 1 }));
    const trace = runTrace({
      initial,
      inputs,
      solids: [floor132, DASH_WALL_LIP],
      config: DEFAULT_PLATFORMER_CONFIG,
    });

    // The actor walks right and stops at the wall (x=104, right edge 120). y
    // never changes (no dash-CC nudge in normal mode — the body stays on the
    // floor at y=108).
    expect(trace.every((r) => r.y === 108)).toBe(true);
    const maxX = Math.max(...trace.map((r) => r.x));
    expect(maxX).toBe(104);
  });
});

// ---------------------------------------------------------------------------
// Part B — Wall-speed retention.
// ---------------------------------------------------------------------------

/**
 * Wall-speed retention is tested by constructing states with a pre-stashed
 * `retainedVx` + `wallSpeedRetentionTimer`, then stepping and observing whether
 * `core.vx` is restored. This isolates the timer/clearance mechanic precisely
 * (a full jump-and-brush trace is impractical here because the default 24px-tall
 * body takes ~6–8 ticks to clear a wall vertically — longer than the 0.06s
 * window — so the direct-construction approach is the faithful unit test).
 */
describe('wall-speed retention', () => {
  /** A wall on the right at x=150. Body flush at x=134 (right edge 150). */
  const baseState = (overrides: { wallY: number; wallH: number }) => {
    const wall: Solid = {
      id: 'wall',
      x: 150,
      y: overrides.wallY,
      width: 16,
      height: overrides.wallH,
    };
    return wall;
  };

  it('restores vx when the wall clears on the retained side within 0.06s', () => {
    // Actor at (134, 100), body y-range [100,124]. Wall at y=200 (y-range
    // [200,216]) — NO y-overlap with the body. The probe finds no wall on the
    // retained (right) side → restore fires on the very next tick.
    const wall = baseState({ wallY: 200, wallH: 16 });
    const base = createPlatformerState(134, 100, DEFAULT_PLATFORMER_CONFIG);
    const initial: PlatformerState = {
      ...base,
      locomotion: {
        ...base.locomotion,
        retainedVx: 200,
        wallSpeedRetentionTimer: 0.06,
      },
    };
    const { state } = stepPlatformer(
      initial,
      idleInput(),
      [wall],
      DT,
      DEFAULT_PLATFORMER_CONFIG,
    );
    // vx restored to the stashed 200; the body moved right this tick.
    expect(state.core.vx).toBe(200);
    expect(state.core.x).toBeGreaterThan(134);
    // Retention cleared after the restore.
    expect(state.locomotion.retainedVx).toBe(0);
    expect(state.locomotion.wallSpeedRetentionTimer).toBe(0);
  });

  it('does NOT restore vx while still in contact with the wall', () => {
    // Wall at y=90 (y-range [90,106]) — overlaps the body [100,124]. The probe
    // finds the wall → countdown, no restore. vx stays 0.
    const wall = baseState({ wallY: 90, wallH: 16 });
    const base = createPlatformerState(134, 100, DEFAULT_PLATFORMER_CONFIG);
    const initial: PlatformerState = {
      ...base,
      locomotion: {
        ...base.locomotion,
        retainedVx: 200,
        wallSpeedRetentionTimer: 0.06,
      },
    };
    const { state } = stepPlatformer(
      initial,
      idleInput(),
      [wall],
      DT,
      DEFAULT_PLATFORMER_CONFIG,
    );
    expect(state.core.vx).toBe(0);
    expect(state.core.x).toBe(134);
    // Timer decremented but retained vx kept (still within the window).
    expect(state.locomotion.retainedVx).toBe(200);
    expect(state.locomotion.wallSpeedRetentionTimer).toBeCloseTo(
      0.06 - DT,
      5,
    );
  });

  it('does NOT restore vx after the 0.06s timer expires', () => {
    // Hold the actor against the wall (y-overlapping) for 4 ticks — the timer
    // counts down 0.06 → 0.043 → 0.027 → 0.010 → 0 (discard). Then move the
    // wall out of y-overlap. The retention is gone (timer=0, retainedVx=0), so
    // no restore fires even though the path is now clear.
    const wallOverlap = baseState({ wallY: 90, wallH: 16 });
    const wallAway = baseState({ wallY: 200, wallH: 16 });
    const base = createPlatformerState(134, 100, DEFAULT_PLATFORMER_CONFIG);
    let state: PlatformerState = {
      ...base,
      locomotion: {
        ...base.locomotion,
        retainedVx: 200,
        wallSpeedRetentionTimer: 0.06,
      },
    };
    // 4 ticks of contact — timer expires, retainedVx discarded.
    for (let i = 0; i < 4; i++) {
      state = stepPlatformer(
        state,
        idleInput(),
        [wallOverlap],
        DT,
        DEFAULT_PLATFORMER_CONFIG,
      ).state;
      expect(state.core.vx).toBe(0);
    }
    expect(state.locomotion.retainedVx).toBe(0);
    expect(state.locomotion.wallSpeedRetentionTimer).toBe(0);
    // Now the wall clears (moved out of y-overlap). No restore — expired.
    state = stepPlatformer(
      state,
      idleInput(),
      [wallAway],
      DT,
      DEFAULT_PLATFORMER_CONFIG,
    ).state;
    expect(state.core.vx).toBe(0);
    expect(state.core.x).toBe(134);
  });

  it('restores vx when the wall clears BEFORE the 0.06s timer expires', () => {
    // 2 ticks of contact (timer: 0.06 → 0.043 → 0.027), then the wall clears.
    // timer=0.027 > 0 → probe returns null → restore fires. The positive
    // counterpoint to the expiry test above.
    const wallOverlap = baseState({ wallY: 90, wallH: 16 });
    const wallAway = baseState({ wallY: 200, wallH: 16 });
    const base = createPlatformerState(134, 100, DEFAULT_PLATFORMER_CONFIG);
    let state: PlatformerState = {
      ...base,
      locomotion: {
        ...base.locomotion,
        retainedVx: 200,
        wallSpeedRetentionTimer: 0.06,
      },
    };
    for (let i = 0; i < 2; i++) {
      state = stepPlatformer(
        state,
        idleInput(),
        [wallOverlap],
        DT,
        DEFAULT_PLATFORMER_CONFIG,
      ).state;
      expect(state.core.vx).toBe(0);
    }
    // Timer still active (< 0.06 elapsed).
    expect(state.locomotion.wallSpeedRetentionTimer).toBeGreaterThan(0);
    // Wall clears → restore.
    state = stepPlatformer(
      state,
      idleInput(),
      [wallAway],
      DT,
      DEFAULT_PLATFORMER_CONFIG,
    ).state;
    expect(state.core.vx).toBe(200);
    expect(state.core.x).toBeGreaterThan(134);
  });

  it('cancels retention when the actor moves away from the retained side', () => {
    // If the actor's vx flips sign (e.g. a wall-jump pushed it off, or input
    // reversed), retention cancels instead of restoring momentum in the wrong
    // direction. retainedVx=200 (right); core.vx=-100 (moving left) → cancel.
    const wall = baseState({ wallY: 200, wallH: 16 });
    const base = createPlatformerState(134, 100, DEFAULT_PLATFORMER_CONFIG);
    const initial: PlatformerState = {
      ...base,
      core: { ...base.core, vx: -100 },
      locomotion: {
        ...base.locomotion,
        retainedVx: 200,
        wallSpeedRetentionTimer: 0.06,
      },
    };
    const { state } = stepPlatformer(
      initial,
      idleInput(),
      [wall],
      DT,
      DEFAULT_PLATFORMER_CONFIG,
    );
    // Cancelled: retainedVx cleared, vx NOT restored to 200 (the actor keeps
    // its leftward velocity, decaying toward 0 under release decel).
    expect(state.locomotion.retainedVx).toBe(0);
    expect(state.locomotion.wallSpeedRetentionTimer).toBe(0);
    expect(state.core.vx).toBeLessThan(200);
  });

  it('a sustained brush does NOT re-stash after the 0.06s window expires', () => {
    // The re-stash-at-expiry defect. This exercises the REAL stash path (not a
    // pre-stashed fixture): an actor pinned against a long wall with `moveX`
    // held toward it. The FIRST contact stashes once; while the brush
    // continues, the per-brush latch (`wallSpeedRetaining`) must keep the stash
    // guard from firing again when the retention timer counts to 0 — otherwise
    // the retained vx is never truly discarded and the actor ghosts through.
    //
    // Pre-fix the cycle (tick: retainedVx / timer) was:
    //   1: 200/0.06 → 4: 200/0.01 → 5: ~37/0.06 (expired then RE-STASHED) →
    //   8: ~37/0.01 → 9: ~37/0.06 (re-stashed again) …
    // The latch breaks that cycle: expiry discards retainedVx but KEEPS the
    // latch set until the wall actually clears.
    const floor: Solid = { id: 'floor', x: 0, y: 132, width: 400, height: 16 };
    // Tall wall: y-overlaps the body [108,132] for the whole brush (so the
    // probe keeps finding it) and only "clears" when we remove it below.
    const wall: Solid = { id: 'wall', x: 120, y: 0, width: 16, height: 140 };
    // Body at x=104 (right edge 120 = wall left edge), moving right at vx=200.
    const base = createPlatformerState(104, 108, DEFAULT_PLATFORMER_CONFIG);
    const initial: PlatformerState = {
      ...base,
      core: { ...base.core, vx: 200 },
    };

    // Snapshot (retainedVx, timer, latch) each tick to show the cycle plainly.
    const snaps: {
      tick: number;
      retainedVx: number;
      timer: number;
      latch: boolean;
    }[] = [];
    let state = initial;

    // 10 ticks holding moveX=1 into the wall — well past the 0.06s window
    // (0.06 / (1/60) ≈ 3.6 ticks ⇒ expiry lands on tick 5, index 4).
    for (let i = 0; i < 10; i++) {
      state = stepPlatformer(
        state,
        makeInput({ moveX: 1 }),
        [floor, wall],
        DT,
        DEFAULT_PLATFORMER_CONFIG,
      ).state;
      snaps.push({
        tick: i,
        retainedVx: state.locomotion.retainedVx,
        timer: state.locomotion.wallSpeedRetentionTimer,
        latch: state.locomotion.wallSpeedRetaining,
      });
    }

    // Tick 1 (index 0) — fresh contact stashes EXACTLY once.
    expect(snaps[0].retainedVx).toBe(200);
    expect(snaps[0].timer).toBeCloseTo(0.06, 5);
    expect(snaps[0].latch).toBe(true);

    // Ticks 2-4 — window counts down, retainedVx held, latch stays set.
    expect(snaps[1].retainedVx).toBe(200);
    expect(snaps[1].timer).toBeCloseTo(0.06 - DT, 5);
    expect(snaps[1].latch).toBe(true);
    expect(snaps[3].retainedVx).toBe(200);
    expect(snaps[3].timer).toBeGreaterThan(0);

    // Tick 5 (index 4) — EXPIRY. retainedVx DISCARDED to 0, timer clamped at 0,
    // but the latch STAYS true. This is the fix: pre-fix the stash guard
    // (`wallSpeedRetentionTimer === 0`) re-fired here and re-stashed ~37/0.06.
    expect(snaps[4].timer).toBe(0);
    expect(snaps[4].retainedVx).toBe(0);
    expect(snaps[4].latch).toBe(true);

    // Ticks 6-10 — sustained contact past expiry: retainedVx stays 0, timer
    // stays 0, latch stays true. NO re-stash cycle (pre-fix this loop saw
    // retainedVx flip back to ~37 every ~4 ticks).
    for (let i = 5; i < 10; i++) {
      expect(snaps[i].retainedVx).toBe(0);
      expect(snaps[i].timer).toBe(0);
      expect(snaps[i].latch).toBe(true);
    }

    // The actor never moved (pinned flush against the wall for the whole brush).
    expect(state.core.x).toBe(104);
    expect(state.core.vx).toBe(0);

    // Now the wall clears (removed). The latch releases (the brush is over)
    // but the window had expired, so vx is NOT restored to the stashed 200 —
    // the actor simply continues from its current input-driven vx. Contrast
    // with "restores vx when the wall clears BEFORE the 0.06s timer expires"
    // above, where clearing within the window DOES restore vx to 200.
    state = stepPlatformer(
      state,
      makeInput({ moveX: 1 }),
      [floor],
      DT,
      DEFAULT_PLATFORMER_CONFIG,
    ).state;
    expect(state.locomotion.wallSpeedRetaining).toBe(false);
    expect(state.locomotion.retainedVx).toBe(0);
    expect(state.locomotion.wallSpeedRetentionTimer).toBe(0);
    // vx is the current ground-accel ramp (~37), NOT the expired 200.
    expect(state.core.vx).toBeGreaterThan(0);
    expect(state.core.vx).toBeLessThan(200);
  });
});
