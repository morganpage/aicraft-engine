import type { GaitConfig, LocomotionState } from '../../animation/locomotion';
import type { BreathConfig } from '../../animation/squash-stretch';
import type { Vec2 } from '../../animation/types';
import type { Palette } from '../../palette/types';

/** Built-in head silhouettes. */
export type HumanoidHeadStyle = 'bare' | 'cap' | 'crest';

/** Immutable, seed-derived humanoid proportions and styling. */
export interface HumanoidConfig {
  readonly seed: number;
  readonly palette: Palette;
  readonly torsoWidth: number;
  readonly torsoHeight: number;
  readonly headRadius: number;
  readonly shoulderWidth: number;
  readonly upperArmLength: number;
  readonly lowerArmLength: number;
  readonly thighLength: number;
  readonly shinLength: number;
  readonly headStyle: HumanoidHeadStyle;
  readonly eyeOffsetX: number;
  readonly gait: GaitConfig;
  readonly breath: BreathConfig;
}

/** Support-relative airborne presentation pose. */
export type HumanoidAirPose = 'grounded' | 'ascent' | 'apex' | 'descent';

/**
 * Consumer-built motion sample. Platformer simulation remains the sole
 * authority for position, collision, support, gravity, and jump.
 */
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

/** Evolving visual state; contains no world position, velocity, or config. */
export interface HumanoidVisualState {
  readonly locomotion: LocomotionState;
  readonly facing: 1 | -1;
  readonly airPose: HumanoidAirPose;
  readonly launchBlend: number;
  readonly landingBlend: number;
  readonly ceilingBlend: number;
  readonly armTarget: Readonly<Vec2> | null;
}
