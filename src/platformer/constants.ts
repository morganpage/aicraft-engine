/**
 * Default config and dimension constants for the platformer kernel.
 *
 * Values are tuned for a Sokpop-style precision platformer feel (snappy
 * ground control, snappy jump, gentle wall-slide). Spread
 * `DEFAULT_PLATFORMER_CONFIG` into your own object to override individual
 * fields without re-typing the whole record.
 *
 * @module
 */

import { DEFAULT_JUMP } from '../animation/jump';
import type { PlatformerConfig, Contacts, PlatformerEvents } from './types';

/**
 * Default platformer tuning. All values in px/s or seconds. No magic numbers
 * in the kernel hot path — every tunable lives here.
 *
 * Math: `gravity` (980 px/s²) was derived by scaling the Spitekeep devil's
 * `0.5 px/tick²` feel by `60²` to convert tick-rate to seconds, then tuned
 * down for snappy precision control. The `jump` sub-config delegates to
 * `DEFAULT_JUMP` from `src/animation/jump.ts` — that is the source of truth
 * for jump trajectory.
 */
export const DEFAULT_PLATFORMER_CONFIG: Readonly<PlatformerConfig> = {
  gravity: 980,
  maxFallSpeed: 600,
  moveSpeed: 200,
  airControl: 0.65,
  jump: DEFAULT_JUMP,
  jumpEnabled: true,
  wallSlideEnabled: true,
  wallSlideSpeed: 60,
  wallJumpVx: 220,
  wallJumpVy: -380,
  wallJumpLockTime: 0.12,
  dashEnabled: true,
  dashSpeed: 420,
  dashDuration: 0.12,
  dashCooldown: 0.3,
  maxDashes: 1,
  doubleJumpEnabled: false,
  maxDoubleJumps: 0,
};

/** Default player body width in world units (Spitekeep devil scale). */
export const DEFAULT_PLAYER_WIDTH = 16;

/** Default player body height in world units (Spitekeep devil scale). */
export const DEFAULT_PLAYER_HEIGHT = 24;

/**
 * Empty `Contacts` record — all sides `null`. Used as the initial contacts
 * for a freshly created state and as the starting point for the kernel's
 * per-tick contact resolution.
 */
export const EMPTY_CONTACTS: Readonly<Contacts> = {
  groundId: null,
  leftWallId: null,
  rightWallId: null,
  ceilingId: null,
};

/**
 * Empty `PlatformerEvents` record — all events `false`. Used as the starting
 * point for the kernel's per-tick event accumulation; the final events object
 * is built by merging partials emitted by each ability plus collision-driven
 * events.
 */
export const EMPTY_EVENTS: Readonly<PlatformerEvents> = {
  justLanded: false,
  justLaunched: false,
  hitCeiling: false,
  hitWall: false,
  startedWallSlide: false,
  wallJumpLaunched: false,
  dashStarted: false,
  doubleJumped: false,
};
