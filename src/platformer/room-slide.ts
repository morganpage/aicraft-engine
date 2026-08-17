/**
 * Phase E3 — supported slide presentation orchestrator.
 *
 * Composes the existing camera brain — NO new camera solver. The orchestrator
 * drives a transient high-priority `fixed` vcam in a normalized two-room
 * coordinate space; enter/exit helpers translate the brain's plain state between
 * source-local, slide-space, and destination-local coordinates. Selection is
 * cleared at each boundary so the brain does NOT stack its default blend on top
 * of the named slide curve.
 *
 * Pure throughout: `beginRoomSlide`/`advanceRoomSlide`/`presentationForRoomSlide`
 * and the enter/finish/cancel camera-space helpers never read host state and
 * never feed camera output back into the kernel (the brain is presentation-only).
 * Reduced motion is an EXPLICIT input — the pure core never reads
 * `window.matchMedia`.
 *
 * Coordinate spaces:
 *  - Each room's player/camera live in that room's LOCAL coords (origin 0,0).
 *  - The LDtk level carries the room's world offset (`worldX`/`worldY`).
 *  - Slide space = the source/destination world-rectangle UNION shifted by the
 *    union's minimum world X/Y, so both offsets are ≥ 0 and the brain's
 *    zero-origin clamp stays valid (including projects with negative worldX/Y).
 *
 * @module
 */

import type {
  Camera,
  CameraBounds,
  CameraBrain,
  CameraTarget,
  CameraViewport,
  FollowBand,
  VirtualCamera,
} from '../camera';
import {
  createCameraBrain,
  DEFAULT_FOLLOW_BODY,
} from '../camera';
import { resolveBand, clampTopLeft } from '../camera/motion';
import type { LdtkLevel } from '../ldtk/types';
import type { CompiledLdtkRoom } from './ldtk-room';
import { rebasePointBetweenLdtkRooms } from './room-transitions';

/** Reserved id for the transient slide-authority vcam. */
export const ROOM_SLIDE_VCAM_ID = '__roomSlide';

/** Default slide duration in seconds (Celeste-feel ~0.30 s). */
export const DEFAULT_ROOM_SLIDE_DURATION = 0.3;

/**
 * The named, exported slide easing: smoothstep (`t*t*(3-2t)`). Symmetric
 * ease-in-out — the camera decelerates into the destination view. Captured in
 * {@link RoomSlideState.easing} so `advanceRoomSlide` finishes deterministically.
 */
export function roomSlideEase(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/** A captured camera endpoint (top-left in that room's LOCAL coords + zoom). */
export interface RoomSlideView {
  /**
   * Camera top-left in that room's LOCAL coordinates, in ROOM-PIXELS (the same
   * unit as `level.pxWid`/`pxHei`, NOT physical/screen px). The camera brain
   * accepts a physical viewport and divides it by zoom internally; the slide
   * endpoints must be in room-px to match. Use {@link roomEntrySlideView} to
   * compute a follow-compatible destination endpoint — do not pass a physical-px
   * camera here.
   */
  readonly camera: Readonly<Camera>;
  /** Strictly-positive camera magnification. */
  readonly zoom: number;
}

/** The actor's position in both rooms' local coordinates (for continuity math). */
export interface RoomSlideActorMapping {
  readonly sourceLocal: Readonly<{ x: number; y: number }>;
  readonly destinationLocal: Readonly<{ x: number; y: number }>;
}

/** Options for {@link beginRoomSlide}. */
export interface RoomSlideOptions {
  /** Slide duration in seconds. Default {@link DEFAULT_ROOM_SLIDE_DURATION} (0.30). */
  readonly duration?: number;
  /** Easing curve. Default {@link roomSlideEase}. Captured in state. */
  readonly easing?: (t: number) => number;
  /** Pause input/sim during the slide. Default `false`. */
  readonly freezeSimulation?: boolean;
  /**
   * Explicit reduced-motion input (the consumer passes `prefersReducedMotion()`).
   * The pure core never reads host state. `true` ⇒ immediate seam-aligned cut
   * (`active: false, t: 1`); the consumer runs enter + finish camera-space
   * rebases in one presentation frame.
   */
  readonly reducedMotion?: boolean;
}

/** The normalized two-room coordinate space the slide runs in. */
export interface RoomSlideSpace {
  /** Union bounds after subtracting the min world X/Y (valid for the brain clamp). */
  readonly bounds: CameraBounds;
  readonly sourceOffset: Readonly<{ x: number; y: number }>;
  readonly destinationOffset: Readonly<{ x: number; y: number }>;
}

/** Immutable slide clock + captured endpoints + correction deltas. */
export interface RoomSlideState {
  readonly active: boolean;
  readonly elapsed: number;
  readonly duration: number;
  /** Eased-independent normalized progress in `[0, 1]`. */
  readonly t: number;
  readonly sourceLevelIid: string;
  readonly destLevelIid: string;
  readonly easing: (t: number) => number;
  readonly freezeSimulation: boolean;
  readonly space: RoomSlideSpace;
  /** Source room rectangle used as the render aperture, not camera clamp space. */
  readonly sourceAperture: CameraBounds;
  /** Destination room rectangle used as the render aperture, not camera clamp space. */
  readonly destinationAperture: CameraBounds;
  readonly sourceView: RoomSlideView;
  readonly destinationView: RoomSlideView;
  /** Dest-player render correction at `t = 0`; presentation eases it to zero. */
  readonly initialPlayerOffset: Readonly<{ x: number; y: number }>;
  /** Add once to source-local particles to express them in destination-local. */
  readonly particleRebaseDelta: Readonly<{ x: number; y: number }>;
}

/**
 * Per-tick presentation output the consumer feeds to render + the camera brain.
 *
 * **Composition.** The offsets below are each room's STATIC origin inside slide
 * space, and the slide vcam moves the camera through that same space — so they
 * compose with the camera transform, they do not replace it. Render under one
 * `composeCameraTransform(ctx, cameraTransform(brain.camera, …))` and pass an
 * offset as a draw's own `worldOffset` (or `ctx.translate`) on top. Drawing at
 * `sourceOffset` alone pins the view to the union's top-left for the whole
 * slide; adding the camera offset into `worldOffset` as well double-counts it.
 */
export interface RoomSlidePresentation {
  /** The transient slide-authority vcam, or `null` when the slide is done. */
  readonly vcam: VirtualCamera | null;
  /**
   * The union bounds the brain is clamped against this tick.
   *
   * CLAMP SPACE, NOT AN APERTURE. Do not hand these to a letterbox mask: the
   * union spans both rooms, so a mask sized from it is roughly twice a room
   * wide and swallows the bars for the length of the slide (a real build
   * shipped exactly that — the world filled the window mid-transition, then
   * snapped back). The window the player looks through stays ONE ROOM while
   * the rooms move behind it; mask with the room, clamp with this.
   */
  readonly bounds: CameraBounds;
  /**
   * The one-room render aperture for this tick. Interpolate this with the
   * slide's easing when room dimensions differ; never use `bounds` here.
   */
  readonly aperture: CameraBounds;
  /** The source room's origin in slide space. Composes with the camera. */
  readonly sourceOffset: Readonly<{ x: number; y: number }>;
  /** The destination room's origin in slide space. Composes with the camera. */
  readonly destinationOffset: Readonly<{ x: number; y: number }>;
  /** Render-only player correction this tick (eases to zero). */
  readonly playerOffset: Readonly<{ x: number; y: number }>;
  readonly freezeSimulation: boolean;
}

/** World rect of a compiled room (reads its LDtk level). */
function worldRectOf(room: CompiledLdtkRoom): {
  x: number; y: number; right: number; bottom: number;
} {
  const lvl = room.ldtkLevel;
  return {
    x: lvl.worldX,
    y: lvl.worldY,
    right: lvl.worldX + lvl.pxWid,
    bottom: lvl.worldY + lvl.pxHei,
  };
}

/**
 * Build the slide clock, coordinate space, endpoints, and correction deltas.
 * Pure.
 *
 * The caller supplies exact endpoint views because the camera brain advances only
 * the SELECTED vcam — there is no independently live inactive destination solver
 * to sample. `views.source` is normally the current rendered `brain.camera`/zoom;
 * `views.destination` is the seam-aligned destination-local view (commonly using
 * `fitCameraZoom` for its lens policy).
 */
export function beginRoomSlide(
  source: CompiledLdtkRoom,
  dest: CompiledLdtkRoom,
  viewport: { readonly width: number; readonly height: number },
  views: { readonly source: RoomSlideView; readonly destination: RoomSlideView },
  actor: RoomSlideActorMapping,
  options?: RoomSlideOptions,
): RoomSlideState {
  const duration = options?.duration ?? DEFAULT_ROOM_SLIDE_DURATION;
  const easing = options?.easing ?? roomSlideEase;
  const freezeSimulation = options?.freezeSimulation ?? false;
  const reducedMotion = options?.reducedMotion ?? false;

  const s = worldRectOf(source);
  const d = worldRectOf(dest);

  // Endpoint view rectangles in authored WORLD coordinates: the rendered camera
  // top-left (room-local) + the room's world origin, sized by the visible world
  // at that endpoint's zoom. Including these in the slide union lets a legitimate
  // negative letterbox camera (a room smaller than the viewport) be represented
  // in slide space — otherwise the fixed vcam's zero-padding clamp would pin it
  // back to the room origin before handoff. Positive-finite fallbacks are used
  // ONLY for constructing these presentation-space rectangles; the caller's
  // endpoint objects stored in RoomSlideState are not mutated.
  const sZoom = finitePositive(views.source.zoom) ? views.source.zoom : 1;
  const dZoom = finitePositive(views.destination.zoom) ? views.destination.zoom : 1;
  const vpW = finitePositive(viewport.width) ? viewport.width : 1;
  const vpH = finitePositive(viewport.height) ? viewport.height : 1;
  const sViewW = vpW / sZoom;
  const sViewH = vpH / sZoom;
  const dViewW = vpW / dZoom;
  const dViewH = vpH / dZoom;
  const sCamWx = s.x + views.source.camera.x;
  const sCamWy = s.y + views.source.camera.y;
  const dCamWx = d.x + views.destination.camera.x;
  const dCamWy = d.y + views.destination.camera.y;

  // The union of all four rectangles, normalized by its min X/Y so every offset
  // is ≥ 0 (the brain's zero-origin clamp stays valid). Room offsets gain a
  // positive letterbox margin when an endpoint view peeks beyond the rooms.
  const minX = Math.min(s.x, d.x, sCamWx, dCamWx);
  const minY = Math.min(s.y, d.y, sCamWy, dCamWy);
  const sourceOffset = { x: s.x - minX, y: s.y - minY };
  const destinationOffset = { x: d.x - minX, y: d.y - minY };
  const bounds: CameraBounds = {
    width: Math.max(s.right, d.right, sCamWx + sViewW, dCamWx + dViewW) - minX,
    height: Math.max(s.bottom, d.bottom, sCamWy + sViewH, dCamWy + dViewH) - minY,
  };
  const space: RoomSlideSpace = { bounds, sourceOffset, destinationOffset };
  const sourceAperture: CameraBounds = { width: s.right - s.x, height: s.bottom - s.y };
  const destinationAperture: CameraBounds = { width: d.right - d.x, height: d.bottom - d.y };

  // Player screen-position continuity at slide start: drawing the dest-local
  // player at destinationOffset would jump it; this correction (eased to 0)
  // makes t=0 match the source-local-in-slide-space position.
  const initialPlayerOffset = {
    x: sourceOffset.x + actor.sourceLocal.x - (destinationOffset.x + actor.destinationLocal.x),
    y: sourceOffset.y + actor.sourceLocal.y - (destinationOffset.y + actor.destinationLocal.y),
  };

  // Particle rebase (equivalent to rebasePointBetweenLdtkRooms): add once to
  // source-local particles so they keep their slide-space position when drawn
  // at destinationOffset.
  const particleRebaseDelta = {
    x: source.ldtkLevel.worldX - dest.ldtkLevel.worldX,
    y: source.ldtkLevel.worldY - dest.ldtkLevel.worldY,
  };

  // Viewport is part of the presentation contract (the consumer drives the brain
  // with it); it is not needed to compute the slide state itself, but we accept
  // it so the call site mirrors the brain's `viewport` argument and stays honest
  // about the presentation surface.
  void viewport;

  return {
    active: !reducedMotion,
    elapsed: 0,
    duration,
    t: reducedMotion ? 1 : 0,
    sourceLevelIid: source.ldtkLevel.iid,
    destLevelIid: dest.ldtkLevel.iid,
    easing,
    freezeSimulation,
    space,
    sourceAperture,
    destinationAperture,
    sourceView: views.source,
    destinationView: views.destination,
    initialPlayerOffset,
    particleRebaseDelta,
  };
}

/** Advance the slide clock by `dt`. Pure. */
export function advanceRoomSlide(slide: RoomSlideState, dt: number): RoomSlideState {
  if (!slide.active) return slide;
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const elapsed = slide.elapsed + step;
  const rawT = slide.duration > 0 ? elapsed / slide.duration : 1;
  const t = rawT >= 1 ? 1 : rawT;
  return { ...slide, elapsed, t, active: t < 1 };
}

/** Vcam + bounds + render offsets for this tick. Pure. */
export function presentationForRoomSlide(slide: RoomSlideState): RoomSlidePresentation {
  const { space, sourceView, destinationView, initialPlayerOffset } = slide;
  if (!slide.active) {
    return {
      vcam: null,
      bounds: space.bounds,
      aperture: slide.destinationAperture,
      sourceOffset: space.sourceOffset,
      destinationOffset: space.destinationOffset,
      playerOffset: { x: 0, y: 0 },
      freezeSimulation: slide.freezeSimulation,
    };
  }

  const easedT = slide.easing(slide.t);
  const aperture: CameraBounds = {
    width: slide.sourceAperture.width + (slide.destinationAperture.width - slide.sourceAperture.width) * easedT,
    height: slide.sourceAperture.height + (slide.destinationAperture.height - slide.sourceAperture.height) * easedT,
  };
  // Endpoint top-lefts expressed in slide space (room-local + room offset).
  const srcCamX = sourceView.camera.x + space.sourceOffset.x;
  const srcCamY = sourceView.camera.y + space.sourceOffset.y;
  const dstCamX = destinationView.camera.x + space.destinationOffset.x;
  const dstCamY = destinationView.camera.y + space.destinationOffset.y;
  const camX = srcCamX + (dstCamX - srcCamX) * easedT;
  const camY = srcCamY + (dstCamY - srcCamY) * easedT;
  const zoom = sourceView.zoom + (destinationView.zoom - sourceView.zoom) * easedT;

  // The sole slide-path authority: blend 0 (no brain blend), snap-threshold ∞
  // (positive dt publishes each finite target exactly), so no default brain
  // blending or body/lens damping applies a second curve on top of `easedT`.
  const vcam: VirtualCamera = {
    id: ROOM_SLIDE_VCAM_ID,
    priority: Number.MAX_SAFE_INTEGER,
    blend: 0,
    body: {
      mode: 'fixed',
      x: camX,
      y: camY,
      motion: { snapThreshold: Number.MAX_VALUE },
    },
    lens: { zoom, motion: { snapThreshold: Number.MAX_VALUE } },
  };

  // Ease the dest-player render correction to zero over the slide.
  const playerOffset = {
    x: initialPlayerOffset.x * (1 - easedT),
    y: initialPlayerOffset.y * (1 - easedT),
  };

  return {
    vcam,
    bounds: space.bounds,
    aperture,
    sourceOffset: space.sourceOffset,
    destinationOffset: space.destinationOffset,
    playerOffset,
    freezeSimulation: slide.freezeSimulation,
  };
}

/**
 * Rebase a brain's plain state by a delta and (optionally) clear selection/blend.
 * Returns a fresh {@link CameraBrain} (the brain is immutable). Frozen blend
 * centres are rebased too so an interrupted blend survives the space switch.
 */
function rebaseBrain(
  brain: CameraBrain,
  delta: { x: number; y: number },
  clear: boolean,
): CameraBrain {
  const blend = brain.blend;
  return {
    camera: { x: brain.camera.x + delta.x, y: brain.camera.y + delta.y },
    zoom: brain.zoom,
    activeId: clear ? null : brain.activeId,
    bodyCamera: { x: brain.bodyCamera.x + delta.x, y: brain.bodyCamera.y + delta.y },
    lensZoom: brain.lensZoom,
    blend:
      clear || blend === null
        ? null
        : {
            ...blend,
            fromCenter: {
              x: blend.fromCenter.x + delta.x,
              y: blend.fromCenter.y + delta.y,
            },
          },
  };
}

/**
 * Rebase source-local brain state into normalized slide space and clear active
 * selection/blend. Call once at slide start. Pure.
 *
 * After this, the brain's `camera`/`bodyCamera` are in slide-space coordinates,
 * so the slide vcam (also slide-space) is the sole path authority — the next
 * destination vcam activation will be a FIRST activation with no incoming blend.
 */
export function enterRoomSlideCameraSpace(
  slide: RoomSlideState,
  brain: CameraBrain,
): CameraBrain {
  return rebaseBrain(brain, slide.space.sourceOffset, true);
}

/**
 * Rebase slide-space brain state into destination-local space and clear active
 * selection/blend. Call once at slide end. Pure.
 *
 * Seeds the destination view from the exact final rendered position; the
 * destination room's ordinary follow solver may continue smoothly from there.
 */
export function finishRoomSlideCameraSpace(
  slide: RoomSlideState,
  brain: CameraBrain,
): CameraBrain {
  return rebaseBrain(
    brain,
    { x: -slide.space.destinationOffset.x, y: -slide.space.destinationOffset.y },
    true,
  );
}

/**
 * Abort/reverse: rebase slide-space brain state into either endpoint room's local
 * space and clear selection/blend. Pure. No slide-space brain may leak into
 * ordinary room rendering.
 *
 * Death/retry/teleport chooses the room the simulation will resume in
 * (`returnTo`); rapid reversal first cancels to the current simulation room,
 * then begins the reverse slide from that local camera state.
 */
export function cancelRoomSlideCameraSpace(
  slide: RoomSlideState,
  brain: CameraBrain,
  returnTo: 'source' | 'destination',
): CameraBrain {
  const offset =
    returnTo === 'source' ? slide.space.sourceOffset : slide.space.destinationOffset;
  return rebaseBrain(brain, { x: -offset.x, y: -offset.y }, true);
}

// --- recommended safe constructors (dip-down prevention) -------------------

/**
 * Create an inactive destination-local brain for a HARD ROOM CUT, preserving
 * the source brain's rendered world-space top-left and rendered zoom.
 *
 * Use this when switching rooms WITHOUT a slide so the destination's
 * first-activation `bodyCamera` (seeded from the carried rendered `camera`) does
 * NOT restart from the room's `(0,0)` origin and visibly dip toward the player.
 * The rebase preserves the exact world position; the destination's real
 * viewport/zoom/bounds clamp (applied by the next `updateCameraBrain`) is the
 * sole authority for bounds validity, so negative destination-local
 * coordinates (a room smaller than the viewport) are preserved until that clamp.
 *
 * Preserves `camera`/`zoom` (the rendered composite), NOT `bodyCamera`/`lensZoom`
 * — those may represent an off-screen live target during an in-flight blend.
 * The result is intentionally inactive (clears selection/blend/live solver
 * state) so the destination room is a first activation with no incoming blend.
 *
 * Do NOT use this result as a room-slide destination endpoint, and do NOT use it
 * after a slide; `finishRoomSlideCameraSpace` already owns the post-slide
 * handoff. Exact world-space rebasing makes the source and rebased destination
 * top-left identical once both are expressed in slide space, producing ZERO
 * spatial slide travel — a slide destination view must be selected
 * independently from the destination's desired framing and lens.
 *
 * Pure: never reads host state or logs.
 */
export function seedRoomCutCamera(
  sourceBrain: Readonly<CameraBrain>,
  sourceLevel: LdtkLevel,
  destinationLevel: LdtkLevel,
): CameraBrain {
  const camera = rebasePointBetweenLdtkRooms(
    sourceBrain.camera,
    sourceLevel,
    destinationLevel,
  );
  return createCameraBrain({ x: camera.x, y: camera.y, zoom: sourceBrain.zoom });
}

/**
 * Begin a room slide using the brain's CURRENTLY RENDERED camera/zoom as the
 * source endpoint, preventing source-view/brain divergence by construction.
 *
 * A consumer can accidentally supply `beginRoomSlide` a source view that
 * differs from the `CameraBrain` currently being rendered (e.g. passing a fresh
 * `(0,0)` brain while the rendered camera is mid-room), which makes the slide
 * interpolate from the wrong origin and visibly dip. This wrapper derives the
 * source endpoint directly from the rendered brain, so the divergence is
 * impossible rather than caught after the fact. It also captures rendered
 * `zoom`, so lens continuity cannot diverge independently from position.
 *
 * The caller still chooses the destination view (`destinationView`) because the
 * engine cannot infer a game's desired destination follow target, fit mode, or
 * lens policy. Delegates to {@link beginRoomSlide} with a COPIED source point
 * (the caller's brain nested reference is not retained), so mutating/replacing
 * the caller's brain reference after construction cannot change the captured
 * source endpoint.
 *
 * Pure: never reads environment globals or logs.
 */
export function beginRoomSlideFromBrain(
  source: CompiledLdtkRoom,
  destination: CompiledLdtkRoom,
  viewport: Readonly<{ width: number; height: number }>,
  sourceBrain: Readonly<CameraBrain>,
  destinationView: Readonly<RoomSlideView>,
  actor: Readonly<RoomSlideActorMapping>,
  options?: Readonly<RoomSlideOptions>,
): RoomSlideState {
  return beginRoomSlide(
    source,
    destination,
    viewport,
    {
      source: {
        camera: { x: sourceBrain.camera.x, y: sourceBrain.camera.y },
        zoom: sourceBrain.zoom,
      },
      destination: {
        camera: { x: destinationView.camera.x, y: destinationView.camera.y },
        zoom: destinationView.zoom,
      },
    },
    actor,
    options,
  );
}

// --- roomEntrySlideView — follow-compatible destination framing ------------

/**
 * Options for {@link roomEntrySlideView}. Pass the same follow bands and padding
 * used by the destination follow vcam so the computed view is an equilibrium of
 * that body (its first follow step does not move the camera).
 */
export interface RoomEntrySlideViewOptions {
  /** Match the destination follow vcam. Defaults to {@link DEFAULT_FOLLOW_BODY}.followX. */
  readonly followX?: Readonly<FollowBand>;
  /** Match the destination follow vcam. Defaults to {@link DEFAULT_FOLLOW_BODY}.followY. */
  readonly followY?: Readonly<FollowBand>;
  /** Match the destination follow vcam. Defaults to `0`. */
  readonly padding?: number;
}

/** Finite and strictly positive (defensive numeric fallback for viewport/zoom). */
function finitePositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** Finite and non-negative (defensive numeric fallback for room bounds/padding). */
function finiteNonNegative(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/** Finite (defensive numeric fallback for target coordinates). */
function finiteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * The deadzone anchor for an equilibrium: the screen fraction at which the
 * camera holds the target. Any anchor in `[trail, lead]` is a deadzone hold; we
 * pick `0.5` (centered framing) when it lies in the band, otherwise the nearest
 * valid band edge — so default bands center the target while a custom band that
 * excludes the center still yields a stable equilibrium.
 */
function deadzoneAnchor(band: Readonly<FollowBand>): number {
  if (0.5 >= band.trail && 0.5 <= band.lead) return 0.5;
  return 0.5 < band.trail ? band.trail : band.lead;
}

/**
 * Compute a follow-compatible destination view for a room slide.
 *
 * `viewport` is in PHYSICAL screen pixels. The returned `camera` top-left is in
 * destination-local ROOM-PIXELS — the coordinate space {@link RoomSlideView}.camera
 * requires (same unit as `level.pxWid`/`pxHei`, not physical/screen px). The brain
 * and the slide endpoints work in room-px; this helper divides the physical
 * viewport by `zoom` internally so the math runs in that space.
 *
 * The result is AN equilibrium of the destination follow body for the supplied
 * deadzone bands and padding: if a destination brain is seeded at this view with
 * the same target, zoom, bands, and padding, its first follow step does not move
 * the camera (the target sits in the deadzone hold range). It is deliberately
 * not described as the unique position an arbitrary already-running deadzone
 * solver would reach — deadzones have a range of valid hold positions.
 *
 * Pass the same `followX`/`followY`/`padding` as the destination follow vcam so
 * the post-slide handoff continues from the same equilibrium (no correction pop).
 *
 * Pure: never reads host state.
 */
export function roomEntrySlideView(
  room: CompiledLdtkRoom,
  entryTarget: Readonly<CameraTarget>,
  viewport: Readonly<CameraViewport>,
  zoom: number,
  options?: Readonly<RoomEntrySlideViewOptions>,
): RoomSlideView {
  const lvl = room.ldtkLevel;
  // Defensive numeric resolution (mirrors the camera brain's policy).
  const z = finitePositive(zoom) ? zoom : 1;
  const vw = finitePositive(viewport.width) ? viewport.width : 1;
  const vh = finitePositive(viewport.height) ? viewport.height : 1;
  const bw = finiteNonNegative(lvl.pxWid) ? lvl.pxWid : 0;
  const bh = finiteNonNegative(lvl.pxHei) ? lvl.pxHei : 0;
  const padding = finiteNonNegative(options?.padding) ? (options?.padding as number) : 0;
  const tx = finiteNumber(entryTarget.x) ? entryTarget.x : 0;
  const ty = finiteNumber(entryTarget.y) ? entryTarget.y : 0;
  const tw = finitePositive(entryTarget.width) ? entryTarget.width : 0;
  const th = finitePositive(entryTarget.height) ? entryTarget.height : 0;

  // Visible room-px (the brain divides the physical viewport by zoom internally).
  const visibleW = vw / z;
  const visibleH = vh / z;

  const bandX = resolveBand(options?.followX, DEFAULT_FOLLOW_BODY.followX);
  const bandY = resolveBand(options?.followY, DEFAULT_FOLLOW_BODY.followY);
  const anchorX = deadzoneAnchor(bandX);
  const anchorY = deadzoneAnchor(bandY);

  // Desired top-left: center the target at the deadzone anchor, in room-px.
  const targetCenterX = tx + tw / 2;
  const targetCenterY = ty + th / 2;
  const desiredX = targetCenterX - anchorX * visibleW;
  const desiredY = targetCenterY - anchorY * visibleH;

  // Reuse the follow body's clamp: letterbox-center when room ≤ visible, else
  // padded clamp to [−padding, bound − visible + padding].
  const cameraX = clampTopLeft(desiredX, bw, visibleW, padding);
  const cameraY = clampTopLeft(desiredY, bh, visibleH, padding);

  return { camera: { x: cameraX, y: cameraY }, zoom: z };
}
