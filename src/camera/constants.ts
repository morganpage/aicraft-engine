/**
 * Tunables and canonical defaults for the follow-camera module.
 *
 * No magic numbers live outside this file. Consumers import {@link DEFAULT_CAMERA}
 * and spread their own overrides over it.
 *
 * @module
 */

import type { CameraConfig, DampedMotionConfig } from './types';

/**
 * Default camera config:
 *   - `lerp: 0.1` — smooth follow without noticeable lag.
 *   - `snapThreshold: 0.5` — converge exactly within half a pixel so the
 *     lerp terminates (and the renderer's integer rounding lands on the
 *     exact clamp bound).
 */
export const DEFAULT_CAMERA: Required<CameraConfig> = {
  lerp: 0.1,
  snapThreshold: 0.5,
};

// --- Camera brain defaults ------------------------------------------------
//
// Motion configs are field-by-field fallbacks: each omitted/invalid field on
// a body or lens config is replaced by the matching default below. Bodies use
// `DEFAULT_CAMERA_MOTION` (px/s); the lens uses `DEFAULT_LENS_MOTION`
// (zoom-units/s).

/**
 * Default analytic convergence for camera BODIES (position). `maxSpeed: 1600`
 * px/s caps catch-up so a far jump glides rather than teleports; `halfLife:
 * 0.12s` eases the final approach; `snapThreshold: 0.5px` terminates the
 * asymptote on the pixel grid.
 *
 * The `0.5` is WORLD pixels: under a zoomed lens the terminal snap jumps
 * `zoom · 0.5` device pixels in one tick, which reads as a visible lurch at
 * zoom 3+ (settles to near-stillness, then clicks into place). A build that
 * renders zoomed should pass `snapThreshold: devicePixelSnapThreshold(zoom,
 * dpr)` instead — the largest threshold the display cannot see. The Celeste
 * preset (`./celeste.ts`) does.
 */
export const DEFAULT_CAMERA_MOTION: Required<DampedMotionConfig> = {
  halfLife: 0.12,
  maxSpeed: 1600,
  snapThreshold: 0.5,
};

/**
 * Default analytic convergence for the camera LENS (zoom). Smaller `maxSpeed`
 * (4 zoom-units/s) so a cut between zoom levels reads as a deliberate ease
 * rather than a pop; the tiny `snapThreshold` avoids visible zoom chatter.
 */
export const DEFAULT_LENS_MOTION: Required<DampedMotionConfig> = {
  halfLife: 0.12,
  maxSpeed: 4,
  snapThreshold: 0.001,
};

/**
 * Default follow-body tuning. `followX: { trail: 0.25, lead: 0.5 }` keeps the
 * player in the left half of the screen at rest — a deadzone feel ("start at
 * the left, camera only moves once the player crosses the centre"). The
 * vertical band `[0.35, 0.65]` is symmetric so vertical drift is balanced.
 *
 * Note this is NOT Celeste's follow: the original has no deadzone at all — it
 * recenters on the player every frame. `./celeste.ts` ships the decompile's
 * bands (`CELESTE_FOLLOW_CENTERED`/`_AHEAD`) for that feel.
 */
export const DEFAULT_FOLLOW_BODY = {
  targetKey: 'player',
  followX: { trail: 0.25, lead: 0.5 },
  followY: { trail: 0.35, lead: 0.65 },
  padding: 0,
} as const;

/** Default incoming brain-blend duration (seconds) when a vcam omits `blend`. */
export const DEFAULT_BRAIN_BLEND_DURATION = 0.3;
