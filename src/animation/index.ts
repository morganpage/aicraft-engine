/**
 * Animation pillar — skeletal rigging, inverse kinematics, foot-locking,
 * deterministic oscillators, procedural locomotion, squash & stretch,
 * Verlet-PBD spring chains, and apex-parameterized jump trajectory.
 *
 * Foundation (Task 1): types, constants, rig, transform, skin, oscillators.
 * Task 2: `./ik` (limb / CCD / FABRIK solvers) + `./foot-lock`.
 * Task 3: `./locomotion`, `./squash-stretch`, `./spring`.
 * Task 4: `./jump` (trajectory + state machine + landing squash).
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
export * from './jump';
