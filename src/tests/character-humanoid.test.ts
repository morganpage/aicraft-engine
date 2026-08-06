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
import { composePose } from '../character/humanoid/pose';
import type { PoseComposition } from '../character/humanoid/pose';
import {
  advanceHumanoidVisual,
  createHumanoidVisualState,
} from '../character/humanoid/state';
import type {
  HumanoidConfig,
  HumanoidMotionSample,
  HumanoidVisualState,
} from '../character/humanoid/types';
import type { Vec2 } from '../animation/types';

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

function collectLandmarks(pose: PoseComposition): readonly Readonly<Vec2>[] {
  return [
    pose.head.centre, pose.head.crown, pose.head.eye,
    pose.torso.topCentre, pose.torso.bottomCentre,
    pose.torso.topNear, pose.torso.topFar,
    pose.torso.bottomNear, pose.torso.bottomFar,
    pose.farLeg.root, pose.farLeg.joint, pose.farLeg.end,
    pose.farArm.root, pose.farArm.joint, pose.farArm.end,
    pose.nearLeg.root, pose.nearLeg.joint, pose.nearLeg.end,
    pose.nearArm.root, pose.nearArm.joint, pose.nearArm.end,
  ];
}

function assertAllFinite(pose: PoseComposition): void {
  for (const point of collectLandmarks(pose)) {
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  }
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
    const pose = composePose(
      createHumanoidVisualState(config),
      config,
    );
    assertAllFinite(pose);

    expect(pose.farLeg.end.x).toBeLessThan(0);
    expect(pose.nearLeg.end.x).toBeGreaterThan(0);
    expect(pose.farLeg.joint.x).toBeLessThan(0);
    expect(pose.nearLeg.joint.x).toBeGreaterThan(0);
    expect(pose.farLeg.joint.x).toBeLessThan(pose.nearLeg.joint.x);
    expect(pose.farLeg.end.x).toBeLessThan(pose.nearLeg.end.x);
    expect(pose.farLeg.end.y).toBeCloseTo(0);
    expect(pose.nearLeg.end.y).toBeCloseTo(0);
    expect(pose.torso.topCentre.y).toBeLessThan(pose.torso.bottomCentre.y);
    expect(pose.torso.bottomCentre.y).toBeLessThan(pose.farLeg.end.y);
    expect(
      Math.abs(pose.farLeg.joint.x - pose.farLeg.root.x),
    ).toBeLessThan(2.5);
    expect(
      Math.abs(pose.nearLeg.joint.x - pose.nearLeg.root.x),
    ).toBeLessThan(2.5);
    expect(distance(pose.farLeg.root, pose.farLeg.joint)).toBeCloseTo(
      config.thighLength,
    );
    expect(distance(pose.farLeg.joint, pose.farLeg.end)).toBeCloseTo(
      config.shinLength,
    );
    expect(distance(pose.nearLeg.root, pose.nearLeg.joint)).toBeCloseTo(
      config.thighLength,
    );
    expect(distance(pose.nearLeg.joint, pose.nearLeg.end)).toBeCloseTo(
      config.shinLength,
    );
    expect(
      segmentsCross(
        pose.farLeg.root,
        pose.farLeg.joint,
        pose.nearLeg.root,
        pose.nearLeg.joint,
      ),
    ).toBe(false);
    expect(
      segmentsCross(
        pose.farLeg.joint,
        pose.farLeg.end,
        pose.nearLeg.joint,
        pose.nearLeg.end,
      ),
    ).toBe(false);
  });

  it('hangs neutral arms beside the torso with a slight valid bend', () => {
    const config = deriveHumanoidConfig(1);
    const pose = composePose(createHumanoidVisualState(config), config);
    assertAllFinite(pose);

    expect(pose.farArm.joint.x).toBeLessThan(0);
    expect(pose.farArm.end.x).toBeLessThan(0);
    expect(pose.nearArm.joint.x).toBeGreaterThan(0);
    expect(pose.nearArm.end.x).toBeGreaterThan(0);
    expect(pose.farArm.end.y).toBeGreaterThan(pose.torso.bottomCentre.y);
    expect(pose.nearArm.end.y).toBeGreaterThan(pose.torso.bottomCentre.y);
    expect(distance(pose.farArm.root, pose.farArm.joint)).toBeCloseTo(
      config.upperArmLength,
    );
    expect(distance(pose.farArm.joint, pose.farArm.end)).toBeCloseTo(
      config.lowerArmLength,
    );
    expect(distance(pose.nearArm.root, pose.nearArm.joint)).toBeCloseTo(
      config.upperArmLength,
    );
    expect(distance(pose.nearArm.joint, pose.nearArm.end)).toBeCloseTo(
      config.lowerArmLength,
    );
    expect(distance(pose.farArm.root, pose.farArm.end)).toBeGreaterThan(
      (config.upperArmLength + config.lowerArmLength) * 0.9,
    );
    expect(distance(pose.nearArm.root, pose.nearArm.end)).toBeGreaterThan(
      (config.upperArmLength + config.lowerArmLength) * 0.9,
    );
    expect(
      segmentsCross(
        pose.farArm.root,
        pose.farArm.end,
        pose.nearArm.root,
        pose.nearArm.end,
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

describe('humanoid neutral idle pose geometry (Phase H2)', () => {
  const SEEDS = [
    0, 1, 2, 3, 7, 17, 42, 99, 101, 256, 511, 777, 1000, 1234, 4321, 0x48554d41,
  ];

  function idlePose(seed: number): PoseComposition {
    const config = deriveHumanoidConfig(seed);
    return composePose(createHumanoidVisualState(config), config);
  }

  it('emits only finite landmarks across a seed sweep', () => {
    for (const seed of SEEDS) {
      const pose = idlePose(seed);
      for (const point of collectLandmarks(pose)) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
      }
      for (const value of Object.values(pose.blendWeights)) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it('preserves configured limb lengths through the IK solver', () => {
    for (const seed of SEEDS) {
      const config = deriveHumanoidConfig(seed);
      const pose = idlePose(seed);
      expect(distance(pose.farLeg.root, pose.farLeg.joint)).toBeCloseTo(
        config.thighLength,
      );
      expect(distance(pose.farLeg.joint, pose.farLeg.end)).toBeCloseTo(
        config.shinLength,
      );
      expect(distance(pose.nearLeg.root, pose.nearLeg.joint)).toBeCloseTo(
        config.thighLength,
      );
      expect(distance(pose.nearLeg.joint, pose.nearLeg.end)).toBeCloseTo(
        config.shinLength,
      );
      expect(distance(pose.farArm.root, pose.farArm.joint)).toBeCloseTo(
        config.upperArmLength,
      );
      expect(distance(pose.farArm.joint, pose.farArm.end)).toBeCloseTo(
        config.lowerArmLength,
      );
      expect(distance(pose.nearArm.root, pose.nearArm.joint)).toBeCloseTo(
        config.upperArmLength,
      );
      expect(distance(pose.nearArm.joint, pose.nearArm.end)).toBeCloseTo(
        config.lowerArmLength,
      );
    }
  });

  it('keeps idle feet grounded, ordered, and non-crossing', () => {
    for (const seed of SEEDS) {
      const pose = idlePose(seed);
      expect(pose.nearLeg.end.x).toBeGreaterThan(pose.farLeg.end.x);
      expect(pose.nearLeg.end.y).toBeCloseTo(0, 1);
      expect(pose.farLeg.end.y).toBeCloseTo(0, 1);
      expect(
        segmentsCross(
          pose.farLeg.root,
          pose.farLeg.joint,
          pose.nearLeg.root,
          pose.nearLeg.joint,
        ),
      ).toBe(false);
      expect(
        segmentsCross(
          pose.farLeg.joint,
          pose.farLeg.end,
          pose.nearLeg.joint,
          pose.nearLeg.end,
        ),
      ).toBe(false);
    }
  });

  it('keeps each idle knee on its own anatomical side', () => {
    for (const seed of SEEDS) {
      const pose = idlePose(seed);
      expect(pose.nearLeg.joint.x).toBeGreaterThan(0);
      expect(pose.farLeg.joint.x).toBeLessThan(0);
    }
  });

  it('places the centre of mass between the idle support contacts', () => {
    for (const seed of SEEDS) {
      const pose = idlePose(seed);
      const left = Math.min(pose.farLeg.end.x, pose.nearLeg.end.x);
      const right = Math.max(pose.farLeg.end.x, pose.nearLeg.end.x);
      expect(pose.torso.bottomCentre.x).toBeGreaterThan(left);
      expect(pose.torso.bottomCentre.x).toBeLessThan(right);
    }
  });

  it('hangs idle hands below the pelvis, above the knees, outside the centreline', () => {
    for (const seed of SEEDS) {
      const pose = idlePose(seed);
      const pelvisY = pose.torso.bottomCentre.y;
      const kneeY = Math.min(pose.farLeg.joint.y, pose.nearLeg.joint.y);
      for (const hand of [pose.farArm.end, pose.nearArm.end]) {
        expect(hand.y).toBeGreaterThan(pelvisY);
        expect(hand.y).toBeLessThan(kneeY);
      }
      expect(pose.farArm.end.x).toBeLessThan(0);
      expect(pose.nearArm.end.x).toBeGreaterThan(0);
      expect(pose.farArm.joint.x).toBeLessThan(0);
      expect(pose.nearArm.joint.x).toBeGreaterThan(0);
    }
  });

  it('keeps near and far limbs distinguishable via small vertical and horizontal offsets', () => {
    for (const seed of SEEDS) {
      const pose = idlePose(seed);
      expect(pose.nearLeg.end.x).not.toBeCloseTo(pose.farLeg.end.x, 0);
      expect(pose.nearLeg.joint.y).not.toBeCloseTo(pose.farLeg.joint.y, 1);
      expect(pose.nearArm.end.x).not.toBeCloseTo(pose.farArm.end.x, 0);
      expect(pose.nearArm.joint.y).not.toBeCloseTo(pose.farArm.joint.y, 1);
      expect(pose.torso.topNear.x).not.toBeCloseTo(-pose.torso.topFar.x, 1);
    }
  });

  it('keeps the canonical pose independent of facing (mirroring is render-time only)', () => {
    const config = deriveHumanoidConfig(42);
    const rightFacing: HumanoidVisualState = {
      ...createHumanoidVisualState(config),
      facing: 1,
    };
    const leftFacing: HumanoidVisualState = {
      ...createHumanoidVisualState(config),
      facing: -1,
    };
    expect(composePose(rightFacing, config)).toEqual(composePose(leftFacing, config));
  });

  it('reports idle gait phase and grounded air pose at rest', () => {
    const pose = idlePose(1);
    expect(pose.gaitPhase).toBe('idle');
    expect(pose.airPose).toBe('grounded');
    expect(pose.blendWeights.idle).toBe(1);
  });

  it('derives a named gait phase after walking (H3 geometry pending)', () => {
    const config = deriveHumanoidConfig(2);
    let state = createHumanoidVisualState(config);
    for (let i = 0; i < 200; i += 1) {
      state = advanceHumanoidVisual(config, state, motion({ dx: 4 }), 1 / 60);
    }
    const pose = composePose(state, config);
    expect(pose.gaitPhase).not.toBe('idle');
    expect([
      'contact',
      'recoil',
      'passing',
      'highPoint',
      'oppositeContact',
    ]).toContain(pose.gaitPhase);
  });

  it('never produces non-finite geometry for defensive inputs', () => {
    const config = deriveHumanoidConfig(7);
    const cleanState = createHumanoidVisualState(config);

    const nonFiniteState: HumanoidVisualState = {
      locomotion: { phase: Number.NaN },
      facing: 1,
      idleBlend: Number.NaN,
      airPose: 'ascent',
      launchBlend: Number.POSITIVE_INFINITY,
      landingBlend: Number.POSITIVE_INFINITY,
      ceilingBlend: Number.NEGATIVE_INFINITY,
      armTarget: null,
    };

    assertAllFinite(composePose(nonFiniteState, config));
    assertAllFinite(composePose(cleanState, config, { x: 1e9, y: 1e9 }));
    assertAllFinite(composePose(cleanState, config, { x: Number.NaN, y: 5 }));
    assertAllFinite(
      composePose(cleanState, config, { x: Number.POSITIVE_INFINITY, y: 0 }),
    );
  });
});
