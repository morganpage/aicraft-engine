/**
 * Dev-time plausibility guards (src/particles/plausibility.ts). The guards
 * warn ONCE PER PROCESS per kind, so these tests are ordered: silent-cases
 * first (while both flags are still clean), then each kind's warn is consumed
 * exactly once and its silence-thereafter is asserted inside the same test.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mulberry32, sampleConeVelocity, spawn } from '../index';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('warn-once plausibility guards', () => {
  it('plausible tick-unit values stay silent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    spawn(0, 0, { count: 4, speed: 2, speedJitter: 0.25, life: 30, size: 2, rng: mulberry32(3) });
    sampleConeVelocity({ baseAngle: -Math.PI / 2, spread: 1.1, speedMin: 0.35, speedMax: 0.95 }, mulberry32(3));
    expect(warn).not.toHaveBeenCalled();
  });

  it('a px/s-sized speed warns exactly once across spawn AND cone call sites', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 14 — the exact px/s-authored dash-trail speed a real build shipped.
    spawn(0, 0, { count: 1, speed: 14, life: 24, size: 2 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('px/tick');
    // The cone variant of the same bug (a 16–80 dust cone): same kind, so the
    // once-per-process guard stays silent — the message already fired.
    sampleConeVelocity({ baseAngle: -Math.PI / 2, spread: 1.4, speedMin: 16, speedMax: 80 }, mulberry32(1));
    expect(warn).toHaveBeenCalledTimes(1);
    // And further suspicious spawns stay quiet too.
    spawn(0, 0, { count: 1, speed: 40, life: 24, size: 2 });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a seconds-sized life warns once (the 60×-too-slow twin)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    spawn(0, 0, { count: 1, speed: 1, life: 900, size: 2 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('ticks');
    spawn(0, 0, { count: 1, speed: 1, life: 1200, size: 2 });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
