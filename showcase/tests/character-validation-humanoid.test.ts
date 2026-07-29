import { describe, expect, it } from 'vitest';
import {
  deriveHumanoidConfig,
} from '../_prototype/character-enemy-validation/humanoid-config';
import {
  advanceHumanoidVisual,
  createHumanoidVisualState,
  type HumanoidMotionSample,
} from '../_prototype/character-enemy-validation/humanoid-state';

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

describe('humanoid validation prototype', () => {
  it('derives deterministic controlled seed variation', () => {
    const first = deriveHumanoidConfig(42);
    expect(deriveHumanoidConfig(42)).toEqual(first);
    expect(deriveHumanoidConfig(43)).not.toEqual(first);
    expect(first.torsoWidth).toBeGreaterThanOrEqual(7.2);
    expect(first.torsoWidth).toBeLessThan(9.2);
  });

  it('keeps static configuration out of visual state', () => {
    const config = deriveHumanoidConfig(1);
    const state = createHumanoidVisualState(config);
    expect(state).not.toHaveProperty('config');
    expect(state).not.toHaveProperty('x');
    expect(state).not.toHaveProperty('y');
    expect(state).not.toHaveProperty('vy');
    expect(config).toEqual(deriveHumanoidConfig(1));
  });

  it('advances leftward walking in local space and freezes at rest or in air', () => {
    const config = deriveHumanoidConfig(2);
    const initial = createHumanoidVisualState(config);
    const walked = advanceHumanoidVisual(
      config,
      initial,
      motion({ dx: -4, facing: -1 }),
      1 / 60,
    );
    expect(walked.locomotion.phase).toBeGreaterThan(0);
    expect(initial.locomotion.phase).toBe(0);

    const stopped = advanceHumanoidVisual(
      config,
      walked,
      motion({ dx: 0, facing: -1 }),
      1 / 60,
    );
    expect(stopped.locomotion.phase).toBe(walked.locomotion.phase);

    const airborne = advanceHumanoidVisual(
      config,
      stopped,
      motion({ dx: 8, facing: 1, supported: false }),
      1 / 60,
    );
    expect(airborne.locomotion.phase).toBe(stopped.locomotion.phase);
  });

  it('classifies ascent and descent relative to signed gravity', () => {
    const config = deriveHumanoidConfig(3);
    const state = createHumanoidVisualState(config);
    expect(
      advanceHumanoidVisual(
        config,
        state,
        motion({ supported: false, gravityDirection: 1, verticalVelocity: -10 }),
        1 / 60,
      ).airPose,
    ).toBe('ascent');
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

  it('copies optional arm targets without affecting locomotion', () => {
    const config = deriveHumanoidConfig(4);
    const state = createHumanoidVisualState(config);
    const target = { x: 100, y: 50 };
    const next = advanceHumanoidVisual(
      config,
      state,
      motion({ armTarget: target }),
      1 / 60,
    );
    expect(next.armTarget).toEqual(target);
    expect(next.armTarget).not.toBe(target);
    expect(next.locomotion).toEqual(state.locomotion);
  });

  it('uses launch/landing/ceiling pulses for pose only', () => {
    const config = deriveHumanoidConfig(5);
    const state = createHumanoidVisualState(config);
    const next = advanceHumanoidVisual(
      config,
      state,
      motion({ justLaunched: true, justLanded: true, hitCeiling: true }),
      1 / 60,
    );
    expect(next.launchBlend).toBe(1);
    expect(next.landingBlend).toBe(1);
    expect(next.ceilingBlend).toBe(1);
    expect(next).not.toHaveProperty('verticalVelocity');
  });
});
