import { describe, it, expect } from 'vitest';
import {
  createJumpState,
  advanceJump,
  evaluateJump,
  DEFAULT_JUMP,
  type JumpState,
  type JumpInputs,
  type JumpConfig,
} from '../animation/jump';

const DT = 1 / 60;

/**
 * Round to `digits` decimal places. Used to keep snapshot / assertion output
 * free of float noise (1e-7 carry etc.).
 */
function round(v: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/** Per-tick recorded sample of the jump trajectory. */
interface Sample {
  yOffset: number;
  phase: string;
  scaleY: number;
  airborneBlend: number;
}

/**
 * Run a deterministic jump scenario for `ticks` ticks, recording a sample each
 * tick. `inputsFor` is a pure function of the tick index AND the previous
 * state (so scenarios can detect landing from the trajectory). Style template:
 * src/tests/locomotion.test.ts lines 56-75 (cumulative integral pattern).
 */
function runScenario(
  ticks: number,
  inputsFor: (tick: number, prev: JumpState) => JumpInputs,
  config: JumpConfig = DEFAULT_JUMP,
  dt: number = DT,
): Sample[] {
  let state = createJumpState(config);
  const out: Sample[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    state = advanceJump(state, inputsFor(tick, state), dt, config);
    const pose = evaluateJump(state);
    out.push({
      yOffset: round(pose.yOffset, 6),
      phase: state.phase,
      scaleY: round(pose.scale.scaleY, 6),
      airborneBlend: round(pose.airborneBlend, 6),
    });
  }
  return out;
}

/**
 * Standard full-hold jump scenario:
 *   - tick 0: jumpPressed, grounded (anticipation begins).
 *   - ticks 1-3: grounded during anticipation crouch.
 *   - airborne from launch until the falling body returns to ~launch height.
 *   - grounded again thereafter (landing recovery + idle) — `isGrounded` latches
 *     true once the character is no longer ballistic.
 *
 * `isGrounded` is driven purely from the previous state: `true` whenever the
 * previous phase is not ballistic, OR the falling body has touched back down
 * (`phase === 'falling'` and `y ≥ -0.5`). This mirrors how a consumer would
 * drive `isGrounded` from a ground-level collision, and keeps the character
 * planted after landing rather than walking off into an infinite fall.
 */
function fullHoldInputs(tick: number, prev: JumpState): JumpInputs {
  const airborne = prev.phase === 'rising' || prev.phase === 'falling';
  const touchingDown = prev.phase === 'falling' && prev.y >= -0.5;
  return { jumpPressed: tick === 0, jumpHeld: true, isGrounded: !airborne || touchingDown };
}

// ---------------------------------------------------------------------------
// Golden trajectory — the FIRST test (TDD: written before jump.ts exists).
// ---------------------------------------------------------------------------

describe('golden trajectory', () => {
  it('matches the recorded golden array (fixed inputs → fixed outputs)', () => {
    const traj = runScenario(120, fullHoldInputs);
    // Snapshot locks the exact trajectory; the shape tests below validate it.
    expect(traj).toMatchSnapshot();
  });

  it('rises (y goes negative) then descends and settles after landing', () => {
    const traj = runScenario(120, fullHoldInputs);
    const ys = traj.map((p) => p.yOffset);
    const minY = Math.min(...ys);
    // Rose significantly above the launch point.
    expect(minY).toBeLessThan(-DEFAULT_JUMP.apexHeight * 0.8);
    // Descended from the apex (no longer near peak height).
    expect(ys[ys.length - 1]).toBeGreaterThan(minY + DEFAULT_JUMP.apexHeight * 0.5);
    // Settled on the ground: recovered to grounded, y stopped moving.
    expect(traj[traj.length - 1].phase).toBe('grounded');
    expect(Math.abs(ys[ys.length - 1] - ys[ys.length - 11])).toBeLessThan(1);
    // NOTE: the exact landing `y` is not clamped to 0 by the library — the
    // consumer snaps the rendered position to the ground via its own collision
    // resolution. The library is a pure trajectory solver.
  });
});

// ---------------------------------------------------------------------------
// Apex height.
// ---------------------------------------------------------------------------

describe('apex height', () => {
  it('max upward offset ≈ apexHeight (within Euler tolerance)', () => {
    const traj = runScenario(120, fullHoldInputs);
    const minY = Math.min(...traj.map((p) => p.yOffset));
    // Semi-implicit Euler undershoots the continuous apex slightly.
    expect(Math.abs(minY)).toBeGreaterThan(DEFAULT_JUMP.apexHeight * 0.9);
    expect(Math.abs(minY)).toBeLessThan(DEFAULT_JUMP.apexHeight * 1.05);
  });
});

// ---------------------------------------------------------------------------
// Air time.
// ---------------------------------------------------------------------------

describe('air time', () => {
  it('rise+fall ticks ≈ 2 * timeToApex / dt', () => {
    const traj = runScenario(120, fullHoldInputs);
    const ballistic = traj.filter(
      (p) => p.phase === 'rising' || p.phase === 'falling',
    ).length;
    const expected = (2 * DEFAULT_JUMP.timeToApex) / DT;
    expect(ballistic).toBeGreaterThan(expected - 3);
    expect(ballistic).toBeLessThan(expected + 3);
  });
});

// ---------------------------------------------------------------------------
// Symmetry (no cutoff → parabolic mirror about the apex tick).
// ---------------------------------------------------------------------------

describe('symmetry', () => {
  it('rise and fall are mirror images about the apex tick', () => {
    const traj = runScenario(120, fullHoldInputs);
    const ys = traj.map((p) => p.yOffset);
    const apexTick = ys.indexOf(Math.min(...ys));
    // Equidistant ticks about the apex sit at near-identical heights. The
    // semi-implicit-Euler vertex lands at a non-integer tick, so integer-tick
    // symmetry is approximate (within a couple of px).
    for (let k = 1; k <= 5; k++) {
      const lo = apexTick - k;
      const hi = apexTick + k;
      if (lo < 0 || hi >= ys.length) continue;
      expect(Math.abs(ys[lo] - ys[hi])).toBeLessThan(2.0);
    }
  });
});

// ---------------------------------------------------------------------------
// Variable height.
// ---------------------------------------------------------------------------

describe('variable height', () => {
  it('tap (release immediately) → substantially lower apex than hold', () => {
    const hold = runScenario(80, fullHoldInputs);
    // Tap: release after tick 0. Lands via trajectory detection (short hop
    // returns to ground far earlier than a full jump).
    const tap = runScenario(80, (t, prev) => {
      const airborne = prev.phase === 'rising' || prev.phase === 'falling';
      const touchingDown = prev.phase === 'falling' && prev.y >= -0.5;
      return {
        jumpPressed: t === 0,
        jumpHeld: t === 0,
        isGrounded: !airborne || touchingDown,
      };
    });
    const holdApex = Math.abs(Math.min(...hold.map((p) => p.yOffset)));
    const tapApex = Math.abs(Math.min(...tap.map((p) => p.yOffset)));
    expect(tapApex).toBeLessThan(holdApex * 0.7);
    expect(tapApex).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Coyote time.
// ---------------------------------------------------------------------------

describe('coyote time', () => {
  it('jump within coyote window fires', () => {
    // Walked off a ledge (always airborne); press at tick 3 (< 0.08s ≈ 4.8 ticks).
    const traj = runScenario(20, (t) => ({
      jumpPressed: t === 3,
      jumpHeld: t >= 3,
      isGrounded: false,
    }));
    const phases = traj.map((p) => p.phase);
    expect(phases.slice(3, 10)).toContain('anticipating');
  });

  it('jump past coyote window does NOT fire', () => {
    const traj = runScenario(20, (t) => ({
      jumpPressed: t === 10,
      jumpHeld: t >= 10,
      isGrounded: false,
    }));
    const phases = traj.map((p) => p.phase);
    expect(phases.slice(10)).not.toContain('anticipating');
    expect(phases.slice(10)).not.toContain('rising');
  });
});

// ---------------------------------------------------------------------------
// Jump buffering.
// ---------------------------------------------------------------------------

describe('jump buffering', () => {
  it('press 5 ticks before landing → fires on the landing tick', () => {
    // First jump lands ~tick 38; a press at tick 33 buffers and re-fires on land.
    const traj = runScenario(50, (t) => ({
      jumpPressed: t === 0 || t === 33,
      jumpHeld: true,
      isGrounded: t <= 3 || t >= 38,
    }));
    const phases = traj.map((p) => p.phase);
    expect(phases.slice(38, 48)).toContain('anticipating');
  });

  it('press 15 ticks before landing → buffer expired, no re-fire', () => {
    const traj = runScenario(50, (t) => ({
      jumpPressed: t === 0 || t === 23,
      jumpHeld: true,
      isGrounded: t <= 3 || t >= 38,
    }));
    const phases = traj.map((p) => p.phase);
    const afterLand = phases.slice(40, 50);
    expect(afterLand).not.toContain('anticipating');
    expect(afterLand).not.toContain('rising');
  });
});

// ---------------------------------------------------------------------------
// Tick-boundary behavior (per architect — pre-decrement "active" semantics).
// ---------------------------------------------------------------------------

describe('tick-boundary coyote', () => {
  it('coyoteTimer === dt + jumpPressed same tick → fires', () => {
    // Enter FALLING with a fresh coyote window.
    let state = createJumpState(DEFAULT_JUMP);
    state = advanceJump(
      state,
      { jumpPressed: false, jumpHeld: false, isGrounded: false },
      DT,
      DEFAULT_JUMP,
    );
    expect(state.phase).toBe('falling');
    // Force the timer to exactly dt (one tick of grace left).
    const boundary: JumpState = { ...state, coyoteTimer: DT };
    const next = advanceJump(
      boundary,
      { jumpPressed: true, jumpHeld: true, isGrounded: false },
      DT,
      DEFAULT_JUMP,
    );
    expect(next.phase).toBe('anticipating');
  });

  it('coyoteTimer === 0 + jumpPressed same tick → does NOT fire', () => {
    let state = createJumpState(DEFAULT_JUMP);
    state = advanceJump(
      state,
      { jumpPressed: false, jumpHeld: false, isGrounded: false },
      DT,
      DEFAULT_JUMP,
    );
    const boundary: JumpState = { ...state, coyoteTimer: 0 };
    const next = advanceJump(
      boundary,
      { jumpPressed: true, jumpHeld: true, isGrounded: false },
      DT,
      DEFAULT_JUMP,
    );
    expect(next.phase).not.toBe('anticipating');
    expect(next.phase).toBe('falling');
  });
});

describe('tick-boundary buffer', () => {
  it('jumpBufferTimer === dt on landing tick → buffered jump fires', () => {
    // Rise + fall until just before landing.
    let state = createJumpState(DEFAULT_JUMP);
    for (let t = 0; t < 37; t++) {
      state = advanceJump(
        state,
        { jumpPressed: t === 0, jumpHeld: true, isGrounded: t <= 3 },
        DT,
        DEFAULT_JUMP,
      );
    }
    expect(state.phase).toBe('falling');
    const boundary: JumpState = { ...state, jumpBufferTimer: DT };
    const next = advanceJump(
      boundary,
      { jumpPressed: false, jumpHeld: true, isGrounded: true },
      DT,
      DEFAULT_JUMP,
    );
    expect(next.phase).toBe('anticipating');
  });

  it('jumpBufferTimer === 0 on landing tick → no buffered re-fire', () => {
    let state = createJumpState(DEFAULT_JUMP);
    for (let t = 0; t < 37; t++) {
      state = advanceJump(
        state,
        { jumpPressed: t === 0, jumpHeld: true, isGrounded: t <= 3 },
        DT,
        DEFAULT_JUMP,
      );
    }
    const boundary: JumpState = { ...state, jumpBufferTimer: 0 };
    const next = advanceJump(
      boundary,
      { jumpPressed: false, jumpHeld: true, isGrounded: true },
      DT,
      DEFAULT_JUMP,
    );
    expect(next.phase).toBe('landing');
  });
});

// ---------------------------------------------------------------------------
// Landing squash.
// ---------------------------------------------------------------------------

describe('landing squash', () => {
  it('scaleY dips on landing then recovers toward 1.0', () => {
    const traj = runScenario(120, fullHoldInputs);
    const scaleY = traj.map((p) => p.scaleY);
    const landIdx = traj.findIndex((p) => p.phase === 'landing');
    expect(landIdx).toBeGreaterThan(0);
    expect(scaleY[landIdx]).toBeLessThan(DEFAULT_JUMP.landingSquashMin + 0.2);
    // Within 30 ticks, scaleY is back near 1.0.
    const recoverIdx = Math.min(landIdx + 30, scaleY.length - 1);
    expect(Math.abs(scaleY[recoverIdx] - 1.0)).toBeLessThan(0.1);
  });
});

// ---------------------------------------------------------------------------
// Airborne blend ramp.
// ---------------------------------------------------------------------------

describe('airborne blend ramp', () => {
  it('ramps 0→1 after launch and back to ~0 after landing', () => {
    const traj = runScenario(120, fullHoldInputs);
    const blend = traj.map((p) => p.airborneBlend);
    expect(Math.max(...blend)).toBeCloseTo(1.0, 6);
    expect(blend[blend.length - 1]).toBeLessThan(0.1);
  });

  it('is clamped to [0, 1] at all times', () => {
    const traj = runScenario(120, fullHoldInputs);
    for (const p of traj) {
      expect(p.airborneBlend).toBeGreaterThanOrEqual(0);
      expect(p.airborneBlend).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Anticipation + launch stretch.
// ---------------------------------------------------------------------------

describe('anticipation', () => {
  it('scaleY ≈ anticipationSquash during the anticipating phase', () => {
    const traj = runScenario(120, fullHoldInputs);
    const anticip = traj.filter((p) => p.phase === 'anticipating');
    expect(anticip.length).toBeGreaterThan(0);
    for (const p of anticip) {
      expect(p.scaleY).toBeCloseTo(DEFAULT_JUMP.anticipationSquash, 2);
    }
  });

  it('launch stretch applies for one tick (first rising tick scaleY ≈ launchStretch)', () => {
    const traj = runScenario(120, fullHoldInputs);
    const firstRising = traj.findIndex((p) => p.phase === 'rising');
    expect(firstRising).toBeGreaterThan(0);
    expect(traj[firstRising].scaleY).toBeCloseTo(DEFAULT_JUMP.launchStretch, 2);
    // The following rising tick is no longer stretched.
    if (firstRising + 1 < traj.length && traj[firstRising + 1].phase === 'rising') {
      expect(traj[firstRising + 1].scaleY).toBeCloseTo(1.0, 1);
    }
  });
});

// ---------------------------------------------------------------------------
// Ceiling hit.
// ---------------------------------------------------------------------------

describe('ceiling hit', () => {
  it('rising + hitCeiling → falling with vy ≈ 0', () => {
    let state = createJumpState(DEFAULT_JUMP);
    for (let t = 0; t < 6; t++) {
      state = advanceJump(
        state,
        { jumpPressed: t === 0, jumpHeld: true, isGrounded: t <= 3 },
        DT,
        DEFAULT_JUMP,
      );
    }
    expect(state.phase).toBe('rising');
    const next = advanceJump(
      state,
      { jumpPressed: false, jumpHeld: true, isGrounded: false, hitCeiling: true },
      DT,
      DEFAULT_JUMP,
    );
    expect(next.phase).toBe('falling');
    expect(Math.abs(next.vy)).toBeLessThan(1.0);
  });
});

// ---------------------------------------------------------------------------
// Determinism + purity (architecture contract).
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('identical inputs → deep-equal trajectories', () => {
    const a = runScenario(120, fullHoldInputs);
    const b = runScenario(120, fullHoldInputs);
    expect(a).toEqual(b);
  });
});

describe('purity', () => {
  it('advanceJump does not mutate its state input', () => {
    let state = createJumpState(DEFAULT_JUMP);
    state = advanceJump(
      state,
      { jumpPressed: true, jumpHeld: true, isGrounded: true },
      DT,
      DEFAULT_JUMP,
    );
    state = advanceJump(
      state,
      { jumpPressed: false, jumpHeld: true, isGrounded: true },
      DT,
      DEFAULT_JUMP,
    );
    const snap: JumpState = JSON.parse(JSON.stringify(state));
    advanceJump(
      state,
      { jumpPressed: false, jumpHeld: true, isGrounded: true },
      DT,
      DEFAULT_JUMP,
    );
    expect(state).toEqual(snap);
  });

  it('createJumpState returns a grounded, at-rest state', () => {
    const s = createJumpState(DEFAULT_JUMP);
    expect(s.phase).toBe('grounded');
    expect(s.vy).toBe(0);
    expect(s.y).toBe(0);
    expect(s.airborneBlend).toBe(0);
    expect(s.squashOffset).toBe(0);
  });
});
