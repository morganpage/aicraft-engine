/**
 * Follow-camera module.
 *
 * A generalised, pure follow-camera. The reference `updateCamera` read
 * `state.player` + `CONFIG` + `state.level` and mutated the camera in place;
 * this module takes the target, bounds, viewport, and config as explicit
 * parameters and returns a brand-new {@link Camera} every call
 * (pure-progression-ops discipline per `docs/architecture.md`).
 *
 * Determinism summary:
 *   - Lives in the deterministic core: no `Math.random`, no `Date.now()`,
 *     no DOM reads. Pure arithmetic.
 *   - Same `(camera, target, bounds, viewport, config)` → same output, forever.
 *   - Never mutates the input camera; returns a fresh object.
 *
 * Key insight: the camera coordinates are kept as FLOATS between updates.
 * Rounding inside the lerp caused the camera to stall ~4px short of a clamp
 * bound once the per-tick increment dropped below 0.5 (it rounded to 0
 * forever). Instead a snap-to-target kicks in within `snapThreshold` pixels so
 * the lerp fully converges, and the RENDERER rounds to integer pixels only
 * when it applies the world transform.
 *
 * @module
 */

export type {
  Camera,
  CameraTarget,
  CameraBounds,
  CameraConfig,
  CameraViewport,
  FollowBand,
  DampedMotionConfig,
  FollowBodyConfig,
  FixedBodyConfig,
  CameraBody,
  CameraLens,
  VirtualCamera,
  CameraBrain,
  CameraBrainOptions,
} from './types';
export {
  DEFAULT_CAMERA,
  DEFAULT_CAMERA_MOTION,
  DEFAULT_LENS_MOTION,
  DEFAULT_FOLLOW_BODY,
  DEFAULT_BRAIN_BLEND_DURATION,
} from './constants';
export { createCamera, updateCamera } from './follow';
export { converge } from './motion';
export { createCameraBrain, updateCameraBrain, snapCameraBrain } from './brain';
export { fitCameraZoom, type CameraFitMode, type FitCameraZoomOptions } from './fit';
export {
  cameraTransform,
  applyCameraTransform,
  composeCameraTransform,
  type CameraSnapMode,
  type CameraTransformOptions,
  type CameraTransformResult,
  type CameraWorldView,
} from './transform';
export {
  cameraLetterbox,
  applyCameraLetterbox,
  type ApplyCameraLetterboxOptions,
  type CameraFrameRect,
  type CameraLetterbox,
} from './letterbox';
// NOTE: `followPosition` (motion.ts) is an implementation helper for focused
// unit tests and is intentionally omitted from the package barrel.
