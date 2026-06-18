/**
 * Animation pillar — skeletal rigging, inverse kinematics, foot-locking,
 * deterministic oscillators, procedural locomotion, squash & stretch, and
 * Verlet-PBD spring chains.
 *
 * Foundation (Task 1): types, constants, rig, transform, skin, oscillators.
 * Task 2: `./ik` (limb / CCD / FABRIK solvers) + `./foot-lock`.
 * Task 3: `./locomotion`, `./squash-stretch`, `./spring`.
 */
export * from './types';
export * from './constants';
export * from './rig';
export * from './transform';
export * from './skin';
export * from './oscillators';
export * from './ik';
export * from './foot-lock';
export * from './locomotion';
export * from './squash-stretch';
export * from './spring';
