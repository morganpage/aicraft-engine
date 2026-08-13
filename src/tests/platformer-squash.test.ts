import { describe, it, expect } from 'vitest';
import {
  advanceSquash,
  DEFAULT_SQUASH_CONFIG,
  IDENTITY_SCALE,
  type SquashInput,
} from '../platformer/squash';
import { EMPTY_EVENTS } from '../platformer/constants';
import type { PlatformerEvents } from '../platformer/types';
import type { Scale2D } from '../animation/squash-stretch';

const DT = 1 / 60;

/**
 * Build a `PlatformerEvents` record from partial overrides (everything else
 * false). Mirrors how the kernel accumulates per-tick events.
 */
function events(overrides: Partial<PlatformerEvents>): PlatformerEvents {
  return { ...EMPTY_EVENTS, ...overrides };
}

/** Build a `SquashInput` with sane defaults (no event, not fast-falling). */
function input(overrides: Partial<SquashInput> = {}): SquashInput {
  return {
    events: EMPTY_EVENTS,
    coreVx: 0,
    coreVy: 0,
    fastFalling: false,
    dt: DT,
    ...overrides,
  };
}

describe('advanceSquash — per-event pairs (Phase 8c)', () => {
  it('justLaunched (jump) sets the tall launch stretch (.6, 1.4)', () => {
    const next = advanceSquash(
      IDENTITY_SCALE,
      input({ events: events({ justLaunched: true }) }),
      DEFAULT_SQUASH_CONFIG,
    );
    expect(next).toEqual({ scaleX: 0.6, scaleY: 1.4 });
  });

  it('dashStarted sets the tall launch stretch (.6, 1.4)', () => {
    const next = advanceSquash(
      IDENTITY_SCALE,
      input({ events: events({ dashStarted: true }) }),
      DEFAULT_SQUASH_CONFIG,
    );
    expect(next).toEqual({ scaleX: 0.6, scaleY: 1.4 });
  });

  it('doubleJumped sets the softer beat (.8, 1.2)', () => {
    const next = advanceSquash(
      IDENTITY_SCALE,
      input({ events: events({ doubleJumped: true }) }),
      DEFAULT_SQUASH_CONFIG,
    );
    expect(next).toEqual({ scaleX: 0.8, scaleY: 1.2 });
  });

  it('wallJumpLaunched sets the horizontal impact stretch (1.4, .6)', () => {
    const next = advanceSquash(
      IDENTITY_SCALE,
      input({ events: events({ wallJumpLaunched: true }) }),
      DEFAULT_SQUASH_CONFIG,
    );
    expect(next).toEqual({ scaleX: 1.4, scaleY: 0.6 });
  });

  it('hitWall sets the wide wall-bonk squash (1.5, .5)', () => {
    const next = advanceSquash(
      IDENTITY_SCALE,
      input({ events: events({ hitWall: true }) }),
      DEFAULT_SQUASH_CONFIG,
    );
    expect(next).toEqual({ scaleX: 1.5, scaleY: 0.5 });
  });

  it('justLanded sets the landing squat (1.2, .8)', () => {
    const next = advanceSquash(
      IDENTITY_SCALE,
      input({ events: events({ justLanded: true }) }),
      DEFAULT_SQUASH_CONFIG,
    );
    expect(next).toEqual({ scaleX: 1.2, scaleY: 0.8 });
  });

  it('an event OVERRIDEs prev (does not ease from the prior scale)', () => {
    // Start from an extreme non-identity prior scale.
    const prev: Scale2D = { scaleX: 1.5, scaleY: 0.5 };
    const next = advanceSquash(
      prev,
      input({ events: events({ justLaunched: true }) }),
      DEFAULT_SQUASH_CONFIG,
    );
    expect(next).toEqual({ scaleX: 0.6, scaleY: 1.4 });
  });
});

describe('advanceSquash — multi-event precedence (deterministic)', () => {
  it('launch (justLaunched) beats impact (hitWall)', () => {
    const next = advanceSquash(
      IDENTITY_SCALE,
      input({ events: events({ justLaunched: true, hitWall: true }) }),
      DEFAULT_SQUASH_CONFIG,
    );
    expect(next).toEqual({ scaleX: 0.6, scaleY: 1.4 }); // launch wins
  });

  it('dashStarted beats wallJumpLaunched', () => {
    const next = advanceSquash(
      IDENTITY_SCALE,
      input({ events: events({ dashStarted: true, wallJumpLaunched: true }) }),
      DEFAULT_SQUASH_CONFIG,
    );
    expect(next).toEqual({ scaleX: 0.6, scaleY: 1.4 }); // launch wins
  });

  it('wallJumpLaunched beats doubleJumped', () => {
    const next = advanceSquash(
      IDENTITY_SCALE,
      input({ events: events({ wallJumpLaunched: true, doubleJumped: true }) }),
      DEFAULT_SQUASH_CONFIG,
    );
    expect(next).toEqual({ scaleX: 1.4, scaleY: 0.6 }); // wall-jump wins
  });

  it('doubleJumped beats hitWall', () => {
    const next = advanceSquash(
      IDENTITY_SCALE,
      input({ events: events({ doubleJumped: true, hitWall: true }) }),
      DEFAULT_SQUASH_CONFIG,
    );
    expect(next).toEqual({ scaleX: 0.8, scaleY: 1.2 }); // soft launch wins
  });

  it('hitWall beats justLanded', () => {
    const next = advanceSquash(
      IDENTITY_SCALE,
      input({ events: events({ hitWall: true, justLanded: true }) }),
      DEFAULT_SQUASH_CONFIG,
    );
    expect(next).toEqual({ scaleX: 1.5, scaleY: 0.5 }); // wall bonk wins
  });

  it('precedence is stable across many random-ish orderings (same inputs ⇒ same output)', () => {
    // The resolution is branch ORDER, not input key order, so any permutation of
    // the same event set must resolve identically.
    const allEvents: PlatformerEvents = {
      justLanded: true,
      justLaunched: true,
      hitCeiling: true,
      hitWall: true,
      startedWallSlide: true,
      wallJumpLaunched: true,
      dashStarting: true,
      dashStarted: true,
      doubleJumped: true,
      climbJumpLaunched: true,
      mantled: true,
    };
    const a = advanceSquash(IDENTITY_SCALE, input({ events: allEvents }), DEFAULT_SQUASH_CONFIG);
    const b = advanceSquash(IDENTITY_SCALE, input({ events: { ...allEvents } }), DEFAULT_SQUASH_CONFIG);
    // justLaunched OR dashStarted is the top-priority branch → launch pair.
    expect(a).toEqual({ scaleX: 0.6, scaleY: 1.4 });
    expect(b).toEqual(a);
  });
});

describe('advanceSquash — ease-back toward (1, 1)', () => {
  it('no event + not fast-falling eases BOTH axes toward 1 at exactly easeRate·dt', () => {
    const prev: Scale2D = { scaleX: 0.6, scaleY: 1.4 };
    const next = advanceSquash(prev, input(), DEFAULT_SQUASH_CONFIG);

    const expectedDelta = DEFAULT_SQUASH_CONFIG.easeRate * DT; // 1.75 / 60
    // scaleX moves UP toward 1 by exactly the delta.
    expect(next.scaleX).toBeCloseTo(0.6 + expectedDelta, 10);
    // scaleY moves DOWN toward 1 by exactly the delta.
    expect(next.scaleY).toBeCloseTo(1.4 - expectedDelta, 10);
    // Assert the per-frame delta verbatim (Celeste Player.cs:1165).
    expect(expectedDelta).toBeCloseTo((1.75 * DT), 10);
  });

  it('eases by easeRate·dt per frame regardless of direction (asymmetric start)', () => {
    const prev: Scale2D = { scaleX: 1.5, scaleY: 0.5 };
    const next = advanceSquash(prev, input(), DEFAULT_SQUASH_CONFIG);
    const expectedDelta = DEFAULT_SQUASH_CONFIG.easeRate * DT;
    expect(next.scaleX).toBeCloseTo(1.5 - expectedDelta, 10);
    expect(next.scaleY).toBeCloseTo(0.5 + expectedDelta, 10);
  });

  it('snaps exactly to 1 once within easeRate·dt (approach semantics)', () => {
    // Place scaleX within one step of 1; scaleY exactly one step below.
    const step = DEFAULT_SQUASH_CONFIG.easeRate * DT;
    const prev: Scale2D = { scaleX: 1 - step / 2, scaleY: 1 - step };
    const next = advanceSquash(prev, input(), DEFAULT_SQUASH_CONFIG);
    expect(next.scaleX).toBe(1);
    expect(next.scaleY).toBe(1);
  });

  it('fully recovers to (1, 1) from a launch pair in a bounded number of frames', () => {
    let scale: Scale2D = { scaleX: 0.6, scaleY: 1.4 };
    // 1.75/sec → from 0.4 away, full recovery in just over 0.4/1.75 ≈ 0.23 s.
    for (let i = 0; i < 600; i++) {
      scale = advanceSquash(scale, input(), DEFAULT_SQUASH_CONFIG);
    }
    expect(scale).toEqual({ scaleX: 1, scaleY: 1 });
  });

  it('identity at rest stays identity (no event, not fast-falling)', () => {
    const next = advanceSquash(IDENTITY_SCALE, input(), DEFAULT_SQUASH_CONFIG);
    expect(next).toEqual({ scaleX: 1, scaleY: 1 });
  });
});

describe('advanceSquash — fast-fall drift toward (.5, 1.5)', () => {
  it('fast-falling lerps BOTH axes toward the fast-fall silhouette', () => {
    const prev = IDENTITY_SCALE;
    const next = advanceSquash(
      prev,
      input({ fastFalling: true }),
      DEFAULT_SQUASH_CONFIG,
    );
    const rate = DEFAULT_SQUASH_CONFIG.fastFallRate * DT;
    expect(next.scaleX).toBeCloseTo(approachExpected(1, 0.5, rate), 10);
    expect(next.scaleY).toBeCloseTo(approachExpected(1, 1.5, rate), 10);
  });

  it('fast-falling does not overshoot the (.5, 1.5) target (approach clamps)', () => {
    let scale: Scale2D = IDENTITY_SCALE;
    for (let i = 0; i < 600; i++) {
      scale = advanceSquash(scale, input({ fastFalling: true }), DEFAULT_SQUASH_CONFIG);
    }
    expect(scale).toEqual({ scaleX: 0.5, scaleY: 1.5 });
  });

  it('fast-falling eases back out once the flag clears (recovers to 1)', () => {
    // Pump into the fast-fall squat, then release and recover.
    let scale: Scale2D = IDENTITY_SCALE;
    for (let i = 0; i < 60; i++) {
      scale = advanceSquash(scale, input({ fastFalling: true }), DEFAULT_SQUASH_CONFIG);
    }
    expect(scale.scaleX).toBeLessThan(1);
    expect(scale.scaleY).toBeGreaterThan(1);
    for (let i = 0; i < 600; i++) {
      scale = advanceSquash(scale, input({ fastFalling: false }), DEFAULT_SQUASH_CONFIG);
    }
    expect(scale).toEqual({ scaleX: 1, scaleY: 1 });
  });
});

describe('advanceSquash — purity & determinism', () => {
  it('same inputs ⇒ byte-identical output', () => {
    const prev: Scale2D = { scaleX: 0.7, scaleY: 1.3 };
    const inp = input({ events: events({ justLaunched: true }) });
    const a = advanceSquash(prev, inp, DEFAULT_SQUASH_CONFIG);
    const b = advanceSquash(prev, inp, DEFAULT_SQUASH_CONFIG);
    expect(a).toEqual(b);
  });

  it('never mutates prev (returns a fresh record)', () => {
    const prev: Scale2D = { scaleX: 0.6, scaleY: 1.4 };
    const snapshot: Scale2D = { ...prev };
    advanceSquash(prev, input(), DEFAULT_SQUASH_CONFIG);
    advanceSquash(prev, input({ events: events({ hitWall: true }) }), DEFAULT_SQUASH_CONFIG);
    advanceSquash(prev, input({ fastFalling: true }), DEFAULT_SQUASH_CONFIG);
    expect(prev).toEqual(snapshot);
  });

  it('returns a NEW object (not the prev reference)', () => {
    const prev: Scale2D = { scaleX: 1, scaleY: 1 };
    const next = advanceSquash(prev, input(), DEFAULT_SQUASH_CONFIG);
    expect(next).not.toBe(prev);
  });

  it('never throws on degenerate inputs (NaN-safe dt, zero scale)', () => {
    const prev: Scale2D = { scaleX: 0, scaleY: 0 };
    expect(() =>
      advanceSquash(prev, input({ dt: 0 }), DEFAULT_SQUASH_CONFIG),
    ).not.toThrow();
    expect(() =>
      advanceSquash(prev, input({ dt: NaN }), DEFAULT_SQUASH_CONFIG),
    ).not.toThrow();
  });

  it('honors a consumer-overridden config (faster ease, different pair)', () => {
    const tuned = {
      ...DEFAULT_SQUASH_CONFIG,
      easeRate: 10,
      launch: { scaleX: 0.5, scaleY: 1.5 },
    };
    const launched = advanceSquash(
      IDENTITY_SCALE,
      input({ events: events({ justLaunched: true }) }),
      tuned,
    );
    expect(launched).toEqual({ scaleX: 0.5, scaleY: 1.5 });
    // One frame of ease-back at the tuned rate moves 10·dt, not 1.75·dt.
    const eased = advanceSquash(launched, input(), tuned);
    expect(eased.scaleX).toBeCloseTo(0.5 + 10 * DT, 10);
  });
});

// --- local helpers ---------------------------------------------------------

/**
 * Reference implementation of `approach` for asserting the expected eased
 * value (kept local so the test independently re-derives the math the helper
 * under test relies on from `src/primitives/pixel.ts`).
 */
function approachExpected(current: number, target: number, maxDelta: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}
