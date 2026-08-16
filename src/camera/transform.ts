/**
 * The camera → canvas transform, with an explicit pixel-snap policy.
 *
 * Every consumer that renders a world through a zoomed camera writes the same
 * three lines — scale by the zoom, translate by the negated camera position,
 * draw — and the second line is where pixel-art rendering goes wrong. The
 * camera is deliberately a float between updates (`../camera/index.ts` explains
 * why: rounding inside the lerp stalls it short of a clamp bound), so an
 * un-snapped translate lands the world origin between device pixels and the
 * rasterizer antialiases every surface edge it draws — read as a hairline seam
 * along the level's edge, a flickering scanline between tile rows, or a sprite
 * that shimmers while standing still.
 *
 * The obvious fix — `ctx.translate(-Math.round(camera.x), …)` INSIDE
 * `ctx.scale(zoom, zoom)` — is not enough on its own, and that is the whole
 * reason this module exists: it rounds in WORLD units, which a fractional zoom
 * (a cover fit of 4.75×, or a lens easing between rooms) then maps straight
 * back onto a fractional device pixel. Snapping has to happen in the device
 * grid the rasterizer actually quantises to. {@link cameraTransform} computes
 * the world-space offset whose DEVICE position is integral:
 *
 * ```
 * offsetX = -round(camera.x · zoom · dpr) / (zoom · dpr)
 * ```
 *
 * Pure and canvas-free ({@link cameraTransform}) or a two-call context
 * application ({@link applyCameraTransform}); the caller owns `save`/`restore`,
 * matching `../primitives/snap.ts`.
 *
 * **What snapping does and does not guarantee.** Snapping fixes the ORIGIN, so
 * the world grid's alignment to the device grid stops drifting frame to frame.
 * Whether every world pixel also lands on a device pixel depends on the scale:
 * only an integral `zoom · dpr` maps the whole grid, which is what
 * {@link CameraTransformResult.pixelAligned} reports. A fractional cover fit is
 * NOT pixel-aligned, and its far edges can still land mid-pixel however the
 * origin is snapped — pass `integerScale: true` to `fitCameraZoom` when crisp
 * edges matter more than filling the viewport exactly.
 *
 * @module
 */

import type { Camera, CameraViewport } from './types';

/**
 * Where the camera offset is quantised.
 *
 * - `'device'` — round in device pixels (the default, and the only mode that
 *   accounts for zoom). The world origin lands exactly on a device pixel.
 * - `'world'`  — round to whole world pixels. Equivalent to `'device'` only
 *   when `zoom · dpr` is an integer; under a fractional zoom the rounded world
 *   coordinate still maps to a fractional device pixel.
 * - `'none'`   — no rounding. The exact float camera position, for smooth
 *   non-pixel-art rendering or when the caller snaps downstream.
 */
export type CameraSnapMode = 'device' | 'world' | 'none';

/** Options for {@link cameraTransform} / {@link applyCameraTransform}. */
export interface CameraTransformOptions {
  /** Camera zoom. Non-finite or non-positive degrades to `1`. */
  readonly zoom?: number;
  /**
   * Backing-store scale of the canvas — `window.devicePixelRatio` for a
   * DPR-aware canvas, or `1` for a fixed-size backing store. Non-finite or
   * non-positive degrades to `1`. Only affects `'device'` snapping and
   * {@link CameraTransformResult.pixelAligned}.
   */
  readonly devicePixelRatio?: number;
  /** Quantisation policy. Defaults to `'device'`. */
  readonly snap?: CameraSnapMode;
}

/** The world-space rectangle a transform makes visible. */
export interface CameraWorldView {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The resolved transform. */
export interface CameraTransformResult {
  /** The sanitized zoom that was (or should be) applied. */
  readonly zoom: number;
  /**
   * World-space X translation to apply INSIDE `ctx.scale(zoom, zoom)`. Already
   * negated — pass straight to `ctx.translate`, or as the `worldOffset.x` of a
   * level/surface draw. Equals `-camera.x` before snapping.
   */
  readonly offsetX: number;
  /** World-space Y translation. See {@link CameraTransformResult.offsetX}. */
  readonly offsetY: number;
  /**
   * The visible world rectangle AFTER snapping — the correct cull rect, since
   * it describes what is actually drawn rather than the pre-snap float camera.
   */
  readonly view: CameraWorldView;
  /**
   * `true` when the whole world pixel grid lands on device pixels: the offset
   * is snapped AND `zoom · dpr` is an integer. When `false`, art is still
   * stable (the origin does not drift) but scaled edges can be antialiased —
   * see the module docs.
   */
  readonly pixelAligned: boolean;
}

/** Finite positive, else the fallback. */
function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Finite, else zero. */
function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Quantise one axis under the resolved policy. Returns the NEGATED offset.
 *
 * `Math.round` breaks ties toward `+Infinity` (`-5.5 → -5`), so a camera
 * sitting exactly on a half-pixel biases one way; the displacement is still
 * bounded by half a device pixel, which is all the contract claims.
 *
 * `-0` is canonicalized to `+0`, matching `clampTopLeft` in `motion.ts` — the
 * offsets are presentation state a consumer may serialize or compare.
 */
function snapAxis(position: number, deviceScale: number, mode: CameraSnapMode): number {
  let offset: number;
  if (mode === 'world') offset = -Math.round(position);
  else if (mode === 'none') offset = -position;
  // 'device': round the position in device pixels, then map back to world.
  else offset = -Math.round(position * deviceScale) / deviceScale;
  return offset === 0 ? 0 : offset;
}

/**
 * Resolve the camera transform without touching a canvas.
 *
 * Use this when the offset feeds something other than `ctx.translate` — a
 * level draw's `worldOffset`, a parallax layer's own offset, a hit-test that
 * has to agree with what was rendered — or when the caller composes the
 * transform itself. {@link applyCameraTransform} is the same computation plus
 * the two context calls.
 *
 * Every input is guarded: a non-finite camera coordinate reads as `0`, and a
 * non-finite or non-positive zoom / DPR / viewport dimension degrades to `1`.
 * Never throws.
 *
 * ```ts
 * const t = cameraTransform(brain.camera, viewport, {
 *   zoom: brain.zoom,
 *   devicePixelRatio: window.devicePixelRatio,
 * });
 * ctx.save();
 * ctx.scale(t.zoom, t.zoom);
 * surfaceCache.draw(ctx, room.ldtkLevel, {
 *   tilesets,
 *   worldOffset: { x: t.offsetX, y: t.offsetY },
 *   view: t.view,
 * });
 * ctx.restore();
 * ```
 */
export function cameraTransform(
  camera: Readonly<Camera>,
  viewport: Readonly<CameraViewport>,
  options: Readonly<CameraTransformOptions> = {},
): CameraTransformResult {
  const zoom = positive(options.zoom, 1);
  const dpr = positive(options.devicePixelRatio, 1);
  const mode: CameraSnapMode =
    options.snap === 'world' || options.snap === 'none' ? options.snap : 'device';
  const deviceScale = zoom * dpr;

  const x = finiteOrZero(camera?.x);
  const y = finiteOrZero(camera?.y);
  const offsetX = snapAxis(x, deviceScale, mode);
  const offsetY = snapAxis(y, deviceScale, mode);

  const vw = positive(viewport?.width, 1);
  const vh = positive(viewport?.height, 1);

  return {
    zoom,
    offsetX,
    offsetY,
    // The drawn position is the negation of the applied offset — cull against
    // what was rendered, not against the pre-snap float camera.
    view: { x: -offsetX, y: -offsetY, width: vw / zoom, height: vh / zoom },
    pixelAligned: mode !== 'none' && Number.isInteger(deviceScale),
  };
}

/**
 * Apply {@link cameraTransform} to a rendering context: `scale(zoom, zoom)`
 * then `translate(offsetX, offsetY)`, in that order, so the returned offsets
 * are world-space and directly comparable with world geometry.
 *
 * The caller owns `save()` / `restore()` — this helper only composes onto the
 * current transform, matching `applySnappedTranslate`. Returns the resolved
 * transform so the same call can drive culling and any draw that takes its own
 * `worldOffset`.
 *
 * ```ts
 * ctx.save();
 * const t = applyCameraTransform(ctx, brain.camera, viewport, {
 *   zoom: brain.zoom,
 *   devicePixelRatio: window.devicePixelRatio,
 * });
 * drawWorld(ctx, t.view);          // world coordinates from here on
 * ctx.restore();
 * ```
 */
export function applyCameraTransform(
  ctx: CanvasRenderingContext2D,
  camera: Readonly<Camera>,
  viewport: Readonly<CameraViewport>,
  options: Readonly<CameraTransformOptions> = {},
): CameraTransformResult {
  const resolved = cameraTransform(camera, viewport, options);
  ctx.scale(resolved.zoom, resolved.zoom);
  ctx.translate(resolved.offsetX, resolved.offsetY);
  return resolved;
}
