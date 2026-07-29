import type { LocomotionState } from '../../../src/animation/locomotion';
import { advanceLocomotionByDisplacement } from '../../../src/animation/locomotion';
import type { Vec2 } from '../../../src/animation/types';
import { HUMANOID_POSE_DECAY_PER_SECOND } from './constants';
import type { HumanoidConfig } from './humanoid-config';

export type HumanoidAirPose = 'grounded' | 'ascent' | 'apex' | 'descent';

export interface HumanoidMotionSample {
  readonly dx: number;
  readonly facing: 1 | -1;
  readonly supported: boolean;
  readonly gravityDirection: 1 | -1;
  readonly verticalVelocity: number;
  readonly justLaunched: boolean;
  readonly justLanded: boolean;
  readonly hitCeiling: boolean;
  readonly armTarget?: Readonly<Vec2>;
}

export interface HumanoidVisualState {
  readonly locomotion: LocomotionState;
  readonly facing: 1 | -1;
  readonly airPose: HumanoidAirPose;
  readonly launchBlend: number;
  readonly landingBlend: number;
  readonly ceilingBlend: number;
  readonly armTarget: Readonly<Vec2> | null;
}

export function createHumanoidVisualState(
  _config: HumanoidConfig,
): HumanoidVisualState {
  return {
    locomotion: { phase: 0 },
    facing: 1,
    airPose: 'grounded',
    launchBlend: 0,
    landingBlend: 0,
    ceilingBlend: 0,
    armTarget: null,
  };
}

function decay(value: number, dt: number): number {
  return Math.max(0, value - dt * HUMANOID_POSE_DECAY_PER_SECOND);
}

export function advanceHumanoidVisual(
  config: HumanoidConfig,
  state: HumanoidVisualState,
  motion: HumanoidMotionSample,
  dt: number,
): HumanoidVisualState {
  const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const dx = Number.isFinite(motion.dx) ? motion.dx : 0;
  const localDx = motion.supported ? dx * motion.facing : 0;
  const locomotion = advanceLocomotionByDisplacement(
    state.locomotion,
    localDx,
    config.gait,
  );
  const relativeVertical =
    Number.isFinite(motion.verticalVelocity)
      ? motion.verticalVelocity * motion.gravityDirection
      : 0;
  const airPose: HumanoidAirPose = motion.supported
    ? 'grounded'
    : relativeVertical < -0.5
      ? 'ascent'
      : relativeVertical > 0.5
        ? 'descent'
        : 'apex';

  return {
    locomotion,
    facing: motion.facing,
    airPose,
    launchBlend: motion.justLaunched ? 1 : decay(state.launchBlend, safeDt),
    landingBlend: motion.justLanded ? 1 : decay(state.landingBlend, safeDt),
    ceilingBlend: motion.hitCeiling ? 1 : decay(state.ceilingBlend, safeDt),
    armTarget: motion.armTarget
      ? { x: motion.armTarget.x, y: motion.armTarget.y }
      : null,
  };
}
