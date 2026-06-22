import { describe, it, expect } from 'vitest';
import {
  gapSolids,
  createGapMotion,
  advanceGapMotion,
  gapTileQuery,
  DEFAULT_GAP_WIDTH,
  DEFAULT_GAP_SPEED,
  DEFAULT_CHASE_GIVE_UP_RADIUS,
  type GapSpanConfig,
  type GapGeometry,
  type GapMotionConfig,
  type GapMotionState,
} from '../collision/moving-gap';
import { resolveAxisY } from '../collision/resolve';
import type { Solid, TileSolidityQuery } from '../collision/types';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SPAN: GapSpanConfig = { x: 100, y: 200, width: 400, height: 16 };
const HALF = DEFAULT_GAP_WIDTH / 2;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ===========================================================================
// gapSolids — the four-guard clamp (the invariant anchor)
// ===========================================================================

describe('gapSolids — Guard 1: NaN rejection', () => {
  it('throws when gap.centerX is NaN', () => {
    expect(() => gapSolids(SPAN, { centerX: NaN, width: 64 })).toThrow();
  });

  it('throws when gap.width is NaN', () => {
    expect(() => gapSolids(SPAN, { centerX: 250, width: NaN })).toThrow();
  });

  it('throws when both are NaN', () => {
    expect(() => gapSolids(SPAN, { centerX: NaN, width: NaN })).toThrow();
  });
});

describe('gapSolids — Guard 2: gap.width ≤ 0 → 1 full-span fragment', () => {
  it('gap.width = 0 → exactly 1 fragment covering the full span', () => {
    const frags = gapSolids(SPAN, { centerX: 250, width: 0 });
    expect(frags).toHaveLength(1);
    expect(frags[0]).toEqual({
      x: SPAN.x,
      y: SPAN.y,
      width: SPAN.width,
      height: SPAN.height,
      passthrough: undefined,
    });
  });

  it('gap.width = -10 → exactly 1 full-span fragment', () => {
    const frags = gapSolids(SPAN, { centerX: 250, width: -10 });
    expect(frags).toHaveLength(1);
    expect(frags[0].width).toBe(SPAN.width);
  });

  it('inherits passthrough from the span', () => {
    const spanPT: GapSpanConfig = { ...SPAN, passthrough: true };
    const frags = gapSolids(spanPT, { centerX: 250, width: 0 });
    expect(frags).toHaveLength(1);
    expect(frags[0].passthrough).toBe(true);
  });
});

describe('gapSolids — Guard 3: gap.width ≥ span.width → 0 fragments', () => {
  it('gap.width = span.width → 0 fragments (fully voided)', () => {
    const frags = gapSolids(SPAN, { centerX: 250, width: SPAN.width });
    expect(frags).toHaveLength(0);
  });

  it('gap.width > span.width → 0 fragments', () => {
    const frags = gapSolids(SPAN, { centerX: 250, width: SPAN.width + 100 });
    expect(frags).toHaveLength(0);
  });
});

describe('gapSolids — Guard 4: normal case (gap fits within span)', () => {
  it('gap fully inside span → 2 fragments, both inside [span.x, span.x+span.width]', () => {
    const centerX = 250;
    const frags = gapSolids(SPAN, { centerX, width: DEFAULT_GAP_WIDTH });
    expect(frags).toHaveLength(2);
    const gapLeft = centerX - HALF;
    const gapRight = centerX + HALF;
    // Left fragment: [span.x, gapLeft]
    expect(frags[0].x).toBe(SPAN.x);
    expect(frags[0].width).toBe(gapLeft - SPAN.x);
    expect(frags[0].width).toBeGreaterThan(0);
    // Right fragment: [gapRight, span.x+span.width]
    expect(frags[1].x).toBe(gapRight);
    expect(frags[1].width).toBe(SPAN.x + SPAN.width - gapRight);
    expect(frags[1].width).toBeGreaterThan(0);
    // All fragments inside the span's Y range.
    for (const f of frags) {
      expect(f.y).toBe(SPAN.y);
      expect(f.height).toBe(SPAN.height);
    }
  });

  it('gap flush left (gapLeft = span.x) → left fragment omitted, 1 right fragment', () => {
    const centerX = SPAN.x + HALF; // 132
    const frags = gapSolids(SPAN, { centerX, width: DEFAULT_GAP_WIDTH });
    expect(frags).toHaveLength(1);
    expect(frags[0].x).toBe(centerX + HALF); // gapRight
    expect(frags[0].width).toBe(SPAN.x + SPAN.width - (centerX + HALF));
  });

  it('gap flush right (gapRight = span.x + span.width) → right fragment omitted, 1 left fragment', () => {
    const centerX = SPAN.x + SPAN.width - HALF; // 468
    const frags = gapSolids(SPAN, { centerX, width: DEFAULT_GAP_WIDTH });
    expect(frags).toHaveLength(1);
    expect(frags[0].x).toBe(SPAN.x);
    expect(frags[0].width).toBe(centerX - HALF - SPAN.x); // gapLeft - span.x
  });

  it('never produces a negative-width fragment', () => {
    // Sweep many center positions; none should yield negative widths.
    for (let i = 0; i <= 20; i++) {
      const cx = SPAN.x - 50 + i * 30; // includes out-of-bounds
      const frags = gapSolids(SPAN, { centerX: cx, width: DEFAULT_GAP_WIDTH });
      for (const f of frags) {
        expect(f.width).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('fragments never extend past the span bounds', () => {
    for (let i = 0; i <= 20; i++) {
      const cx = SPAN.x - 50 + i * 30;
      const frags = gapSolids(SPAN, { centerX: cx, width: DEFAULT_GAP_WIDTH });
      for (const f of frags) {
        expect(f.x).toBeGreaterThanOrEqual(SPAN.x);
        expect(f.x + f.width).toBeLessThanOrEqual(SPAN.x + SPAN.width);
      }
    }
  });
});

describe('gapSolids — centerX clamp (out-of-bounds values)', () => {
  it('centerX = -9999 → clamped flush left → 1 right fragment', () => {
    const frags = gapSolids(SPAN, { centerX: -9999, width: DEFAULT_GAP_WIDTH });
    expect(frags).toHaveLength(1);
    // Gap sits at the leftmost valid position: gapLeft = span.x.
    expect(frags[0].x).toBe(SPAN.x + DEFAULT_GAP_WIDTH); // gapRight
  });

  it('centerX = +9999 → clamped flush right → 1 left fragment', () => {
    const frags = gapSolids(SPAN, { centerX: 9999, width: DEFAULT_GAP_WIDTH });
    expect(frags).toHaveLength(1);
    expect(frags[0].x).toBe(SPAN.x);
    expect(frags[0].width).toBe(SPAN.width - DEFAULT_GAP_WIDTH);
  });

  it('centerX = -Infinity → clamped flush left', () => {
    const frags = gapSolids(SPAN, { centerX: -Infinity, width: DEFAULT_GAP_WIDTH });
    expect(frags).toHaveLength(1);
    expect(frags[0].x).toBe(SPAN.x + DEFAULT_GAP_WIDTH);
  });

  it('centerX = +Infinity → clamped flush right', () => {
    const frags = gapSolids(SPAN, { centerX: Infinity, width: DEFAULT_GAP_WIDTH });
    expect(frags).toHaveLength(1);
    expect(frags[0].x).toBe(SPAN.x);
  });
});

describe('gapSolids — passthrough inheritance', () => {
  it('fragments carry span.passthrough = true', () => {
    const spanPT: GapSpanConfig = { ...SPAN, passthrough: true };
    const frags = gapSolids(spanPT, { centerX: 250, width: DEFAULT_GAP_WIDTH });
    expect(frags).toHaveLength(2);
    for (const f of frags) {
      expect(f.passthrough).toBe(true);
    }
  });

  it('fragments carry span.passthrough = false', () => {
    const spanPT: GapSpanConfig = { ...SPAN, passthrough: false };
    const frags = gapSolids(spanPT, { centerX: 250, width: DEFAULT_GAP_WIDTH });
    expect(frags).toHaveLength(2);
    for (const f of frags) {
      expect(f.passthrough).toBe(false);
    }
  });
});

describe('gapSolids — purity', () => {
  it('does not mutate the span or gap inputs', () => {
    const spanSnap = clone(SPAN);
    const gap: GapGeometry = { centerX: 250, width: DEFAULT_GAP_WIDTH };
    const gapSnap = clone(gap);
    gapSolids(SPAN, gap);
    expect(SPAN).toEqual(spanSnap);
    expect(gap).toEqual(gapSnap);
  });
});

describe('gapSolids — golden table (from the proposal)', () => {
  it('gapWidth = 0 → 1 fragment (full span)', () => {
    expect(gapSolids(SPAN, { centerX: 250, width: 0 })).toHaveLength(1);
  });
  it('gapWidth = -10 → 1 fragment (full span)', () => {
    expect(gapSolids(SPAN, { centerX: 250, width: -10 })).toHaveLength(1);
  });
  it('gapWidth = span.width - 1 → 1 fragment (gap nearly fills span; clamped)', () => {
    // width=399, half=199.5. minCenter=299.5, maxCenter=300.5. centerX=250
    // clamps to 299.5 → gapLeft=100=span.x → left fragment omitted, 1 right sliver.
    expect(gapSolids(SPAN, { centerX: 250, width: SPAN.width - 1 })).toHaveLength(1);
  });
  it('gapWidth = span.width → 0 fragments', () => {
    expect(gapSolids(SPAN, { centerX: 250, width: SPAN.width })).toHaveLength(0);
  });
  it('gapWidth = span.width + 100 → 0 fragments', () => {
    expect(gapSolids(SPAN, { centerX: 250, width: SPAN.width + 100 })).toHaveLength(0);
  });
  it('centerX = -Infinity → 1 fragment (right side)', () => {
    expect(gapSolids(SPAN, { centerX: -Infinity, width: DEFAULT_GAP_WIDTH })).toHaveLength(1);
  });
  it('centerX = +Infinity → 1 fragment (left side)', () => {
    expect(gapSolids(SPAN, { centerX: Infinity, width: DEFAULT_GAP_WIDTH })).toHaveLength(1);
  });
  it('gapWidth=64, centerX=span.x+half → 1 fragment (right side, flush left)', () => {
    // Flush left requires gapLeft=span.x, so centerX=span.x+half=132.
    expect(gapSolids(SPAN, { centerX: SPAN.x + HALF, width: 64 })).toHaveLength(1);
  });
  it('gapWidth=64, centerX=span.x+span.width-half → 1 fragment (left side, flush right)', () => {
    // Flush right requires gapRight=span.x+span.width, so centerX=span.x+span.width-half=468.
    expect(gapSolids(SPAN, { centerX: SPAN.x + SPAN.width - HALF, width: 64 })).toHaveLength(1);
  });
});

// ===========================================================================
// createGapMotion — initial state
// ===========================================================================

describe('createGapMotion', () => {
  it('sweep: centerX starts at path[0].x', () => {
    const cfg: GapMotionConfig = {
      travelMode: 'sweep',
      speed: DEFAULT_GAP_SPEED,
      gapWidth: DEFAULT_GAP_WIDTH,
      path: [{ x: 100, y: 0 }, { x: 500, y: 0 }],
    };
    const s = createGapMotion(cfg);
    expect(s.centerX).toBe(100);
    expect(s.dist).toBe(0);
    expect(s.dir).toBe(1);
    expect(s.width).toBe(DEFAULT_GAP_WIDTH);
    expect(s.expandElapsed).toBe(0);
  });

  it('chase: centerX defaults to 0 when no initialCenterX provided', () => {
    const cfg: GapMotionConfig = {
      travelMode: 'chase',
      speed: 4,
      gapWidth: DEFAULT_GAP_WIDTH,
    };
    const s = createGapMotion(cfg);
    expect(s.centerX).toBe(0);
    expect(s.width).toBe(DEFAULT_GAP_WIDTH);
  });

  it('expand: width starts at minWidth, centerX defaults to 0', () => {
    const cfg: GapMotionConfig = {
      travelMode: 'expand',
      speed: 0,
      gapWidth: DEFAULT_GAP_WIDTH,
      minWidth: 16,
      maxWidth: 128,
      expandTicks: 60,
    };
    const s = createGapMotion(cfg);
    expect(s.width).toBe(16);
    expect(s.centerX).toBe(0);
    expect(s.expandElapsed).toBe(0);
  });

  it('expand: width defaults to 0 when minWidth not provided', () => {
    const cfg: GapMotionConfig = {
      travelMode: 'expand',
      speed: 0,
      gapWidth: DEFAULT_GAP_WIDTH,
    };
    const s = createGapMotion(cfg);
    expect(s.width).toBe(0);
  });

  it('ruling 5: initialCenterX overrides the default centerX', () => {
    const cfg: GapMotionConfig = {
      travelMode: 'chase',
      speed: 4,
      gapWidth: DEFAULT_GAP_WIDTH,
      initialCenterX: 300,
    };
    const s = createGapMotion(cfg);
    expect(s.centerX).toBe(300);
  });

  it('ruling 5: initialCenterX overrides path[0].x for sweep', () => {
    const cfg: GapMotionConfig = {
      travelMode: 'sweep',
      speed: DEFAULT_GAP_SPEED,
      gapWidth: DEFAULT_GAP_WIDTH,
      path: [{ x: 100, y: 0 }, { x: 500, y: 0 }],
      initialCenterX: 250,
    };
    const s = createGapMotion(cfg);
    expect(s.centerX).toBe(250);
  });
});

// ===========================================================================
// advanceGapMotion — determinism + purity
// ===========================================================================

describe('advanceGapMotion — determinism', () => {
  it('identical inputs → byte-identical returned state (JSON deep-equal)', () => {
    const cfg: GapMotionConfig = {
      travelMode: 'sweep',
      speed: DEFAULT_GAP_SPEED,
      gapWidth: DEFAULT_GAP_WIDTH,
      path: [{ x: 100, y: 0 }, { x: 500, y: 0 }],
      loopMode: 'pingpong',
    };
    const s0 = createGapMotion(cfg);
    const run = () => {
      let s = s0;
      for (let t = 0; t < 250; t++) s = advanceGapMotion(s, 1, cfg);
      return s;
    };
    const a = run();
    const b = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('chase determinism: same target sequence → identical state', () => {
    const cfg: GapMotionConfig = {
      travelMode: 'chase',
      speed: 4,
      gapWidth: DEFAULT_GAP_WIDTH,
      initialCenterX: 200,
    };
    const targets = [210, 220, 230, 500, 240, 230];
    const run = () => {
      let s = createGapMotion(cfg);
      for (const tx of targets) s = advanceGapMotion(s, 1, cfg, tx);
      return s;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});

describe('advanceGapMotion — purity', () => {
  it('does not mutate the input state', () => {
    const cfg: GapMotionConfig = {
      travelMode: 'sweep',
      speed: DEFAULT_GAP_SPEED,
      gapWidth: DEFAULT_GAP_WIDTH,
      path: [{ x: 100, y: 0 }, { x: 500, y: 0 }],
    };
    const s = createGapMotion(cfg);
    const snap: GapMotionState = JSON.parse(JSON.stringify(s));
    advanceGapMotion(s, 1, cfg);
    advanceGapMotion(s, 1, cfg);
    expect(s).toEqual(snap);
  });
});

// ===========================================================================
// advanceGapMotion — sweep mode
// ===========================================================================

describe('advanceGapMotion — sweep (loop)', () => {
  const cfg: GapMotionConfig = {
    travelMode: 'sweep',
    speed: DEFAULT_GAP_SPEED,
    gapWidth: DEFAULT_GAP_WIDTH,
    path: [{ x: 100, y: 0 }, { x: 500, y: 0 }],
    loopMode: 'loop',
  };

  it('advances centerX along the path by speed * dt', () => {
    const s0 = createGapMotion(cfg);
    const s1 = advanceGapMotion(s0, 1, cfg);
    expect(s1.centerX).toBe(102);
    expect(s1.dist).toBe(2);
  });

  it('wraps at path end (dist wraps into [0, totalLen))', () => {
    let s = createGapMotion(cfg);
    // totalLen = 400; at speed 2, reaching dist=400 takes 200 ticks.
    for (let t = 0; t < 199; t++) s = advanceGapMotion(s, 1, cfg);
    expect(s.dist).toBe(398);
    expect(s.centerX).toBe(498);
    // Tick 200: dist wraps to 0.
    s = advanceGapMotion(s, 1, cfg);
    expect(s.dist).toBe(0);
    expect(s.centerX).toBe(100);
  });

  it('dir stays +1 in loop mode (no reflection)', () => {
    let s = createGapMotion(cfg);
    for (let t = 0; t < 300; t++) s = advanceGapMotion(s, 1, cfg);
    expect(s.dir).toBe(1);
  });
});

describe('advanceGapMotion — sweep (pingpong)', () => {
  const cfg: GapMotionConfig = {
    travelMode: 'sweep',
    speed: DEFAULT_GAP_SPEED,
    gapWidth: DEFAULT_GAP_WIDTH,
    path: [{ x: 100, y: 0 }, { x: 500, y: 0 }],
    loopMode: 'pingpong',
  };

  it('reaches the right endpoint without flipping dir before crossing it', () => {
    let s = createGapMotion(cfg);
    for (let t = 0; t < 200; t++) s = advanceGapMotion(s, 1, cfg);
    expect(s.dist).toBe(400);
    expect(s.centerX).toBe(500);
    // At exactly the endpoint, dir hasn't flipped yet (dist == totalLen, not >).
    expect(s.dir).toBe(1);
  });

  it('flips dir and reflects when dist crosses totalLen', () => {
    let s = createGapMotion(cfg);
    for (let t = 0; t < 201; t++) s = advanceGapMotion(s, 1, cfg);
    // dist was 402, reflected to 398, dir flipped to -1.
    expect(s.dir).toBe(-1);
    expect(s.dist).toBe(398);
    expect(s.centerX).toBe(498);
  });

  it('reaches the left endpoint with dir still -1 (bounce on the next tick)', () => {
    let s = createGapMotion(cfg);
    // Go right to endpoint then back to left endpoint: 200 + 200 = 400 ticks.
    for (let t = 0; t < 400; t++) s = advanceGapMotion(s, 1, cfg);
    expect(s.dist).toBe(0);
    expect(s.centerX).toBe(100);
    // At exactly dist=0, dir hasn't flipped yet (mirrors the right-endpoint
    // boundary: dist==totalLen doesn't trigger the while loop).
    expect(s.dir).toBe(-1);
    // Tick 401: dist goes negative → reflects → dir flips back to +1.
    s = advanceGapMotion(s, 1, cfg);
    expect(s.dir).toBe(1);
    expect(s.dist).toBe(2);
    expect(s.centerX).toBe(102);
  });
});

describe('advanceGapMotion — sweep (degenerate path)', () => {
  it('empty path → state unchanged (stationary)', () => {
    const cfg: GapMotionConfig = {
      travelMode: 'sweep',
      speed: DEFAULT_GAP_SPEED,
      gapWidth: DEFAULT_GAP_WIDTH,
      path: [],
    };
    const s0 = createGapMotion(cfg);
    const s1 = advanceGapMotion(s0, 1, cfg);
    expect(s1).toBe(s0); // Same reference — no new state needed.
  });

  it('single-point path → state unchanged (stationary)', () => {
    const cfg: GapMotionConfig = {
      travelMode: 'sweep',
      speed: DEFAULT_GAP_SPEED,
      gapWidth: DEFAULT_GAP_WIDTH,
      path: [{ x: 250, y: 0 }],
    };
    const s0 = createGapMotion(cfg);
    const s1 = advanceGapMotion(s0, 1, cfg);
    expect(s1).toBe(s0);
  });
});

// ===========================================================================
// advanceGapMotion — chase mode
// ===========================================================================

describe('advanceGapMotion — chase', () => {
  const cfg: GapMotionConfig = {
    travelMode: 'chase',
    speed: 4,
    gapWidth: DEFAULT_GAP_WIDTH,
    initialCenterX: 200,
  };

  it('moves toward targetX by at most speed * dt', () => {
    const s0 = createGapMotion(cfg);
    const s1 = advanceGapMotion(s0, 1, cfg, 300);
    expect(s1.centerX).toBe(204); // +4 toward 300
  });

  it('does not overshoot the target (caps at targetX)', () => {
    const s0 = createGapMotion(cfg);
    // Target only 3px away; speed*dt = 4. Should move exactly 3 (not 4).
    const s1 = advanceGapMotion(s0, 1, cfg, 203);
    expect(s1.centerX).toBe(203);
  });

  it('moves left when target is left of center', () => {
    const s0 = createGapMotion(cfg);
    const s1 = advanceGapMotion(s0, 1, cfg, 100);
    expect(s1.centerX).toBe(196); // -4 toward 100
  });

  it('disengages (holds position) when |targetX - centerX| > giveUpRadius', () => {
    const s0 = createGapMotion(cfg);
    const far = s0.centerX + DEFAULT_CHASE_GIVE_UP_RADIUS + 50;
    const s1 = advanceGapMotion(s0, 1, cfg, far);
    expect(s1.centerX).toBe(s0.centerX); // No movement.
    expect(s1).toBe(s0); // Same reference — disengaged no-op.
  });

  it('targetX === undefined → no-op (silent, documented)', () => {
    const s0 = createGapMotion(cfg);
    const s1 = advanceGapMotion(s0, 1, cfg, undefined);
    expect(s1).toBe(s0);
  });

  it('respects custom giveUpRadius', () => {
    const cfgCustom: GapMotionConfig = { ...cfg, giveUpRadius: 10 };
    const s0 = createGapMotion(cfgCustom);
    // 50px away, custom radius 10 → disengage.
    const s1 = advanceGapMotion(s0, 1, cfgCustom, s0.centerX + 50);
    expect(s1).toBe(s0);
  });

  it('chases within custom giveUpRadius', () => {
    const cfgCustom: GapMotionConfig = { ...cfg, giveUpRadius: 100 };
    const s0 = createGapMotion(cfgCustom);
    const s1 = advanceGapMotion(s0, 1, cfgCustom, s0.centerX + 50);
    expect(s1.centerX).toBe(s0.centerX + 4);
  });

  it('never exceeds speed * dt in a single tick', () => {
    const s0 = createGapMotion(cfg);
    const s1 = advanceGapMotion(s0, 1, cfg, s0.centerX + 10000);
    expect(Math.abs(s1.centerX - s0.centerX)).toBeLessThanOrEqual(4);
  });
});

// ===========================================================================
// advanceGapMotion — expand mode
// ===========================================================================

describe('advanceGapMotion — expand', () => {
  const cfg: GapMotionConfig = {
    travelMode: 'expand',
    speed: 0,
    gapWidth: DEFAULT_GAP_WIDTH,
    minWidth: 16,
    maxWidth: 128,
    expandTicks: 60,
    initialCenterX: 250,
  };

  it('width starts at minWidth', () => {
    const s = createGapMotion(cfg);
    expect(s.width).toBe(16);
  });

  it('width grows linearly by (maxWidth - minWidth) / expandTicks per tick', () => {
    const s0 = createGapMotion(cfg);
    const s1 = advanceGapMotion(s0, 1, cfg);
    const expected = 16 + (128 - 16) * (1 / 60);
    expect(s1.width).toBeCloseTo(expected, 6);
  });

  it('width at half-cycle ≈ midpoint', () => {
    let s = createGapMotion(cfg);
    for (let t = 0; t < 30; t++) s = advanceGapMotion(s, 1, cfg);
    expect(s.width).toBeCloseTo(16 + (128 - 16) * 0.5, 6); // ≈ 72
  });

  it('resets to minWidth after reaching expandTicks', () => {
    let s = createGapMotion(cfg);
    for (let t = 0; t < 60; t++) s = advanceGapMotion(s, 1, cfg);
    expect(s.expandElapsed).toBe(0);
    expect(s.width).toBe(16);
  });

  it('centerX is preserved across advances', () => {
    let s = createGapMotion(cfg);
    expect(s.centerX).toBe(250);
    for (let t = 0; t < 100; t++) s = advanceGapMotion(s, 1, cfg);
    expect(s.centerX).toBe(250);
  });

  it('cycle repeats after reset (grows again)', () => {
    let s = createGapMotion(cfg);
    for (let t = 0; t < 61; t++) s = advanceGapMotion(s, 1, cfg);
    // After 60 ticks (reset) + 1 more tick: width = 16 + 112/60.
    expect(s.width).toBeCloseTo(16 + (128 - 16) * (1 / 60), 6);
  });
});

// ===========================================================================
// gapTileQuery — tile-grid wrapper (ruling 4: AABB overlap)
// ===========================================================================

describe('gapTileQuery', () => {
  // Span in world coords aligned to a 16px tile grid.
  // span.x=128 (tile 8), span.width=256 (16 tiles), span.y=192 (tile row 12).
  const span: GapSpanConfig = { x: 128, y: 192, width: 256, height: 16 };
  const tileSize = 16;
  // Gap: centerX=200, width=40 → gapLeft=180, gapRight=220.
  const gap: GapGeometry = { centerX: 200, width: 40 };
  const allSolid: TileSolidityQuery = () => 'solid';

  it('ruling 4: tile straddling gapLeft (body overlaps gap) is reported "empty"', () => {
    // tileX=11 → world [176, 192). Left edge 176 < gapLeft 180, but body
    // [176,192) overlaps gap [180,220). AABB overlap → 'empty'.
    // The OLD left-edge test (tileWorldLeft >= gapLeft) would miss this.
    const q = gapTileQuery(allSolid, span, gap, tileSize);
    expect(q(11, 12)).toBe('empty');
  });

  it('tile fully inside the gap is reported "empty"', () => {
    const q = gapTileQuery(allSolid, span, gap, tileSize);
    // tileX=12 → world [192, 208) — fully inside [180, 220).
    expect(q(12, 12)).toBe('empty');
    // tileX=13 → world [208, 224) — overlaps gap right edge.
    expect(q(13, 12)).toBe('empty');
  });

  it('tiles fully outside the gap keep the base query classification', () => {
    const q = gapTileQuery(allSolid, span, gap, tileSize);
    // tileX=10 → world [160, 176) — fully left of gapLeft 180.
    expect(q(10, 12)).toBe('solid');
    // tileX=14 → world [224, 240) — fully right of gapRight 220.
    expect(q(14, 12)).toBe('solid');
  });

  it('tiles in a different row keep the base classification (single-row v1)', () => {
    const q = gapTileQuery(allSolid, span, gap, tileSize);
    // Row 11 (above span row 12).
    expect(q(12, 11)).toBe('solid');
    // Row 13 (below).
    expect(q(12, 13)).toBe('solid');
  });

  it('clamp computed once: multiple tile calls see the same clamped bounds', () => {
    // Out-of-bounds centerX clamped flush left; every tile call must agree
    // on the same clamped gap (no per-call re-evaluation drift).
    const bigGap: GapGeometry = { centerX: -9999, width: 40 };
    const q = gapTileQuery(allSolid, span, bigGap, tileSize);
    // Clamped to flush left: gapLeft=128, gapRight=168.
    // tileX=8 → world [128, 144) → inside gap → 'empty'.
    expect(q(8, 12)).toBe('empty');
    // tileX=9 → world [144, 160) → inside gap → 'empty'.
    expect(q(9, 12)).toBe('empty');
    // tileX=10 → world [160, 176) → overlaps gap [128,168] (AABB) → 'empty'.
    expect(q(10, 12)).toBe('empty');
    // tileX=11 → world [176, 192) → no overlap (176 >= 168) → 'solid'.
    expect(q(11, 12)).toBe('solid');
  });

  it('gap.width ≤ 0 → transparent wrapper (returns base for all tiles)', () => {
    const q = gapTileQuery(allSolid, span, { centerX: 200, width: 0 }, tileSize);
    expect(q(12, 12)).toBe('solid');
    expect(q(0, 0)).toBe('solid');
  });

  it('gap.width ≥ span.width → all tiles in the span row report "empty"', () => {
    const bigGap: GapGeometry = { centerX: 256, width: 300 };
    const q = gapTileQuery(allSolid, span, bigGap, tileSize);
    for (let tx = 8; tx < 8 + 16; tx++) {
      expect(q(tx, 12)).toBe('empty');
    }
  });

  it('throws eagerly on NaN gap.centerX', () => {
    expect(() => gapTileQuery(allSolid, span, { centerX: NaN, width: 40 }, tileSize)).toThrow();
  });

  it('throws eagerly on NaN gap.width', () => {
    expect(() => gapTileQuery(allSolid, span, { centerX: 200, width: NaN }, tileSize)).toThrow();
  });
});

// ===========================================================================
// Integration: gapSolids + resolveAxisY (end-to-end composition)
// ===========================================================================

describe('integration: moving gap + resolveAxisY', () => {
  // Span: platform from x=100 to x=500 at y=200.
  const span: GapSpanConfig = { x: 100, y: 200, width: 400, height: 16 };
  // Gap: centerX=300, width=80 → gapLeft=260, gapRight=340.
  // Left fragment: [100, 260). Right fragment: [340, 500].
  const gap: GapGeometry = { centerX: 300, width: 80 };
  const fragments: readonly Solid[] = gapSolids(span, gap);

  it('produces the expected fragment layout', () => {
    expect(fragments).toHaveLength(2);
    expect(fragments[0].x).toBe(100);
    expect(fragments[0].width).toBe(160); // 260 - 100
    expect(fragments[1].x).toBe(340);
    expect(fragments[1].width).toBe(160); // 500 - 340
  });

  it('a body standing on a fragment lands (does not fall)', () => {
    // Body A at x=150 (on the left fragment), resting on the platform top.
    const bodyA = { x: 150, y: 200 - 24, width: 16, height: 24 };
    const prevBottom = bodyA.y + bodyA.height; // 200
    const vy = 5; // Gravity step.
    const r = resolveAxisY(bodyA, vy, fragments, prevBottom);
    expect(r.landed).toBe(true);
    expect(r.vy).toBe(0);
    expect(r.y).toBe(200 - 24); // Snapped back to surface.
  });

  it('a body standing in the gap falls (no landing)', () => {
    // Body B at x=290 (in the gap [260, 340]).
    const bodyB = { x: 290, y: 200 - 24, width: 16, height: 24 };
    const prevBottom = bodyB.y + bodyB.height; // 200
    const vy = 5; // Gravity step.
    const r = resolveAxisY(bodyB, vy, fragments, prevBottom);
    expect(r.landed).toBe(false);
    expect(r.vy).toBe(5); // Velocity unchanged — still falling.
    expect(r.y).toBe(bodyB.y + 5); // Moved down by gravity.
  });
});

describe('integration: advanceGapMotion (chase) → gapSolids → resolveAxisY', () => {
  it('as the gap chases rightward, a body that was safe falls once the gap reaches it', () => {
    const span: GapSpanConfig = { x: 100, y: 200, width: 400, height: 16 };
    const cfg: GapMotionConfig = {
      travelMode: 'chase',
      speed: 4,
      gapWidth: 48,
      initialCenterX: 150,
      giveUpRadius: 500,
    };
    let state = createGapMotion(cfg);

    // Body stands at x=300 (on the span, no gap there yet).
    const bodyX = 300;
    const bodyW = 16;
    const bodyH = 24;
    const bodyY = 200 - bodyH;

    // Tick 0: gap at ~150, body at 300 is safe (on a fragment).
    let frags = gapSolids(span, { centerX: state.centerX, width: state.width });
    let r = resolveAxisY(
      { x: bodyX, y: bodyY, width: bodyW, height: bodyH },
      5,
      frags,
      bodyY + bodyH,
    );
    expect(r.landed).toBe(true);

    // Chase the gap toward the body until it arrives.
    for (let t = 0; t < 100; t++) {
      state = advanceGapMotion(state, 1, cfg, bodyX + bodyW / 2);
    }
    // Gap should now be at or past the body.
    expect(state.centerX).toBeGreaterThanOrEqual(bodyX);

    // Body is now in the gap → falls.
    frags = gapSolids(span, { centerX: state.centerX, width: state.width });
    r = resolveAxisY(
      { x: bodyX, y: bodyY, width: bodyW, height: bodyH },
      5,
      frags,
      bodyY + bodyH,
    );
    expect(r.landed).toBe(false);
  });
});
