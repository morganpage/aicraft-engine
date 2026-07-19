import { describe, it, expect } from 'vitest';
import { spawn, type SpawnOptions } from '../particles';

/**
 * Contract: `SpawnOptions.gravity` was a footgun. The field existed on the
 * type but `spawn()` ignored it — readers assumed spawn-time gravity
 * application that never happened. Gravity is now properly an `advance`-time
 * concern (see `AdvanceOptions.gravity`).
 *
 * These tests pin both halves of the removal:
 *   1. Type-level: `SpawnOptions` no longer accepts a `gravity` field.
 *   2. Runtime-level: even if a caller smuggles `gravity` in via `as any`,
 *      initial velocities are byte-identical to a clean call (defensive — the
 *      field is silently dropped, never silently applied).
 */
describe('SpawnOptions.gravity (removed field)', () => {
  it('type-level: SpawnOptions does not accept gravity', () => {
    // If `gravity` is ever re-added to SpawnOptions, this line fails to
    // compile (the @ts-expect-error becomes unused). The build gate enforces
    // it via `noUnusedLocals`-equivalent tsc checks on test files.
    const opts = {
      // @ts-expect-error gravity is intentionally NOT on SpawnOptions
      gravity: 0.5,
      count: 1,
      speed: 1,
      life: 10,
      size: 1,
    } satisfies SpawnOptions;
    expect(opts).toBeDefined();
  });

  it('runtime: smuggled gravity via `as any` does not affect initial velocity', () => {
    const clean = spawn(0, 0, { count: 4, speed: 2, life: 10, size: 1 });
    const smuggled = spawn(0, 0, {
      count: 4,
      speed: 2,
      life: 10,
      size: 1,
      gravity: 999,
    } as SpawnOptions & { gravity: number });
    expect(smuggled.map((p) => ({ vx: p.vx, vy: p.vy }))).toEqual(
      clean.map((p) => ({ vx: p.vx, vy: p.vy })),
    );
  });

  it('runtime: smuggled gravity does not affect position or life', () => {
    const clean = spawn(5, 7, { count: 2, speed: 3, life: 24, size: 2 });
    const smuggled = spawn(5, 7, {
      count: 2,
      speed: 3,
      life: 24,
      size: 2,
      gravity: -1,
    } as SpawnOptions & { gravity: number });
    expect(smuggled).toEqual(clean);
  });
});
