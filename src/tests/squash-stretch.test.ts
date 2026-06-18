import { describe, it, expect } from 'vitest';
import {
  volumeScale,
  breathe,
  projectTurnedPart,
  scaledBreath,
  DEFAULT_BREATH,
  type BreathConfig,
} from '../animation/squash-stretch';

describe('volumeScale', () => {
  it('is identity at deltaY=0 ({1, 1})', () => {
    const s = volumeScale(0);
    expect(s.scaleX).toBeCloseTo(1, 10);
    expect(s.scaleY).toBeCloseTo(1, 10);
  });

  it('preserves volume (scaleX * scaleY === 1) across many deltas', () => {
    const deltas = [-0.5, -0.3, -0.1, -0.02, 0, 0.02, 0.1, 0.3, 0.5, 0.9];
    for (const d of deltas) {
      const s = volumeScale(d);
      expect(s.scaleX * s.scaleY).toBeCloseTo(1, 9);
    }
  });

  it('a positive deltaY stretches vertically and squashes horizontally', () => {
    const s = volumeScale(0.5);
    expect(s.scaleY).toBeCloseTo(1.5, 10);
    expect(s.scaleX).toBeCloseTo(1 / 1.5, 10);
    expect(s.scaleY).toBeGreaterThan(1);
    expect(s.scaleX).toBeLessThan(1);
  });

  it('a negative deltaY squashes vertically and stretches horizontally', () => {
    const s = volumeScale(-0.5);
    expect(s.scaleY).toBeCloseTo(0.5, 10);
    expect(s.scaleX).toBeCloseTo(2, 10);
    expect(s.scaleY).toBeLessThan(1);
    expect(s.scaleX).toBeGreaterThan(1);
  });

  it('clamps scaleY to the lower bound (no inversion / division by zero)', () => {
    // deltaY = -1 → raw sy = 0 → clamped to the floor.
    const s = volumeScale(-1);
    expect(s.scaleY).toBeCloseTo(0.05, 10);
    expect(s.scaleX).toBeCloseTo(1 / 0.05, 10);
    expect(Number.isFinite(s.scaleX)).toBe(true);
  });

  it('clamps scaleY to the upper bound (no blow-up)', () => {
    // deltaY = 5 → raw sy = 6 → clamped to the ceiling.
    const s = volumeScale(5);
    expect(s.scaleY).toBeCloseTo(3.0, 10);
    expect(s.scaleX).toBeCloseTo(1 / 3.0, 10);
  });

  it('returns a fresh object each call (stateless)', () => {
    expect(volumeScale(0.1)).not.toBe(volumeScale(0.1));
  });
});

describe('breathe', () => {
  it('is identity at tick=0 (sin(0)=0 → no delta)', () => {
    const s = breathe(0, DEFAULT_BREATH);
    expect(s.scaleX).toBeCloseTo(1, 10);
    expect(s.scaleY).toBeCloseTo(1, 10);
  });

  it('stays volume-preserving and bounded across many ticks', () => {
    for (let t = 0; t < 200; t++) {
      const s = breathe(t, DEFAULT_BREATH);
      expect(s.scaleX * s.scaleY).toBeCloseTo(1, 9);
      expect(s.scaleY).toBeGreaterThanOrEqual(0.05);
      expect(s.scaleY).toBeLessThanOrEqual(3.0);
      expect(Number.isFinite(s.scaleX)).toBe(true);
      expect(Number.isFinite(s.scaleY)).toBe(true);
    }
  });

  it('is periodic: breathe(0) === breathe(period)', () => {
    const period = 1 / DEFAULT_BREATH.frequency;
    const a = breathe(0, DEFAULT_BREATH);
    const b = breathe(period, DEFAULT_BREATH);
    expect(a.scaleY).toBeCloseTo(b.scaleY, 6);
    expect(a.scaleX).toBeCloseTo(b.scaleX, 6);
  });

  it('is deterministic (same inputs → same outputs)', () => {
    expect(breathe(42, DEFAULT_BREATH)).toEqual(breathe(42, DEFAULT_BREATH));
  });

  it('peaks at quarter-period (max vertical stretch)', () => {
    // sin peaks at 1 when tick*freq*2π = π/2 → tick = 1/(4*freq).
    const peak = 1 / (4 * DEFAULT_BREATH.frequency);
    const s = breathe(peak, DEFAULT_BREATH);
    expect(s.scaleY).toBeCloseTo(1 + DEFAULT_BREATH.amplitude, 6);
  });
});

describe('scaledBreath', () => {
  it('scales the amplitude by the factor', () => {
    const scaled = scaledBreath(DEFAULT_BREATH, 0.2);
    expect(scaled.amplitude).toBeCloseTo(DEFAULT_BREATH.amplitude * 0.2, 10);
  });

  it('leaves frequency unchanged', () => {
    const scaled = scaledBreath(DEFAULT_BREATH, 0.2);
    expect(scaled.frequency).toBe(DEFAULT_BREATH.frequency);
  });

  it('does not mutate the input config', () => {
    const snap = { ...DEFAULT_BREATH };
    scaledBreath(DEFAULT_BREATH, 0.2);
    expect(DEFAULT_BREATH).toEqual(snap);
  });

  it('produces smaller breathing excursion when scaled down', () => {
    const cfg: BreathConfig = DEFAULT_BREATH;
    const peakTick = 1 / (4 * cfg.frequency);
    const full = breathe(peakTick, cfg);
    const reduced = breathe(peakTick, scaledBreath(cfg, 0.2));
    expect(Math.abs(reduced.scaleY - 1)).toBeLessThan(Math.abs(full.scaleY - 1));
  });
});

describe('projectTurnedPart', () => {
  it('returns the input unchanged at facingAngle=0 (facing camera)', () => {
    const r = projectTurnedPart(5, 7, 0);
    expect(r.x).toBeCloseTo(5, 10);
    expect(r.y).toBeCloseTo(7, 10);
    expect(r.sx).toBeCloseTo(1, 10);
    expect(r.sy).toBeCloseTo(1, 10);
  });

  it('collapses horizontally at facingAngle=π/2 (full profile)', () => {
    const r = projectTurnedPart(5, 7, Math.PI / 2);
    // cos(π/2) ≈ 0 → part squashed to zero width, projected to the center line.
    expect(r.sx).toBeCloseTo(0, 10);
    expect(r.x).toBeCloseTo(0, 10);
    expect(r.y).toBeCloseTo(7, 10);
    expect(r.sy).toBeCloseTo(1, 10);
  });

  it('mirrors horizontally at facingAngle=π (facing away / flipped)', () => {
    const r = projectTurnedPart(5, 7, Math.PI);
    expect(r.x).toBeCloseTo(-5, 10);
    expect(r.sx).toBeCloseTo(1, 10);
    expect(r.y).toBeCloseTo(7, 10);
    expect(r.sy).toBeCloseTo(1, 10);
  });

  it('is deterministic (same inputs → same outputs)', () => {
    expect(projectTurnedPart(3, 4, 0.7)).toEqual(projectTurnedPart(3, 4, 0.7));
  });

  it('keeps sx non-negative (|cos|)', () => {
    for (let i = 0; i <= 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const r = projectTurnedPart(1, 1, angle);
      expect(r.sx).toBeGreaterThanOrEqual(0);
    }
  });
});
