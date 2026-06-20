/**
 * Type definitions for the follow-camera module.
 *
 * The camera is a pure world-space position: it never mutates game state,
 * only describes where the viewport's top-left sits in world coordinates.
 * The renderer reads `Camera.x / y` and rounds to integer pixels only when
 * applying the world transform (the camera itself stays float between
 * updates so the lerp stays smooth and never stalls).
 *
 * @module
 */

/**
 * Camera world-space position (top-left of the viewport).
 *
 * Stored as floats between updates for a smooth, non-stalling lerp. The
 * renderer rounds to integer pixels only when applying the world transform.
 */
export interface Camera {
  x: number;
  y: number;
}

/**
 * The target the camera follows. Typically the player's collision box, but
 * any axis-aligned rectangle works — the camera centres on the target's
 * midpoint.
 */
export interface CameraTarget {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Level / world bounds. The camera clamps so the viewport never shows outside
 * the level. When a bound is smaller than the viewport on an axis, the level
 * is centred on that axis instead (the camera goes negative).
 */
export interface CameraBounds {
  width: number;
  height: number;
}

/**
 * Camera behaviour tuning. Every field is optional and falls back to
 * {@link DEFAULT_CAMERA}; consumers spread their own values over the defaults.
 */
export interface CameraConfig {
  /**
   * Lerp factor per update (0 = never moves, 1 = instant snap to target).
   * Default 0.1 — smooth follow without noticeable lag. Higher = snappier.
   */
  lerp?: number;
  /**
   * Snap-to-target threshold in pixels. When the camera is within this
   * distance of its target on an axis, it snaps exactly. Prevents the lerp
   * from asymptoting forever at the clamp bounds (where per-tick increments
   * drop below the pixel grid and stall). Default 0.5.
   */
  snapThreshold?: number;
}
