import { describe, it, expect } from 'vitest';
import {
  advanceSpringChain,
  createSpringChain,
  DEFAULT_SPRING,
  type VerletNode,
  type SpringConfig,
} from '../animation/spring';

function dist(a: VerletNode, b: VerletNode): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

describe('createSpringChain', () => {
  it('creates `count` nodes in a straight vertical line, segmentLength apart', () => {
    const nodes = createSpringChain(4, 10, 20, 5);
    expect(nodes).toHaveLength(4);
    expect(nodes[0].x).toBe(10);
    expect(nodes[0].y).toBe(20);
    expect(nodes[1].x).toBe(10);
    expect(nodes[1].y).toBe(25);
    expect(nodes[2].x).toBe(10);
    expect(nodes[2].y).toBe(30);
    expect(nodes[3].x).toBe(10);
    expect(nodes[3].y).toBe(35);
  });

  it('root node is at the anchor', () => {
    const nodes = createSpringChain(3, 7, 9, 4);
    expect(nodes[0].x).toBe(7);
    expect(nodes[0].y).toBe(9);
  });

  it('every node starts at rest (prev === current → zero implicit velocity)', () => {
    const nodes = createSpringChain(5, 0, 0, 4);
    for (const n of nodes) {
      expect(n.prevX).toBe(n.x);
      expect(n.prevY).toBe(n.y);
    }
  });

  it('returns an empty array for count=0', () => {
    expect(createSpringChain(0, 0, 0, 4)).toEqual([]);
  });
});

describe('advanceSpringChain — purity', () => {
  it('returns a NEW array (input array reference unchanged)', () => {
    const nodes = createSpringChain(4, 0, 0, 4);
    const next = advanceSpringChain(nodes, 0, 0, 1, DEFAULT_SPRING);
    expect(next).not.toBe(nodes);
    expect(next).toHaveLength(nodes.length);
  });

  it('returns NEW node objects (no node is shared with the input)', () => {
    const nodes = createSpringChain(4, 0, 0, 4);
    const next = advanceSpringChain(nodes, 0, 0, 1, DEFAULT_SPRING);
    for (let i = 0; i < nodes.length; i++) {
      expect(next[i]).not.toBe(nodes[i]);
    }
  });

  it('does NOT mutate the input array or any of its node objects', () => {
    const nodes = createSpringChain(6, 3, 5, 4);
    const snap = JSON.parse(JSON.stringify(nodes)) as VerletNode[];
    advanceSpringChain(nodes, 1, 2, 1, DEFAULT_SPRING);
    expect(nodes).toEqual(snap);
    // Deep check on the first node specifically (the marquee anchor-pin step).
    expect(nodes[0].x).toBe(snap[0].x);
    expect(nodes[0].y).toBe(snap[0].y);
    expect(nodes[0].prevX).toBe(snap[0].prevX);
    expect(nodes[0].prevY).toBe(snap[0].prevY);
  });

  it('returns an empty array for an empty input', () => {
    expect(advanceSpringChain([], 0, 0, 1, DEFAULT_SPRING)).toEqual([]);
  });
});

describe('advanceSpringChain — anchor pinning', () => {
  it('pins the root node to the anchor after every step', () => {
    const nodes = createSpringChain(5, 0, 0, 4);
    let chain = nodes;
    for (let i = 0; i < 30; i++) {
      chain = advanceSpringChain(chain, 12, -8, 1, DEFAULT_SPRING);
      expect(chain[0].x).toBe(12);
      expect(chain[0].y).toBe(-8);
    }
  });
});

describe('advanceSpringChain — stability', () => {
  it('runs 60 ticks under DEFAULT_SPRING with no NaN / Infinity', () => {
    let chain = createSpringChain(6, 0, 0, DEFAULT_SPRING.segmentLength);
    for (let i = 0; i < 60; i++) {
      chain = advanceSpringChain(chain, 0, 0, 1, DEFAULT_SPRING);
      for (const n of chain) {
        expect(Number.isFinite(n.x)).toBe(true);
        expect(Number.isFinite(n.y)).toBe(true);
        expect(Number.isFinite(n.prevX)).toBe(true);
        expect(Number.isFinite(n.prevY)).toBe(true);
      }
    }
  });

  it('positions stay bounded over 60 ticks (no explosion)', () => {
    let chain = createSpringChain(6, 0, 0, DEFAULT_SPRING.segmentLength);
    for (let i = 0; i < 60; i++) {
      chain = advanceSpringChain(chain, 0, 0, 1, DEFAULT_SPRING);
    }
    for (const n of chain) {
      expect(Math.abs(n.x)).toBeLessThan(1e6);
      expect(Math.abs(n.y)).toBeLessThan(1e6);
    }
  });

  it('stays stable when the anchor moves rapidly (whip test, 60 ticks)', () => {
    let chain = createSpringChain(8, 0, 0, DEFAULT_SPRING.segmentLength);
    for (let i = 0; i < 60; i++) {
      const ax = Math.sin(i * 0.3) * 20;
      const ay = Math.cos(i * 0.2) * 10;
      chain = advanceSpringChain(chain, ax, ay, 1, DEFAULT_SPRING);
      for (const n of chain) {
        expect(Number.isFinite(n.x)).toBe(true);
        expect(Number.isFinite(n.y)).toBe(true);
      }
    }
  });
});

describe('advanceSpringChain — segment-length preservation (PBD softness)', () => {
  it('keeps adjacent distances within the ~7% PBD softness bound at 2 iterations (single step from rest)', () => {
    // After ONE advance from a straight resting chain — the regime the decision
    // doc's "~7% at 2 iterations" figure describes — every adjacent distance
    // stays within ~7% of the rest length. (Empirically ~4.7% for an 8-node
    // chain under DEFAULT_SPRING gravity; the 7% bound is generous headroom.)
    const cfg: SpringConfig = { ...DEFAULT_SPRING, constraintIterations: 2 };
    const chain = createSpringChain(8, 0, 0, cfg.segmentLength);
    const next = advanceSpringChain(chain, 0, 0, 1, cfg);
    for (let i = 0; i < next.length - 1; i++) {
      const d = dist(next[i], next[i + 1]);
      expect(d).toBeLessThanOrEqual(cfg.segmentLength * 1.07);
      expect(d).toBeGreaterThanOrEqual(cfg.segmentLength * 0.93);
    }
  });

  it('tighter stretch at higher iterations (the documented softness property)', () => {
    // The decision doc records ~7% single-step stretch at 2 iterations and ~1%
    // at 8 (measured on a short chain). We measure a single advance FROM REST
    // — the regime the doc's figures describe — and assert the core documented
    // property: more constraint iterations → less stretch (tighter rods).
    const singleStepStretch = (iterations: number): number => {
      const cfg: SpringConfig = { ...DEFAULT_SPRING, constraintIterations: iterations };
      const chain = createSpringChain(8, 0, 0, cfg.segmentLength);
      const next = advanceSpringChain(chain, 0, 0, 1, cfg);
      let maxRatio = 0;
      for (let i = 0; i < next.length - 1; i++) {
        const d = dist(next[i], next[i + 1]);
        maxRatio = Math.max(maxRatio, d / cfg.segmentLength);
      }
      return maxRatio;
    };
    const stretchAt2 = singleStepStretch(2);
    const stretchAt8 = singleStepStretch(8);

    // At 2 iterations the chain is within the documented ~7% softness bound.
    expect(stretchAt2).toBeLessThanOrEqual(1.07);
    // More iterations → constraints satisfied more tightly → less stretch.
    expect(stretchAt8).toBeLessThanOrEqual(stretchAt2);
    // At 8 iterations the chain is near-rigid (well under the 2-iter stretch).
    expect(stretchAt8).toBeLessThanOrEqual(1.03);
  });
});

describe('advanceSpringChain — determinism', () => {
  it('identical inputs produce identical outputs (deep-equal)', () => {
    const seed = createSpringChain(6, 0, 0, 4);
    const a = advanceSpringChain(seed, 5, 3, 1, DEFAULT_SPRING);
    const b = advanceSpringChain(seed, 5, 3, 1, DEFAULT_SPRING);
    expect(a).toEqual(b);
  });

  it('a multi-tick run is reproducible', () => {
    const run = () => {
      let chain = createSpringChain(6, 0, 0, 4);
      for (let i = 0; i < 30; i++) {
        chain = advanceSpringChain(chain, Math.sin(i) * 5, i, 1, DEFAULT_SPRING);
      }
      return chain;
    };
    expect(run()).toEqual(run());
  });
});
