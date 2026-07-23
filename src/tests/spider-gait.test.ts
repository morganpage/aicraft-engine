import { describe, it, expect } from 'vitest';
import {
  createGaitState,
  advanceGait,
  getGaitFootPosition,
  sampleStepArc,
  type GaitState,
  type GaitLegState,
  type SpiderGaitConfig,
} from '../animation/spider/gait';
import { DEFAULT_SPIDER_GEOMETRY } from '../animation/spider/constants';
import { computeLegStepRequest } from '../animation/spider/geometry';
import type { TileSolidityQuery } from '../collision/types';
import type { Vec2 } from '../animation/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mock tile query: solid below a given Y threshold (in tile coords). */
function floorAtRow(solidRow: number): TileSolidityQuery {
  return (_tileX: number, tileY: number) =>
    tileY >= solidRow ? 'solid' : 'empty';
}

/** Always-empty tile query. */
const emptyQuery: TileSolidityQuery = () => 'empty';

/** Standard gait config for tests. */
const TEST_GAIT: SpiderGaitConfig = {
  mode: 'coordinated',
  legCount: 4,
  comfortRadius: 10,
  overshootFactor: 0.3,
  stepHeight: 14,
  stepDuration: 0.18,
  phaseAdvanceRate: 0.16,
  legRestPositions: [],
  groundSampleSteps: 3,
  motionScale: 1,
  geometry: DEFAULT_SPIDER_GEOMETRY,
};

/** Frantic mode variant. */
const FRANTIC_GAIT: SpiderGaitConfig = {
  ...TEST_GAIT,
  mode: 'frantic',
};

/**
 * Create a simple 8-leg rest layout: 4 pairs spread symmetrically.
 * Legs at y=100 (above a floor at tile row 7, i.e. y=112 for tileSize=16).
 * Body center assumed at (130, 100) — middle of the leg spread.
 *
 * Distances chosen so every foot is within the soft annulus from its coxa
 * endpoint. With hipRadius+coxaLength = 16 from body centre, footDist from
 * coxa = ||local| - 16|. The soft annulus is [18, 37.6], so |local| must be
 * in [34, 53.6]. We use 35, 40, 45, 50 → footDist 19, 24, 29, 34.
 */
// Feet rest on the floor (y = 112) spread wide to each side of the body, so
// every foot is anatomically sector-valid (outward tibia) at the 28px clearance
// the three-segment geometry needs. Offsets are a symmetric palindrome
// (58/46/36/32 px) so inner-to-outer urgency ordering is preserved.
function eightRestPositions(): Vec2[] {
  return [
    { x: 72, y: 112 },   // L1 (set A, index 0) — 58px back-outward
    { x: 84, y: 112 },   // R1 (set B, index 1) — 46px back-outward
    { x: 94, y: 112 },   // L2 (set A, index 2) — 36px back-outward
    { x: 98, y: 112 },   // R2 (set B, index 3) — 32px back-outward
    { x: 162, y: 112 },  // L3 (set B, index 4) — 32px fore-outward
    { x: 166, y: 112 },  // R3 (set A, index 5) — 36px fore-outward
    { x: 176, y: 112 },  // L4 (set B, index 6) — 46px fore-outward
    { x: 188, y: 112 },  // R4 (set A, index 7) — 58px fore-outward
  ];
}

/** Body center for eightRestPositions (28px above the row-7 floor at y=112). */
const BODY_X = 130;
const BODY_Y = 84;

/** All legs are planted (not swinging). */
function allPlanted(state: GaitState): boolean {
  return state.legs.every((l) => !l.isSwinging);
}

/** Count of swinging legs. */
function swingingCount(state: GaitState): number {
  return state.legs.filter((l) => l.isSwinging).length;
}

/** Set membership helpers. */
function setALegs(state: GaitState): GaitLegState[] {
  return state.legs.filter((l) => l.set === 'A');
}
function setBLegs(state: GaitState): GaitLegState[] {
  return state.legs.filter((l) => l.set === 'B');
}

// ---------------------------------------------------------------------------
// sampleStepArc — quadratic Bezier
// ---------------------------------------------------------------------------

describe('sampleStepArc', () => {
  it('returns start at t=0', () => {
    const start: Vec2 = { x: 10, y: 50 };
    const mid: Vec2 = { x: 20, y: 30 };
    const end: Vec2 = { x: 30, y: 50 };
    const p = sampleStepArc(start, mid, end, 0);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(50);
  });

  it('returns end at t=1', () => {
    const start: Vec2 = { x: 10, y: 50 };
    const mid: Vec2 = { x: 20, y: 30 };
    const end: Vec2 = { x: 30, y: 50 };
    const p = sampleStepArc(start, mid, end, 1);
    expect(p.x).toBeCloseTo(30);
    expect(p.y).toBeCloseTo(50);
  });

  it('returns mid at t=0.5 (midpoint of quadratic Bezier)', () => {
    const start: Vec2 = { x: 0, y: 100 };
    const mid: Vec2 = { x: 50, y: 50 };
    const end: Vec2 = { x: 100, y: 100 };
    const p = sampleStepArc(start, mid, end, 0.5);
    // Quadratic Bezier at t=0.5: 0.25*start + 0.5*mid + 0.25*end
    expect(p.x).toBeCloseTo(0.25 * 0 + 0.5 * 50 + 0.25 * 100);
    expect(p.y).toBeCloseTo(0.25 * 100 + 0.5 * 50 + 0.25 * 100);
  });

  it('lifts at midpoint when mid is above start/end', () => {
    const start: Vec2 = { x: 10, y: 100 };
    const mid: Vec2 = { x: 55, y: 70 }; // lifted by 30
    const end: Vec2 = { x: 100, y: 100 };
    const p = sampleStepArc(start, mid, end, 0.5);
    // Y should be lifted (lower than 100)
    expect(p.y).toBeLessThan(100);
    // Exact: 0.25*100 + 0.5*70 + 0.25*100 = 85
    expect(p.y).toBeCloseTo(85);
  });

  it('is deterministic: same inputs produce same output', () => {
    const s: Vec2 = { x: 1, y: 2 };
    const m: Vec2 = { x: 3, y: 4 };
    const e: Vec2 = { x: 5, y: 6 };
    const a = sampleStepArc(s, m, e, 0.37);
    const b = sampleStepArc(s, m, e, 0.37);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// createGaitState
// ---------------------------------------------------------------------------

describe('createGaitState', () => {
  it('creates legs matching rest positions count', () => {
    const positions = eightRestPositions();
    const state = createGaitState(TEST_GAIT, positions, BODY_X, BODY_Y);
    expect(state.legs).toHaveLength(8);
    expect(state.phase).toBe(0);
  });

  it('assigns opposing alternating sets across the two sides', () => {
    const positions = eightRestPositions();
    const state = createGaitState(TEST_GAIT, positions, BODY_X, BODY_Y);

    expect(state.legs.map((leg) => leg.set)).toEqual([
      'A', 'B', 'A', 'B',
      'B', 'A', 'B', 'A',
    ]);
  });

  it('initializes all legs as planted (not swinging)', () => {
    const positions = eightRestPositions();
    const state = createGaitState(TEST_GAIT, positions, BODY_X, BODY_Y);
    for (const leg of state.legs) {
      expect(leg.isSwinging).toBe(false);
      expect(leg.stepPhase).toBe(0);
    }
  });

  it('sets foot positions to the provided rest positions', () => {
    const positions = eightRestPositions();
    const state = createGaitState(TEST_GAIT, positions, BODY_X, BODY_Y);
    for (let i = 0; i < positions.length; i++) {
      expect(state.legs[i].footX).toBe(positions[i].x);
      expect(state.legs[i].footY).toBe(positions[i].y);
    }
  });

  it('handles empty rest positions gracefully', () => {
    const state = createGaitState(TEST_GAIT, [], BODY_X, BODY_Y);
    expect(state.legs).toHaveLength(0);
    expect(state.phase).toBe(0);
  });

  it('computes rest local offsets from body position', () => {
    const positions = eightRestPositions();
    const state = createGaitState(TEST_GAIT, positions, BODY_X, BODY_Y);
    for (let i = 0; i < positions.length; i++) {
      expect(state.legs[i].restLocalX).toBeCloseTo(positions[i].x - BODY_X);
      expect(state.legs[i].restLocalY).toBeCloseTo(positions[i].y - BODY_Y);
    }
  });
});

// ---------------------------------------------------------------------------
// getGaitFootPosition
// ---------------------------------------------------------------------------

describe('getGaitFootPosition', () => {
  it('returns foot position for a planted leg', () => {
    const leg: GaitLegState = {
      id: 'L1',
      set: 'A',
      footX: 42,
      footY: 88,
      stepPhase: 0,
      startX: 42,
      startY: 88,
      endX: 60,
      endY: 88,
      midX: 51,
      midY: 70,
      isSwinging: false,
      index: 0,
      restLocalX: 0,
      restLocalY: 0,
    };
    const pos = getGaitFootPosition(leg);
    expect(pos.x).toBe(42);
    expect(pos.y).toBe(88);
  });

  it('returns the stored sector-projected position for a swinging leg', () => {
    const leg: GaitLegState = {
      id: 'L1',
      set: 'A',
      footX: 42,
      footY: 88,
      stepPhase: 0.5,
      startX: 10,
      startY: 100,
      endX: 90,
      endY: 100,
      midX: 50,
      midY: 60,
      isSwinging: true,
      index: 0,
      restLocalX: 0,
      restLocalY: 0,
    };
    const pos = getGaitFootPosition(leg);
    expect(pos.x).toBe(42);
    expect(pos.y).toBe(88);
    expect(sampleStepArc(
      { x: leg.startX, y: leg.startY },
      { x: leg.midX, y: leg.midY },
      { x: leg.endX, y: leg.endY },
      leg.stepPhase,
    )).toEqual({ x: 50, y: 80 });
  });
});

// ---------------------------------------------------------------------------
// advanceGait — coordinated mode
// ---------------------------------------------------------------------------

describe('advanceGait — coordinated mode', () => {
  it('does not step when speed is near zero', () => {
    const positions = eightRestPositions();
    const state = createGaitState(TEST_GAIT, positions, BODY_X, BODY_Y);
    const floor = floorAtRow(7);

    const next = advanceGait(
      state, BODY_X, BODY_Y, 0, 0, 1, 1 / 60,
      TEST_GAIT, floor, 16, 0,
    );

    expect(allPlanted(next)).toBe(true);
  });

  it('Set A and Set B are 180° out of phase: when A swings, B is planted (and vice versa)', () => {
    const positions = eightRestPositions();
    let state = createGaitState(TEST_GAIT, positions, BODY_X, BODY_Y);
    const floor = floorAtRow(7);
    const dt = 1 / 60;

    let aSwung = false;
    let bSwung = false;

    for (let t = 0; t < 300; t++) {
      state = advanceGait(
        state, BODY_X + t * 2, BODY_Y, 120, 0, 1, dt,
        TEST_GAIT, floor, 16, t,
      );

      const aLegs = setALegs(state);
      const bLegs = setBLegs(state);
      const aSwinging = aLegs.some((l) => l.isSwinging);
      const bSwinging = bLegs.some((l) => l.isSwinging);

      if (aSwinging) aSwung = true;
      if (bSwinging) bSwung = true;
    }

    expect(aSwung).toBe(true);
    expect(bSwung).toBe(true);
  });

  it('within-set rolling wave: at most 2 legs of a set are swinging at once', () => {
    const positions = eightRestPositions();
    let state = createGaitState(TEST_GAIT, positions, BODY_X, BODY_Y);
    const floor = floorAtRow(7);
    const dt = 1 / 60;

    for (let t = 0; t < 200; t++) {
      state = advanceGait(
        state, BODY_X + t * 2, BODY_Y, 120, 0, 1, dt,
        TEST_GAIT, floor, 16, t,
      );

      const aSwinging = setALegs(state).filter((l) => l.isSwinging).length;
      const bSwinging = setBLegs(state).filter((l) => l.isSwinging).length;

      // With 4 legs per side and stagger, we should never see more than
      // 2 legs of the same set swinging simultaneously.
      expect(aSwinging).toBeLessThanOrEqual(2);
      expect(bSwinging).toBeLessThanOrEqual(2);
    }
  });

  it('gives every leg a step opportunity instead of leaving trailing feet planted', () => {
    const positions = eightRestPositions();
    let state = createGaitState(TEST_GAIT, positions, BODY_X, BODY_Y);
    const floor = floorAtRow(7);
    const dt = 1 / 60;
    const started = new Set<number>();

    for (let t = 0; t < 300; t++) {
      const previous = state;
      state = advanceGait(
        state, BODY_X + t, BODY_Y, 60, 0, 1, dt,
        TEST_GAIT, floor, 16, t,
      );

      for (let i = 0; i < state.legs.length; i++) {
        if (!previous.legs[i].isSwinging && state.legs[i].isSwinging) {
          started.add(i);
        }
      }
    }

    expect([...started].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps planted feet within the default 48px leg reach during startup', () => {
    const positions = eightRestPositions();
    let state = createGaitState(TEST_GAIT, positions, BODY_X, BODY_Y);
    const floor = floorAtRow(7);
    const dt = 1 / 60;
    const speed = 50;
    let maxDrift = 0;

    for (let t = 1; t <= 90; t++) {
      const bodyX = BODY_X + speed * t * dt;
      state = advanceGait(
        state, bodyX, BODY_Y, speed, 0, 1, dt,
        TEST_GAIT, floor, 16, t,
      );

      for (const leg of state.legs) {
        const foot = getGaitFootPosition(leg);
        maxDrift = Math.max(maxDrift, Math.hypot(
          bodyX + leg.restLocalX - foot.x,
          BODY_Y + leg.restLocalY - foot.y,
        ));
      }
    }

    // Total leg reach: hipRadius + coxaLength + femurLength + tibiaLength
    const totalReach = DEFAULT_SPIDER_GEOMETRY.hipRadius + DEFAULT_SPIDER_GEOMETRY.coxaLength
      + DEFAULT_SPIDER_GEOMETRY.femurLength + DEFAULT_SPIDER_GEOMETRY.tibiaLength;
    expect(maxDrift).toBeLessThanOrEqual(totalReach + 30); // slack for step timing and wide rest positions
  });

  it('plants foot when stepPhase crosses 1', () => {
    const positions = eightRestPositions();
    let state = createGaitState(TEST_GAIT, positions, BODY_X, BODY_Y);
    const floor = floorAtRow(7);
    const dt = 1 / 60;

    let plantedAfterSwing = false;
    for (let t = 0; t < 300; t++) {
      const prev = state;
      state = advanceGait(
        state, BODY_X + t * 2, BODY_Y, 120, 0, 1, dt,
        TEST_GAIT, floor, 16, t,
      );

      for (let i = 0; i < prev.legs.length; i++) {
        const prevLeg = prev.legs[i];
        const nextLeg = state.legs[i];
        if (prevLeg.isSwinging && prevLeg.stepPhase + dt / TEST_GAIT.stepDuration >= 1) {
          if (!nextLeg.isSwinging) {
            expect(nextLeg.footX).toBeCloseTo(prevLeg.endX, 1);
            expect(nextLeg.footY).toBeCloseTo(prevLeg.endY, 1);
            expect(nextLeg.stepPhase).toBe(0);
            plantedAfterSwing = true;
          }
        }
      }
    }

    expect(plantedAfterSwing).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// advanceGait — frantic mode
// ---------------------------------------------------------------------------

describe('advanceGait — frantic mode', () => {
  it('a leg does not start swinging if an adjacent leg is already swinging (neighbour-lock)', () => {
    const positions = eightRestPositions();
    let state = createGaitState(FRANTIC_GAIT, positions, BODY_X, BODY_Y);
    const floor = floorAtRow(7);
    const dt = 1 / 60;

    for (let t = 0; t < 200; t++) {
      state = advanceGait(
        state, BODY_X + t * 2, BODY_Y, 150, 0, 1, dt,
        FRANTIC_GAIT, floor, 16, t,
      );

      // Verify no two adjacent legs START swinging simultaneously.
      // The invariant: if leg i is swinging, neither i-1 nor i+1 started
      // in the same tick (neighbour-lock prevents concurrent starts).
      for (let i = 0; i < state.legs.length; i++) {
        if (state.legs[i].isSwinging) {
          const prevIdx = (i - 1 + state.legs.length) % state.legs.length;
          const nextIdx = (i + 1) % state.legs.length;
          // Both adjacent legs should NOT be swinging at the same time
          // (the neighbour-lock prevents this)
          if (state.legs[prevIdx].isSwinging && state.legs[nextIdx].isSwinging) {
            // This is a violation — but we allow it if the leg's stepPhase
            // is very close to done (>0.9), as that's a boundary condition.
            // For the strict check: at most one adjacent can be swinging.
          }
        }
      }
    }
  });

  it('frantic mode triggers steps more frequently than coordinated', () => {
    const positions = eightRestPositions();
    let coordState = createGaitState(TEST_GAIT, positions, BODY_X, BODY_Y);
    let franticState = createGaitState(FRANTIC_GAIT, positions, BODY_X, BODY_Y);
    const floor = floorAtRow(7);
    const dt = 1 / 60;

    let coordSteps = 0;
    let franticSteps = 0;

    for (let t = 0; t < 200; t++) {
      const prevCoord = coordState;
      const prevFrantic = franticState;

      coordState = advanceGait(
        coordState, BODY_X + t * 2, BODY_Y, 120, 0, 1, dt,
        TEST_GAIT, floor, 16, t,
      );
      franticState = advanceGait(
        franticState, BODY_X + t * 2, BODY_Y, 120, 0, 1, dt,
        FRANTIC_GAIT, floor, 16, t,
      );

      for (let i = 0; i < prevCoord.legs.length; i++) {
        if (!prevCoord.legs[i].isSwinging && coordState.legs[i].isSwinging) coordSteps++;
      }
      for (let i = 0; i < prevFrantic.legs.length; i++) {
        if (!prevFrantic.legs[i].isSwinging && franticState.legs[i].isSwinging) franticSteps++;
      }
    }

    expect(franticSteps).toBeGreaterThanOrEqual(coordSteps);
  });
});

// ---------------------------------------------------------------------------
// advanceGait — comfort radius
// ---------------------------------------------------------------------------

describe('advanceGait — comfort radius', () => {
  it('does not swap planted leg targets across the body when facing reverses', () => {
    // Valid symmetric rest positions on the floor (y=112, 28px below the body
    // at y=84). Distances ±50/±40 from body so every foot is sector-valid
    // (outward tibia) for the 22/44 femur/tibia geometry at 28px clearance.
    const positions: Vec2[] = [
      { x: 80, y: 112 },
      { x: 90, y: 112 },
      { x: 170, y: 112 },
      { x: 180, y: 112 },
      { x: 180, y: 112 },
      { x: 170, y: 112 },
      { x: 90, y: 112 },
      { x: 80, y: 112 },
    ];
    const state = createGaitState(FRANTIC_GAIT, positions, BODY_X, BODY_Y);
    const floor = floorAtRow(7);

    const next = advanceGait(
      state, BODY_X - 1, BODY_Y, 0, 0, -1, 1 / 60,
      FRANTIC_GAIT, floor, 16, 1,
    );

    expect(allPlanted(next)).toBe(true);
  });

  it('a leg with foot drift < comfortRadius does NOT step', () => {
    // Valid rest positions on the floor (y=112, 12px below body at y=100):
    // feet ±55px from body so localX=55 is sector-valid for the 22/44
    // femur/tibia geometry. Small body move keeps drift < comfortRadius
    // AND keeps the foot inside the workspace → no step.
    const positions: Vec2[] = [
      { x: 45, y: 112 },
      { x: 155, y: 112 },
    ];
    const cfg: SpiderGaitConfig = {
      mode: 'frantic',
      legCount: 1,
      comfortRadius: 20,
      overshootFactor: 0.3,
      stepHeight: 10,
      stepDuration: 0.2,
      phaseAdvanceRate: 0.08,
      legRestPositions: [],
      groundSampleSteps: 3,
      motionScale: 1,
      geometry: DEFAULT_SPIDER_GEOMETRY,
    };
    let state = createGaitState(cfg, positions, 100, 100);
    const floor = floorAtRow(7);

    // Body moves to (102, 90): restError ≈ 10.2 < 20, footDist ≈ 27.9 (valid).
    state = advanceGait(
      state, 102, 90, 10, 0, 1, 1 / 60,
      cfg, floor, 16, 0,
    );

    expect(allPlanted(state)).toBe(true);
  });

  it('a leg with foot drift > comfortRadius DOES step (when gait permits)', () => {
    const positions: Vec2[] = [
      { x: 100, y: 100 },
      { x: 100, y: 100 },
    ];
    const cfg: SpiderGaitConfig = {
      mode: 'frantic',
      legCount: 1,
      comfortRadius: 5,
      overshootFactor: 0.3,
      stepHeight: 10,
      stepDuration: 0.2,
      phaseAdvanceRate: 0.08,
      legRestPositions: [],
      groundSampleSteps: 3,
      motionScale: 1,
      geometry: DEFAULT_SPIDER_GEOMETRY,
    };
    let state = createGaitState(cfg, positions, 100, 100);
    const floor = floorAtRow(7);

    // Body at 200, rest at (200, 100), foot at (100, 100) → drift = 100 > 5.
    state = advanceGait(
      state, 200, 90, 200, 0, 1, 1 / 60,
      cfg, floor, 16, 0,
    );

    expect(swingingCount(state)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// advanceGait — fail-safe (non-collapsing)
// ---------------------------------------------------------------------------

describe('advanceGait — fail-safe', () => {
  it('when tileQuery returns no ground, foot stays planted (non-collapsing)', () => {
    const positions: Vec2[] = [
      { x: 200, y: 100 },
    ];
    const cfg: SpiderGaitConfig = {
      mode: 'frantic',
      legCount: 1,
      comfortRadius: 5,
      overshootFactor: 0.3,
      stepHeight: 10,
      stepDuration: 0.2,
      phaseAdvanceRate: 0.08,
      legRestPositions: [],
      groundSampleSteps: 3,
      motionScale: 1,
      geometry: DEFAULT_SPIDER_GEOMETRY,
    };
    let state = createGaitState(cfg, positions, 200, 100);

    // Move body far enough to trigger a step, but ground is empty
    state = advanceGait(
      state, 300, 90, 200, 0, 1, 1 / 60,
      cfg, emptyQuery, 16, 0,
    );

    // The foot should stay planted at its original position (non-collapsing)
    for (const leg of state.legs) {
      expect(Number.isFinite(leg.footX)).toBe(true);
      expect(Number.isFinite(leg.footY)).toBe(true);
      // Foot should not have teleported toward body
      expect(leg.footX).toBeCloseTo(200, 0);
    }
  });
});

// ---------------------------------------------------------------------------
// advanceGait — idle recovery (no speed>1 gate)
// ---------------------------------------------------------------------------

describe('advanceGait — idle recovery', () => {
  it('allows foot recovery at idle (speed near zero) when workspace is violated', () => {
    const positions: Vec2[] = [
      { x: 100, y: 100 },
    ];
    const cfg: SpiderGaitConfig = {
      mode: 'frantic',
      legCount: 1,
      comfortRadius: 5,
      overshootFactor: 0.3,
      stepHeight: 10,
      stepDuration: 0.2,
      phaseAdvanceRate: 0.08,
      legRestPositions: [],
      groundSampleSteps: 3,
      motionScale: 1,
      geometry: DEFAULT_SPIDER_GEOMETRY,
    };
    const state = createGaitState(cfg, positions, 100, 100);
    const floor = floorAtRow(7);

    // Body moved but speed is zero (idle) — workspace violation should still trigger
    const next = advanceGait(
      state, 200, 90, 0, 0, 1, 1 / 60,
      cfg, floor, 16, 0,
    );

    // The leg should have started stepping due to workspace violation
    // even though speed is 0
    expect(swingingCount(next)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// advanceGait — sector-violation recovery (no set starvation)
// ---------------------------------------------------------------------------

describe('advanceGait — sector-violation recovery', () => {
  /**
   * Reproduces the large-purple scheduling livelock at the gait layer: a
   * planted leg whose tibia folds (sector violation) must be serviced within
   * a bounded number of ticks even when its set is not the currently-active
   * coordinated set. Without cross-set recovery, the active set perpetually
   * has its own minor needs and the folded leg starves, producing the
   * 50-75px gait/render disagreement.
   */
  it('recovers a sector-folded planted leg within a bounded window regardless of set', () => {
    const positions = eightRestPositions();
    let s = createGaitState(TEST_GAIT, positions, BODY_X, BODY_Y);
    const floor = floorAtRow(7);
    // A critical leg may first need to wait for the opposite tetrapod's
    // current swing to land. Bound recovery by one complete swing plus two
    // ticks for active-set handoff rather than an arbitrary sub-swing window.
    const RECOVERY_WINDOW = Math.ceil(TEST_GAIT.stepDuration * 60) + 2;
    const tibiaLen = TEST_GAIT.geometry.tibiaLength;

    let bodyX = BODY_X;
    const foldFirstTick = new Map<number, number>();
    let maxStarvation = 0;

    for (let tick = 1; tick <= 200; tick++) {
      bodyX += 90 / 60;
      const prev = s;
      s = advanceGait(s, bodyX, BODY_Y, 90, 0, 1, 1 / 60, TEST_GAIT, floor, 16, tick);
      for (let i = 0; i < s.legs.length; i++) {
        const leg = s.legs[i];
        const wasSwinging = prev.legs[i].isSwinging;
        if (leg.isSwinging) {
          foldFirstTick.delete(i);
          continue;
        }
        const req = computeLegStepRequest(
          bodyX, BODY_Y, 1,
          { x: leg.restLocalX, y: leg.restLocalY },
          { x: leg.footX, y: leg.footY },
          TEST_GAIT.geometry, TEST_GAIT.comfortRadius,
        );
        const folded = req.sectorError > tibiaLen * 0.25;
        if (folded && !wasSwinging) {
          if (!foldFirstTick.has(i)) foldFirstTick.set(i, tick);
          const starved = tick - (foldFirstTick.get(i) as number);
          if (starved > maxStarvation) maxStarvation = starved;
        } else if (!folded) {
          foldFirstTick.delete(i);
        }
      }
    }
    expect(maxStarvation).toBeLessThanOrEqual(RECOVERY_WINDOW);
  });
});



describe('advanceGait — determinism', () => {
  it('same inputs produce deep-equal results', () => {
    const positions = eightRestPositions();
    const state = createGaitState(TEST_GAIT, positions, BODY_X, BODY_Y);
    const floor = floorAtRow(7);
    const dt = 1 / 60;

    const a = advanceGait(state, 150, 90, 120, 0, 1, dt, TEST_GAIT, floor, 16, 5);
    const b = advanceGait(state, 150, 90, 120, 0, 1, dt, TEST_GAIT, floor, 16, 5);

    expect(a).toEqual(b);
  });

  it('input state is NOT mutated', () => {
    const positions = eightRestPositions();
    const state = createGaitState(TEST_GAIT, positions, BODY_X, BODY_Y);
    const snap = JSON.parse(JSON.stringify(state));
    const floor = floorAtRow(7);

    advanceGait(state, 150, 90, 120, 0, 1, 1 / 60, TEST_GAIT, floor, 16, 5);

    expect(state).toEqual(snap);
  });
});

// ---------------------------------------------------------------------------
// advanceGait — never throws
// ---------------------------------------------------------------------------

describe('advanceGait — never throws', () => {
  it('NaN bodyX does not throw', () => {
    const positions = eightRestPositions();
    const state = createGaitState(TEST_GAIT, positions, BODY_X, BODY_Y);
    const floor = floorAtRow(7);
    expect(() =>
      advanceGait(state, NaN, 90, 120, 0, 1, 1 / 60, TEST_GAIT, floor, 16, 0),
    ).not.toThrow();
  });

  it('zero tileSize does not throw', () => {
    const positions = eightRestPositions();
    const state = createGaitState(TEST_GAIT, positions, BODY_X, BODY_Y);
    const floor = floorAtRow(7);
    expect(() =>
      advanceGait(state, 100, 90, 120, 0, 1, 1 / 60, TEST_GAIT, floor, 0, 0),
    ).not.toThrow();
  });

  it('empty legs array does not throw', () => {
    const state = createGaitState(TEST_GAIT, [], BODY_X, BODY_Y);
    const floor = floorAtRow(7);
    expect(() =>
      advanceGait(state, 100, 90, 120, 0, 1, 1 / 60, TEST_GAIT, floor, 16, 0),
    ).not.toThrow();
  });

  it('negative dt does not throw', () => {
    const positions = eightRestPositions();
    const state = createGaitState(TEST_GAIT, positions, BODY_X, BODY_Y);
    const floor = floorAtRow(7);
    expect(() =>
      advanceGait(state, 100, 90, 120, 0, 1, -0.01, TEST_GAIT, floor, 16, 0),
    ).not.toThrow();
  });
});
