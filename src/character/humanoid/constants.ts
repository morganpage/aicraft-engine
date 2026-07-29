import type { BreathConfig } from '../../animation/squash-stretch';
import type { GaitConfig } from '../../animation/locomotion';
import type { HumanoidConfig } from './types';

/** Reference collision width used to scale the procedural drawing. */
export const HUMANOID_BASE_WIDTH = 16;
/** Reference collision height used to scale the procedural drawing. */
export const HUMANOID_BASE_HEIGHT = 24;

/** Default displacement-driven humanoid gait. */
export const HUMANOID_GAIT: Readonly<GaitConfig> = {
  baseFrequency: 0.05,
  strideLength: 3.4,
  strideHeight: 2.8,
  hipBobHeight: 0.8,
  hipSwayWidth: 0.55,
};

/** Default subtle idle breathing. */
export const HUMANOID_BREATH: Readonly<BreathConfig> = {
  frequency: 0.018,
  amplitude: 0.025,
};

export const HUMANOID_POSE_DECAY_PER_SECOND = 7;
export const HUMANOID_OUTLINE_WIDTH = 1;
export const HUMANOID_EYE_RADIUS = 1;
export const HUMANOID_TARGET_ARM_BLEND = 0.72;
/** Neutral distance between idle feet in local pixels. */
export const HUMANOID_IDLE_STANCE_WIDTH = 5.2;
/** Neutral hip height keeps idle legs nearly straight instead of crouched. */
export const HUMANOID_IDLE_HIP_Y = -10.6;
/** Rate at which the neutral stance blends in/out. */
export const HUMANOID_IDLE_BLEND_PER_SECOND = 10;

/** Default deterministic humanoid configuration. */
export const DEFAULT_HUMANOID_SEED = 0x48554d41;

/** Type-check seam populated by `config.ts` without mutable module state. */
export type DefaultHumanoidConfig = Readonly<HumanoidConfig>;
