import type {
  AnyBodyPlanHandler,
  BodyPlanHandlerMap,
  BodyPlanRegistry,
} from './body-plan-types';
import { deriveHumanoidConfig } from './humanoid-config';
import { createHumanoidVisualState, advanceHumanoidVisual } from './humanoid-state';
import { drawHumanoid } from './humanoid-draw';

export const humanoidBodyPlan = {
  deriveConfig: deriveHumanoidConfig,
  createVisualState: createHumanoidVisualState,
  advanceVisual: advanceHumanoidVisual,
  draw: drawHumanoid,
};

const BUILT_INS = {
  humanoid: humanoidBodyPlan,
} as const satisfies BodyPlanHandlerMap;

export type BuiltInBodyPlans = typeof BUILT_INS;

export function createBodyPlanRegistry<
  const TCustom extends BodyPlanHandlerMap = Record<never, never>,
>(
  customPlans?: TCustom,
): BodyPlanRegistry<BuiltInBodyPlans & TCustom> {
  const handlers: Record<string, AnyBodyPlanHandler> = {
    ...BUILT_INS,
    ...(customPlans ?? {}),
  };
  return {
    get(plan: string): AnyBodyPlanHandler | undefined {
      return handlers[plan];
    },
  } as BodyPlanRegistry<BuiltInBodyPlans & TCustom>;
}
