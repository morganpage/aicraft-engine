import { describe, it, expect } from 'vitest';
import {
  evaluateSpiderPose,
  drawSpider,
  type SpiderPose,
  type LegPose,
} from '../animation/spider/spider';
import {
  createSpiderState,
  stepSpider,
  type SpiderState,
} from '../animation/spider/spider-state';
import { sampleStepArc } from '../animation/spider/gait';
import { DEFAULT_SPIDER } from '../animation/spider/constants';
import type { TileSolidityQuery } from '../collision/types';
import { createMockCtx } from './_helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const floorQuery: TileSolidityQuery = (_tileX: number, tileY: number) =>
  tileY >= 7 ? 'solid' : 'empty';

function makeDefaultState(seed = 42, x = 100, y = 80): SpiderState {
  return createSpiderState(DEFAULT_SPIDER, seed, x, y);
}

function makeSteppedState(seed = 42, x = 100, y = 80, ticks = 60): SpiderState {
  let state = createSpiderState(DEFAULT_SPIDER, seed, x, y);
  const dt = 1 / 60;
  for (let t = 1; t <= ticks; t++) {
    state = stepSpider(state, x + 30 * t * dt, y, 30, 0, 1, dt, DEFAULT_SPIDER, floorQuery, 16, t);
  }
  return state;
}

function makeNormalPose(): SpiderPose {
  const state = makeSteppedState();
  const bodyX = 100 + 30 * 60 * (1 / 60);
  return evaluateSpiderPose(state, bodyX, 80, 1, 30, 0, 60, DEFAULT_SPIDER);
}

function makeEmptyPose(): SpiderPose {
  return {
    cephalothorax: { x: 0, y: 0, radius: 0 },
    abdomen: { x: 0, y: 0, rx: 0, ry: 0 },
    eyes: [],
    chelicerae: [],
    legPoses: [],
    palpChains: [],
    jitterOffsets: [],
  };
}

function makeNaNPose(): SpiderPose {
  return {
    cephalothorax: { x: NaN, y: NaN, radius: NaN },
    abdomen: { x: NaN, y: NaN, rx: NaN, ry: NaN },
    eyes: [{ x: NaN, y: NaN, radius: NaN }],
    chelicerae: [{ x: NaN, y: NaN, angle: NaN }],
    legPoses: [{
      hipX: NaN, hipY: NaN,
      coxaX: NaN, coxaY: NaN,
      kneeX: NaN, kneeY: NaN,
      footX: NaN, footY: NaN,
      isBg: false,
    }],
    palpChains: [[{ x: NaN, y: NaN }]],
    jitterOffsets: [NaN],
  };
}

// ---------------------------------------------------------------------------
// evaluateSpiderPose
// ---------------------------------------------------------------------------

describe('evaluateSpiderPose', () => {
  it('returns a pose with 8 legPoses (4 fg + 4 bg)', () => {
    const pose = makeNormalPose();
    expect(pose.legPoses).toHaveLength(8);
    const fg = pose.legPoses.filter((l: LegPose) => !l.isBg);
    const bg = pose.legPoses.filter((l: LegPose) => l.isBg);
    expect(fg).toHaveLength(4);
    expect(bg).toHaveLength(4);
  });

  it.each([
    [1, 1, 1],
    [2, 2, 2],
    [3, 3, 3],
    [4, 4, 4],
  ])('splits legCount=%i into %i foreground and %i background legs', (legCount, fgCount, bgCount) => {
    const config = { ...DEFAULT_SPIDER, legCount };
    const state = createSpiderState(config, 42, 100, 80);
    const pose = evaluateSpiderPose(state, 100, 80, 1, 0, 0, 0, config);

    expect(pose.legPoses.filter((leg) => !leg.isBg)).toHaveLength(fgCount);
    expect(pose.legPoses.filter((leg) => leg.isBg)).toHaveLength(bgCount);
  });

  it('returns a pose with 8 eyes', () => {
    const pose = makeNormalPose();
    expect(pose.eyes).toHaveLength(8);
  });

  it('returns 2 chelicerae', () => {
    const pose = makeNormalPose();
    expect(pose.chelicerae).toHaveLength(2);
  });

  it('returns 2 palp chains', () => {
    const pose = makeNormalPose();
    expect(pose.palpChains).toHaveLength(2);
  });

  it('returns jitter offsets matching jitterVertexCount', () => {
    const pose = makeNormalPose();
    expect(pose.jitterOffsets).toHaveLength(DEFAULT_SPIDER.jitterVertexCount);
  });

  it('is pure: same inputs produce deep-equal output', () => {
    const state = makeDefaultState();
    const args = [state, 100, 80, 1, 30, 0, 60, DEFAULT_SPIDER] as const;
    const pose1 = evaluateSpiderPose(...args);
    const pose2 = evaluateSpiderPose(...args);
    expect(pose1).toEqual(pose2);
  });

  it('does not mutate input state', () => {
    const state = makeDefaultState();
    const stateSnapshot = JSON.parse(JSON.stringify(state));
    evaluateSpiderPose(state, 100, 80, 1, 30, 0, 60, DEFAULT_SPIDER);
    expect(JSON.parse(JSON.stringify(state))).toEqual(stateSnapshot);
  });

  it('uses the gait step arc for swinging leg foot positions', () => {
    const state = makeDefaultState();
    // Arc placed forward of the body, in leg 0's outward sector, so the sample
    // is anatomically valid and the renderer passes it through unchanged.
    const swinging = {
      ...state.gait.legs[0],
      footX: 164,
      footY: 100,
      startX: 150,
      startY: 108,
      midX: 164,
      midY: 92,
      endX: 178,
      endY: 108,
      stepPhase: 0.5,
      isSwinging: true,
    };
    const spider: SpiderState = {
      ...state,
      gait: {
        ...state.gait,
        legs: [swinging, ...state.gait.legs.slice(1)],
      },
    };

    const pose = evaluateSpiderPose(spider, 100, 80, 1, 30, 0, 60, DEFAULT_SPIDER);
    const expected = sampleStepArc(
      { x: swinging.startX, y: swinging.startY },
      { x: swinging.midX, y: swinging.midY },
      { x: swinging.endX, y: swinging.endY },
      swinging.stepPhase,
    );

    expect(pose.legPoses[0].footX).toBeCloseTo(expected.x);
    expect(pose.legPoses[0].footY).toBeCloseTo(expected.y);
  });

  it('attaches corresponding background legs to the same fore-aft body side', () => {
    const state = makeDefaultState();
    const pose = evaluateSpiderPose(state, 100, 80, 1, 0, 0, 0, DEFAULT_SPIDER);

    expect(state.gait.legs[0].restLocalX).toBeGreaterThan(0);
    expect(state.gait.legs[4].restLocalX).toBeCloseTo(state.gait.legs[0].restLocalX);
    expect(pose.legPoses[0].hipX).toBeGreaterThan(pose.cephalothorax.x);
    expect(pose.legPoses[4].hipX).toBeCloseTo(pose.legPoses[0].hipX);
  });

  it('mirrors leg hips with body facing', () => {
    const facingRight = evaluateSpiderPose(
      createSpiderState(DEFAULT_SPIDER, 42, 100, 80, 1),
      100, 80, 1, 0, 0, 0, DEFAULT_SPIDER,
    );
    const facingLeft = evaluateSpiderPose(
      createSpiderState(DEFAULT_SPIDER, 42, 100, 80, -1),
      100, 80, -1, 0, 0, 0, DEFAULT_SPIDER,
    );

    for (let i = 0; i < facingRight.legPoses.length; i++) {
      expect(facingLeft.legPoses[i].hipX - 100).toBeCloseTo(
        -(facingRight.legPoses[i].hipX - 100),
      );
    }
  });

  it.each([
    [1, -1],
    [-1, 1],
  ] as const)('keeps the two-leg foreground foot trailing when facing %i', (facing, trailingSign) => {
    const config = { ...DEFAULT_SPIDER, legCount: 1 };
    const state = createSpiderState(config, 42, 100, 80, facing);
    const pose = evaluateSpiderPose(state, 100, 80, facing, 30 * facing, 0, 0, config);
    const foreground = pose.legPoses.find((leg) => !leg.isBg)!;

    expect(Math.sign(foreground.footX - pose.cephalothorax.x)).toBe(trailingSign);
    expect(Math.sign(foreground.hipX - pose.cephalothorax.x)).toBe(trailingSign);
  });

  it('keeps the abdomen connected at high movement speeds', () => {
    const state = makeDefaultState();
    const pose = evaluateSpiderPose(state, 100, 80, 1, 300, 0, 0, DEFAULT_SPIDER);

    expect(Math.abs(pose.abdomen.x - pose.cephalothorax.x)).toBeLessThanOrEqual(
      pose.cephalothorax.radius + pose.abdomen.rx,
    );
  });

  it('handles degenerate inputs without throwing', () => {
    const state = makeDefaultState();
    expect(() => evaluateSpiderPose(state, NaN, NaN, 1, NaN, NaN, NaN, DEFAULT_SPIDER)).not.toThrow();
    expect(() => evaluateSpiderPose(state, 0, 0, 1 as 1 | -1, 0, 0, 0, DEFAULT_SPIDER)).not.toThrow();
  });

  it('three-segment leg has all named joints finite', () => {
    const state = makeDefaultState();
    const pose = evaluateSpiderPose(state, 100, 80, 1, 0, 0, 0, DEFAULT_SPIDER);
    for (const leg of pose.legPoses) {
      expect(Number.isFinite(leg.hipX)).toBe(true);
      expect(Number.isFinite(leg.hipY)).toBe(true);
      expect(Number.isFinite(leg.coxaX)).toBe(true);
      expect(Number.isFinite(leg.coxaY)).toBe(true);
      expect(Number.isFinite(leg.kneeX)).toBe(true);
      expect(Number.isFinite(leg.kneeY)).toBe(true);
      expect(Number.isFinite(leg.footX)).toBe(true);
      expect(Number.isFinite(leg.footY)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// drawSpider
// ---------------------------------------------------------------------------

describe('drawSpider', () => {
  it('does not throw for a normal pose', () => {
    const ctx = createMockCtx();
    const pose = makeNormalPose();
    expect(() => drawSpider(ctx as never, pose, DEFAULT_SPIDER)).not.toThrow();
  });

  it('does not throw for an empty/degenerate pose', () => {
    const ctx = createMockCtx();
    const pose = makeEmptyPose();
    expect(() => drawSpider(ctx as never, pose, DEFAULT_SPIDER)).not.toThrow();
  });

  it('does not throw for a NaN-containing pose', () => {
    const ctx = createMockCtx();
    const pose = makeNaNPose();
    expect(() => drawSpider(ctx as never, pose, DEFAULT_SPIDER)).not.toThrow();
  });

  it('calls ctx.save and ctx.restore in balanced pairs', () => {
    const ctx = createMockCtx();
    const pose = makeNormalPose();
    drawSpider(ctx as never, pose, DEFAULT_SPIDER);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('restores ctx state (save/restore balanced)', () => {
    const ctx = createMockCtx();
    ctx.fillStyle = '#aaaaaa';
    ctx.strokeStyle = '#bbbbbb';
    ctx.lineWidth = 7;
    ctx.globalAlpha = 0.5;
    const pose = makeNormalPose();
    drawSpider(ctx as never, pose, DEFAULT_SPIDER);
    // After drawSpider, the save/restore should have balanced.
    // The mock doesn't implement real save/restore, but the call counts match.
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });
});
