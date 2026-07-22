import { describe, it, expect } from 'vitest';
import {
  createSpiderState,
  stepSpider,
} from '../animation/spider/spider-state';
import {
  splitSpiderConfig,
  DEFAULT_SPIDER,
} from '../animation/spider/types';
import type { TileSolidityQuery } from '../collision/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mock tile query: row 7 and below are solid (y >= 112 for tileSize=16). */
const floorQuery: TileSolidityQuery = (_tileX: number, tileY: number) =>
  tileY >= 7 ? 'solid' : 'empty';

/** All-empty tile query. */
const emptyQuery: TileSolidityQuery = () => 'empty';

// ---------------------------------------------------------------------------
// DEFAULT_SPIDER
// ---------------------------------------------------------------------------

describe('DEFAULT_SPIDER', () => {
  it('is a valid SpiderConfig with required fields', () => {
    expect(DEFAULT_SPIDER.mode).toBe('coordinated');
    expect(DEFAULT_SPIDER.legCount).toBe(4);
    expect(DEFAULT_SPIDER.comfortRadius).toBeGreaterThan(0);
    expect(DEFAULT_SPIDER.stepHeight).toBeGreaterThan(0);
    expect(DEFAULT_SPIDER.stepDuration).toBeGreaterThan(0);
    expect(DEFAULT_SPIDER.cephRadius).toBeGreaterThan(0);
    expect(DEFAULT_SPIDER.thighLength).toBeGreaterThan(0);
    expect(DEFAULT_SPIDER.shinLength).toBeGreaterThan(0);
    expect(DEFAULT_SPIDER.palpSegmentLength).toBeGreaterThan(0);
    expect(DEFAULT_SPIDER.palette).toBeDefined();
    expect(DEFAULT_SPIDER.palette.cephFill).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// splitSpiderConfig
// ---------------------------------------------------------------------------

describe('splitSpiderConfig', () => {
  it('partitions SpiderConfig into GaitConfig + SpiderVisualConfig', () => {
    const { gait, visual } = splitSpiderConfig(DEFAULT_SPIDER);

    // Gait fields
    expect(gait.mode).toBe(DEFAULT_SPIDER.mode);
    expect(gait.legCount).toBe(DEFAULT_SPIDER.legCount);
    expect(gait.comfortRadius).toBe(DEFAULT_SPIDER.comfortRadius);
    expect(gait.overshootFactor).toBe(DEFAULT_SPIDER.overshootFactor);
    expect(gait.stepHeight).toBe(DEFAULT_SPIDER.stepHeight);
    expect(gait.stepDuration).toBe(DEFAULT_SPIDER.stepDuration);
    expect(gait.phaseAdvanceRate).toBe(DEFAULT_SPIDER.phaseAdvanceRate);

    // Visual fields
    expect(visual.cephRadius).toBe(DEFAULT_SPIDER.cephRadius);
    expect(visual.abdRx).toBe(DEFAULT_SPIDER.abdRx);
    expect(visual.thighLength).toBe(DEFAULT_SPIDER.thighLength);
    expect(visual.shinLength).toBe(DEFAULT_SPIDER.shinLength);
    expect(visual.palette).toBe(DEFAULT_SPIDER.palette);
  });

  it('gait config does not contain visual fields', () => {
    const { gait } = splitSpiderConfig(DEFAULT_SPIDER);
    expect((gait as unknown as Record<string, unknown>).cephRadius).toBeUndefined();
    expect((gait as unknown as Record<string, unknown>).palette).toBeUndefined();
  });

  it('visual config does not contain gait fields', () => {
    const { visual } = splitSpiderConfig(DEFAULT_SPIDER);
    expect((visual as unknown as Record<string, unknown>).mode).toBeUndefined();
    expect((visual as unknown as Record<string, unknown>).comfortRadius).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createSpiderState
// ---------------------------------------------------------------------------

describe('createSpiderState', () => {
  it('initializes gait with 8 legs (4 per side × 2 sides)', () => {
    const state = createSpiderState(DEFAULT_SPIDER, 42, 100, 90);

    expect(state.gait.legs).toHaveLength(8);
    expect(state.gait.phase).toBe(0);
  });

  it('initializes both pedipalp spring-rod chains', () => {
    const state = createSpiderState(DEFAULT_SPIDER, 42, 100, 90);

    expect(state.palpL.length).toBeGreaterThan(0);
    expect(state.palpR.length).toBeGreaterThan(0);
  });

  it('stores the jitterSeed', () => {
    const state = createSpiderState(DEFAULT_SPIDER, 12345, 100, 90);
    expect(state.jitterSeed).toBe(12345);
  });

  it('all initial legs are planted', () => {
    const state = createSpiderState(DEFAULT_SPIDER, 42, 100, 90);

    for (const leg of state.gait.legs) {
      expect(leg.isSwinging).toBe(false);
    }
  });

  it('creates different states for different jitter seeds', () => {
    const a = createSpiderState(DEFAULT_SPIDER, 1, 100, 90);
    const b = createSpiderState(DEFAULT_SPIDER, 2, 100, 90);
    expect(a.jitterSeed).not.toBe(b.jitterSeed);
  });
});

// ---------------------------------------------------------------------------
// stepSpider
// ---------------------------------------------------------------------------

describe('stepSpider', () => {
  it('advances gait AND both palps in one call', () => {
    let state = createSpiderState(DEFAULT_SPIDER, 42, 100, 90);
    const snap = JSON.parse(JSON.stringify(state));

    state = stepSpider(
      state, 100, 90, 120, 0, 1, 1 / 60,
      DEFAULT_SPIDER, floorQuery, 16, 0,
    );

    // Gait phase should have advanced (body is moving)
    expect(state.gait.phase).not.toBe(snap.gait.phase);

    // Palp nodes should have changed (spring-rod advances)
    expect(state.palpL).not.toEqual(snap.palpL);
    expect(state.palpR).not.toEqual(snap.palpR);
  });

  it('returned state is fresh (input not mutated)', () => {
    const state = createSpiderState(DEFAULT_SPIDER, 42, 100, 90);
    const snap = JSON.parse(JSON.stringify(state));

    stepSpider(
      state, 100, 90, 120, 0, 1, 1 / 60,
      DEFAULT_SPIDER, floorQuery, 16, 0,
    );

    // Input deeply unchanged
    expect(state.gait).toEqual(snap.gait);
    expect(state.jitterSeed).toBe(snap.jitterSeed);
  });

  it('preserves jitterSeed across ticks', () => {
    let state = createSpiderState(DEFAULT_SPIDER, 999, 100, 90);

    for (let t = 0; t < 10; t++) {
      state = stepSpider(
        state, 100 + t * 2, 90, 120, 0, 1, 1 / 60,
        DEFAULT_SPIDER, floorQuery, 16, t,
      );
    }

    expect(state.jitterSeed).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// stepSpider — determinism
// ---------------------------------------------------------------------------

describe('stepSpider — determinism', () => {
  it('same inputs produce deep-equal results', () => {
    const state = createSpiderState(DEFAULT_SPIDER, 42, 100, 90);

    const a = stepSpider(
      state, 150, 90, 120, 0, 1, 1 / 60,
      DEFAULT_SPIDER, floorQuery, 16, 5,
    );
    const b = stepSpider(
      state, 150, 90, 120, 0, 1, 1 / 60,
      DEFAULT_SPIDER, floorQuery, 16, 5,
    );

    expect(a).toEqual(b);
  });

  it('input state is NOT mutated', () => {
    const state = createSpiderState(DEFAULT_SPIDER, 42, 100, 90);
    const snap = JSON.parse(JSON.stringify(state));

    stepSpider(
      state, 150, 90, 120, 0, 1, 1 / 60,
      DEFAULT_SPIDER, floorQuery, 16, 5,
    );

    expect(state).toEqual(snap);
  });
});

// ---------------------------------------------------------------------------
// stepSpider — never throws
// ---------------------------------------------------------------------------

describe('stepSpider — never throws', () => {
  it('NaN bodyX does not throw', () => {
    const state = createSpiderState(DEFAULT_SPIDER, 42, 100, 90);
    expect(() =>
      stepSpider(state, NaN, 90, 120, 0, 1, 1 / 60, DEFAULT_SPIDER, floorQuery, 16, 0),
    ).not.toThrow();
  });

  it('zero tileSize does not throw', () => {
    const state = createSpiderState(DEFAULT_SPIDER, 42, 100, 90);
    expect(() =>
      stepSpider(state, 100, 90, 120, 0, 1, 1 / 60, DEFAULT_SPIDER, floorQuery, 0, 0),
    ).not.toThrow();
  });

  it('empty tileQuery does not throw', () => {
    const state = createSpiderState(DEFAULT_SPIDER, 42, 100, 90);
    expect(() =>
      stepSpider(state, 100, 90, 120, 0, 1, 1 / 60, DEFAULT_SPIDER, emptyQuery, 16, 0),
    ).not.toThrow();
  });
});
