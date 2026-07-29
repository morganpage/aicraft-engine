import type { BreathConfig } from '../../../src/animation/squash-stretch';
import type { GaitConfig } from '../../../src/animation/locomotion';

export const HUMANOID_BASE_WIDTH = 16;
export const HUMANOID_BASE_HEIGHT = 24;

export const HUMANOID_GAIT: Readonly<GaitConfig> = {
  baseFrequency: 0.05,
  strideLength: 3.4,
  strideHeight: 2.8,
  hipBobHeight: 0.8,
  hipSwayWidth: 0.55,
};

export const HUMANOID_BREATH: Readonly<BreathConfig> = {
  frequency: 0.018,
  amplitude: 0.025,
};

export const HUMANOID_POSE_DECAY_PER_SECOND = 7;
export const HUMANOID_OUTLINE_WIDTH = 1;
export const HUMANOID_EYE_RADIUS = 1;
export const HUMANOID_TARGET_ARM_BLEND = 0.72;
export const HUMANOID_IDLE_STANCE_WIDTH = 5.2;
export const HUMANOID_IDLE_HIP_Y = -10.6;
export const HUMANOID_IDLE_BLEND_PER_SECOND = 10;

export const CHARGER_WIDTH = 16;
export const CHARGER_HEIGHT = 16;

export const CHARGER_DEFAULTS = {
  speed: 40,
  dashSpeed: 300,
  windupDuration: 0.5,
  recoveryDuration: 0.8,
  dashMaxDistance: 128,
  detectionRadius: 160,
  verticalTolerance: 12,
  ledgeTurnAround: true,
} as const;
