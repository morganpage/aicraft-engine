import { describe, expect, it } from 'vitest';
import {
  createSpiderState,
  DEFAULT_SPIDER,
  evaluateSpiderPose,
  getGaitFootPosition,
  stepSpider,
  computeLegStepRequest,
} from '../../src/animation/spider';
import {
  createShowcaseSpiderLanes,
  groundShowcaseSpiderState,
  scaleShowcaseSpiderConfig,
  spiderSilhouetteExtent,
  tuneShowcaseSpiderSpeed,
} from '../sections/spider-config';

describe('scaleShowcaseSpiderConfig', () => {
  it('scales leg rest distances by sizeScale (uniform physical scaling)', () => {
    const scaled = scaleShowcaseSpiderConfig(DEFAULT_SPIDER, 1.2);

    expect(scaled.cephRadius).toBe(DEFAULT_SPIDER.cephRadius * 1.2);
    expect(scaled.geometry.femurLength).toBe(DEFAULT_SPIDER.geometry.femurLength * 1.2);
    expect(scaled.legRestPositions[0].distance).toBeCloseTo(
      DEFAULT_SPIDER.legRestPositions[0].distance * 1.2,
      5,
    );
  });

  it('is identity on physical fields at scale 1.0 (DEFAULT_SPIDER is the coherent reference)', () => {
    const scaled = scaleShowcaseSpiderConfig(DEFAULT_SPIDER, 1);

    expect(scaled.comfortRadius).toBe(DEFAULT_SPIDER.comfortRadius);
    expect(scaled.stepHeight).toBe(DEFAULT_SPIDER.stepHeight);
    expect(scaled.cephRadius).toBe(DEFAULT_SPIDER.cephRadius);
    expect(scaled.abdOffsetX).toBe(DEFAULT_SPIDER.abdOffsetX);
    expect(scaled.bodyYOffset).toBe(DEFAULT_SPIDER.bodyYOffset);
    expect(scaled.geometry).toEqual(DEFAULT_SPIDER.geometry);
    expect(scaled.legRestPositions).toEqual(DEFAULT_SPIDER.legRestPositions);
  });

  it('keeps every physical normalized ratio identical to DEFAULT_SPIDER across 0.7/1/1.2', () => {
    const referenceReach =
      DEFAULT_SPIDER.geometry.hipRadius +
      DEFAULT_SPIDER.geometry.coxaLength +
      DEFAULT_SPIDER.geometry.femurLength +
      DEFAULT_SPIDER.geometry.tibiaLength;
    const refRest = DEFAULT_SPIDER.legRestPositions[0].distance / referenceReach;
    const refComfort = DEFAULT_SPIDER.comfortRadius / referenceReach;
    const refStep = DEFAULT_SPIDER.stepHeight / referenceReach;
    const refSafety = DEFAULT_SPIDER.geometry.jointSafetyMargin / referenceReach;
    const refClearance = 28 / referenceReach;

    for (const scale of [0.7, 1, 1.2]) {
      const scaled = scaleShowcaseSpiderConfig(DEFAULT_SPIDER, scale);
      const reach =
        scaled.geometry.hipRadius +
        scaled.geometry.coxaLength +
        scaled.geometry.femurLength +
        scaled.geometry.tibiaLength;
      expect(scaled.legRestPositions[0].distance / reach).toBeCloseTo(refRest, 5);
      expect(scaled.comfortRadius / reach).toBeCloseTo(refComfort, 5);
      expect(scaled.stepHeight / reach).toBeCloseTo(refStep, 5);
      expect(scaled.geometry.jointSafetyMargin / reach).toBeCloseTo(refSafety, 5);
      // Body clearance scales with the spider (caller uses 28 * sizeScale); the
      // normalized clearance must therefore be invariant.
      expect((28 * scale) / reach).toBeCloseTo(refClearance, 5);
    }
  });

  it('keeps rest reach and detail proportions identical at every showcase size', () => {
    const configs = [0.7, 1, 1.2].map((scale) =>
      scaleShowcaseSpiderConfig(DEFAULT_SPIDER, scale),
    );
    const reference = configs[2];
    const referenceReach =
      reference.geometry.hipRadius +
      reference.geometry.coxaLength +
      reference.geometry.femurLength +
      reference.geometry.tibiaLength;
    const referenceRestRatio = reference.legRestPositions[0].distance / referenceReach;
    const referenceEyeRatio = reference.eyeDefinitions[0].r / reference.cephRadius;
    const referenceStrokeRatio = reference.legOutlineWidth / reference.cephRadius;

    for (const config of configs) {
      const reach =
        config.geometry.hipRadius +
        config.geometry.coxaLength +
        config.geometry.femurLength +
        config.geometry.tibiaLength;
      expect(config.legRestPositions[0].distance / reach).toBeCloseTo(referenceRestRatio);
      expect(config.eyeDefinitions[0].r / config.cephRadius).toBeCloseTo(referenceEyeRatio);
      expect(config.legOutlineWidth / config.cephRadius).toBeCloseTo(referenceStrokeRatio);
      expect(Math.max(...config.legRestPositions.map((leg) => leg.distance))).toBeLessThan(reach);
    }
  });

  it('returns fresh nested arrays without mutating the base config', () => {
    const restSnapshot = DEFAULT_SPIDER.legRestPositions.map((leg) => ({ ...leg }));
    const eyeSnapshot = DEFAULT_SPIDER.eyeDefinitions.map((eye) => ({ ...eye }));
    const scaled = scaleShowcaseSpiderConfig(DEFAULT_SPIDER, 0.7);

    expect(scaled.legRestPositions).not.toBe(DEFAULT_SPIDER.legRestPositions);
    expect(scaled.eyeDefinitions).not.toBe(DEFAULT_SPIDER.eyeDefinitions);
    expect(DEFAULT_SPIDER.legRestPositions).toEqual(restSnapshot);
    expect(DEFAULT_SPIDER.eyeDefinitions).toEqual(eyeSnapshot);
  });

  it('scales gait cadence with reach and caps velocity overshoot', () => {
    const large = tuneShowcaseSpiderSpeed(scaleShowcaseSpiderConfig(DEFAULT_SPIDER, 1.2), 90);
    const small = tuneShowcaseSpiderSpeed(scaleShowcaseSpiderConfig(DEFAULT_SPIDER, 0.7), 126);
    const largeReach =
      large.geometry.hipRadius +
      large.geometry.coxaLength +
      large.geometry.femurLength +
      large.geometry.tibiaLength;
    const smallReach =
      small.geometry.hipRadius +
      small.geometry.coxaLength +
      small.geometry.femurLength +
      small.geometry.tibiaLength;

    expect(large.phaseAdvanceRate * largeReach).toBeCloseTo(
      small.phaseAdvanceRate * smallReach,
    );
    expect(large.overshootFactor * 90).toBeLessThanOrEqual(largeReach * 0.24);
    expect(small.overshootFactor * 126).toBeLessThanOrEqual(smallReach * 0.24);
    expect(large.stepDuration * 90).toBeLessThanOrEqual(largeReach * 0.16);
    const smallAtMaxSpeed = tuneShowcaseSpiderSpeed(
      scaleShowcaseSpiderConfig(DEFAULT_SPIDER, 0.7),
      216,
    );
    expect(smallAtMaxSpeed.stepDuration).toBeGreaterThanOrEqual(0.1);
    expect(smallAtMaxSpeed.stepDuration * 216).toBeLessThanOrEqual(smallReach * 0.65);
  });

  it('keeps a visible six-frame swing for the small spider', () => {
    const small = tuneShowcaseSpiderSpeed(
      scaleShowcaseSpiderConfig({ ...DEFAULT_SPIDER, stepDuration: 0.1 }, 0.7),
      72,
    );

    expect(small.stepDuration).toBeGreaterThanOrEqual(0.1);
  });

  it('keeps every foot within reach through the 0.7x reversal benchmark path', () => {
    const config = tuneShowcaseSpiderSpeed(scaleShowcaseSpiderConfig({
      ...DEFAULT_SPIDER,
      mode: 'frantic',
      stepDuration: 0.1,
      comfortRadius: 8,
    }, 0.7), 50);
    const floorY = 192;
    const bodyY = floorY - 28 * 0.7;
    const reach =
      config.geometry.hipRadius +
      config.geometry.coxaLength +
      config.geometry.femurLength +
      config.geometry.tibiaLength;
    const tileQuery = (_tileX: number, tileY: number) => tileY >= 12 ? 'solid' as const : 'empty' as const;
    let bodyX = 120;
    let state = createSpiderState(config, 101, bodyX, bodyY);

    for (let tick = 1; tick <= 64; tick++) {
      const reversed = tick > 60;
      const vx = reversed ? -50 : 50;
      bodyX += vx / 60;
      state = stepSpider(
        state, bodyX, bodyY, vx, 0, reversed ? -1 : 1, 1 / 60,
        config, tileQuery, 16, tick,
      );
    }

    for (const leg of state.gait.legs) {
      const foot = getGaitFootPosition(leg);
      // Gait foot targets legitimately overshoot the physical reach by a
      // bounded margin (they are unclamped by the IK solver); +30 matches
      // the core convention in spider-state.test.ts for the same property.
      expect(Math.hypot(foot.x - bodyX, foot.y - bodyY)).toBeLessThanOrEqual(reach + 30);
    }
  });

  it('creates exclusive body-safe lanes inside the 960px canvas', () => {
    const configs = [1.2, 0.7, 1, 1].map((scale) =>
      scaleShowcaseSpiderConfig(DEFAULT_SPIDER, scale),
    );
    const lanes = createShowcaseSpiderLanes(configs, 960, 24);

    expect(lanes).toHaveLength(4);
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i];
      expect(lane.extent).toBe(spiderSilhouetteExtent(configs[i]));
      expect(lane.min - lane.extent).toBeGreaterThanOrEqual(0);
      expect(lane.max + lane.extent).toBeLessThanOrEqual(960);
      if (i > 0) {
        const previous = lanes[i - 1];
        expect(lane.min - lane.extent - (previous.max + previous.extent)).toBeGreaterThanOrEqual(24);
      }
    }
  });

  it('gives every lane positive patrol travel (no spider is pinned in place)', () => {
    // Regression guard: the large fast spider (1.2x) must actually be able to
    // walk. A zero-width lane would clamp its body and flip facing every tick,
    // making it vibrate in place. Uses the real showcase configs (scaled +
    // speed-tuned) so the extent reflects the shipped leg proportions.
    const specs: readonly { scale: number; speed: number }[] = [
      { scale: 1.2, speed: 90 },
      { scale: 0.7, speed: 72 },
      { scale: 1, speed: 15 },
    ];
    const configs = specs.map((s) =>
      tuneShowcaseSpiderSpeed(scaleShowcaseSpiderConfig(DEFAULT_SPIDER, s.scale), s.speed),
    );
    const lanes = createShowcaseSpiderLanes(configs, 960);
    for (const lane of lanes) {
      expect(lane.max - lane.min).toBeGreaterThan(0);
    }
  });

  it('grounds a fresh state without mutating it', () => {
    const state = createSpiderState(DEFAULT_SPIDER, 42, 100, 90);
    const grounded = groundShowcaseSpiderState(state, 100, 90, 1, 112, DEFAULT_SPIDER);

    expect(grounded).not.toBe(state);
    expect(grounded.gait.legs.every((leg) => leg.footY === 112)).toBe(true);
    expect(state.gait.legs.some((leg) => leg.footY !== 112)).toBe(true);
  });
});

describe('groundShowcaseSpiderState — geometry-aware grounding', () => {
  it('places every foot exactly on the floor', () => {
    const floorY = 224;
    const bodyY = floorY - 28 * 1.2;
    const config = scaleShowcaseSpiderConfig(DEFAULT_SPIDER, 1.2);
    const raw = createSpiderState(config, 42, 480, bodyY, 1);
    const grounded = groundShowcaseSpiderState(raw, 480, bodyY, 1, floorY, config);

    for (const leg of grounded.gait.legs) {
      expect(leg.footY).toBe(floorY);
      expect(leg.startY).toBe(floorY);
      expect(leg.endY).toBe(floorY);
    }
  });

  it('produces gait feet that agree with rendered feet immediately after grounding', () => {
    const floorY = 224;
    const bodyY = floorY - 28 * 1.2;
    const config = scaleShowcaseSpiderConfig(DEFAULT_SPIDER, 1.2);
    const bodyX = 480;
    const grounded = groundShowcaseSpiderState(
      createSpiderState(config, 42, bodyX, bodyY, 1),
      bodyX,
      bodyY,
      1,
      floorY,
      config,
    );
    const pose = evaluateSpiderPose(grounded, bodyX, bodyY, 1, 0, 0, 0, config);

    for (let i = 0; i < grounded.gait.legs.length; i++) {
      const gaitFoot = getGaitFootPosition(grounded.gait.legs[i]);
      const renderFoot = { x: pose.legPoses[i].footX, y: pose.legPoses[i].footY };
      const correction = Math.hypot(
        gaitFoot.x - renderFoot.x,
        gaitFoot.y - renderFoot.y,
      );
      expect(correction).toBeLessThan(0.5);
    }
  });

  it('requires no workspace or sector recovery immediately after grounding', () => {
    const floorY = 224;
    const bodyY = floorY - 28 * 1.2;
    const config = scaleShowcaseSpiderConfig(DEFAULT_SPIDER, 1.2);
    const bodyX = 480;
    const grounded = groundShowcaseSpiderState(
      createSpiderState(config, 42, bodyX, bodyY, 1),
      bodyX,
      bodyY,
      1,
      floorY,
      config,
    );

    for (const leg of grounded.gait.legs) {
      const req = computeLegStepRequest(
        bodyX,
        bodyY,
        1,
        { x: leg.restLocalX, y: leg.restLocalY },
        { x: leg.footX, y: leg.footY },
        config.geometry,
        config.comfortRadius,
      );
      expect(req.needsStep).toBe(false);
    }
  });

  it('retains authored same-side ordinal foot ordering after grounding', () => {
    const floorY = 224;
    const bodyY = floorY - 28 * 1.2;
    const config = scaleShowcaseSpiderConfig(DEFAULT_SPIDER, 1.2);
    const bodyX = 480;
    const grounded = groundShowcaseSpiderState(
      createSpiderState(config, 42, bodyX, bodyY, 1),
      bodyX,
      bodyY,
      1,
      floorY,
      config,
    );
    const sideCount = grounded.gait.legs.length / 2;
    const reach =
      config.geometry.hipRadius +
      config.geometry.coxaLength +
      config.geometry.femurLength +
      config.geometry.tibiaLength;

    for (const sideStart of [0, sideCount]) {
      const footXs: number[] = [];
      for (let i = 0; i < sideCount; i++) {
        footXs.push(grounded.gait.legs[sideStart + i].footX);
      }
      // Authored order is monotonic (front-to-rear). Grounding must not invert it.
      let direction: 'asc' | 'desc' | 'flat' = 'flat';
      for (let i = 1; i < footXs.length; i++) {
        const diff = footXs[i] - footXs[i - 1];
        if (Math.abs(diff) > 1e-6) {
          direction = diff > 0 ? 'asc' : 'desc';
          break;
        }
      }
      for (let i = 1; i < footXs.length; i++) {
        const diff = footXs[i] - footXs[i - 1];
        if (direction === 'asc') expect(diff).toBeGreaterThanOrEqual(-1e-6);
        else if (direction === 'desc') expect(diff).toBeLessThanOrEqual(1e-6);
        // Adjacent same-side feet must stay separated (fan, not bundle).
        expect(Math.abs(diff)).toBeGreaterThanOrEqual(reach * 0.1);
      }
    }
  });

  it('grounds symmetrically under facing reversal', () => {
    const floorY = 224;
    const bodyY = floorY - 28 * 1.2;
    const config = scaleShowcaseSpiderConfig(DEFAULT_SPIDER, 1.2);
    const bodyX = 480;
    const right = groundShowcaseSpiderState(
      createSpiderState(config, 42, bodyX, bodyY, 1),
      bodyX,
      bodyY,
      1,
      floorY,
      config,
    );
    const left = groundShowcaseSpiderState(
      createSpiderState(config, 42, bodyX, bodyY, -1),
      bodyX,
      bodyY,
      -1,
      floorY,
      config,
    );

    for (let i = 0; i < right.gait.legs.length; i++) {
      const dr = right.gait.legs[i].footX - bodyX;
      const dl = left.gait.legs[i].footX - bodyX;
      expect(dr).toBeCloseTo(-dl, 4);
      expect(right.gait.legs[i].footY).toBe(left.gait.legs[i].footY);
    }
  });
});
