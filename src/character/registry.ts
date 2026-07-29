import type {
  BodyPlanHandler,
  BodyPlanRegistry,
} from './types';
import type {
  HumanoidConfig,
  HumanoidMotionSample,
  HumanoidVisualState,
} from './humanoid/types';
import {
  advanceHumanoidVisual,
  createHumanoidVisualState,
} from './humanoid/state';
import { deriveHumanoidConfig } from './humanoid/config';
import { drawHumanoid } from './humanoid/draw';

/** Built-in typed humanoid body-plan handler. */
export const humanoidBodyPlan: BodyPlanHandler<
  HumanoidConfig,
  HumanoidVisualState,
  HumanoidMotionSample
> = {
  deriveConfig: deriveHumanoidConfig,
  createVisualState: createHumanoidVisualState,
  advanceVisual: advanceHumanoidVisual,
  draw: drawHumanoid,
};

const BUILT_INS = { humanoid: humanoidBodyPlan } as const;
type AnyHandler = BodyPlanHandler<any, any, any>;
type HandlerMap = Readonly<Record<string, AnyHandler>>;

/**
 * Create a body-plan registry with typed built-ins and typed custom entries.
 * Custom entries override same-named built-ins.
 */
export function createBodyPlanRegistry<
  const TCustom extends HandlerMap = Record<never, never>,
>(
  customPlans?: TCustom,
): BodyPlanRegistry<typeof BUILT_INS & TCustom> {
  const handlers: Record<string, AnyHandler> = {
    ...BUILT_INS,
    ...(customPlans ?? {}),
  };
  return {
    get(plan: string): AnyHandler | undefined {
      return handlers[plan];
    },
  } as BodyPlanRegistry<typeof BUILT_INS & TCustom>;
}
