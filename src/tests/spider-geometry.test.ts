import { describe, it, expect } from 'vitest';
import {
  computeHipPosition,
  computeCoxaEndpoint,
  computeFemurTibiaAnnuli,
  projectTargetIntoWorkspace,
  projectGroundedTargetIntoWorkspace,
  solveThreeSegmentLeg,
  computeLegStepRequest,
  type SpiderLegGeometryConfig,
} from '../animation/spider/geometry';
import { DEFAULT_SPIDER } from '../animation/spider/constants';

// ---------------------------------------------------------------------------
// Defaults matching the approved spec (jointSafetyMargin in px)
// ---------------------------------------------------------------------------

const DEFAULT_GEOMETRY: SpiderLegGeometryConfig = {
  hipRadius: 8,
  coxaLength: 8,
  femurLength: 19,
  tibiaLength: 21,
  minExtensionRatio: 0.45,
  maxExtensionRatio: 0.94,
  jointSafetyMargin: 0.5,
  minDistalAdvanceRatio: 0.1,
};

// ---------------------------------------------------------------------------
// computeHipPosition
// ---------------------------------------------------------------------------

describe('computeHipPosition', () => {
  it('places hip on the body circumference at the rest-local angle', () => {
    const hip = computeHipPosition(100, 80, 1, { x: 30, y: 30 }, DEFAULT_GEOMETRY);
    const dist = Math.hypot(hip.x - 100, hip.y - 80);
    expect(dist).toBeCloseTo(DEFAULT_GEOMETRY.hipRadius, 1);
  });

  it('mirrors the local X offset by facing', () => {
    const hipR = computeHipPosition(100, 80, 1, { x: 30, y: 0 }, DEFAULT_GEOMETRY);
    const hipL = computeHipPosition(100, 80, -1, { x: 30, y: 0 }, DEFAULT_GEOMETRY);
    expect(hipR.x - 100).toBeCloseTo(-(hipL.x - 100), 5);
    expect(hipR.y).toBeCloseTo(hipL.y, 5);
  });

  it('falls back for degenerate local offset', () => {
    const hip = computeHipPosition(100, 80, 1, { x: 0, y: 0 }, DEFAULT_GEOMETRY);
    expect(Number.isFinite(hip.x)).toBe(true);
    expect(Number.isFinite(hip.y)).toBe(true);
  });

  it('is pure: same inputs produce same output', () => {
    const a = computeHipPosition(100, 80, 1, { x: 20, y: 15 }, DEFAULT_GEOMETRY);
    const b = computeHipPosition(100, 80, 1, { x: 20, y: 15 }, DEFAULT_GEOMETRY);
    expect(a).toEqual(b);
  });

  it('handles non-finite bodyX/bodyY gracefully', () => {
    const hip = computeHipPosition(NaN, Infinity, 1, { x: 10, y: 10 }, DEFAULT_GEOMETRY);
    expect(Number.isFinite(hip.x)).toBe(true);
    expect(Number.isFinite(hip.y)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeCoxaEndpoint
// ---------------------------------------------------------------------------

describe('computeCoxaEndpoint', () => {
  it('places coxa tip exactly coxaLength from hip', () => {
    const hip = { x: 108, y: 80 };
    const restLocal = { x: 30, y: 30 };
    const coxa = computeCoxaEndpoint(hip, 1, restLocal, DEFAULT_GEOMETRY);
    const dist = Math.hypot(coxa.x - hip.x, coxa.y - hip.y);
    expect(dist).toBeCloseTo(DEFAULT_GEOMETRY.coxaLength, 2);
  });

  it('anterior leg (positive restLocalX) coxa points forward/outward', () => {
    const hip = { x: 108, y: 80 };
    const restLocal = { x: 30, y: 10 };
    const coxaR = computeCoxaEndpoint(hip, 1, restLocal, DEFAULT_GEOMETRY);
    expect(coxaR.x - hip.x).toBeGreaterThan(0);
  });

  it('posterior leg (negative restLocalX) coxa points backward/outward', () => {
    const hip = { x: 92, y: 80 };
    const restLocal = { x: -30, y: 10 };
    const coxaR = computeCoxaEndpoint(hip, 1, restLocal, DEFAULT_GEOMETRY);
    expect(coxaR.x - hip.x).toBeLessThan(0);
  });

  it('mirrors coxa direction by facing for same restLocal', () => {
    const hipR = { x: 108, y: 80 };
    const hipL = { x: 92, y: 80 };
    const restLocal = { x: 30, y: 10 };
    const coxaR = computeCoxaEndpoint(hipR, 1, restLocal, DEFAULT_GEOMETRY);
    const coxaL = computeCoxaEndpoint(hipL, -1, restLocal, DEFAULT_GEOMETRY);
    expect(coxaR.x - hipR.x).toBeCloseTo(-(coxaL.x - hipL.x), 2);
  });

  it('anterior and posterior coxae fan apart', () => {
    const hipAnt = { x: 108, y: 80 };
    const hipPost = { x: 92, y: 80 };
    const coxaAnt = computeCoxaEndpoint(hipAnt, 1, { x: 40, y: 10 }, DEFAULT_GEOMETRY);
    const coxaPost = computeCoxaEndpoint(hipPost, 1, { x: -40, y: 10 }, DEFAULT_GEOMETRY);
    expect(coxaAnt.x - hipAnt.x).toBeGreaterThan(coxaPost.x - hipPost.x);
  });

  it('handles non-finite hip gracefully', () => {
    const coxa = computeCoxaEndpoint({ x: NaN, y: NaN }, 1, { x: 10, y: 10 }, DEFAULT_GEOMETRY);
    expect(Number.isFinite(coxa.x)).toBe(true);
    expect(Number.isFinite(coxa.y)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeFemurTibiaAnnuli
// ---------------------------------------------------------------------------

describe('computeFemurTibiaAnnuli', () => {
  it('hardMin = |femur - tibia| + margin (px)', () => {
    const annuli = computeFemurTibiaAnnuli(DEFAULT_GEOMETRY);
    expect(annuli.hardMin).toBeCloseTo(2 + 0.5, 5);
  });

  it('hardMax = femur + tibia - margin (px)', () => {
    const annuli = computeFemurTibiaAnnuli(DEFAULT_GEOMETRY);
    expect(annuli.hardMax).toBeCloseTo(40 - 0.5, 5);
  });

  it('softMin = clamp(total * minExtensionRatio, hardMin, hardMax)', () => {
    const annuli = computeFemurTibiaAnnuli(DEFAULT_GEOMETRY);
    expect(annuli.softMin).toBeCloseTo(18, 5);
  });

  it('softMax = clamp(total * maxExtensionRatio, hardMin, hardMax)', () => {
    const annuli = computeFemurTibiaAnnuli(DEFAULT_GEOMETRY);
    expect(annuli.softMax).toBeCloseTo(37.6, 5);
  });

  it('hardMin <= softMin <= softMax <= hardMax always holds', () => {
    const a = computeFemurTibiaAnnuli(DEFAULT_GEOMETRY);
    expect(a.hardMin).toBeLessThanOrEqual(a.softMin + 1e-10);
    expect(a.softMin).toBeLessThanOrEqual(a.softMax + 1e-10);
    expect(a.softMax).toBeLessThanOrEqual(a.hardMax + 1e-10);
  });

  it('holds defensively for extreme configs', () => {
    const extreme: SpiderLegGeometryConfig = {
      hipRadius: 8, coxaLength: 8, femurLength: 1, tibiaLength: 1,
      minExtensionRatio: 0.01, maxExtensionRatio: 0.99, jointSafetyMargin: 10,
      minDistalAdvanceRatio: 0.1,
    };
    const a = computeFemurTibiaAnnuli(extreme);
    expect(a.hardMin).toBeLessThanOrEqual(a.softMin + 1e-10);
    expect(a.softMin).toBeLessThanOrEqual(a.softMax + 1e-10);
    expect(a.softMax).toBeLessThanOrEqual(a.hardMax + 1e-10);
  });

  it('sanitizes non-positive femurLength to a safe positive fallback', () => {
    const a = computeFemurTibiaAnnuli({ ...DEFAULT_GEOMETRY, femurLength: 0 });
    expect(a.hardMin).toBeGreaterThan(0);
    expect(a.hardMax).toBeGreaterThan(a.hardMin);
    expect(a.softMin).toBeLessThanOrEqual(a.softMax + 1e-10);
  });

  it('sanitizes non-positive tibiaLength to a safe positive fallback', () => {
    const a = computeFemurTibiaAnnuli({ ...DEFAULT_GEOMETRY, tibiaLength: -5 });
    expect(a.hardMin).toBeGreaterThan(0);
    expect(a.hardMax).toBeGreaterThan(a.hardMin);
    expect(a.softMin).toBeLessThanOrEqual(a.softMax + 1e-10);
  });

  it('sanitizes non-positive coxaLength in solveThreeSegmentLeg', () => {
    const result = solveThreeSegmentLeg(
      100, 80, 1, { x: 30, y: 30 }, { x: 120, y: 130 },
      { ...DEFAULT_GEOMETRY, coxaLength: 0 },
    );
    const coxaLen = Math.hypot(result.coxaX - result.hipX, result.coxaY - result.hipY);
    expect(coxaLen).toBeGreaterThan(0);
  });

  it('sanitizes non-positive femurLength in solveThreeSegmentLeg (non-degenerate femur)', () => {
    const result = solveThreeSegmentLeg(
      100, 80, 1, { x: 30, y: 30 }, { x: 120, y: 130 },
      { ...DEFAULT_GEOMETRY, femurLength: 0 },
    );
    const femurLen = Math.hypot(result.kneeX - result.coxaX, result.kneeY - result.coxaY);
    expect(femurLen).toBeGreaterThan(1);
  });

  it('sanitizes non-positive tibiaLength in solveThreeSegmentLeg (non-degenerate tibia)', () => {
    const result = solveThreeSegmentLeg(
      100, 80, 1, { x: 30, y: 30 }, { x: 120, y: 130 },
      { ...DEFAULT_GEOMETRY, tibiaLength: 0 },
    );
    const tibiaLen = Math.hypot(result.footX - result.kneeX, result.footY - result.kneeY);
    expect(tibiaLen).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// projectTargetIntoWorkspace
// ---------------------------------------------------------------------------

describe('projectTargetIntoWorkspace', () => {
  it('passes through a target in the soft annulus unchanged', () => {
    const coxa = { x: 116, y: 88 };
    const target = { x: 116, y: 120 };
    const result = projectTargetIntoWorkspace(coxa, target, DEFAULT_GEOMETRY);
    expect(result.x).toBeCloseTo(target.x, 3);
    expect(result.y).toBeCloseTo(target.y, 3);
  });

  it('projects a too-close target outward to the hard minimum', () => {
    const coxa = { x: 116, y: 88 };
    const target = { x: 116, y: 89 };
    const result = projectTargetIntoWorkspace(coxa, target, DEFAULT_GEOMETRY);
    const dist = Math.hypot(result.x - coxa.x, result.y - coxa.y);
    expect(dist).toBeGreaterThanOrEqual(computeFemurTibiaAnnuli(DEFAULT_GEOMETRY).hardMin - 0.01);
  });

  it('projects a too-far target inward to the hard maximum', () => {
    const coxa = { x: 116, y: 88 };
    const target = { x: 116, y: 200 };
    const result = projectTargetIntoWorkspace(coxa, target, DEFAULT_GEOMETRY);
    const dist = Math.hypot(result.x - coxa.x, result.y - coxa.y);
    expect(dist).toBeLessThanOrEqual(computeFemurTibiaAnnuli(DEFAULT_GEOMETRY).hardMax + 0.01);
  });

  it('handles coincident coxa and target', () => {
    const result = projectTargetIntoWorkspace({ x: 100, y: 100 }, { x: 100, y: 100 }, DEFAULT_GEOMETRY);
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });

  it('handles non-finite target gracefully', () => {
    const result = projectTargetIntoWorkspace({ x: 100, y: 100 }, { x: NaN, y: NaN }, DEFAULT_GEOMETRY);
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// projectGroundedTargetIntoWorkspace — restLocalX-aware tie-break
// ---------------------------------------------------------------------------

describe('projectGroundedTargetIntoWorkspace', () => {
  it('preserves the ground Y exactly', () => {
    const coxa = { x: 116, y: 88 };
    const result = projectGroundedTargetIntoWorkspace(coxa, { x: 116, y: 112 }, DEFAULT_GEOMETRY, 1, 30);
    expect(result.y).toBe(112);
  });

  it('when feasible and sector-valid, passes through unchanged', () => {
    // Target is outward (x > coxa.x for a facing-right anterior leg) and inside
    // the annulus, so its tibia already advances outward — no correction.
    const coxa = { x: 116, y: 88 };
    const target = { x: 138, y: 110 };
    const result = projectGroundedTargetIntoWorkspace(coxa, target, DEFAULT_GEOMETRY, 1, 30);
    expect(result.x).toBeCloseTo(target.x, 3);
    expect(result.y).toBe(target.y);
  });

  it('pushes an inward (folded) target outward while preserving ground Y', () => {
    // Target directly below the coxa folds the tibia back; the projector moves
    // it outward (toward increasing X for this anterior leg) but keeps ground Y.
    const coxa = { x: 116, y: 88 };
    const target = { x: 116, y: 112 };
    const result = projectGroundedTargetIntoWorkspace(coxa, target, DEFAULT_GEOMETRY, 1, 30);
    expect(result.x).toBeGreaterThan(target.x);
    expect(result.y).toBe(target.y);
  });

  it('when too close, adjusts X to maintain ground Y at hardMin distance', () => {
    const coxa = { x: 100, y: 100 };
    const result = projectGroundedTargetIntoWorkspace(coxa, { x: 100, y: 100.1 }, DEFAULT_GEOMETRY, 1, 30);
    expect(result.y).toBe(100.1);
    const dist = Math.hypot(result.x - coxa.x, result.y - coxa.y);
    expect(dist).toBeGreaterThanOrEqual(computeFemurTibiaAnnuli(DEFAULT_GEOMETRY).hardMin - 0.01);
  });

  it('when too far vertically, clamps to hardMax distance from coxa', () => {
    const coxa = { x: 100, y: 100 };
    const result = projectGroundedTargetIntoWorkspace(coxa, { x: 100, y: 500 }, DEFAULT_GEOMETRY, 1, 30);
    const dist = Math.hypot(result.x - coxa.x, result.y - coxa.y);
    expect(dist).toBeLessThanOrEqual(computeFemurTibiaAnnuli(DEFAULT_GEOMETRY).hardMax + 0.01);
  });

  it('uses soft annulus when ground height makes it feasible', () => {
    const coxa = { x: 116, y: 88 };
    const result = projectGroundedTargetIntoWorkspace(coxa, { x: 120, y: 112 }, DEFAULT_GEOMETRY, 1, 30);
    const dist = Math.hypot(result.x - coxa.x, result.y - coxa.y);
    const annuli = computeFemurTibiaAnnuli(DEFAULT_GEOMETRY);
    expect(dist).toBeGreaterThanOrEqual(annuli.softMin - 0.01);
    expect(dist).toBeLessThanOrEqual(annuli.softMax + 0.01);
  });

  it('posterior leg (restLocalX < 0) facing right prefers negative X', () => {
    const coxa = { x: 100, y: 100 };
    // restLocalX = -40 (posterior), facing = 1 (right)
    // mirrored restLocalX = -40 * 1 = -40 → outward direction is negative X
    const result = projectGroundedTargetIntoWorkspace(coxa, { x: 100, y: 100 }, DEFAULT_GEOMETRY, 1, -40);
    expect(result.x).toBeLessThan(coxa.x); // posterior prefers negative X
  });

  it('anterior leg (restLocalX > 0) facing right prefers positive X', () => {
    const coxa = { x: 100, y: 100 };
    const result = projectGroundedTargetIntoWorkspace(coxa, { x: 100, y: 100 }, DEFAULT_GEOMETRY, 1, 40);
    expect(result.x).toBeGreaterThan(coxa.x); // anterior prefers positive X
  });

  it('posterior leg facing left prefers positive X (mirrored)', () => {
    const coxa = { x: 100, y: 100 };
    // restLocalX = -40, facing = -1 → mirrored = -40 * -1 = 40 → outward is positive X
    const result = projectGroundedTargetIntoWorkspace(coxa, { x: 100, y: 100 }, DEFAULT_GEOMETRY, -1, -40);
    expect(result.x).toBeGreaterThan(coxa.x);
  });

  it('handles non-finite inputs gracefully', () => {
    const result = projectGroundedTargetIntoWorkspace(
      { x: NaN, y: NaN }, { x: NaN, y: NaN }, DEFAULT_GEOMETRY, 1, 30,
    );
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeLegStepRequest — structured result, absolute workspace validity
// ---------------------------------------------------------------------------

describe('computeLegStepRequest', () => {
  const geometry = DEFAULT_GEOMETRY;

  it('at-rest foot inside soft annulus and sector: needsStep is false', () => {
    // Foot at rest, shallow-outward so the tibia advances outward (sector-valid)
    // and inside the soft annulus from the coxa.
    const req = computeLegStepRequest(
      100, 100, 1, { x: 34, y: 12 }, { x: 134, y: 112 }, geometry, 10,
    );
    expect(req.needsStep).toBe(false);
    expect(req.restError).toBe(0);
    expect(req.sectorError).toBe(0);
    expect(req.hardViolation).toBe(false);
  });

  it('at-rest foot that folds the tibia (sector violation): needsStep is true', () => {
    // Foot resting steeply below-and-close (45° down) folds the tibia back even
    // though it is inside the radial annulus — must replant even at rest.
    const req = computeLegStepRequest(
      100, 100, 1, { x: 30, y: 30 }, { x: 130, y: 130 }, geometry, 10,
    );
    expect(req.needsStep).toBe(true);
    expect(req.sectorError).toBeGreaterThan(0);
    expect(req.restError).toBe(0);
  });

  it('at-rest foot OUTSIDE soft annulus: needsStep is true (absolute workspace validity)', () => {
    // Foot at rest, but rest position is outside softMax from coxa.
    // restLocal = {-70, 0}, facing=1 → restWorldX = 30, footX = 30.
    // Hip: localX = -70*1 = -70, dir = (-1, 0), hip = (92, 100).
    // coxa: localX = -70, dir = (-1, 0), coxa = (84, 100).
    // footDist = |30 - 84| = 54. softMax = 37.6, hardMax = 39.5.
    // 54 > hardMax → hard violation.
    const req = computeLegStepRequest(
      100, 100, 1, { x: -70, y: 0 }, { x: 30, y: 100 }, geometry, 10,
    );
    expect(req.needsStep).toBe(true);
    expect(req.hardViolation).toBe(true);
    expect(req.workspaceError).toBeGreaterThan(0);
  });

  it('arbitrarily small soft violation yields needsStep', () => {
    // Place the foot just outside softMax from the leg's actual coxa tip,
    // directly below it. Deriving the foot from the real coxa keeps this
    // robust to the coxa direction (horizontal-splay geometry).
    const annuli = computeFemurTibiaAnnuli(geometry);
    const hip = computeHipPosition(100, 100, 1, { x: 30, y: 0 }, geometry);
    const coxa = computeCoxaEndpoint(hip, 1, { x: 30, y: 0 }, geometry);
    const foot = { x: coxa.x, y: coxa.y + annuli.softMax + 0.1 };
    const req = computeLegStepRequest(
      100, 100, 1, { x: 30, y: 0 }, foot, geometry, 10,
    );
    expect(req.needsStep).toBe(true);
    expect(req.workspaceError).toBeGreaterThan(0);
    expect(req.hardViolation).toBe(false); // still inside hardMax
  });

  it('foot drifted from rest beyond comfortRadius: needsStep is true', () => {
    const req = computeLegStepRequest(
      100, 100, 1, { x: 30, y: 30 }, { x: 200, y: 200 }, geometry, 10,
    );
    expect(req.needsStep).toBe(true);
    expect(req.restError).toBeGreaterThan(10);
  });

  it('foot drifted slightly but inside soft annulus and sector: needsStep is false', () => {
    // Small drift from a sector-valid rest, foot still in soft annulus.
    // restError ~ 2.8 < comfortRadius 20, sectorError 0 → needsStep false.
    const req = computeLegStepRequest(
      100, 100, 1, { x: 34, y: 12 }, { x: 136, y: 114 }, geometry, 20,
    );
    expect(req.needsStep).toBe(false);
  });

  it('hardViolation is true when outside hardMin or hardMax', () => {
    // foot way outside hardMax
    const req = computeLegStepRequest(
      100, 100, 1, { x: 30, y: 30 }, { x: 300, y: 300 }, geometry, 10,
    );
    expect(req.hardViolation).toBe(true);
  });

  it('hardViolation is false when inside hard bounds', () => {
    const req = computeLegStepRequest(
      100, 100, 1, { x: 30, y: 30 }, { x: 135, y: 135 }, geometry, 10,
    );
    expect(req.hardViolation).toBe(false);
  });

  it('handles non-finite inputs gracefully', () => {
    const req = computeLegStepRequest(
      NaN, NaN, 1, { x: NaN, y: NaN }, { x: NaN, y: NaN }, geometry, 10,
    );
    expect(Number.isFinite(req.urgency)).toBe(true);
    expect(req.urgency).toBeGreaterThanOrEqual(0);
    expect(typeof req.needsStep).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// solveThreeSegmentLeg — exact segment lengths for ALL target conditions
// ---------------------------------------------------------------------------

describe('solveThreeSegmentLeg', () => {
  const bodyX = 100;
  const bodyY = 80;
  const restLocal = { x: 30, y: 30 };

  function expectExactLengths(
    result: ReturnType<typeof solveThreeSegmentLeg>,
    geo: SpiderLegGeometryConfig,
  ) {
    const coxaLen = Math.hypot(result.coxaX - result.hipX, result.coxaY - result.hipY);
    const femurLen = Math.hypot(result.kneeX - result.coxaX, result.kneeY - result.coxaY);
    const tibiaLen = Math.hypot(result.footX - result.kneeX, result.footY - result.kneeY);
    expect(coxaLen).toBeCloseTo(geo.coxaLength, 1);
    expect(femurLen).toBeCloseTo(geo.femurLength, 1);
    expect(tibiaLen).toBeCloseTo(geo.tibiaLength, 1);
  }

  it('normal target: all three segment lengths are exact', () => {
    const result = solveThreeSegmentLeg(bodyX, bodyY, 1, restLocal, { x: 120, y: 130 }, DEFAULT_GEOMETRY);
    expectExactLengths(result, DEFAULT_GEOMETRY);
  });

  it('close target: all three segment lengths are exact', () => {
    const result = solveThreeSegmentLeg(bodyX, bodyY, 1, restLocal, { x: bodyX + 5, y: bodyY + 5 }, DEFAULT_GEOMETRY);
    expectExactLengths(result, DEFAULT_GEOMETRY);
  });

  it('coincident target: all three segment lengths are exact', () => {
    const result = solveThreeSegmentLeg(bodyX, bodyY, 1, restLocal, { x: bodyX, y: bodyY }, DEFAULT_GEOMETRY);
    expectExactLengths(result, DEFAULT_GEOMETRY);
  });

  it('far target: all three segment lengths are exact', () => {
    const result = solveThreeSegmentLeg(bodyX, bodyY, 1, restLocal, { x: bodyX + 500, y: bodyY + 500 }, DEFAULT_GEOMETRY);
    expectExactLengths(result, DEFAULT_GEOMETRY);
  });

  it('non-finite target: all three segment lengths are exact', () => {
    const result = solveThreeSegmentLeg(bodyX, bodyY, 1, restLocal, { x: NaN, y: NaN }, DEFAULT_GEOMETRY);
    expectExactLengths(result, DEFAULT_GEOMETRY);
  });

  it('all output coordinates are finite for every target condition', () => {
    const targets = [
      { x: 120, y: 130 },
      { x: bodyX + 5, y: bodyY + 5 },
      { x: bodyX, y: bodyY },
      { x: bodyX + 500, y: bodyY + 500 },
      { x: NaN, y: NaN },
    ];
    for (const t of targets) {
      const r = solveThreeSegmentLeg(bodyX, bodyY, 1, restLocal, t, DEFAULT_GEOMETRY);
      for (const key of ['hipX', 'hipY', 'coxaX', 'coxaY', 'kneeX', 'kneeY', 'footX', 'footY'] as const) {
        expect(Number.isFinite(r[key])).toBe(true);
      }
    }
  });

  it('projection guarantees dist between hardMin and hardMax', () => {
    const targets = [
      { x: 120, y: 130 },
      { x: bodyX + 5, y: bodyY + 5 },
      { x: bodyX, y: bodyY },
      { x: bodyX + 500, y: bodyY + 500 },
    ];
    const annuli = computeFemurTibiaAnnuli(DEFAULT_GEOMETRY);
    for (const t of targets) {
      const r = solveThreeSegmentLeg(bodyX, bodyY, 1, restLocal, t, DEFAULT_GEOMETRY);
      const dist = Math.hypot(r.footX - r.coxaX, r.footY - r.coxaY);
      expect(dist).toBeGreaterThanOrEqual(annuli.hardMin - 0.01);
      expect(dist).toBeLessThanOrEqual(annuli.hardMax + 0.01);
    }
  });

  it('is deterministic', () => {
    const a = solveThreeSegmentLeg(bodyX, bodyY, 1, restLocal, { x: 115, y: 130 }, DEFAULT_GEOMETRY);
    const b = solveThreeSegmentLeg(bodyX, bodyY, 1, restLocal, { x: 115, y: 130 }, DEFAULT_GEOMETRY);
    expect(a).toEqual(b);
  });

  it('never throws for any input', () => {
    expect(() => solveThreeSegmentLeg(NaN, NaN, 1, { x: NaN, y: NaN }, { x: NaN, y: NaN }, DEFAULT_GEOMETRY)).not.toThrow();
    expect(() => solveThreeSegmentLeg(0, 0, 1, { x: 0, y: 0 }, { x: 0, y: 0 }, DEFAULT_GEOMETRY)).not.toThrow();
    expect(() => solveThreeSegmentLeg(100, 100, 1, { x: 100, y: 100 }, { x: 1e6, y: 1e6 }, DEFAULT_GEOMETRY)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// solveThreeSegmentLeg — anatomical bend stability
// ---------------------------------------------------------------------------

describe('solveThreeSegmentLeg — anatomical bend stability', () => {
  it('anterior leg: knee stays on consistent side across perturbations', () => {
    const restLocal = { x: 40, y: 20 };
    const target = { x: 130, y: 130 };
    const base = solveThreeSegmentLeg(100, 80, 1, restLocal, target, DEFAULT_GEOMETRY);
    const baseCross = (base.footX - base.coxaX) * (base.kneeY - base.coxaY)
      - (base.footY - base.coxaY) * (base.kneeX - base.coxaX);
    for (const dx of [-0.5, -0.1, 0.1, 0.5]) {
      for (const dy of [-0.5, -0.1, 0.1, 0.5]) {
        const p = solveThreeSegmentLeg(100, 80, 1, restLocal,
          { x: target.x + dx, y: target.y + dy }, DEFAULT_GEOMETRY);
        const pCross = (p.footX - p.coxaX) * (p.kneeY - p.coxaY)
          - (p.footY - p.coxaY) * (p.kneeX - p.coxaX);
        expect(Math.sign(pCross)).toBe(Math.sign(baseCross));
      }
    }
  });

  it('posterior leg: knee stays on consistent side across perturbations', () => {
    const restLocal = { x: -40, y: 20 };
    const target = { x: 80, y: 130 };
    const base = solveThreeSegmentLeg(100, 80, 1, restLocal, target, DEFAULT_GEOMETRY);
    const baseCross = (base.footX - base.coxaX) * (base.kneeY - base.coxaY)
      - (base.footY - base.coxaY) * (base.kneeX - base.coxaX);
    for (const dx of [-0.5, -0.1, 0.1, 0.5]) {
      for (const dy of [-0.5, -0.1, 0.1, 0.5]) {
        const p = solveThreeSegmentLeg(100, 80, 1, restLocal,
          { x: target.x + dx, y: target.y + dy }, DEFAULT_GEOMETRY);
        const pCross = (p.footX - p.coxaX) * (p.kneeY - p.coxaY)
          - (p.footY - p.coxaY) * (p.kneeX - p.coxaX);
        expect(Math.sign(pCross)).toBe(Math.sign(baseCross));
      }
    }
  });

  it('facing mirror: knee stays on anatomically consistent side', () => {
    const restLocal = { x: 30, y: 20 };
    const resultR = solveThreeSegmentLeg(100, 80, 1, restLocal, { x: 130, y: 130 }, DEFAULT_GEOMETRY);
    const resultL = solveThreeSegmentLeg(100, 80, -1, restLocal, { x: 70, y: 130 }, DEFAULT_GEOMETRY);
    expect(Number.isFinite(resultR.kneeX)).toBe(true);
    expect(Number.isFinite(resultL.kneeX)).toBe(true);
    const crossR = (resultR.footX - resultR.coxaX) * (resultR.kneeY - resultR.coxaY)
      - (resultR.footY - resultR.coxaY) * (resultR.kneeX - resultR.coxaX);
    const crossL = (resultL.footX - resultL.coxaX) * (resultL.kneeY - resultL.coxaY)
      - (resultL.footY - resultL.coxaY) * (resultL.kneeX - resultL.coxaX);
    expect(crossR).not.toBeCloseTo(0, 0);
    expect(crossL).not.toBeCloseTo(0, 0);
  });

  it('anterior vs posterior legs produce valid finite poses', () => {
    const resultAnt = solveThreeSegmentLeg(100, 80, 1, { x: 40, y: 20 }, { x: 110, y: 130 }, DEFAULT_GEOMETRY);
    const resultPost = solveThreeSegmentLeg(100, 80, 1, { x: -40, y: 20 }, { x: 110, y: 130 }, DEFAULT_GEOMETRY);
    expect(Number.isFinite(resultAnt.kneeX)).toBe(true);
    expect(Number.isFinite(resultPost.kneeX)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Landing endpoint feasibility (stepDuration-based coxa prediction)
// ---------------------------------------------------------------------------

describe('landing endpoint feasibility', () => {
  it('landing endpoint is feasible against coxa at stepDuration', () => {
    // Simulate: body at (100, 100), moving at vx=60, stepDuration=0.18.
    // At landing time, body will be at (100 + 60*0.18, 100) = (110.8, 100).
    // coxa at landing time should be computed from predicted body.
    // Ground sample returns a point. After projection, the endpoint should
    // be within the annulus from the landing-time coxa.
    const bodyX = 100;
    const bodyY = 100;
    const vx = 60;
    const stepDuration = 0.18;
    const landingBodyX = bodyX + vx * stepDuration;
    const landingBodyY = bodyY;
    const restLocal = { x: 30, y: 30 };
    const facing: 1 | -1 = 1;

    // Compute coxa at landing time
    const landingHip = computeHipPosition(landingBodyX, landingBodyY, facing, restLocal, DEFAULT_GEOMETRY);
    const landingCoxa = computeCoxaEndpoint(landingHip, facing, restLocal, DEFAULT_GEOMETRY);

    // A ground point that's within the annulus
    const groundY = 112;
    const result = projectGroundedTargetIntoWorkspace(
      landingCoxa, { x: landingCoxa.x, y: groundY }, DEFAULT_GEOMETRY, facing, restLocal.x,
    );

    // Verify the result is feasible from the landing-time coxa
    const dist = Math.hypot(result.x - landingCoxa.x, result.y - landingCoxa.y);
    const annuli = computeFemurTibiaAnnuli(DEFAULT_GEOMETRY);
    expect(dist).toBeGreaterThanOrEqual(annuli.hardMin - 0.01);
    expect(dist).toBeLessThanOrEqual(annuli.hardMax + 0.01);
    // Ground Y should be preserved when feasible
    if (Math.abs(groundY - landingCoxa.y) <= annuli.hardMax) {
      expect(result.y).toBe(groundY);
    }
  });
});

// ---------------------------------------------------------------------------
// computeCoxaEndpoint — horizontal splay with small downward bias (BUG 2)
// ---------------------------------------------------------------------------

describe('computeCoxaEndpoint — horizontal splay', () => {
  it('extends horizontally with a small downward bias, not the full rest direction', () => {
    // restLocal for a 60° leg. The old code extended 6.9px DOWN (full rest
    // direction), eating vertical reach so the femur/tibia could not reach
    // the floor. The coxa must extend mostly sideways with a slight droop.
    const h = { x: 100, y: 80 };
    const restLocal = { x: 17.5, y: 30.3 };
    const coxa = computeCoxaEndpoint(h, 1, restLocal, DEFAULT_GEOMETRY);
    const dx = coxa.x - h.x;
    const dy = coxa.y - h.y;
    expect(dy).toBeGreaterThan(0);                              // slightly below hip
    expect(dy).toBeLessThan(DEFAULT_GEOMETRY.coxaLength * 0.5); // small, not full
    expect(Math.abs(dx)).toBeGreaterThan(dy);                   // horizontal-dominant
  });

  it('keeps the coxa tip exactly coxaLength from the hip', () => {
    const h = { x: 100, y: 80 };
    const coxa = computeCoxaEndpoint(h, 1, { x: 17.5, y: 30.3 }, DEFAULT_GEOMETRY);
    expect(Math.hypot(coxa.x - h.x, coxa.y - h.y)).toBeCloseTo(DEFAULT_GEOMETRY.coxaLength, 2);
  });

  it('degenerate restLocal (zero) extends in the facing direction with a small downward bias', () => {
    const h = { x: 100, y: 80 };
    const coxa = computeCoxaEndpoint(h, 1, { x: 0, y: 0 }, DEFAULT_GEOMETRY);
    const dx = coxa.x - h.x;
    const dy = coxa.y - h.y;
    expect(dx).toBeGreaterThan(0);              // facing (right) direction
    expect(dy).toBeGreaterThan(0);              // small downward bias
    expect(Math.abs(dx)).toBeGreaterThan(dy);   // horizontal-dominant
  });
});

// ---------------------------------------------------------------------------
// solveThreeSegmentLeg — anatomical pole points UPWARD (BUG 1)
// ---------------------------------------------------------------------------

describe('solveThreeSegmentLeg — knee bends UPWARD', () => {
  it('selects the knee ABOVE the coxa for a horizontal chord (steep rest leg)', () => {
    // Isolates the anatomical pole: a horizontal coxa->foot chord yields two
    // IK solutions directly above and below. The pole must select ABOVE so
    // knees arch up, not sag down. Uses a steep (60°) rest leg whose old pole
    // pointed downward. The target tracks the coxa so the chord stays
    // horizontal regardless of the coxa direction — this makes the test
    // depend ONLY on the pole fix.
    const bodyX = 100, bodyY = 100, facing = 1;
    const restLocal = { x: 17.5, y: 30.3 };
    const hp = computeHipPosition(bodyX, bodyY, facing, restLocal, DEFAULT_GEOMETRY);
    const coxa = computeCoxaEndpoint(hp, facing, restLocal, DEFAULT_GEOMETRY);
    const target = { x: coxa.x + 30, y: coxa.y };
    const r = solveThreeSegmentLeg(bodyX, bodyY, facing, restLocal, target, DEFAULT_GEOMETRY);
    expect(r.kneeY).toBeLessThan(r.coxaY);
  });

  it('keeps all three segment lengths exact for the horizontal-chord case', () => {
    const bodyX = 100, bodyY = 100, facing = 1;
    const restLocal = { x: 17.5, y: 30.3 };
    const hp = computeHipPosition(bodyX, bodyY, facing, restLocal, DEFAULT_GEOMETRY);
    const coxa = computeCoxaEndpoint(hp, facing, restLocal, DEFAULT_GEOMETRY);
    const r = solveThreeSegmentLeg(
      bodyX, bodyY, facing, restLocal, { x: coxa.x + 30, y: coxa.y }, DEFAULT_GEOMETRY,
    );
    const coxaLen = Math.hypot(r.coxaX - r.hipX, r.coxaY - r.hipY);
    const femurLen = Math.hypot(r.kneeX - r.coxaX, r.kneeY - r.coxaY);
    const tibiaLen = Math.hypot(r.footX - r.kneeX, r.footY - r.kneeY);
    expect(coxaLen).toBeCloseTo(DEFAULT_GEOMETRY.coxaLength, 1);
    expect(femurLen).toBeCloseTo(DEFAULT_GEOMETRY.femurLength, 1);
    expect(tibiaLen).toBeCloseTo(DEFAULT_GEOMETRY.tibiaLength, 1);
  });
});

// ---------------------------------------------------------------------------
// Default-spider body clearance — feet on the floor land in mid-extension
// (BUG 3 + BUG 4 feasibility)
// ---------------------------------------------------------------------------

describe('default-spider body clearance — feet on floor', () => {
  it('every default leg has coxa-to-foot distance within [softMin, softMax] and ratio [0.40, 0.72]', () => {
    const geometry = DEFAULT_SPIDER.geometry;
    const annuli = computeFemurTibiaAnnuli(geometry);
    const totalLen = geometry.femurLength + geometry.tibiaLength;
    const floorY = 100;
    // Mimic the benchmark: body sits 28px above the floor; with the neutral
    // bodyYOffset (0), cephY === bodyY so the gait and renderer agree.
    const bodyY = floorY - 30;
    const bodyX = 100;
    const facing: 1 | -1 = 1;
    const cephY = bodyY + DEFAULT_SPIDER.bodyYOffset;

    for (const lp of DEFAULT_SPIDER.legRestPositions) {
      const rad = (lp.angle * Math.PI) / 180;
      const restLocal = { x: Math.cos(rad) * lp.distance, y: Math.sin(rad) * lp.distance };
      const hp = computeHipPosition(bodyX, cephY, facing, restLocal, geometry);
      const coxa = computeCoxaEndpoint(hp, facing, restLocal, geometry);
      const foot = { x: bodyX + Math.cos(rad) * lp.distance * facing, y: floorY };
      const dist = Math.hypot(foot.x - coxa.x, foot.y - coxa.y);
      const ratio = dist / totalLen;
      expect(dist).toBeGreaterThanOrEqual(annuli.softMin - 1e-6);
      expect(dist).toBeLessThanOrEqual(annuli.softMax + 1e-6);
      expect(ratio).toBeGreaterThanOrEqual(0.40);
      expect(ratio).toBeLessThanOrEqual(0.72);
    }
  });

  it('keeps the body height controlled by the caller (bodyYOffset is neutral)', () => {
    // The renderer must not independently lift the body: with bodyYOffset at
    // 0, the gait and renderer share the same body height, so body clearance
    // is the caller's responsibility (set via `bodyY`). A non-zero offset
    // previously split the two, deadlocking the gait at 18px while the
    // renderer faked 28px.
    expect(DEFAULT_SPIDER.bodyYOffset).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Anatomical sector (no folded-Z): the tibia must advance outward, never
// reverse back toward the body.
// ---------------------------------------------------------------------------

/**
 * Anatomical advances for a solved leg, in the leg's facing-relative outward
 * frame. `distalAdvance < 0` is a folded-Z (tibia reversing toward the body).
 */
function legAdvances(
  restLocal: { x: number; y: number },
  facing: 1 | -1,
  result: { coxaX: number; coxaY: number; kneeX: number; kneeY: number; footX: number; footY: number },
) {
  const outward = Math.sign(restLocal.x * facing) || facing;
  return {
    outward,
    femurAdvance: (result.kneeX - result.coxaX) * outward,
    distalAdvance: (result.footX - result.kneeX) * outward,
    kneeUpward: result.kneeY <= Math.max(result.coxaY, result.footY) + 1e-6,
  };
}

describe('solveThreeSegmentLeg — anatomical sector (no folded-Z)', () => {
  const geometry = DEFAULT_SPIDER.geometry;
  const bodyY = -30; // 30px above a floor at y=0

  it('reproduced defect: the previously-folding pose no longer reverses the tibia', () => {
    // Historic case: default 2nd foreleg (angle 60, dist 35 in the OLD topology)
    // grounded at its rest world X produced knee→foot of -13px (folded). With
    // sector projection the tibia must advance outward (distalAdvance >= margin).
    const rad = (60 * Math.PI) / 180;
    const restLocal = { x: Math.cos(rad) * 35, y: Math.sin(rad) * 35 };
    const foot = { x: restLocal.x, y: 0 };
    const r = solveThreeSegmentLeg(0, bodyY, 1, restLocal, foot, geometry);
    const adv = legAdvances(restLocal, 1, r);
    expect(adv.distalAdvance).toBeGreaterThan(0);
    expect(adv.femurAdvance).toBeGreaterThanOrEqual(-1e-6);
    expect(adv.kneeUpward).toBe(true);
  });

  it('every default leg (both facings) has an outward tibia and upward knee', () => {
    for (const facing of [1, -1] as const) {
      for (const lp of DEFAULT_SPIDER.legRestPositions) {
        const rad = (lp.angle * Math.PI) / 180;
        const restLocal = { x: Math.cos(rad) * lp.distance, y: Math.sin(rad) * lp.distance };
        const foot = { x: restLocal.x * facing, y: 0 };
        const r = solveThreeSegmentLeg(0, bodyY, facing, restLocal, foot, geometry);
        const adv = legAdvances(restLocal, facing, r);
        const tibiaMargin = geometry.tibiaLength * geometry.minDistalAdvanceRatio;
        expect(adv.distalAdvance).toBeGreaterThanOrEqual(tibiaMargin - 1e-6);
        expect(adv.femurAdvance).toBeGreaterThanOrEqual(-1e-6);
        expect(adv.kneeUpward).toBe(true);
        // Fixed segment lengths preserved.
        expect(Math.hypot(r.kneeX - r.coxaX, r.kneeY - r.coxaY)).toBeCloseTo(geometry.femurLength, 3);
        expect(Math.hypot(r.footX - r.kneeX, r.footY - r.kneeY)).toBeCloseTo(geometry.tibiaLength, 3);
      }
    }
  });

  it('facing-left is an exact horizontal mirror of facing-right', () => {
    for (const lp of DEFAULT_SPIDER.legRestPositions) {
      const rad = (lp.angle * Math.PI) / 180;
      const restLocal = { x: Math.cos(rad) * lp.distance, y: Math.sin(rad) * lp.distance };
      const footR = { x: restLocal.x, y: 0 };
      const footL = { x: -restLocal.x, y: 0 };
      const rR = solveThreeSegmentLeg(0, bodyY, 1, restLocal, footR, geometry);
      const rL = solveThreeSegmentLeg(0, bodyY, -1, restLocal, footL, geometry);
      expect(rL.coxaX).toBeCloseTo(-rR.coxaX, 4);
      expect(rL.kneeX).toBeCloseTo(-rR.kneeX, 4);
      expect(rL.footX).toBeCloseTo(-rR.footX, 4);
      expect(rL.coxaY).toBeCloseTo(rR.coxaY, 4);
      expect(rL.kneeY).toBeCloseTo(rR.kneeY, 4);
      expect(rL.footY).toBeCloseTo(rR.footY, 4);
    }
  });

  it('unfolds an inward foot target (foot directly under the coxa)', () => {
    // The renderer no longer sector-projects in solveThreeSegmentLeg (radial
    // projection via projectTargetIntoWorkspace + selectKneeBranch only); the
    // foot X may therefore differ from the sector-projected value for an
    // inward target. selectKneeBranch still picks an outward knee when one
    // branch is valid, so assert exact femur/tibia lengths and an upward knee
    // rather than a sector-projected foot position.
    const restLocal = { x: 40, y: 20 };
    const r = solveThreeSegmentLeg(0, bodyY, 1, restLocal, { x: 0, y: 0 }, geometry);
    const adv = legAdvances(restLocal, 1, r);
    expect(Math.hypot(r.kneeX - r.coxaX, r.kneeY - r.coxaY)).toBeCloseTo(geometry.femurLength, 3);
    expect(Math.hypot(r.footX - r.kneeX, r.footY - r.kneeY)).toBeCloseTo(geometry.tibiaLength, 3);
    expect(adv.kneeUpward).toBe(true);
  });

  it('degenerate and non-finite targets stay finite', () => {
    for (const target of [{ x: 0, y: 0 }, { x: NaN, y: 10 }, { x: 1e9, y: -1e9 }]) {
      const r = solveThreeSegmentLeg(0, bodyY, 1, { x: 40, y: 20 }, target, geometry);
      for (const v of [r.hipX, r.hipY, r.coxaX, r.coxaY, r.kneeX, r.kneeY, r.footX, r.footY]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

describe('computeLegStepRequest — sector recovery', () => {
  const geometry = DEFAULT_SPIDER.geometry;

  it('flags a folded planted foot for replanting even at rest (no speed gate)', () => {
    // Foot resting directly below the body folds the tibia → sectorError > 0.
    const req = computeLegStepRequest(0, -28, 1, { x: 40, y: 20 }, { x: 0, y: 0 }, geometry, 10);
    expect(req.sectorError).toBeGreaterThan(0);
    expect(req.needsStep).toBe(true);
  });

  it('ranks a fold above a soft radial violation', () => {
    const folded = computeLegStepRequest(0, -28, 1, { x: 40, y: 20 }, { x: 0, y: 0 }, geometry, 10);
    // A soft-only violation: foot slightly beyond softMax straight out, no fold.
    const annuli = computeFemurTibiaAnnuli(geometry);
    const hip = computeHipPosition(0, -28, 1, { x: 40, y: 20 }, geometry);
    const coxa = computeCoxaEndpoint(hip, 1, { x: 40, y: 20 }, geometry);
    const softOnly = computeLegStepRequest(
      0, -28, 1, { x: 40, y: 20 },
      { x: coxa.x + (annuli.softMax + 0.5), y: coxa.y }, geometry, 100,
    );
    expect(folded.sectorError).toBeGreaterThan(0);
    expect(softOnly.sectorError).toBe(0);
    expect(folded.urgency).toBeGreaterThan(softOnly.urgency);
  });
});
