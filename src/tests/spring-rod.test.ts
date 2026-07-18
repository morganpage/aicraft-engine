import { describe, it, expect } from 'vitest';
import {
  createSpringRod,
  advanceSpringRod,
  DEFAULT_SPRING_ROD,
  type SpringRodConfig,
} from '../animation/spring-rod';
import type { VerletNode } from '../animation/spring';

function dist(a: VerletNode, b: VerletNode): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function allFinite(nodes: VerletNode[]): boolean {
  return nodes.every(
    (n) =>
      Number.isFinite(n.x) &&
      Number.isFinite(n.y) &&
      Number.isFinite(n.prevX) &&
      Number.isFinite(n.prevY),
  );
}

// ---------------------------------------------------------------------------
// createSpringRod
// ---------------------------------------------------------------------------

describe('createSpringRod', () => {
  it('lays nodes along restDirection at segmentLength spacing (downward)', () => {
    const nodes = createSpringRod(5, 10, 20, 4, { x: 0, y: 1 });
    expect(nodes).toHaveLength(5);
    expect(nodes[0].x).toBe(10);
    expect(nodes[0].y).toBe(20);
    expect(nodes[1].x).toBe(10);
    expect(nodes[1].y).toBe(24);
    expect(nodes[4].x).toBe(10);
    expect(nodes[4].y).toBe(36);
  });

  it('lays nodes along restDirection (upward)', () => {
    const nodes = createSpringRod(4, 0, 0, 5, { x: 0, y: -1 });
    expect(nodes[0].y).toBe(0);
    expect(nodes[1].y).toBe(-5);
    expect(nodes[3].y).toBe(-15);
  });

  it('normalizes a non-unit restDirection', () => {
    // {3, 4} has length 5 → unit vector (0.6, 0.8). segLen=10 → per-segment (6, 8).
    const nodes = createSpringRod(3, 0, 0, 10, { x: 3, y: 4 });
    expect(nodes[1].x).toBeCloseTo(6, 5);
    expect(nodes[1].y).toBeCloseTo(8, 5);
    expect(nodes[2].x).toBeCloseTo(12, 5);
    expect(nodes[2].y).toBeCloseTo(16, 5);
  });

  it('every node starts at rest (prev === current → zero implicit velocity)', () => {
    const nodes = createSpringRod(5, 1, 2, 4, { x: 0.32, y: -1 });
    for (const n of nodes) {
      expect(n.prevX).toBe(n.x);
      expect(n.prevY).toBe(n.y);
    }
  });

  it('falls back to a safe default direction when restDirection is zero-length', () => {
    // Zero vector cannot be normalized — must not produce NaN. The chain still
    // lays out in a straight line along the fallback direction.
    const nodes = createSpringRod(3, 5, 7, 4, { x: 0, y: 0 });
    expect(allFinite(nodes)).toBe(true);
    expect(nodes[0].x).toBe(5);
    expect(nodes[0].y).toBe(7);
    for (const n of nodes) {
      expect(n.prevX).toBe(n.x);
      expect(n.prevY).toBe(n.y);
    }
  });

  it('returns an empty array for count=0', () => {
    expect(createSpringRod(0, 0, 0, 4, { x: 0, y: 1 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_SPRING_ROD
// ---------------------------------------------------------------------------

describe('DEFAULT_SPRING_ROD', () => {
  it('is a Readonly<SpringRodConfig> with the approved safe defaults', () => {
    // Compile-time check: assigning to a readonly field would fail under strict TS.
    const _: Readonly<SpringRodConfig> = DEFAULT_SPRING_ROD;
    expect(_).toBe(DEFAULT_SPRING_ROD);
    expect(DEFAULT_SPRING_ROD.segmentLength).toBe(4);
    expect(DEFAULT_SPRING_ROD.restDirection).toEqual({ x: 0, y: 1 });
    expect(DEFAULT_SPRING_ROD.stiffness).toBe(0.5);
    expect(DEFAULT_SPRING_ROD.tipWeight).toBe(0);
    expect(DEFAULT_SPRING_ROD.subSteps).toBe(1);
    expect(DEFAULT_SPRING_ROD.gravityX).toBe(0);
    expect(DEFAULT_SPRING_ROD.gravityY).toBe(0);
    expect(DEFAULT_SPRING_ROD.drag).toBe(0.95);
  });
});

// ---------------------------------------------------------------------------
// Purity / no mutation
// ---------------------------------------------------------------------------

describe('advanceSpringRod — purity / no mutation', () => {
  it('returns a NEW array of NEW node objects; input array + nodes unchanged', () => {
    const nodes = createSpringRod(5, 0, 0, 4, { x: 0, y: 1 });
    const snap = JSON.parse(JSON.stringify(nodes)) as VerletNode[];
    const next = advanceSpringRod(nodes, 1, 2, 1, DEFAULT_SPRING_ROD);

    expect(next).not.toBe(nodes);
    expect(next).toHaveLength(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      expect(next[i]).not.toBe(nodes[i]);
    }
    // Input deeply unchanged.
    expect(nodes).toEqual(snap);
    expect(nodes[0].x).toBe(snap[0].x);
    expect(nodes[0].prevY).toBe(snap[0].prevY);
    expect(nodes[4].y).toBe(snap[4].y);
  });

  it('returns an empty array for empty input', () => {
    expect(advanceSpringRod([], 0, 0, 1, DEFAULT_SPRING_ROD)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Anchor pinning
// ---------------------------------------------------------------------------

describe('advanceSpringRod — anchor pinning', () => {
  it('pins the root to the anchor every tick', () => {
    let chain = createSpringRod(5, 0, 0, 4, { x: 0, y: 1 });
    for (let i = 0; i < 20; i++) {
      chain = advanceSpringRod(chain, 7 + i, 9 - i, 1, DEFAULT_SPRING_ROD);
      expect(chain[0].x).toBe(7 + i);
      expect(chain[0].y).toBe(9 - i);
    }
  });
});

// ---------------------------------------------------------------------------
// Distance constraint (PBD)
// ---------------------------------------------------------------------------

describe('advanceSpringRod — distance constraint', () => {
  it('keeps adjacent distances near segmentLength under mild anchor motion', () => {
    const cfg: SpringRodConfig = { ...DEFAULT_SPRING_ROD, segmentLength: 4 };
    let chain = createSpringRod(6, 0, 0, 4, { x: 0, y: 1 });
    for (let i = 0; i < 30; i++) {
      const ax = Math.sin(i * 0.2) * 2;
      const ay = i * 0.1;
      chain = advanceSpringRod(chain, ax, ay, 1, cfg);
    }
    for (let i = 0; i < chain.length - 1; i++) {
      const d = dist(chain[i], chain[i + 1]);
      // Strain-limit hard cap is 1.5*segLen; mild motion should stay far inside it.
      expect(d).toBeLessThanOrEqual(cfg.segmentLength * 1.5);
      // And not collapse below half rest length.
      expect(d).toBeGreaterThanOrEqual(cfg.segmentLength * 0.5);
    }
  });
});

// ---------------------------------------------------------------------------
// Bend resistance (the anti-buckle marquee feature)
// ---------------------------------------------------------------------------

describe('advanceSpringRod — bend resistance (anti-buckle)', () => {
  it('does NOT kink under a sharp anchor lateral jump (smooths to a curve)', () => {
    // Sharp lateral yank: anchor jumps +20px sideways in one tick, then holds.
    // A raw distance-only chain would kink at the root (node 1 yanked sideways
    // while nodes 2..n still hang down → ~90°+ fold). The Provot bend
    // constraint (i, i+2 at 2*segLen) keeps the chain smooth.
    const cfg: SpringRodConfig = {
      ...DEFAULT_SPRING_ROD,
      segmentLength: 4,
      stiffness: 0.8,
      subSteps: 2,
    };
    let chain = createSpringRod(5, 0, 0, 4, { x: 0, y: 1 });
    // One sharp jump, then settle for 30 ticks with the anchor held.
    chain = advanceSpringRod(chain, 20, 0, 1, cfg);
    for (let i = 0; i < 30; i++) {
      chain = advanceSpringRod(chain, 20, 0, 1, cfg);
    }

    // (a) No consecutive segments reverse direction (dot product strictly > 0).
    for (let i = 1; i < chain.length - 1; i++) {
      const dx1 = chain[i].x - chain[i - 1].x;
      const dy1 = chain[i].y - chain[i - 1].y;
      const dx2 = chain[i + 1].x - chain[i].x;
      const dy2 = chain[i + 1].y - chain[i].y;
      const dot = dx1 * dx2 + dy1 * dy2;
      expect(dot).toBeGreaterThan(0);
    }

    // (b) i,i+2 distance stays well above the fold-back threshold. Straight-
    //     rod rest is 2*segLen; a 90° kink collapses it to sqrt(2)*segLen
    //     (~1.414*segLen). Assert no kink sharper than ~90°.
    for (let i = 0; i < chain.length - 2; i++) {
      const d = dist(chain[i], chain[i + 2]);
      expect(d).toBeGreaterThan(cfg.segmentLength * 1.4);
    }
  });
});

// ---------------------------------------------------------------------------
// Rest-pose spring (directional pull)
// ---------------------------------------------------------------------------

describe('advanceSpringRod — rest-pose spring', () => {
  it('relaxes toward restDirection over a few ticks (no motion, no gravity)', () => {
    // Start with a chain bent sideways (along +X) instead of along the rest
    // direction (+Y). With no anchor motion and no gravity, only the rest-pose
    // spring + distance/bend constraints act. The tip should converge to
    // anchor + count*segLen*normalize(restDir) = (0, 16).
    const segLen = 4;
    const count = 5;
    const cfg: SpringRodConfig = {
      ...DEFAULT_SPRING_ROD,
      segmentLength: segLen,
      stiffness: 0.6,
    };
    const bent: VerletNode[] = [];
    for (let i = 0; i < count; i++) {
      const x = i * segLen; // sideways, instead of downward
      const y = 0;
      bent.push({ x, y, prevX: x, prevY: y });
    }
    let chain = bent;
    for (let i = 0; i < 60; i++) {
      chain = advanceSpringRod(chain, 0, 0, 1, cfg);
    }
    const tip = chain[count - 1];
    // Tip converges to (0, (count-1)*segLen) = (0, 16) within ~2px tolerance.
    // (count nodes → count-1 segments; the tip is at index count-1.)
    expect(Math.abs(tip.x)).toBeLessThan(2);
    expect(tip.y).toBeGreaterThan((count - 1) * segLen - 2);
    expect(tip.y).toBeLessThan((count - 1) * segLen + 2);
  });
});

// ---------------------------------------------------------------------------
// Tip-weight nudge
// ---------------------------------------------------------------------------

describe('advanceSpringRod — tip-weight', () => {
  it('sags the tip below the rest line proportional to node index', () => {
    const segLen = 4;
    const count = 5;
    const cfgNoWeight: SpringRodConfig = {
      ...DEFAULT_SPRING_ROD,
      segmentLength: segLen,
      stiffness: 0.5,
      tipWeight: 0,
    };
    const cfgWithWeight: SpringRodConfig = { ...cfgNoWeight, tipWeight: 2 };

    const seed = createSpringRod(count, 0, 0, segLen, { x: 0, y: 1 });
    let noW = seed;
    let withW = seed;
    for (let i = 0; i < 40; i++) {
      noW = advanceSpringRod(noW, 0, 0, 1, cfgNoWeight);
      withW = advanceSpringRod(withW, 0, 0, 1, cfgWithWeight);
    }

    // The weighted chain's tip sits strictly below the unweighted tip
    // (larger Y in canvas coords = further down).
    expect(withW[count - 1].y).toBeGreaterThan(noW[count - 1].y);

    // Sag grows monotonically from base → tip (tip-weight * i/(n-1)).
    const sags: number[] = [];
    for (let i = 0; i < count; i++) {
      sags.push(withW[i].y - noW[i].y);
    }
    for (let i = 1; i < sags.length; i++) {
      expect(sags[i]).toBeGreaterThanOrEqual(sags[i - 1]);
    }
    // And the tip itself sags strictly more than the base.
    expect(sags[count - 1]).toBeGreaterThan(sags[0]);
  });
});

// ---------------------------------------------------------------------------
// STABILITY — blowout-proof (the acceptance bar)
// ---------------------------------------------------------------------------

describe('advanceSpringRod — STABILITY (blowout-proof)', () => {
  it('extreme dt (1000) with anchor motion → no NaN / Infinity anywhere', () => {
    let chain = createSpringRod(5, 0, 0, 4, { x: 0, y: 1 });
    chain = advanceSpringRod(chain, 50, 50, 1000, DEFAULT_SPRING_ROD);
    expect(allFinite(chain)).toBe(true);
  });

  it('two coincident nodes (zero segment distance) → no explosion (epsilon guard)', () => {
    const coincident: VerletNode[] = [
      { x: 0, y: 0, prevX: 0, prevY: 0 },
      { x: 0, y: 0, prevX: 0, prevY: 0 },
      { x: 0, y: 0, prevX: 0, prevY: 0 },
      { x: 0, y: 0, prevX: 0, prevY: 0 },
    ];
    const out = advanceSpringRod(coincident, 0, 0, 1, DEFAULT_SPRING_ROD);
    expect(allFinite(out)).toBe(true);
  });

  it('huge anchor teleport (10000px) → strain-limit bound holds; output finite', () => {
    const segLen = 4;
    const cfg: SpringRodConfig = { ...DEFAULT_SPRING_ROD, segmentLength: segLen };
    let chain = createSpringRod(6, 0, 0, segLen, { x: 0, y: 1 });
    chain = advanceSpringRod(chain, 10000, 10000, 1, cfg);
    expect(allFinite(chain)).toBe(true);
    // No node escapes more than the strain-limit bound (1.5*segLen) from its neighbor.
    for (let i = 0; i < chain.length - 1; i++) {
      const d = dist(chain[i], chain[i + 1]);
      expect(d).toBeLessThanOrEqual(segLen * 1.5 + 1e-6);
    }
  });

  it('NaN / Infinity INPUT node → rebuilt along restDirection off the anchor', () => {
    // Defensive: a corrupted state from upstream must not persist. The NaN
    // reset rebuilds the whole chain along restDirection off the current anchor.
    const corrupted: VerletNode[] = [
      { x: 0, y: 0, prevX: 0, prevY: 0 },
      { x: NaN, y: 4, prevX: NaN, prevY: 4 },
      { x: 0, y: 8, prevX: 0, prevY: 8 },
      { x: Infinity, y: 12, prevX: 0, prevY: 12 },
    ];
    const out = advanceSpringRod(corrupted, 10, 20, 1, DEFAULT_SPRING_ROD);
    expect(allFinite(out)).toBe(true);
    // Rebuilt along restDirection {0,1} off anchor (10, 20): node i at (10, 20 + i*4).
    expect(out[0].x).toBe(10);
    expect(out[0].y).toBe(20);
    expect(out[1].x).toBe(10);
    expect(out[1].y).toBe(24);
    expect(out[2].x).toBe(10);
    expect(out[2].y).toBe(28);
    expect(out[3].x).toBe(10);
    expect(out[3].y).toBe(32);
    // And every node is at rest (zero implicit velocity).
    for (const n of out) {
      expect(n.prevX).toBe(n.x);
      expect(n.prevY).toBe(n.y);
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('advanceSpringRod — determinism', () => {
  it('identical inputs → byte-identical output across two runs', () => {
    const seed = createSpringRod(6, 0, 0, 4, { x: 0.3, y: -1 });
    const run = () => {
      let chain = seed;
      for (let i = 0; i < 20; i++) {
        chain = advanceSpringRod(chain, Math.sin(i) * 5, i * 0.5, 1, DEFAULT_SPRING_ROD);
      }
      return chain;
    };
    expect(run()).toEqual(run());
  });
});
