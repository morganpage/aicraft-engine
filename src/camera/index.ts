/**
 * Follow-camera module.
 *
 * A generalised, pure port of Spitekeep's `src/render/camera.ts`. Spitekeep's
 * `updateCamera` read `state.player` + `CONFIG` + `state.level` and mutated
 * the camera in place; this module takes the target, bounds, viewport, and
 * config as explicit parameters and returns a brand-new {@link Camera} every
 * call (pure-progression-ops discipline per `docs/architecture.md`).
 *
 * Determinism summary:
 *   - Lives in the deterministic core: no `Math.random`, no `Date.now()`,
 *     no DOM reads. Pure arithmetic.
 *   - Same `(camera, target, bounds, viewport, config)` → same output, forever.
 *   - Never mutates the input camera; returns a fresh object.
 *
 * Key insight carried over from Spitekeep (see the reference file's header):
 * the camera coordinates are kept as FLOATS between updates. Rounding inside
 * the lerp caused the camera to stall ~4px short of a clamp bound once the
 * per-tick increment dropped below 0.5 (it rounded to 0 forever). Instead a
 * snap-to-target kicks in within `snapThreshold` pixels so the lerp fully
 * converges, and the RENDERER rounds to integer pixels only when it applies
 * the world transform.
 *
 * @module
 */

export type { Camera, CameraTarget, CameraBounds, CameraConfig } from './types';
export { DEFAULT_CAMERA } from './constants';
export { createCamera, updateCamera } from './follow';
