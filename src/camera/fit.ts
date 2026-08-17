/**
 * Phase E4 — explicit camera-fit policy.
 *
 * Replaces the repeated consumer `Math.min`/`Math.max` `fitZoom` guess with a
 * tested helper. The Celeste-compact-room policy is `'cover'` (the one-line flip
 * from `min` → `max` documented in BUILD_NOTES §8): a `cover` fit fills the
 * viewport on BOTH axes so the level owns the screen, scrolling the overflow
 * axis, with no empty side/bottom letterbox gaps. `'contain'` is the inverse
 * (`min`) for when letterboxing is desired; `'native'` is a passthrough zoom of
 * 1.
 *
 * Pure, canvas-free, and unit-testable. Reads level dimensions either from a
 * bare `{ width, height }` or from a compiled LDtk room (whose pixel dimensions
 * live on `levelData` / `ldtkLevel`).
 */

import type { CompiledLdtkRoom } from '../platformer/ldtk-room';

/**
 * How a level rectangle is fitted into the viewport.
 *  - `'cover'`   — fill both axes (`max`); the overflow axis scrolls. No side
 *    gaps. The Celeste-compact-room policy.
 *  - `'contain'` — fit entirely inside (`min`); the slack axis letterboxes.
 *  - `'native'`  — zoom of 1 (no scaling); the level renders 1:1.
 */
export type CameraFitMode = 'contain' | 'cover' | 'native';

/** Options for {@link fitCameraZoom}. */
export interface FitCameraZoomOptions {
  /** Fit policy. Defaults to `'cover'` (Celeste compact rooms — no side gaps). */
  readonly mode?: CameraFitMode;
  /** Lower zoom clamp applied last (after the fit + integer quantisation). */
  readonly minZoom?: number;
  /** Upper zoom clamp applied last. */
  readonly maxZoom?: number;
  /**
   * Best-effort integer-pixel quantisation. A raw zoom `>= 1` rounds UP for
   * `'cover'` (still covers) and DOWN (minimum 1) for `'contain'` (still fits).
   * A sub-unit raw zoom is left fractional because no positive integer
   * preserves that fit. Crisp-pixel rendering is not guaranteed by this flag
   * alone; the geometric `cover`/`contain` guarantee is the acceptance.
   */
  readonly integerScale?: boolean;
}

/** A level-sized rectangle or anything duck-typed to one. */
export type FitLevel = { readonly width: number; readonly height: number };

function isFinitePositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * Resolve the level pixel dimensions from either a bare rectangle or a compiled
 * LDtk room. A compiled room exposes no top-level `width`/`height`; its pixel
 * dimensions live on `levelData` (the translated engine level), with the raw
 * LDtk pixel size on `ldtkLevel` as a fallback.
 *
 * Module-internal (shared with `./letterbox`), deliberately NOT re-exported
 * from `./index` — the public surface is the two helpers that consume it.
 * Anything that is not an object reads as `NaN × NaN` so callers degrade
 * through their own invalid-dimension path instead of throwing.
 */
export function resolveLevelDims(
  level: FitLevel | CompiledLdtkRoom,
): { width: number; height: number } {
  if (level === null || typeof level !== 'object') return { width: NaN, height: NaN };
  const room = level as Partial<CompiledLdtkRoom>;
  if (
    'levelData' in room &&
    room.levelData !== null &&
    typeof room.levelData === 'object'
  ) {
    const ld = room.levelData as { width?: unknown; height?: unknown };
    const lw = ld.width;
    const lh = ld.height;
    if (isFinitePositive(lw) && isFinitePositive(lh)) {
      return { width: lw, height: lh };
    }
  }
  const l = level as FitLevel;
  return { width: l.width, height: l.height };
}

/**
 * Compute the camera zoom that fits `level` into `viewport` per `options`.
 *
 * Invalid or non-positive dimensions (level or viewport) return `1`. After the
 * geometric fit (and optional integer quantisation), `minZoom`/`maxZoom` are
 * applied last — note an explicit clamp may override the geometric cover/contain
 * guarantee, which is the caller's choice.
 */
export function fitCameraZoom(
  level: FitLevel | CompiledLdtkRoom,
  viewport: { readonly width: number; readonly height: number },
  options?: Readonly<FitCameraZoomOptions>,
): number {
  const { width, height } = resolveLevelDims(level);
  const vpW = viewport.width;
  const vpH = viewport.height;
  // Invalid / non-positive dimensions: no meaningful fit.
  if (!isFinitePositive(width) || !isFinitePositive(height) || !isFinitePositive(vpW) || !isFinitePositive(vpH)) {
    return 1;
  }

  const mode: CameraFitMode = options?.mode ?? 'cover';
  if (mode === 'native') {
    return applyClamps(1, options);
  }

  const zx = vpW / width;
  const zy = vpH / height;
  let zoom = mode === 'cover' ? Math.max(zx, zy) : Math.min(zx, zy);
  if (!Number.isFinite(zoom) || zoom < 0) zoom = 1;

  if (options?.integerScale === true) {
    if (zoom >= 1) {
      // Integer quantisation preserves the fit direction: `ceil` for cover
      // (still covers), `floor` (min 1) for contain (still fits inside).
      zoom = mode === 'cover' ? Math.ceil(zoom) : Math.max(1, Math.floor(zoom));
    }
    // Sub-unit raw zoom: leave fractional — no positive integer preserves it.
  }

  return applyClamps(zoom, options);
}

function applyClamps(zoom: number, options?: Readonly<FitCameraZoomOptions>): number {
  let z = zoom;
  if (options !== undefined) {
    if (isFinitePositive(options.minZoom)) z = Math.max(options.minZoom as number, z);
    if (isFinitePositive(options.maxZoom)) z = Math.min(options.maxZoom as number, z);
  }
  return Number.isFinite(z) ? z : 1;
}
