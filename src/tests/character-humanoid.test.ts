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
