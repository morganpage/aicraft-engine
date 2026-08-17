/**
 * The screen rectangle a contain-fitted level occupies, and the mask around it.
 *
 * `fitCameraZoom(..., { mode: 'contain' })` guarantees the whole authored room
 * stays visible at every aspect ratio, which necessarily leaves slack on one
 * axis. What the fit does NOT do is say anything about that slack, and the gap
 * has a consistent failure mode in real builds: the backdrop / parallax pass is
 * drawn across the entire canvas, the world is drawn unclipped on top, and the
 * player reads the empty margin as playable level — the room looks like it
 * continues past its own edge, and the camera clamp looks broken even though
 * the bounds were right all along. The fix is not a camera change at all; it is
 * two rectangles' worth of masking that every consumer would otherwise
 * hand-roll (four bar rects, clamped and made disjoint, plus a clip path).
 *
 * This module owns that arithmetic:
 *
 * ```ts
 * const t = cameraTransform(brain.camera, viewport, { zoom: brain.zoom, devicePixelRatio: dpr });
 * ctx.save();
 * applyCameraLetterbox(ctx, bounds, viewport, t, { fill: '#070b18' });  // bars + clip
 * ctx.translate(shake.x, shake.y);   // shake INSIDE the clip: the mask holds still
 * composeCameraTransform(ctx, t);    // world space from here on
 * drawWorld();
 * ctx.restore();
 * ```
 *
 * **Units.** The frame and bars are in the caller's CURRENT transform units —
 * CSS pixels under the standard `ctx.scale(dpr, dpr)`, computed BEFORE the zoom
 * is composed (the frame is `bounds · zoom`, so applying it under the zoom
 * would square it). Call it in the same space as the viewport, which is the
 * same space `canvasCssViewport` reports.
 *
 * **Fail-safe direction.** Invalid bounds, a degenerate viewport, or a
 * non-finite transform resolve to a frame that COVERS the viewport: no bars, a
 * no-op clip. A masking helper that cannot compute its mask must never blank
 * the game.
 *
 * @module
 */

import { resolveLevelDims, type FitLevel } from './fit';
import type { CameraTransformResult } from './transform';
import type { CameraViewport } from './types';
import type { CompiledLdtkRoom } from '../platformer/ldtk-room';

/**
 * An axis-aligned rectangle in the caller's current transform units (CSS
 * pixels under `ctx.scale(dpr, dpr)`). Never negative in width/height.
 */
export interface CameraFrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The resolved level frame and the mask around it. */
export interface CameraLetterbox {
  /**
   * Where the level's own rectangle lands on screen — `bounds · zoom` at the
   * transform's snapped offset. May extend past the viewport on the covered
   * axis (a `'cover'` fit, or a room larger than the viewport).
   */
  readonly frame: CameraFrameRect;
  /**
   * The frame clipped to the viewport: the region world rendering is allowed
   * to touch. Empty (`width`/`height` of `0`) when the frame is entirely
   * off-screen.
   */
  readonly clip: CameraFrameRect;
  /**
   * The 0–4 disjoint viewport regions OUTSIDE the frame, in draw order (top,
   * bottom, left, right). Empty when the frame covers the viewport. Zero-area
   * bars are omitted, so `bars.length` is a truthful "is anything letterboxed"
   * signal.
   */
  readonly bars: readonly CameraFrameRect[];
  /** `true` when the frame covers the whole viewport — `bars` is empty. */
  readonly covered: boolean;
}

/** Options for {@link applyCameraLetterbox}. */
export interface ApplyCameraLetterboxOptions {
  /**
   * Bar fill. Defaults to `'#000000'`. Pass `null` to skip the fill and take
   * only the clip (e.g. when a starfield already owns the margin and the frame
   * is delineated some other way). The context's `fillStyle` is saved and
   * restored around the fill — only the clip survives the call.
   */
  readonly fill?: string | CanvasGradient | CanvasPattern | null;
  /**
   * Clip subsequent drawing to {@link CameraLetterbox.clip}. Defaults to
   * `true`. The clip is intentionally NOT undone by this helper — the caller's
   * `restore()` owns it, matching `applyCameraTransform`.
   */
  readonly clip?: boolean;
}

/** Finite positive, else the fallback. */
function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Clamp to `[low, high]`; `-0` canonicalized to `+0`. */
function clamp(value: number, low: number, high: number): number {
  const clamped = value < low ? low : value > high ? high : value;
  return clamped === 0 ? 0 : clamped;
}

/** A rect, with negative extents floored at zero. */
function rect(x: number, y: number, width: number, height: number): CameraFrameRect {
  return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
}

/**
 * Resolve the level frame and its surrounding mask. Pure and canvas-free.
 *
 * `bounds` is the APERTURE — the rectangle the player looks through, which is
 * one room (`{ width: room.levelData.width, height: … }`, or the compiled room
 * itself).
 *
 * **It is not the camera's clamp space, and during a room slide the two
 * differ.** `presentationForRoomSlide(slide).bounds` is the two-room union: a
 * mask sized from it is about twice a room wide, so it exceeds the viewport,
 * every bar disappears for the length of the transition, and the world spills
 * across the whole window before snapping back. Pass the ROOM while a slide
 * runs (interpolating source→destination if their sizes differ); the rooms
 * move behind a window that does not.
 *
 * `transform` is the {@link CameraTransformResult} already being used to draw:
 * passing the same object is what keeps the mask and the world on the same
 * snapped pixel grid. Anything invalid degrades to a full-viewport frame with
 * no bars (see the module note on the fail-safe direction).
 *
 * `covered` reports whether anything is letterboxed at all — `true` for a
 * `'cover'` fit or an oversized room, where the bars are empty and the clip is
 * the viewport.
 */
export function cameraLetterbox(
  bounds: FitLevel | CompiledLdtkRoom,
  viewport: Readonly<CameraViewport>,
  transform: Readonly<Pick<CameraTransformResult, 'zoom' | 'offsetX' | 'offsetY'>>,
): CameraLetterbox {
  const vw = positive(viewport?.width, 0);
  const vh = positive(viewport?.height, 0);
  const viewportRect = rect(0, 0, vw, vh);
  const full: CameraLetterbox = {
    frame: viewportRect,
    clip: viewportRect,
    bars: [],
    covered: true,
  };
  if (vw === 0 || vh === 0) return full;

  const { width, height } = resolveLevelDims(bounds);
  const zoom = positive(transform?.zoom, 0);
  if (zoom === 0 || !(width > 0) || !(height > 0)) return full;

  const offsetX = typeof transform.offsetX === 'number' && Number.isFinite(transform.offsetX)
    ? transform.offsetX
    : NaN;
  const offsetY = typeof transform.offsetY === 'number' && Number.isFinite(transform.offsetY)
    ? transform.offsetY
    : NaN;
  if (Number.isNaN(offsetX) || Number.isNaN(offsetY)) return full;

  const frame = rect(offsetX * zoom, offsetY * zoom, width * zoom, height * zoom);

  // The frame ∩ viewport edges: every bar and the clip derive from these four.
  const left = clamp(frame.x, 0, vw);
  const right = clamp(frame.x + frame.width, 0, vw);
  const top = clamp(frame.y, 0, vh);
  const bottom = clamp(frame.y + frame.height, 0, vh);

  const bars: CameraFrameRect[] = [];
  // Full-width top/bottom bars first, then side bars spanning only the band
  // between them — so the four are disjoint and no pixel is filled twice
  // (which would double a translucent fill).
  if (top > 0) bars.push(rect(0, 0, vw, top));
  if (bottom < vh) bars.push(rect(0, bottom, vw, vh - bottom));
  const bandHeight = Math.max(0, bottom - top);
  if (left > 0 && bandHeight > 0) bars.push(rect(0, top, left, bandHeight));
  if (right < vw && bandHeight > 0) bars.push(rect(right, top, vw - right, bandHeight));

  return {
    frame,
    clip: rect(left, top, right - left, bottom - top),
    bars,
    covered: bars.length === 0,
  };
}

/**
 * Resolve a centered, room-sized aperture for a room slide.
 *
 * Unlike {@link cameraLetterbox}, this intentionally ignores the camera
 * offset. A room slide's camera moves through the two-room union, but the
 * player's window remains centered in the viewport while the rooms move
 * behind it. Pass {@link RoomSlidePresentation.aperture} here rather than its
 * union `bounds`.
 *
 * Pure and canvas-free. Invalid dimensions degrade to a full-viewport frame.
 */
export function cameraApertureLetterbox(
  bounds: FitLevel | CompiledLdtkRoom,
  viewport: Readonly<CameraViewport>,
  zoom: number,
): CameraLetterbox {
  const vw = positive(viewport?.width, 0);
  const vh = positive(viewport?.height, 0);
  const viewportRect = rect(0, 0, vw, vh);
  const full: CameraLetterbox = {
    frame: viewportRect,
    clip: viewportRect,
    bars: [],
    covered: true,
  };
  if (vw === 0 || vh === 0) return full;

  const dims = resolveLevelDims(bounds);
  const z = positive(zoom, 0);
  if (z === 0 || !(dims.width > 0) || !(dims.height > 0)) return full;

  const width = Math.min(vw, dims.width * z);
  const height = Math.min(vh, dims.height * z);
  const frame = rect((vw - width) / 2, (vh - height) / 2, width, height);
  const left = clamp(frame.x, 0, vw);
  const right = clamp(frame.x + frame.width, 0, vw);
  const top = clamp(frame.y, 0, vh);
  const bottom = clamp(frame.y + frame.height, 0, vh);
  const bars: CameraFrameRect[] = [];
  if (top > 0) bars.push(rect(0, 0, vw, top));
  if (bottom < vh) bars.push(rect(0, bottom, vw, vh - bottom));
  const bandHeight = Math.max(0, bottom - top);
  if (left > 0 && bandHeight > 0) bars.push(rect(0, top, left, bandHeight));
  if (right < vw && bandHeight > 0) bars.push(rect(right, top, vw - right, bandHeight));

  return {
    frame,
    clip: rect(left, top, right - left, bottom - top),
    bars,
    covered: bars.length === 0,
  };
}

/**
 * Fill the letterbox bars and clip subsequent drawing to the level frame.
 *
 * Same shape as {@link applyCameraTransform}: compute + apply + return the
 * resolved value. The caller owns `save()` / `restore()`, because the clip has
 * to survive the call — it is the whole point. The bar fill is internally
 * save/restored so `fillStyle` does not leak, matching the surface cache's
 * smoothing guard.
 *
 * Call this BEFORE composing the zoom (the frame is already in screen units),
 * and before any screen shake translate, so the mask stays welded to the
 * viewport while the world shakes inside it.
 *
 * ```ts
 * ctx.save();
 * applyCameraLetterbox(ctx, active, viewport, t, { fill: '#070b18' });
 * ctx.translate(shake.x, shake.y);
 * composeCameraTransform(ctx, t);
 * // …world…
 * ctx.restore();
 * ```
 */
export function applyCameraLetterbox(
  ctx: CanvasRenderingContext2D,
  bounds: FitLevel | CompiledLdtkRoom,
  viewport: Readonly<CameraViewport>,
  transform: Readonly<Pick<CameraTransformResult, 'zoom' | 'offsetX' | 'offsetY'>>,
  options: Readonly<ApplyCameraLetterboxOptions> = {},
): CameraLetterbox {
  const box = cameraLetterbox(bounds, viewport, transform);
  const fill = options.fill === undefined ? '#000000' : options.fill;

  if (fill !== null && box.bars.length > 0) {
    ctx.save();
    try {
      ctx.fillStyle = fill;
      for (const bar of box.bars) ctx.fillRect(bar.x, bar.y, bar.width, bar.height);
    } finally {
      ctx.restore();
    }
  }

  if (options.clip !== false) {
    ctx.beginPath();
    ctx.rect(box.clip.x, box.clip.y, box.clip.width, box.clip.height);
    ctx.clip();
  }

  return box;
}

/** Fill and clip a centered room-slide aperture. */
export function applyCameraApertureLetterbox(
  ctx: CanvasRenderingContext2D,
  bounds: FitLevel | CompiledLdtkRoom,
  viewport: Readonly<CameraViewport>,
  zoom: number,
  options: Readonly<ApplyCameraLetterboxOptions> = {},
): CameraLetterbox {
  const box = cameraApertureLetterbox(bounds, viewport, zoom);
  const fill = options.fill === undefined ? '#000000' : options.fill;

  if (fill !== null && box.bars.length > 0) {
    ctx.save();
    try {
      ctx.fillStyle = fill;
      for (const bar of box.bars) ctx.fillRect(bar.x, bar.y, bar.width, bar.height);
    } finally {
      ctx.restore();
    }
  }

  if (options.clip !== false) {
    ctx.beginPath();
    ctx.rect(box.clip.x, box.clip.y, box.clip.width, box.clip.height);
    ctx.clip();
  }

  return box;
}
