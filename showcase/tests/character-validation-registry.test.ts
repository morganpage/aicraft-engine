import { describe, expect, expectTypeOf, it } from 'vitest';
import type { BodyPlanHandler } from '../_prototype/character-enemy-validation/body-plan-types';
import {
  createBodyPlanRegistry,
  humanoidBodyPlan,
} from '../_prototype/character-enemy-validation/body-plan-registry';
import type {
  HumanoidConfig,
} from '../_prototype/character-enemy-validation/humanoid-config';
import type {
  HumanoidMotionSample,
  HumanoidVisualState,
} from '../_prototype/character-enemy-validation/humanoid-state';

describe('body-plan registry validation spike', () => {
  it('preserves concrete built-in handler types', () => {
    const registry = createBodyPlanRegistry();
    const handler = registry.get('humanoid');
    expect(handler).toBe(humanoidBodyPlan);
    expectTypeOf(handler).toMatchTypeOf<
      BodyPlanHandler<
        HumanoidConfig,
        HumanoidVisualState,
        HumanoidMotionSample
      >
    >();
  });

  it('preserves custom handler types and does not mutate the input map', () => {
    const customHandler: BodyPlanHandler<
      { readonly seed: number },
      { readonly phase: number },
      { readonly amount: number }
    > = {
      deriveConfig: (seed) => ({ seed }),
      createVisualState: () => ({ phase: 0 }),
      advanceVisual: (_config, state, motion) => ({
        phase: state.phase + motion.amount,
      }),
      draw: () => undefined,
    };
    const custom = { custom: customHandler };
    const snapshot = { ...custom };
    const registry = createBodyPlanRegistry(custom);

    expect(registry.get('custom')).toBe(customHandler);
    expect(registry.get('missing')).toBeUndefined();
    expect(custom).toEqual(snapshot);
    expectTypeOf(registry.get('custom')).toEqualTypeOf(customHandler);
  });
});
