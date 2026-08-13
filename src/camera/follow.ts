/**
 * Follow-camera implementation (pure).
 *
 * @module
 */

import type { Camera, CameraTarget, CameraBounds, CameraConfig } from './types';
import { DEFAULT_CAMERA } from './constants';
import { clamp } from '../primitives/pixel';

/**
 * Create a fresh camera parked at the world origin (0, 0).
 *
 * @returns A new {@link Camera} at `{x: 0, y: 0}`.
 */
export function createCamera(): Camera {
  return { x: 0, y: 0 };
}

/**
 * Advance the camera one frame toward the target.
 *
 * The desired top-left is computed so the target's centre sits at the
 * viewport centre, then clamped to `[0, bounds - viewport]` per axis so the
 * viewport never shows outside the level. When a bound is smaller than the
 * viewport on an axis, the level is centred instead (the camera goes
 * negative so the smaller level sits in the middle of the visible area).
 * The clamp result is the per-axis `target`; the camera is lerped toward it.
 *
 * Snap-to-target: once the camera is within `snapThreshold` pixels of the
 * per-axis target, it snaps exactly. This makes the lerp converge instead of
 * asymptoting forever — at a clamp bound the per-tick lerp increment drops
 * below the pixel grid and would otherwise stall short of the bound (the
 * canonical camera bug).
 *
 * Pure: returns a brand-new {@link Camera}; the input is never mutated, and
 * the function never throws.
 *
 * @param camera   - Current camera position (never mutated).
 * @param target   - What the camera follows (typically the player's box).
 * @param bounds   - Level / world dimensions used for clamping.
 * @param viewport - Visible dimensions in the SAME world-space units as
 *                   `target` and `bounds`. This legacy solver has NO zoom input
 *                   (unlike {@link updateCameraBrain}); callers using a zoomed
 *                   renderer must pass `physicalViewport / zoom` themselves.
 * @param config   - Tuning (`lerp`, `snapThreshold`); defaults to
 *                   {@link DEFAULT_CAMERA} when omitted or partially omitted.
 * @returns A new {@link Camera} one lerp step closer to the target, in the
 *          same coordinate space as `target` and `bounds`.
 *
 * @example
 * ```ts
 * let cam = createCamera();
 * // each frame:
 * cam = updateCamera(cam, playerBox, levelBounds, { width: 960, height: 540 });
 * // renderer: ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
 * ```
 */
export function updateCamera(
  camera: Camera,
  target: CameraTarget,
  bounds: CameraBounds,
  viewport: { width: number; height: number },
  config: CameraConfig = {},
): Camera {
  const {
    lerp: lerpFactor = DEFAULT_CAMERA.lerp,
    snapThreshold = DEFAULT_CAMERA.snapThreshold,
  } = config;

  const desiredX = target.x + target.width / 2 - viewport.width / 2;
  const desiredY = target.y + target.height / 2 - viewport.height / 2;

  const maxX = bounds.width - viewport.width;
  const maxY = bounds.height - viewport.height;

  const targetX = bounds.width <= viewport.width ? maxX / 2 : clamp(desiredX, 0, maxX);
  const targetY = bounds.height <= viewport.height ? maxY / 2 : clamp(desiredY, 0, maxY);

  let x = camera.x + (targetX - camera.x) * lerpFactor;
  let y = camera.y + (targetY - camera.y) * lerpFactor;

  if (Math.abs(targetX - x) < snapThreshold) x = targetX;
  if (Math.abs(targetY - y) < snapThreshold) y = targetY;

  return { x, y };
}
