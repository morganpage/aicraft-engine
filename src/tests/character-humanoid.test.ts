import { describe, expect, expectTypeOf, it } from 'vitest';
import type { BodyPlanHandler } from '../character/types';
import {
  createBodyPlanRegistry,
  humanoidBodyPlan,
} from '../character/registry';
import {
  DEFAULT_HUMANOID,
  deriveHumanoidConfig,
} from '../character/humanoid/config';
import { evaluateHumanoidLowerBodyPose } from '../character/humanoid/draw';
import {
  advanceHumanoidVisual,
  createHumanoidVisualState,
} from '../character/humanoid/state';
import type {
  HumanoidConfig,
  HumanoidMotionSample,
  HumanoidVisualState,
} from '../character/humanoid/types';

function motion(
  overrides: Partial<HumanoidMotionSample> = {},
): HumanoidMotionSample {
  return {
    dx: 0,
    facing: 1,
    supported: true,
    gravityDirection: 1,
    verticalVelocity: 0,
    justLaunched: false,
    justLanded: false,
    hitCeiling: false,
    ...overrides,
  };
}

function distance(
  a: Readonly<{ x: number; y: number }>,
  b: Readonly<{ x: number; y: number }>,
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function orientation(
  a: Readonly<{ x: number; y: number }>,
  b: Readonly<{ x: number; y: number }>,
  c: Readonly<{ x: number; y: number }>,
): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(
  a: Readonly<{ x: number; y: number }>,
  b: Readonly<{ x: number; y: number }>,
  c: Readonly<{ x: number; y: number }>,
  d: Readonly<{ x: number; y: number }>,
): boolean {
  return orientation(a, b, c) * orientation(a, b, d) < 0
    && orientation(c, d, a) * orientation(c, d, b) < 0;
}

describe('production humanoid', () => {
  it('derives deterministic bounded variation', () => {
    expect(deriveHumanoidConfig(42)).toEqual(deriveHumanoidConfig(42));
    expect(deriveHumanoidConfig(43)).not.toEqual(deriveHumanoidConfig(42));
    expect(DEFAULT_HUMANOID.seed).toBe(0x48554d41);
  });

  it('keeps config and physics authority out of visual state', () => {
    const config = deriveHumanoidConfig(1);
    const state = createHumanoidVisualState(config);
    expect(state).not.toHaveProperty('config');
    expect(state).not.toHaveProperty('x');
    expect(state).not.toHaveProperty('y');
    expect(state).not.toHaveProperty('vy');
  });

  it('starts in a grounded, uncrossed, anatomically sided idle stance', () => {
    const config = deriveHumanoidConfig(1);
    const pose = evaluateHumanoidLowerBodyPose(
      config,
      createHumanoidVisualState(config),
    );
    const points = [
      pose.leftLeg.hip,
      pose.leftLeg.knee,
      pose.leftLeg.foot,
      pose.rightLeg.hip,
      pose.rightLeg.knee,
      pose.rightLeg.foot,
    ];

    expect(points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(pose.leftLeg.foot.x).toBeLessThan(0);
    expect(pose.rightLeg.foot.x).toBeGreaterThan(0);
    expect(pose.leftLeg.knee.x).toBeLessThan(0);
    expect(pose.rightLeg.knee.x).toBeGreaterThan(0);
    expect(pose.leftLeg.knee.x).toBeLessThan(pose.rightLeg.knee.x);
    expect(pose.leftLeg.foot.x).toBeLessThan(pose.rightLeg.foot.x);
    expect(pose.leftLeg.foot.y).toBeCloseTo(0);
    expect(pose.rightLeg.foot.y).toBeCloseTo(0);
    expect(pose.torsoTop).toBeLessThan(pose.torsoBottom);
    expect(pose.torsoBottom).toBeLessThan(pose.leftLeg.foot.y);
    expect(Math.abs(pose.leftLeg.knee.x - pose.leftLeg.hip.x)).toBeLessThan(2.5);
    expect(Math.abs(pose.rightLeg.knee.x - pose.rightLeg.hip.x)).toBeLessThan(2.5);
    expect(distance(pose.leftLeg.hip, pose.leftLeg.knee)).toBeCloseTo(config.thighLength);
    expect(distance(pose.leftLeg.knee, pose.leftLeg.foot)).toBeCloseTo(config.shinLength);
    expect(distance(pose.rightLeg.hip, pose.rightLeg.knee)).toBeCloseTo(config.thighLength);
    expect(distance(pose.rightLeg.knee, pose.rightLeg.foot)).toBeCloseTo(config.shinLength);
    expect(
      segmentsCross(
        pose.leftLeg.hip,
        pose.leftLeg.knee,
        pose.rightLeg.hip,
        pose.rightLeg.knee,
      ),
    ).toBe(false);
    expect(
      segmentsCross(
        pose.leftLeg.knee,
        pose.leftLeg.foot,
        pose.rightLeg.knee,
        pose.rightLeg.foot,
      ),
    ).toBe(false);
  });

  it('blends out of and back into the neutral stance', () => {
    const config = deriveHumanoidConfig(2);
    const initial = createHumanoidVisualState(config);
    const walking = advanceHumanoidVisual(
      config,
      initial,
      motion({ dx: 4 }),
      1 / 60,
    );
    const resting = advanceHumanoidVisual(
      config,
      walking,
      motion(),
      1 / 60,
    );

    expect(initial.idleBlend).toBe(1);
    expect(walking.idleBlend).toBeLessThan(initial.idleBlend);
    expect(resting.idleBlend).toBeGreaterThan(walking.idleBlend);
  });

  it('advances in facing-local displacement and freezes while unsupported', () => {
    const config = deriveHumanoidConfig(2);
    const initial = createHumanoidVisualState(config);
    const walked = advanceHumanoidVisual(
      config,
      initial,
      motion({ dx: -4, facing: -1 }),
      1 / 60,
    );
    expect(walked.locomotion.phase).toBeGreaterThan(0);
    const airborne = advanceHumanoidVisual(
      config,
      walked,
      motion({ dx: 10, supported: false }),
      1 / 60,
    );
    expect(airborne.locomotion.phase).toBe(walked.locomotion.phase);
    expect(initial.locomotion.phase).toBe(0);
  });

  it('classifies signed-gravity ascent and descent', () => {
    const config = deriveHumanoidConfig(3);
    const state = createHumanoidVisualState(config);
    expect(
      advanceHumanoidVisual(
        config,
        state,
        motion({ supported: false, gravityDirection: -1, verticalVelocity: 10 }),
        1 / 60,
      ).airPose,
    ).toBe('ascent');
    expect(
      advanceHumanoidVisual(
        config,
        state,
        motion({ supported: false, gravityDirection: -1, verticalVelocity: -10 }),
        1 / 60,
      ).airPose,
    ).toBe('descent');
  });

  it('copies arm targets and never mutates inputs', () => {
    const config = deriveHumanoidConfig(4);
    const state = createHumanoidVisualState(config);
    const sample = motion({ armTarget: { x: 20, y: 30 } });
    const configSnapshot = structuredClone(config);
    const stateSnapshot = structuredClone(state);
    const sampleSnapshot = structuredClone(sample);
    const next = advanceHumanoidVisual(config, state, sample, 1 / 60);
    expect(next.armTarget).toEqual(sample.armTarget);
    expect(next.armTarget).not.toBe(sample.armTarget);
    expect(config).toEqual(configSnapshot);
    expect(state).toEqual(stateSnapshot);
    expect(sample).toEqual(sampleSnapshot);
  });

  it('preserves typed built-in and custom registry handlers', () => {
    const registry = createBodyPlanRegistry();
    expect(registry.get('humanoid')).toBe(humanoidBodyPlan);
    expectTypeOf(registry.get('humanoid')).toMatchTypeOf<
      BodyPlanHandler<HumanoidConfig, HumanoidVisualState, HumanoidMotionSample>
    >();
    const custom = {
      custom: {
        deriveConfig: (seed: number) => ({ seed }),
        createVisualState: () => ({ phase: 0 }),
        advanceVisual: (
          _config: { readonly seed: number },
          state: { readonly phase: number },
          value: { readonly step: number },
        ) => ({ phase: state.phase + value.step }),
        draw: () => undefined,
      },
    };
    const customRegistry = createBodyPlanRegistry(custom);
    expect(customRegistry.get('custom')).toBe(custom.custom);
    expect(customRegistry.get('missing')).toBeUndefined();
    expectTypeOf(customRegistry.get('custom')).toEqualTypeOf(custom.custom);
  });
});
