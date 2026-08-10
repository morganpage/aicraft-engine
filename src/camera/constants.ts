/**
 * Tunables and canonical defaults for the follow-camera module.
 *
 * No magic numbers live outside this file. Consumers import {@link DEFAULT_CAMERA}
 * and spread their own overrides over it.
 *
 * @module
 */

import type { CameraConfig } from './types';

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
