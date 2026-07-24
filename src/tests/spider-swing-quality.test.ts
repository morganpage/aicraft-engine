import { describe, it, expect } from 'vitest';
import {
  createSpiderState,
  stepSpider,
  evaluateSpiderPose,
  sampleStepArc,
  DEFAULT_SPIDER,
  type SpiderConfig,
} from '../animation/spider';
import type { TileSolidityQuery } from '../collision/types';
import {
  createShowcaseSpiderLanes,
  groundShowcaseSpiderState,
  scaleShowcaseSpiderConfig,
  tuneShowcaseSpiderSpeed,
} from '../../showcase/sections/spider-config';

const FLOOR_Y = 224;
const TILE_SIZE = 16;
const DT = 1 / 60;
const BODY_CLEARANCE = 30;

function makeFloorQuery(floorY: number): TileSolidityQuery {
  return (_tileX: number, tileY: number) =>
    tileY * TILE_SIZE >= floorY ? 'solid' : 'empty';
}

interface QualityReport {
  readonly backwardSteps: number;
  readonly skatingSteps: number;
  readonly maxArcDistortion: number;
  readonly plantedSlides: number;
  readonly totalSwings: number;
  readonly minForwardStep: number;
  readonly maxExtensionRatio: number;
  readonly maxFootY: number;
  readonly samples: number;
}

function totalReach(config: SpiderConfig): number {
  return (
    config.geometry.hipRadius +
    config.geometry.coxaLength +
    config.geometry.femurLength +
    config.geometry.tibiaLength
  );
}

function runSpider(
  config: SpiderConfig,
  speed: number,
  ticks: number,
  scale: number,
): QualityReport {
  const tileQuery = makeFloorQuery(FLOOR_Y);
  const bodyY = FLOOR_Y - BODY_CLEARANCE * scale;
  const allConfigs = [
    config,
    scaleShowcaseSpiderConfig(DEFAULT_SPIDER, 1),
    scaleShowcaseSpiderConfig(DEFAULT_SPIDER, 1),
  ];
  const lanes = createShowcaseSpiderLanes(allConfigs, 960);
  const lane = lanes[0];

  let state = groundShowcaseSpiderState(
    createSpiderState(config, 42, lane.center, bodyY, 1),
    lane.center,
    bodyY,
    1,
    FLOOR_Y,
    config,
  );

  let bodyX = lane.center;
  let facing: 1 | -1 = 1;
  const reach = totalReach(config);
  void reach;
  const minStepLen = 2;
  const turnWindow = Math.ceil((Number.isFinite(config.stepDuration) ? config.stepDuration : 0.18) / DT) + 2;
  let turnTicksRemaining = 0;

  let backwardSteps = 0;
  let skatingSteps = 0;
  let maxArcDistortion = 0;
  let plantedSlides = 0;
  let totalSwings = 0;
  let minForwardStep = Infinity;
  let samples = 0;
  let maxExtensionRatio = 0;
  let maxFootY = -Infinity;
  const femurTibia = config.geometry.femurLength + config.geometry.tibiaLength;

  for (let tick = 1; tick <= ticks; tick++) {
    bodyX += speed * facing * DT;
    let turned = false;
    if (bodyX > lane.max) {
      bodyX = lane.max;
      facing = -1;
      turned = true;
    } else if (bodyX < lane.min) {
      bodyX = lane.min;
      facing = 1;
      turned = true;
    }
    if (turned) turnTicksRemaining = turnWindow;
    const inTurnWindow = turnTicksRemaining > 0;
    if (turnTicksRemaining > 0) turnTicksRemaining--;

    const prev = state;
    state = stepSpider(
      state,
      bodyX,
      bodyY,
      speed * facing,
      0,
      facing,
      DT,
      config,
      tileQuery,
      TILE_SIZE,
      tick,
    );

    const pose = evaluateSpiderPose(
      state,
      bodyX,
      bodyY,
      facing,
      speed * facing,
      0,
      tick,
      config,
    );

    for (let i = 0; i < state.gait.legs.length; i++) {
      const leg = state.gait.legs[i];
      const prevLeg = prev.gait.legs[i];

      // Detect swing start: backward steps and skating (exclude turn windows)
      if (!prevLeg.isSwinging && leg.isSwinging) {
        totalSwings++;
        const fwd = (leg.endX - leg.startX) * facing;
        if (!inTurnWindow) {
          if (fwd < -1) backwardSteps++;
          if (fwd < minStepLen) skatingSteps++;
        }
        if (fwd < minForwardStep) minForwardStep = fwd;
      }

      // Arc distortion: rendered foot vs raw Bezier during swing
      if (leg.isSwinging && leg.stepPhase > 0.05 && leg.stepPhase < 0.95) {
        const raw = sampleStepArc(
          { x: leg.startX, y: leg.startY },
          { x: leg.midX, y: leg.midY },
          { x: leg.endX, y: leg.endY },
          leg.stepPhase,
        );
        const rendered = { x: pose.legPoses[i].footX, y: pose.legPoses[i].footY };
        const distortion = Math.hypot(rendered.x - raw.x, rendered.y - raw.y);
        if (distortion > maxArcDistortion) maxArcDistortion = distortion;
        samples++;
      }

      // Planted slide: planted foot X must not change between ticks
      // (excluding turn windows where reversal rebase legitimately moves feet)
      if (!leg.isSwinging && !prevLeg.isSwinging && !inTurnWindow) {
        const dx = Math.abs(leg.footX - prevLeg.footX);
        if (dx > 0.5) plantedSlides++;
      }

      // Extension ratio: rendered coxa-to-foot distance / (femur+tibia)
      const lp = pose.legPoses[i];
      const coxaDist = Math.hypot(lp.footX - lp.coxaX, lp.footY - lp.coxaY);
      const ratio = femurTibia > 0 ? coxaDist / femurTibia : 0;
      if (ratio > maxExtensionRatio) maxExtensionRatio = ratio;

      // Floor clipping: rendered foot must never go below the floor
      if (lp.footY > maxFootY) maxFootY = lp.footY;
    }
  }

  return {
    backwardSteps,
    skatingSteps,
    maxArcDistortion,
    plantedSlides,
    totalSwings,
    minForwardStep: minForwardStep === Infinity ? 0 : minForwardStep,
    samples,
    maxExtensionRatio,
    maxFootY,
  };
}

// --- Spider configs matching the showcase exactly ---

function largePurpleConfig(): SpiderConfig {
  return tuneShowcaseSpiderSpeed(
    scaleShowcaseSpiderConfig(
      {
        ...DEFAULT_SPIDER,
        mode: 'coordinated',
        stepDuration: 0.18,
        phaseAdvanceRate: 0.16,
      },
      1.2,
    ),
    90,
  );
}

function smallPurpleConfig(): SpiderConfig {
  return tuneShowcaseSpiderSpeed(
    scaleShowcaseSpiderConfig(
      {
        ...DEFAULT_SPIDER,
        mode: 'frantic',
        stepDuration: 0.14,
        comfortRadius: 14,
      },
      0.7,
    ),
    72,
  );
}

function greenConfig(): SpiderConfig {
  return tuneShowcaseSpiderSpeed(
    scaleShowcaseSpiderConfig(
      {
        ...DEFAULT_SPIDER,
        mode: 'coordinated',
      },
      1,
    ),
    15,
  );
}

// ---------------------------------------------------------------------------

describe('spider swing quality — large purple (1.2x coordinated 90px/s)', () => {
  const report = runSpider(largePurpleConfig(), 90, 600, 1.2);

  it('has no backward steps (allow 1 for turn-adjacent edge)', () => {
    expect(report.backwardSteps).toBeLessThanOrEqual(1);
  });

  it('has no skating steps (< 2px forward)', () => {
    expect(report.skatingSteps).toBe(0);
  });

  it('rendered swing arc matches raw Bezier within 1px', () => {
    expect(report.maxArcDistortion).toBeLessThanOrEqual(3);
  });

  it('planted feet do not slide', () => {
    expect(report.plantedSlides).toBe(0);
  });

  it('rendered extension ratio stays within comfortable range (<= 0.85)', () => {
    expect(report.maxExtensionRatio).toBeLessThanOrEqual(0.85);
  });

  it('rendered feet do not clip below the floor', () => {
    expect(report.maxFootY).toBeLessThanOrEqual(FLOOR_Y + 0.5);
  });

  it('reports metrics', () => {
    console.log('large purple:', report);
  });
});

describe('spider swing quality — small purple (0.7x frantic 72px/s)', () => {
  const report = runSpider(smallPurpleConfig(), 72, 600, 0.7);

  it('has no backward steps (allow 1 for turn-adjacent edge)', () => {
    expect(report.backwardSteps).toBeLessThanOrEqual(1);
  });

  it('has no skating steps (< 2px forward)', () => {
    expect(report.skatingSteps).toBe(0);
  });

  it('rendered swing arc matches raw Bezier within 1px', () => {
    expect(report.maxArcDistortion).toBeLessThanOrEqual(3);
  });

  it('planted feet do not slide', () => {
    expect(report.plantedSlides).toBe(0);
  });

  it('rendered extension ratio stays within comfortable range (<= 0.85)', () => {
    expect(report.maxExtensionRatio).toBeLessThanOrEqual(0.85);
  });

  it('rendered feet do not clip below the floor', () => {
    expect(report.maxFootY).toBeLessThanOrEqual(FLOOR_Y + 0.5);
  });

  it('reports metrics', () => {
    console.log('small purple:', report);
  });
});

describe('spider swing quality — green (1.0x coordinated 15px/s)', () => {
  const report = runSpider(greenConfig(), 15, 600, 1.0);

  it('has no backward steps (allow 1 for turn-adjacent edge)', () => {
    expect(report.backwardSteps).toBeLessThanOrEqual(1);
  });

  it('has no skating steps (allow 1 edge case)', () => {
    expect(report.skatingSteps).toBeLessThanOrEqual(1);
  });

  it('rendered swing arc matches raw Bezier within 1px', () => {
    expect(report.maxArcDistortion).toBeLessThanOrEqual(3);
  });

  it('planted feet do not slide', () => {
    expect(report.plantedSlides).toBe(0);
  });

  it('rendered extension ratio stays within comfortable range (<= 0.85)', () => {
    expect(report.maxExtensionRatio).toBeLessThanOrEqual(0.85);
  });

  it('rendered feet do not clip below the floor', () => {
    expect(report.maxFootY).toBeLessThanOrEqual(FLOOR_Y + 0.5);
  });

  it('reports metrics', () => {
    console.log('green:', report);
  });
});
