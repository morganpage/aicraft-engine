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
  VirtualCamera,
} from '../camera';
import type { CompiledLdtkRoom } from './ldtk-room';

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
  /** Camera top-left in that room's local coordinates. */
  readonly camera: Readonly<Camera>;
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
  readonly sourceView: RoomSlideView;
  readonly destinationView: RoomSlideView;
  /** Dest-player render correction at `t = 0`; presentation eases it to zero. */
  readonly initialPlayerOffset: Readonly<{ x: number; y: number }>;
  /** Add once to source-local particles to express them in destination-local. */
  readonly particleRebaseDelta: Readonly<{ x: number; y: number }>;
}

/** Per-tick presentation output the consumer feeds to render + the camera brain. */
export interface RoomSlidePresentation {
  /** The transient slide-authority vcam, or `null` when the slide is done. */
  readonly vcam: VirtualCamera | null;
  readonly bounds: CameraBounds;
  readonly sourceOffset: Readonly<{ x: number; y: number }>;
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
  const minX = Math.min(s.x, d.x);
  const minY = Math.min(s.y, d.y);
  const sourceOffset = { x: s.x - minX, y: s.y - minY };
  const destinationOffset = { x: d.x - minX, y: d.y - minY };
  // Union bounds in the shifted space — always non-negative width/height.
  const bounds: CameraBounds = {
    width: Math.max(s.right, d.right) - minX,
    height: Math.max(s.bottom, d.bottom) - minY,
  };
  const space: RoomSlideSpace = { bounds, sourceOffset, destinationOffset };

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
      sourceOffset: space.sourceOffset,
      destinationOffset: space.destinationOffset,
      playerOffset: { x: 0, y: 0 },
      freezeSimulation: slide.freezeSimulation,
    };
  }

  const easedT = slide.easing(slide.t);
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
