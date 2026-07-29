import { advanceLocomotionByDisplacement } from '../../animation/locomotion';
import {
  HUMANOID_IDLE_BLEND_PER_SECOND,
  HUMANOID_POSE_DECAY_PER_SECOND,
} from './constants';
import type {
  HumanoidAirPose,
  HumanoidConfig,
  HumanoidMotionSample,
  HumanoidVisualState,
} from './types';

/** Create deterministic visual-only humanoid state. */
export function createHumanoidVisualState(
  _config: HumanoidConfig,
): HumanoidVisualState {
  return {
    locomotion: { phase: 0 },
    facing: 1,
    idleBlend: 1,
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

/** Advance humanoid presentation from consumer-owned motion results. */
export function advanceHumanoidVisual(
  config: HumanoidConfig,
  state: HumanoidVisualState,
  motion: HumanoidMotionSample,
  dt: number,
): HumanoidVisualState {
  const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const dx = Number.isFinite(motion.dx) ? motion.dx : 0;
  const locomotion = advanceLocomotionByDisplacement(
    state.locomotion,
    motion.supported ? dx * motion.facing : 0,
    config.gait,
  );
  const relativeVertical = Number.isFinite(motion.verticalVelocity)
    ? motion.verticalVelocity * motion.gravityDirection
    : 0;
  const airPose: HumanoidAirPose = motion.supported
    ? 'grounded'
    : relativeVertical < -0.5
      ? 'ascent'
      : relativeVertical > 0.5
        ? 'descent'
      : 'apex';
  const idleTarget = motion.supported && Math.abs(dx) < 1e-6 ? 1 : 0;
  const idleStep = safeDt * HUMANOID_IDLE_BLEND_PER_SECOND;
  const idleBlend =
    idleTarget > state.idleBlend
      ? Math.min(idleTarget, state.idleBlend + idleStep)
      : Math.max(idleTarget, state.idleBlend - idleStep);
  return {
    locomotion,
    facing: motion.facing,
    idleBlend,
    airPose,
    launchBlend: motion.justLaunched ? 1 : decay(state.launchBlend, safeDt),
    landingBlend: motion.justLanded ? 1 : decay(state.landingBlend, safeDt),
    ceilingBlend: motion.hitCeiling ? 1 : decay(state.ceilingBlend, safeDt),
    armTarget: motion.armTarget
      ? { x: motion.armTarget.x, y: motion.armTarget.y }
      : null,
  };
}
