import { describe, it, expect } from 'vitest';
import { spawn, type SpawnOptions } from '../particles';
import type { Particle } from '../particles';
import { mulberry32 } from '../rng';

/**
 * Contract: `speedJitter > 0` implies randomness, and determinism demands an
 * explicit seeded RNG. Previously `spawn()` threw a bare message
 * (`'speedJitter > 0 requires an rng function'`) that named neither the option
 * path nor the fix — an uncaught throw here froze a game's rAF loop
 * (ISSUES.md §2.6). These tests pin the improved ergonomics:
 *   1. The throw message names BOTH `speedJitter` and `rng`.
 *   2. A seeded `mulberry32` unlocks the jittered path and yields finite output.
 *   3. Same seed → byte-identical velocities; different seed → different output.
 *   4. The no-jitter path is finite and unaffected by the presence of an rng.
 */

/** Velocity components of a particle array, in order. */
function velocities(
  ps: readonly Particle[],
): Array<{ vx: number; vy: number }> {
  return ps.map((p) => ({ vx: p.vx, vy: p.vy }));
}

/** True when every particle has finite velocity components. */
function allVelocitiesFinite(ps: readonly Particle[]): boolean {
  return ps.every((p) => Number.isFinite(p.vx) && Number.isFinite(p.vy));
}

describe('spawn (rng ergonomics)', () => {
  it('throws an Error whose message names both "speedJitter" and "rng"', () => {
    let caught: unknown;
    try {
      spawn(0, 0, {
        count: 4,
        speed: 3,
        speedJitter: 0.2,
        life: 10,
        size: 1,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message.toLowerCase();
    // Case-insensitive substring check — the message must diagnose the misuse.
    expect(msg).toContain('speedjitter');
    expect(msg).toContain('rng');
  });

  it('does not throw and yields finite velocities when speedJitter > 0 with a seeded rng', () => {
    const ps = spawn(0, 0, {
      count: 16,
      speed: 3,
      speedJitter: 0.5,
      life: 10,
      size: 1,
      rng: mulberry32(1),
    });
    expect(ps).toHaveLength(16);
    expect(allVelocitiesFinite(ps)).toBe(true);
  });

  it('is deterministic: same seed + identical options yield identical velocities', () => {
    const base: SpawnOptions = {
      count: 12,
      speed: 3,
      speedJitter: 0.4,
      life: 20,
      size: 2,
    };
    const a = velocities(spawn(0, 0, { ...base, rng: mulberry32(42) }));
    const b = velocities(spawn(0, 0, { ...base, rng: mulberry32(42) }));
    // Component-wise byte-equality across the whole burst.
    expect(a).toEqual(b);
  });

  it('a different seed yields different velocities', () => {
    const base: SpawnOptions = {
      count: 12,
      speed: 3,
      speedJitter: 0.4,
      life: 20,
      size: 2,
    };
    const a = velocities(spawn(0, 0, { ...base, rng: mulberry32(42) }));
    const c = velocities(spawn(0, 0, { ...base, rng: mulberry32(43) }));
    expect(a).not.toEqual(c);
  });

  it('no-jitter path returns finite particles without an rng', () => {
    const ps = spawn(0, 0, { count: 8, speed: 3, life: 10, size: 1 });
    expect(ps).toHaveLength(8);
    expect(allVelocitiesFinite(ps)).toBe(true);
  });

  it('no-jitter path is unaffected by the presence of an rng (rng is not consumed)', () => {
    const opts: SpawnOptions = {
      count: 8,
      speed: 3,
      speedJitter: 0,
      life: 10,
      size: 1,
    };
    const without = spawn(0, 0, opts);
    const withRng = spawn(0, 0, { ...opts, rng: mulberry32(7) });
    expect(withRng).toEqual(without);
  });
});
