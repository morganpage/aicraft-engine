import { describe, it, expect } from 'vitest';
import {
  waveDisplacement,
  gerstnerDisplacement,
  generateWaveLine,
  DEFAULT_WAVE_LINE,
  DEFAULT_GERSTNER,
  type WaveDisplacementConfig,
} from '../primitives/wave-line';

// =============================================================================
// waveDisplacement
// =============================================================================

describe('waveDisplacement', () => {
  it('returns baseY at x=0, t=0 with phase=0 (sin(0)=0)', () => {
    const cfg: WaveDisplacementConfig = {
      baseY: 100,
      octaves: [{ amplitude: 5, wavelength: 28, speed: 0.8 }],
    };
    expect(waveDisplacement(0, 0, cfg)).toBe(100);
  });

  it('returns absolute Y with crest-up = negative Y direction (canvas convention)', () => {
    const cfg: WaveDisplacementConfig = {
      baseY: 100,
      octaves: [{ amplitude: 5, wavelength: 28, speed: 0.8 }],
    };
    // Crest at x = wavelength/4 = 7: arg = π/2, sin = 1 → Y = baseY - amp = 95.
    expect(waveDisplacement(7, 0, cfg)).toBeCloseTo(95, 5);
    // Trough at x = 3·wavelength/4 = 21: arg = 3π/2, sin = -1 → Y = baseY + amp = 105.
    expect(waveDisplacement(21, 0, cfg)).toBeCloseTo(105, 5);
  });

  it('is deterministic (same inputs → same output)', () => {
    const cfg: WaveDisplacementConfig = {
      baseY: 100,
      octaves: [{ amplitude: 5, wavelength: 28, speed: 0.8 }],
    };
    expect(waveDisplacement(13.7, 42, cfg)).toBe(waveDisplacement(13.7, 42, cfg));
  });

  it('sums multiple octaves correctly', () => {
    const cfg: WaveDisplacementConfig = {
      baseY: 100,
      octaves: [
        { amplitude: 5, wavelength: 28, speed: 0.8 },
        { amplitude: 2, wavelength: 15, speed: -1.2 },
      ],
    };
    // At x=7, t=0: octave0 arg=π/2 (sin=1, contrib=5); octave1 arg=14π/15.
    const expected =
      100 -
      (5 * Math.sin((2 * Math.PI * 7) / 28) +
        2 * Math.sin((2 * Math.PI * 7) / 15));
    expect(waveDisplacement(7, 0, cfg)).toBeCloseTo(expected, 5);
  });

  it('returns baseY when octaves is empty', () => {
    const cfg: WaveDisplacementConfig = { baseY: 100, octaves: [] };
    expect(waveDisplacement(50, 30, cfg)).toBe(100);
  });

  it('skips octaves with wavelength <= 0', () => {
    const cfgZero: WaveDisplacementConfig = {
      baseY: 100,
      octaves: [{ amplitude: 5, wavelength: 0, speed: 0.8 }],
    };
    expect(waveDisplacement(10, 5, cfgZero)).toBe(100);
    const cfgNeg: WaveDisplacementConfig = {
      baseY: 100,
      octaves: [{ amplitude: 5, wavelength: -10, speed: 0.8 }],
    };
    expect(waveDisplacement(10, 5, cfgNeg)).toBe(100);
  });

  it('respects optional phase offset', () => {
    const cfgA: WaveDisplacementConfig = {
      baseY: 100,
      octaves: [{ amplitude: 5, wavelength: 28, speed: 0.8 }],
    };
    const cfgB: WaveDisplacementConfig = {
      baseY: 100,
      octaves: [{ amplitude: 5, wavelength: 28, speed: 0.8, phase: Math.PI / 2 }],
    };
    // At x=0, t=0: cfgA arg=0 (Y=100); cfgB arg=π/2 (Y=95).
    expect(waveDisplacement(0, 0, cfgA)).toBe(100);
    expect(waveDisplacement(0, 0, cfgB)).toBeCloseTo(95, 5);
  });
});

// =============================================================================
// gerstnerDisplacement
// =============================================================================

describe('gerstnerDisplacement', () => {
  it('returns {x, y, dx, dy} with all four fields', () => {
    const r = gerstnerDisplacement(0, 0, {
      baseY: 100,
      octaves: [{ amplitude: 5, wavelength: 28, speed: 0.8, steepness: 0.7 }],
    });
    expect(r).toHaveProperty('x');
    expect(r).toHaveProperty('y');
    expect(r).toHaveProperty('dx');
    expect(r).toHaveProperty('dy');
  });

  it('at x0=0, t=0, phase=0: matches closed-form Gerstner math', () => {
    // arg = 0 → sin=0, cos=1.
    // x  = x0 + Q·A·cos(0)   = steep/k   (since Q·A = steep/k).
    // y  = baseY - A·sin(0)  = baseY.
    // dx = 1 - steep·sin(0)  = 1.
    // dy = -A·k·cos(0)       = -A·k.
    const A = 5;
    const WL = 28;
    const steep = 0.7;
    const k = (2 * Math.PI) / WL;
    const r = gerstnerDisplacement(0, 0, {
      baseY: 100,
      octaves: [{ amplitude: A, wavelength: WL, speed: 0.8, steepness: steep }],
    });
    expect(r.x).toBeCloseTo(steep / k, 5);
    expect(r.y).toBeCloseTo(100, 5);
    expect(r.dx).toBeCloseTo(1, 5);
    expect(r.dy).toBeCloseTo(-A * k, 5);
  });

  it('reduces to pure sine (x = x0) when steepness = 0', () => {
    const r = gerstnerDisplacement(7, 0, {
      baseY: 100,
      octaves: [{ amplitude: 5, wavelength: 28, speed: 0.8, steepness: 0 }],
    });
    expect(r.x).toBe(7);
    // arg = (2π/28)·7 = π/2 → sin=1 → y = 100 - 5 = 95.
    expect(r.y).toBeCloseTo(95, 5);
  });

  it('clamps steepness > 1 to 1 (identical to steepness = 1)', () => {
    const make = (s: number) =>
      gerstnerDisplacement(7, 30, {
        baseY: 100,
        octaves: [{ amplitude: 5, wavelength: 28, speed: 0.8, steepness: s }],
      });
    expect(make(1)).toEqual(make(5));
    expect(make(1)).toEqual(make(100));
  });

  it('clamps steepness < 0 to 0 (identical to steepness = 0)', () => {
    const make = (s: number) =>
      gerstnerDisplacement(7, 30, {
        baseY: 100,
        octaves: [{ amplitude: 5, wavelength: 28, speed: 0.8, steepness: s }],
      });
    expect(make(0)).toEqual(make(-1));
  });

  it('steepness clamp prevents self-intersection (dx >= 0 across a full wavelength)', () => {
    // For a single octave at steepness = 1, dx/dx0 = 1 - sin(arg) ∈ [0, 2].
    const cfg = {
      baseY: 100,
      octaves: [{ amplitude: 5, wavelength: 28, speed: 0.8, steepness: 1 }],
    };
    for (let i = 0; i <= 100; i++) {
      const x0 = (i / 100) * 28;
      const r = gerstnerDisplacement(x0, 0, cfg);
      expect(r.dx).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('respects per-octave steepness (changing one octave affects x, not y)', () => {
    const cfgFlat = {
      baseY: 100,
      octaves: [
        { amplitude: 5, wavelength: 28, speed: 0.8, steepness: 0 },
        { amplitude: 2, wavelength: 15, speed: -1.2, steepness: 0 },
      ],
    };
    const cfgSteep = {
      baseY: 100,
      octaves: [
        { amplitude: 5, wavelength: 28, speed: 0.8, steepness: 1 },
        { amplitude: 2, wavelength: 15, speed: -1.2, steepness: 0 },
      ],
    };
    const rFlat = gerstnerDisplacement(5, 10, cfgFlat);
    const rSteep = gerstnerDisplacement(5, 10, cfgSteep);
    // Vertical displacement is steepness-independent.
    expect(rFlat.y).toBeCloseTo(rSteep.y, 5);
    // Horizontal pinch differs.
    expect(rFlat.x).not.toBeCloseTo(rSteep.x, 5);
  });

  it('is deterministic (same inputs → same output)', () => {
    const cfg = {
      baseY: 100,
      octaves: [{ amplitude: 5, wavelength: 28, speed: 0.8, steepness: 0.7 }],
    };
    expect(gerstnerDisplacement(13.5, 42, cfg)).toEqual(
      gerstnerDisplacement(13.5, 42, cfg),
    );
  });

  it('skips octaves with wavelength <= 0', () => {
    const r = gerstnerDisplacement(0, 0, {
      baseY: 100,
      octaves: [{ amplitude: 5, wavelength: 0, speed: 0.8, steepness: 0.7 }],
    });
    expect(r.x).toBe(0);
    expect(r.y).toBe(100);
  });
});

// =============================================================================
// generateWaveLine
// =============================================================================

describe('generateWaveLine', () => {
  it('returns WavePoint[] with flat shape {x, y, normalX, normalY}', () => {
    const points = generateWaveLine(0, 100, 100, 100, 10, 0);
    expect(points.length).toBeGreaterThan(0);
    const p = points[0] as { normal?: unknown };
    expect(p).toHaveProperty('x');
    expect(p).toHaveProperty('y');
    expect(p).toHaveProperty('normalX');
    expect(p).toHaveProperty('normalY');
    // Flat shape: no nested `normal` field.
    expect(p.normal).toBeUndefined();
  });

  it('sine mode: produces round(segLen/spacing) + 1 points', () => {
    const points = generateWaveLine(0, 100, 100, 100, 10, 0, { mode: 'sine' });
    // round(100/10) + 1 = 11
    expect(points.length).toBe(11);
  });

  it('gerstner mode: produces same sample count as sine', () => {
    const points = generateWaveLine(0, 100, 100, 100, 10, 0, { mode: 'gerstner' });
    expect(points.length).toBe(11);
  });

  it('sine mode: endpoint inclusion (first.x = startX, last.x = endX)', () => {
    const points = generateWaveLine(0, 100, 100, 100, 10, 0, { mode: 'sine' });
    expect(points[0].x).toBe(0);
    expect(points[points.length - 1].x).toBe(100);
  });

  it('sampleCount = round(segLen/spacing) for non-even divisions', () => {
    // segLen=100, spacing=3 → round(33.33)=33 → 34 points.
    const points = generateWaveLine(0, 100, 100, 100, 3, 0, { mode: 'sine' });
    expect(points.length).toBe(34);
  });

  it('clamps sampleSpacing below 1 to 1', () => {
    // spacing=0 → treated as 1 → round(100/1)+1 = 101 points.
    const points = generateWaveLine(0, 100, 100, 100, 0, 0, { mode: 'sine' });
    expect(points.length).toBe(101);
  });

  it('snapToPixel = true rounds coordinates to integers', () => {
    const points = generateWaveLine(0, 100, 100, 100, 10, 30, {
      mode: 'sine',
      snapToPixel: true,
    });
    for (const p of points) {
      expect(Number.isInteger(p.x)).toBe(true);
      expect(Number.isInteger(p.y)).toBe(true);
    }
  });

  it('snapToPixel = false preserves fractional y coordinates', () => {
    const points = generateWaveLine(0, 100, 100, 100, 10, 30, {
      mode: 'sine',
      snapToPixel: false,
      octaves: [{ amplitude: 5, wavelength: 28, speed: 0.8 }],
    });
    const hasFractional = points.some((p) => !Number.isInteger(p.y));
    expect(hasFractional).toBe(true);
  });

  it('zero-amplitude horizontal segment: normals point up (0, -1)', () => {
    const points = generateWaveLine(0, 100, 100, 100, 10, 0, {
      mode: 'sine',
      octaves: [{ amplitude: 0, wavelength: 28, speed: 0.8 }],
    });
    for (const p of points) {
      expect(p.normalX).toBeCloseTo(0, 5);
      expect(p.normalY).toBeCloseTo(-1, 5);
    }
  });

  it('zero-amplitude vertical segment: normals point right (1, 0)', () => {
    const points = generateWaveLine(50, 0, 50, 100, 10, 0, {
      mode: 'sine',
      octaves: [{ amplitude: 0, wavelength: 28, speed: 0.8 }],
    });
    for (const p of points) {
      expect(p.normalX).toBeCloseTo(1, 5);
      expect(p.normalY).toBeCloseTo(0, 5);
    }
  });

  it('normals are unit length', () => {
    const points = generateWaveLine(0, 100, 100, 100, 4, 30, DEFAULT_WAVE_LINE);
    for (const p of points) {
      const len = Math.sqrt(p.normalX * p.normalX + p.normalY * p.normalY);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it('degenerate segment (start === end) returns single point with default normal (0, -1)', () => {
    const points = generateWaveLine(50, 50, 50, 50, 10, 0);
    expect(points.length).toBe(1);
    expect(points[0].x).toBe(50);
    expect(points[0].y).toBe(50);
    expect(points[0].normalX).toBe(0);
    expect(points[0].normalY).toBe(-1);
  });

  it('is deterministic (same inputs → same output)', () => {
    const a = generateWaveLine(0, 100, 100, 100, 4, 30, DEFAULT_WAVE_LINE);
    const b = generateWaveLine(0, 100, 100, 100, 4, 30, DEFAULT_WAVE_LINE);
    expect(a).toEqual(b);
  });

  it('uses DEFAULT_WAVE_LINE when config is omitted', () => {
    const a = generateWaveLine(0, 100, 100, 100, 4, 30);
    const b = generateWaveLine(0, 100, 100, 100, 4, 30, DEFAULT_WAVE_LINE);
    expect(a).toEqual(b);
  });

  it('sine mode y values match waveDisplacement at corresponding arc length', () => {
    const octaves = [{ amplitude: 5, wavelength: 28, speed: 0.8 }];
    const baseY = 100;
    const t = 30;
    const points = generateWaveLine(0, baseY, 100, baseY, 10, t, {
      mode: 'sine',
      snapToPixel: false,
      octaves,
    });
    const sampleCount = points.length - 1;
    const segLen = 100;
    for (let i = 0; i < points.length; i++) {
      const s = (i / sampleCount) * segLen;
      const expectedY = waveDisplacement(s, t, { baseY, octaves });
      expect(points[i].y).toBeCloseTo(expectedY, 5);
    }
  });

  it('gerstner mode produces valid points without throwing', () => {
    const points = generateWaveLine(0, 100, 100, 100, 4, 30, DEFAULT_GERSTNER);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isFinite(p.normalX)).toBe(true);
      expect(Number.isFinite(p.normalY)).toBe(true);
    }
  });
});

// =============================================================================
// DEFAULT_WAVE_LINE / DEFAULT_GERSTNER (ratified values)
// =============================================================================

describe('DEFAULT_WAVE_LINE', () => {
  it('has ratified values: sine, 2 octaves, snapToPixel: true', () => {
    expect(DEFAULT_WAVE_LINE.mode).toBe('sine');
    expect(DEFAULT_WAVE_LINE.octaves).toHaveLength(2);
    expect(DEFAULT_WAVE_LINE.octaves[0]).toEqual({
      amplitude: 5.5,
      wavelength: 28,
      speed: 0.8,
    });
    expect(DEFAULT_WAVE_LINE.octaves[1]).toEqual({
      amplitude: 2.0,
      wavelength: 15,
      speed: -1.2,
    });
    expect(DEFAULT_WAVE_LINE.snapToPixel).toBe(true);
  });
});

describe('DEFAULT_GERSTNER', () => {
  it('has ratified values: gerstner, 2 octaves, steepness: 0.7, snapToPixel: false', () => {
    expect(DEFAULT_GERSTNER.mode).toBe('gerstner');
    expect(DEFAULT_GERSTNER.octaves).toHaveLength(2);
    expect(DEFAULT_GERSTNER.octaves[0]).toEqual({
      amplitude: 5.5,
      wavelength: 28,
      speed: 0.8,
    });
    expect(DEFAULT_GERSTNER.octaves[1]).toEqual({
      amplitude: 2.0,
      wavelength: 15,
      speed: -1.2,
    });
    expect(DEFAULT_GERSTNER.steepness).toBe(0.7);
    expect(DEFAULT_GERSTNER.snapToPixel).toBe(false);
  });
});
