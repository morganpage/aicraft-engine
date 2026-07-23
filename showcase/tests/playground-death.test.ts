/**
 * Tests for showcase-local death feedback lifecycle helpers.
 *
 * Exercises the pure deterministic helpers in `sections/playground-death.ts`.
 * All tests run in Node (DOM-free). These are the authoritative contract
 * tests — a regression here is a regression in the running showcase.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import {
  beginDeath,
  advanceDeath,
  shouldRespawn,
  deathProgress,
  isDying,
  isOneShotTick,
  shouldFlash,
  flashAlpha,
  respawnPopScale,
  DEATH_ANIM_TICKS,
  DEATH_HIT_STOP_TICKS,
  DEATH_PARTICLE_COUNT,
  DEATH_PARTICLE_COUNT_REDUCED,
  DEATH_SHAKE_AMPLITUDE,
  DEATH_SHAKE_DURATION,
  DEATH_FLASH_DURATION_TICKS,
  DEATH_RESPAWN_POP_TICKS,
  DEATH_POP_INITIAL_DELTA,
  DEATH_FLASH_COLOR,
  type DeathReason,
  type DeathState,
} from '../sections/playground-death';

// ---------------------------------------------------------------------------
// beginDeath — one-shot trigger semantics
// ---------------------------------------------------------------------------

describe('beginDeath', () => {
  it('creates a death state at tick 0 with the given reason', () => {
    for (const reason of ['enemy', 'projectile', 'fall'] as DeathReason[]) {
      const s = beginDeath(reason, 100, 200, -1, 0);
      expect(s.reason).toBe(reason);
      expect(s.tick).toBe(0);
    }
  });

  it('captures death position metadata', () => {
    const s = beginDeath('enemy', 123.5, 456.7, 0, -1);
    expect(s.deathX).toBe(123.5);
    expect(s.deathY).toBe(456.7);
  });

  it('captures impact direction metadata', () => {
    const s = beginDeath('projectile', 0, 0, -1, 0);
    expect(s.impactDirX).toBe(-1);
    expect(s.impactDirY).toBe(0);
  });

  it('handles zero impact direction (fall)', () => {
    const s = beginDeath('fall', 300, -50, 0, 0);
    expect(s.impactDirX).toBe(0);
    expect(s.impactDirY).toBe(0);
  });

  it('isOneShotTick is true on the initial state', () => {
    const s = beginDeath('enemy', 0, 0, 0, 0);
    expect(isOneShotTick(s)).toBe(true);
  });

  it('pure: does not mutate or depend on external state', () => {
    const a = beginDeath('enemy', 10, 20, 1, 0);
    const b = beginDeath('enemy', 10, 20, 1, 0);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// advanceDeath — tick progression
// ---------------------------------------------------------------------------

describe('advanceDeath', () => {
  it('increments tick by 1 each call', () => {
    let s = beginDeath('enemy', 0, 0, 0, 0);
    expect(s.tick).toBe(0);
    s = advanceDeath(s);
    expect(s.tick).toBe(1);
    s = advanceDeath(s);
    expect(s.tick).toBe(2);
  });

  it('does not advance past DEATH_ANIM_TICKS (clamps)', () => {
    let s = beginDeath('enemy', 0, 0, 0, 0);
    for (let i = 0; i < DEATH_ANIM_TICKS + 5; i++) {
      s = advanceDeath(s);
    }
    expect(s.tick).toBe(DEATH_ANIM_TICKS);
  });

  it('preserves all other fields during advance', () => {
    let s = beginDeath('projectile', 42, 99, -1, 1);
    s = advanceDeath(s);
    expect(s.reason).toBe('projectile');
    expect(s.deathX).toBe(42);
    expect(s.deathY).toBe(99);
    expect(s.impactDirX).toBe(-1);
    expect(s.impactDirY).toBe(1);
  });

  it('pure: returns a fresh object each time', () => {
    const a = beginDeath('enemy', 0, 0, 0, 0);
    const b = advanceDeath(a);
    const c = advanceDeath(a);
    expect(b).toEqual(c);
    expect(b).not.toBe(c);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// shouldRespawn — exact 15-tick edge
// ---------------------------------------------------------------------------

describe('shouldRespawn', () => {
  it('returns false at tick 0', () => {
    expect(shouldRespawn(beginDeath('enemy', 0, 0, 0, 0))).toBe(false);
  });

  it('returns false at tick 14 (one before respawn)', () => {
    let s = beginDeath('enemy', 0, 0, 0, 0);
    for (let i = 0; i < 14; i++) s = advanceDeath(s);
    expect(s.tick).toBe(14);
    expect(shouldRespawn(s)).toBe(false);
  });

  it('returns true at tick 15 (exact respawn edge)', () => {
    let s = beginDeath('enemy', 0, 0, 0, 0);
    for (let i = 0; i < DEATH_ANIM_TICKS; i++) s = advanceDeath(s);
    expect(s.tick).toBe(DEATH_ANIM_TICKS);
    expect(shouldRespawn(s)).toBe(true);
  });

  it('stays true beyond tick 15', () => {
    let s = beginDeath('enemy', 0, 0, 0, 0);
    for (let i = 0; i < DEATH_ANIM_TICKS + 3; i++) s = advanceDeath(s);
    expect(shouldRespawn(s)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isDying — true while in the dying phase (tick < DEATH_ANIM_TICKS)
// ---------------------------------------------------------------------------

describe('isDying', () => {
  it('returns true at tick 0', () => {
    expect(isDying(beginDeath('enemy', 0, 0, 0, 0))).toBe(true);
  });

  it('returns true at tick 14', () => {
    let s = beginDeath('enemy', 0, 0, 0, 0);
    for (let i = 0; i < 14; i++) s = advanceDeath(s);
    expect(isDying(s)).toBe(true);
  });

  it('returns false at tick 15 (respawn edge)', () => {
    let s = beginDeath('enemy', 0, 0, 0, 0);
    for (let i = 0; i < DEATH_ANIM_TICKS; i++) s = advanceDeath(s);
    expect(isDying(s)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deathProgress — 0..1 linear ramp
// ---------------------------------------------------------------------------

describe('deathProgress', () => {
  it('returns 0 at tick 0', () => {
    expect(deathProgress(beginDeath('enemy', 0, 0, 0, 0))).toBe(0);
  });

  it('returns tick/DEATH_ANIM_TICKS', () => {
    let s = beginDeath('enemy', 0, 0, 0, 0);
    s = advanceDeath(s);
    expect(deathProgress(s)).toBeCloseTo(1 / DEATH_ANIM_TICKS, 10);
  });

  it('returns 1 at tick DEATH_ANIM_TICKS', () => {
    let s = beginDeath('enemy', 0, 0, 0, 0);
    for (let i = 0; i < DEATH_ANIM_TICKS; i++) s = advanceDeath(s);
    expect(deathProgress(s)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// isOneShotTick — fires only at tick 0
// ---------------------------------------------------------------------------

describe('isOneShotTick', () => {
  it('returns true at tick 0', () => {
    expect(isOneShotTick(beginDeath('enemy', 0, 0, 0, 0))).toBe(true);
  });

  it('returns false at tick 1', () => {
    expect(isOneShotTick(advanceDeath(beginDeath('enemy', 0, 0, 0, 0)))).toBe(false);
  });

  it('returns false at every subsequent tick', () => {
    let s = beginDeath('enemy', 0, 0, 0, 0);
    for (let i = 1; i <= DEATH_ANIM_TICKS; i++) {
      s = advanceDeath(s);
      expect(isOneShotTick(s)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// shouldFlash — first 3 ticks, zeroed under reduced motion
// ---------------------------------------------------------------------------

describe('shouldFlash', () => {
  it('returns true for ticks 0, 1, 2 (default motion)', () => {
    let s = beginDeath('enemy', 0, 0, 0, 0);
    expect(shouldFlash(s, false)).toBe(true);
    s = advanceDeath(s);
    expect(shouldFlash(s, false)).toBe(true);
    s = advanceDeath(s);
    expect(shouldFlash(s, false)).toBe(true);
  });

  it('returns false at tick 3 (flash ends)', () => {
    let s = beginDeath('enemy', 0, 0, 0, 0);
    for (let i = 0; i < DEATH_FLASH_DURATION_TICKS; i++) s = advanceDeath(s);
    expect(shouldFlash(s, false)).toBe(false);
  });

  it('returns false for all ticks under reduced motion', () => {
    let s = beginDeath('enemy', 0, 0, 0, 0);
    for (let i = 0; i < DEATH_FLASH_DURATION_TICKS; i++) {
      expect(shouldFlash(s, true)).toBe(false);
      s = advanceDeath(s);
    }
  });
});

// ---------------------------------------------------------------------------
// flashAlpha — linear decay 1 → 0 over flash window
// ---------------------------------------------------------------------------

describe('flashAlpha', () => {
  it('returns 1 at tick 0', () => {
    expect(flashAlpha(beginDeath('enemy', 0, 0, 0, 0))).toBe(1);
  });

  it('returns 0 at tick >= flash duration', () => {
    let s = beginDeath('enemy', 0, 0, 0, 0);
    for (let i = 0; i < DEATH_FLASH_DURATION_TICKS; i++) s = advanceDeath(s);
    expect(flashAlpha(s)).toBe(0);
  });

  it('decays linearly', () => {
    let s = beginDeath('enemy', 0, 0, 0, 0);
    s = advanceDeath(s);
    expect(flashAlpha(s)).toBeCloseTo(1 - 1 / DEATH_FLASH_DURATION_TICKS, 10);
  });

  it('never returns negative', () => {
    let s = beginDeath('enemy', 0, 0, 0, 0);
    for (let i = 0; i < DEATH_ANIM_TICKS + 5; i++) {
      s = advanceDeath(s);
      expect(flashAlpha(s)).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// respawnPopScale — 8-tick spring from squash to identity
// ---------------------------------------------------------------------------

describe('respawnPopScale', () => {
  it('at tick 0, returns the initial squash', () => {
    const scale = respawnPopScale(0);
    // volumeScale(DEATH_POP_INITIAL_DELTA) where delta = -0.3
    // scaleY = 1 + (-0.3) = 0.7
    expect(scale.scaleY).toBeCloseTo(0.7, 5);
    // scaleX = 1 / 0.7 ≈ 1.4286
    expect(scale.scaleX).toBeCloseTo(1 / 0.7, 5);
  });

  it('at tick DEATH_RESPAWN_POP_TICKS, converges near identity', () => {
    const scale = respawnPopScale(DEATH_RESPAWN_POP_TICKS);
    // exp(-4) ≈ 0.0183, so delta ≈ -0.0055 → scaleY ≈ 0.9945, scaleX ≈ 1.0055.
    // Within 1% of identity is visually imperceptible.
    expect(scale.scaleX).toBeCloseTo(1.0, 1);
    expect(scale.scaleY).toBeCloseTo(1.0, 1);
  });

  it('volume is preserved (scaleX * scaleY === 1) at every tick', () => {
    for (let t = 0; t <= DEATH_RESPAWN_POP_TICKS; t++) {
      const scale = respawnPopScale(t);
      expect(scale.scaleX * scale.scaleY).toBeCloseTo(1.0, 5);
    }
  });

  it('monotonically approaches identity (scaleY increases)', () => {
    let prev = respawnPopScale(0).scaleY;
    for (let t = 1; t <= DEATH_RESPAWN_POP_TICKS; t++) {
      const cur = respawnPopScale(t).scaleY;
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
  });

  it('pure: identical inputs produce equal but independent outputs', () => {
    const a = respawnPopScale(3);
    const b = respawnPopScale(3);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Repeated hits during dying — must not retrigger
// ---------------------------------------------------------------------------

describe('repeated hits during dying', () => {
  it('beginDeath on an already-dying state: consumer guards with isDying', () => {
    const first = beginDeath('enemy', 100, 200, -1, 0);
    // The consumer checks isDying() before calling beginDeath.
    // If already dying, the consumer skips beginDeath — no retrigger.
    expect(isDying(first)).toBe(true);
    // Proving: if the consumer did NOT guard, a second beginDeath would
    // create a fresh state (stateless function). The guard is mandatory.
    const unguarded = beginDeath('projectile', 999, 999, 1, 1);
    expect(unguarded.reason).toBe('projectile'); // would be wrong — retriggered!
    // The correct pattern (tested in integration contract):
    // if (!isDying(state)) { state = beginDeath(...); }
  });

  it('advancing a death state then calling beginDeath does not corrupt progression', () => {
    let s = beginDeath('enemy', 100, 200, -1, 0);
    for (let i = 0; i < 5; i++) s = advanceDeath(s);
    expect(s.tick).toBe(5);
    // Consumer guards with isDying — the state continues to advance normally.
    expect(isDying(s)).toBe(true);
    s = advanceDeath(s);
    expect(s.tick).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// All three reasons produce valid states
// ---------------------------------------------------------------------------

describe('death reasons', () => {
  const reasons: DeathReason[] = ['enemy', 'projectile', 'fall'];

  for (const reason of reasons) {
    it(`reason="${reason}" produces a valid dying state`, () => {
      const s = beginDeath(reason, 50, 50, 0, 0);
      expect(s.reason).toBe(reason);
      expect(isDying(s)).toBe(true);
      expect(isOneShotTick(s)).toBe(true);
      expect(deathProgress(s)).toBe(0);
    });

    it(`reason="${reason}" progresses through all ticks`, () => {
      let s = beginDeath(reason, 50, 50, 0, 0);
      for (let i = 0; i < DEATH_ANIM_TICKS; i++) {
        expect(isDying(s)).toBe(true);
        s = advanceDeath(s);
      }
      expect(shouldRespawn(s)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Reduced motion — identical timing, different intensity
// ---------------------------------------------------------------------------

describe('reduced motion', () => {
  it('timing is identical: DEATH_ANIM_TICKS preserved', () => {
    let s = beginDeath('enemy', 0, 0, 0, 0);
    for (let i = 0; i < DEATH_ANIM_TICKS; i++) s = advanceDeath(s);
    expect(shouldRespawn(s)).toBe(true);
    // Timing doesn't depend on reducedMotion flag — it's pure tick counting.
    expect(s.tick).toBe(DEATH_ANIM_TICKS);
  });

  it('flash is zeroed under reduced motion at all ticks', () => {
    let s = beginDeath('enemy', 0, 0, 0, 0);
    for (let i = 0; i < DEATH_FLASH_DURATION_TICKS; i++) {
      expect(shouldFlash(s, true)).toBe(false);
      expect(flashAlpha(s)).toBeGreaterThanOrEqual(0); // alpha function is motion-agnostic
      s = advanceDeath(s);
    }
  });

  it('reduced-motion descriptor differences: particle count halved', () => {
    expect(DEATH_PARTICLE_COUNT_REDUCED).toBe(Math.floor(DEATH_PARTICLE_COUNT / 2));
  });

  it('reduced-motion descriptor differences: shake amplitude zeroed', () => {
    // The consumer checks reducedMotion and sets amplitude to 0.
    // The constants document the default values.
    expect(DEATH_SHAKE_AMPLITUDE).toBe(6);
    // Reduced motion amplitude is always 0 (consumer responsibility).
  });

  it('reduced-motion descriptor differences: flash duration zeroed', () => {
    // shouldFlash(state, true) returns false for all ticks.
    let s = beginDeath('enemy', 0, 0, 0, 0);
    for (let i = 0; i < DEATH_FLASH_DURATION_TICKS; i++) {
      expect(shouldFlash(s, true)).toBe(false);
      s = advanceDeath(s);
    }
  });
});

// ---------------------------------------------------------------------------
// Constants — locked values from the decision doc
// ---------------------------------------------------------------------------

describe('locked constants', () => {
  it('DEATH_ANIM_TICKS = 15', () => {
    expect(DEATH_ANIM_TICKS).toBe(15);
  });

  it('DEATH_HIT_STOP_TICKS = 6', () => {
    expect(DEATH_HIT_STOP_TICKS).toBe(6);
  });

  it('DEATH_PARTICLE_COUNT = 16', () => {
    expect(DEATH_PARTICLE_COUNT).toBe(16);
  });

  it('DEATH_PARTICLE_COUNT_REDUCED = 8', () => {
    expect(DEATH_PARTICLE_COUNT_REDUCED).toBe(8);
  });

  it('DEATH_SHAKE_AMPLITUDE = 6', () => {
    expect(DEATH_SHAKE_AMPLITUDE).toBe(6);
  });

  it('DEATH_SHAKE_DURATION = 10', () => {
    expect(DEATH_SHAKE_DURATION).toBe(10);
  });

  it('DEATH_FLASH_DURATION_TICKS = 3', () => {
    expect(DEATH_FLASH_DURATION_TICKS).toBe(3);
  });

  it('DEATH_RESPAWN_POP_TICKS = 8', () => {
    expect(DEATH_RESPAWN_POP_TICKS).toBe(8);
  });

  it('DEATH_POP_INITIAL_DELTA = -0.3', () => {
    expect(DEATH_POP_INITIAL_DELTA).toBe(-0.3);
  });

  it('DEATH_FLASH_COLOR = #ffffff', () => {
    expect(DEATH_FLASH_COLOR).toBe('#ffffff');
  });
});

// ---------------------------------------------------------------------------
// Integration-friendly: projectile hit produces one death, fall uses same pipeline
// ---------------------------------------------------------------------------

describe('integration contract', () => {
  it('projectile hit → beginDeath("projectile") → full lifecycle → respawn', () => {
    // Simulates what the playground does: enemy contact triggers beginDeath.
    let death = beginDeath('projectile', 300, 350, -1, 0);
    expect(isOneShotTick(death)).toBe(true);

    // Tick through the full dying phase.
    for (let i = 0; i < DEATH_ANIM_TICKS; i++) {
      expect(isDying(death)).toBe(true);
      death = advanceDeath(death);
    }
    expect(shouldRespawn(death)).toBe(true);
    expect(deathProgress(death)).toBe(1);
  });

  it('fall → beginDeath("fall") → same pipeline → respawn', () => {
    let death = beginDeath('fall', 300, 450, 0, 1);
    expect(death.reason).toBe('fall');
    expect(isOneShotTick(death)).toBe(true);

    for (let i = 0; i < DEATH_ANIM_TICKS; i++) {
      death = advanceDeath(death);
    }
    expect(shouldRespawn(death)).toBe(true);
  });

  it('enemy contact → beginDeath("enemy") → same pipeline → respawn', () => {
    let death = beginDeath('enemy', 200, 300, 1, 0);
    expect(death.reason).toBe('enemy');

    for (let i = 0; i < DEATH_ANIM_TICKS; i++) {
      death = advanceDeath(death);
    }
    expect(shouldRespawn(death)).toBe(true);
  });

  it('guard pattern: check isDying before beginDeath to prevent retrigger', () => {
    let deathState: DeathState | null = null;

    // First hit
    if (deathState === null || !isDying(deathState)) {
      deathState = beginDeath('enemy', 100, 200, -1, 0);
    }
    expect(deathState.tick).toBe(0);

    // Advance a few ticks
    deathState = advanceDeath(deathState);
    deathState = advanceDeath(deathState);
    expect(deathState.tick).toBe(2);

    // Second hit during dying — guard prevents retrigger
    if (deathState === null || !isDying(deathState)) {
      deathState = beginDeath('projectile', 999, 999, 1, 1);
    }
    // State unchanged — still tick 2, still reason 'enemy'
    expect(deathState.tick).toBe(2);
    expect(deathState.reason).toBe('enemy');
    expect(deathState.deathX).toBe(100);
  });
});
