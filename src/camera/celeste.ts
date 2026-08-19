/**
 * The Celeste camera, as a preset — the decompile-verified constants.
 *
 * The original's camera is a **fixed 320×180 world-pixel window that never
 * zooms**; every room is a pixel rectangle *at least* one screen, and the
 * camera — a player-centered target with one exponential ease — is hard-clamped
 * so it can never show outside the current room. A room bigger than one screen
 * scrolls under the window; the window itself never changes size. That is the
 * whole system: no dynamic zoom, no per-room fit, no deadzone.
 *
 * That invariant is the one detail builds keep getting wrong, because fitting
 * feels like the obvious move: `fitCameraZoom(room, …)` — in EITHER mode —
 * sizes the lens to the ROOM, so zoom tracks room size and every room is fully
 * visible at its own scale. Celeste's invariant is the opposite: fit a CONSTANT
 * window (the one-screen room size) and let the room-bounds clamp scroll
 * bigger rooms under it. A real build shipped the per-room fit, read as "shows
 * the whole level" where Celeste reads as "shows one screen", and re-derived
 * this table to fix it. {@link CELESTE_CAMERA_WINDOW} + {@link celesteCameraZoom}
 * is that fix, pre-derived.
 *
 * Reference table (verified line-by-line against the decompile,
 * TheCyndaquilDecompilers/Celeste_Decompiled):
 *
 * | Piece | Value | Source (decompile) |
 * | --- | --- | --- |
 * | Viewport | 320×180, fixed, no zoom | `Celeste.cs:300`, `Level.cs:4460` |
 * | One-screen room | 40×23 tiles × 8px = 320×184 (the 4px slack is the vertical clamp range) | `LevelData`, 8px grid |
 * | Follow target | player position − (160, 90), every frame | `Player.cs:1214` |
 * | Deadzone / look-up/down | none — recenters unconditionally | `Player.cs` (absent) |
 * | Room clamp | `X ∈ [L, R−320]`, `Y ∈ [T, B−180]` | `Player.cs:1262` |
 * | Ease | `× (1 − 0.01^Δt)` — half-life ≈ 0.1505 s, uncapped | `Player.cs:827` |
 * | Transition | 0.65 s, CubeOut (= easeOutCubic) | `Level.cs:3056`, `4793` |
 * | Spawn/respawn | instant snap, no lerp | `Level.cs:2835` |
 * | Render | float position, floored in the matrix | `Camera.cs` `UpdateMatrices` |
 *
 * What the engine already owns, so this preset does not re-implement it: the
 * room-bounds clamp and letterbox-centering (`followPosition`), the
 * spawn/respawn snap (`snapCameraBrain`), pixel-snapped rendering
 * (`cameraTransform` — a stricter device-pixel version of the floored matrix),
 * and the slide machinery (`beginSessionRoomSlide` + friends). This module is
 * the constants and the two assemblies — window, bands, motion, slide feel —
 * plus the follow vcam that ties them together.
 *
 * Pure throughout: constants and pure functions; no host reads, never throws.
 *
 * @module
 */

import { easeOutCubic } from '../easing';
import { fitCameraZoom } from './fit';
import { devicePixelSnapThreshold } from './motion';
import type { CameraViewport, FollowBand, VirtualCamera } from './types';

/**
 * The world rectangle the lens fits — Celeste's ONE-SCREEN ROOM
 * (40×23 tiles × 8px = 320×184), not its 320×180 viewport. Fitting the room
 * size rather than the viewport is deliberate: a one-screen room then fills
 * the window exactly (the 4px/zoom slack becomes the camera's vertical clamp
 * range, exactly as in the original), and rooms of any other size keep the
 * same campaign-constant zoom.
 *
 * This is the rectangle to pass {@link fitCameraZoom} — and the ONLY one.
 * Never fit the room: zoom would then vary with room size, which is the
 * opposite of Celeste's fixed lens.
 */
export const CELESTE_CAMERA_WINDOW: Readonly<{ width: number; height: number }> = Object.freeze({
  width: 320,
  height: 184,
});

/**
 * The decompile's framing: recenter on the player EVERY frame. `trail == lead
 * == 0.5` makes the deadzone hold range measure-zero, so any off-center player
 * aims the camera at exact center — `Player.CameraTarget` has no deadzone at
 * all. Use for both axes unless you want the ahead framing.
 */
export const CELESTE_FOLLOW_CENTERED: Readonly<FollowBand> = Object.freeze({
  trail: 0.5,
  lead: 0.5,
});

/**
 * The ahead framing: pin the player at 1/3 from the left so ~2/3 of the view
 * shows the level AHEAD. This is the framing the original produces with an
 * authored room `cameraOffset` of +48px (player at ~35%), made the default —
 * a playtested author's-call variant, not a decompile value. The room-bounds
 * clamp still wins near the right wall. Pass as `followX` (keep
 * {@link CELESTE_FOLLOW_CENTERED} for `followY`); also pass it to
 * `roomEntrySlideView` so a slide's destination endpoint is an equilibrium of
 * the same body.
 */
export const CELESTE_FOLLOW_AHEAD: Readonly<FollowBand> = Object.freeze({
  trail: 1 / 3,
  lead: 1 / 3,
});

/**
 * Celeste's room transition duration: `DefaultTransitionDuration`
 * (`Level.cs:4793`) — 0.65 s. Pair with {@link CELESTE_ROOM_SLIDE_OPTIONS};
 * exported alone for consumers that compose their own options object.
 */
export const CELESTE_ROOM_SLIDE_DURATION = 0.65;

/**
 * Celeste's transition feel: 0.65 s under CubeOut — `1 − (1−t)³`, i.e. the
 * easing module's `easeOutCubic` (fast start, decelerate into the destination),
 * unlike the engine default's symmetric smoothstep.
 *
 * Structurally compatible with the platformer slide options — spread it and
 * add the host-state decisions the pure core never reads:
 *
 * ```ts
 * beginSessionRoomSlide(session, input, {
 *   ...CELESTE_ROOM_SLIDE_OPTIONS,
 *   reducedMotion: prefersReducedMotion(),
 * });
 * ```
 */
export const CELESTE_ROOM_SLIDE_OPTIONS: Readonly<{
  duration: number;
  easing: (t: number) => number;
}> = Object.freeze({ duration: CELESTE_ROOM_SLIDE_DURATION, easing: easeOutCubic });

/**
 * The campaign-constant zoom: the lens fitted to {@link CELESTE_CAMERA_WINDOW},
 * contain + integer scale. Depends on the VIEWPORT only — never on any room —
 * which is the whole point: pass this at every former fit site (room view,
 * reset, slide destination) and the zoom stops changing mid-campaign except on
 * resize. A room larger than the window scrolls under it via the ordinary
 * room-bounds clamp; a room smaller centers/letterboxes the same way.
 */
export function celesteCameraZoom(
  viewport: Readonly<CameraViewport>,
): number {
  return fitCameraZoom(CELESTE_CAMERA_WINDOW, viewport, {
    mode: 'contain',
    integerScale: true,
  });
}

/**
 * Celeste's follow ease, terminated below one rendered device pixel.
 *
 * `halfLife: 0.15` is the decompile value to four figures (`1 − 0.01^dt` decays
 * the remaining distance to 1% per second: ln2/ln100 ≈ 0.1505 s).
 *
 * `maxSpeed: 1600` px/s is a CAP the original does not have — deliberately
 * kept, because it only engages beyond ~1.1 screens of error, which an
 * always-centering target never accumulates (steady-state lag while moving is
 * `v/λ` ≈ 52px at 240px/s). Raise it only if tall multi-screen rooms someday
 * outrun it; the decompile's implied one-screen peak is ≈1474 px/s.
 *
 * `snapThreshold` is {@link devicePixelSnapThreshold} — see its note for why a
 * fixed world-pixel threshold visibly LURCHES under zoom.
 */
export function celesteFollowMotion(
  zoom: number,
  dpr: number,
): { halfLife: number; maxSpeed: number; snapThreshold: number } {
  return {
    halfLife: 0.15,
    maxSpeed: 1600,
    snapThreshold: devicePixelSnapThreshold(zoom, dpr),
  };
}

/** Options for {@link celesteFollowVcam}. */
export interface CelesteFollowVcamOptions {
  /** Physical CSS-pixel viewport (`canvasCssViewport`) — drives the lens fit. */
  readonly viewport: Readonly<CameraViewport>;
  /** Device pixel ratio — drives the follow snap threshold. Default 1. */
  readonly dpr?: number;
  /** Key into the brain's target table. Default `'player'`. */
  readonly targetKey?: string;
  /** Horizontal band. Default {@link CELESTE_FOLLOW_CENTERED} (the decompile). */
  readonly followX?: Readonly<FollowBand>;
  /** Vertical band. Default {@link CELESTE_FOLLOW_CENTERED}. */
  readonly followY?: Readonly<FollowBand>;
  /** Non-negative world-unit overscan. Default 0 (Celeste clamps flush). */
  readonly padding?: number;
}

/**
 * Assemble the per-room Celeste follow vcam — the complete
 * {@link VirtualCamera} the brain selects for ordinary in-room play:
 *
 * ```ts
 * const vcam = celesteFollowVcam(room.ldtkLevel.iid, { viewport, dpr, followX: CELESTE_FOLLOW_AHEAD });
 * brain = snapCameraBrain(brain, {   // boot / reset / respawn: instant, no ease
 *   vcams: [vcam],
 *   targets: { player: state.core },
 *   bounds: { width: room.levelData.width, height: room.levelData.height },
 *   viewport,
 *   activeId: vcam.id,
 *   dt,
 * });
 * ```
 *
 * `blend: 0` — room-local coordinates mean a room switch is a cut in position,
 * and the zoom is campaign-constant so there is nothing to blend; the ROOM
 * SLIDE owns cross-room presentation instead (§ the platformer session). Use
 * `snapCameraBrain` at boot, campaign reset, and hard respawn (`Level.cs:2835`
 * — the original snaps instantly, never eases in), `updateCameraBrain` per
 * tick thereafter. The same options' `followX`/`followY` go to
 * `roomEntrySlideView` so a slide's destination framing is an equilibrium of
 * this body.
 *
 * Pure: returns a fresh vcam; never reads host state, never throws.
 */
export function celesteFollowVcam(
  id: string,
  options: Readonly<CelesteFollowVcamOptions>,
): VirtualCamera {
  const zoom = celesteCameraZoom(options?.viewport);
  const dpr = typeof options?.dpr === 'number' && Number.isFinite(options.dpr) && options.dpr > 0
    ? options.dpr
    : 1;
  return {
    id,
    priority: 0,
    blend: 0,
    body: {
      mode: 'follow',
      targetKey: options?.targetKey ?? 'player',
      followX: options?.followX ?? CELESTE_FOLLOW_CENTERED,
      followY: options?.followY ?? CELESTE_FOLLOW_CENTERED,
      motion: celesteFollowMotion(zoom, dpr),
      padding: typeof options?.padding === 'number' && Number.isFinite(options.padding) &&
          options.padding >= 0
        ? options.padding
        : 0,
    },
    lens: { zoom },
  };
}
