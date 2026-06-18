/**
 * Animation pillar — skeletal rigging, inverse kinematics, foot-locking,
 * deterministic oscillators, and (later) procedural locomotion, springs.
 *
 * Foundation (Task 1): types, constants, rig, transform, skin, oscillators.
 * Task 2: `./ik` (limb / CCD / FABRIK solvers) + `./foot-lock`.
 * Later tasks add: `./locomotion`, `./squash-stretch`, `./spring`. Do not
 * re-export modules that do not yet exist.
 */
export * from './types';
export * from './constants';
export * from './rig';
export * from './transform';
export * from './skin';
export * from './oscillators';
export * from './ik';
export * from './foot-lock';
