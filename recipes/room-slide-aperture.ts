import {
  applyCameraApertureLetterbox,
  cameraApertureLetterbox,
  presentationForRoomSlide,
  type ApplyCameraLetterboxOptions,
  type CameraLetterbox,
  type CameraViewport,
  type RoomSlideState,
} from 'aicraft-engine';

/**
 * The one-room aperture for this tick of a room slide, ready to hand to
 * `cameraApertureLetterbox`.
 *
 * ⚠ The slide's union `bounds` are CLAMP SPACE for the camera brain, never a
 * letterbox mask: the union spans both rooms, so bars sized from it vanish
 * for the length of the slide. The engine interpolates
 * `sourceAperture → destinationAperture` with the slide's easing inside
 * `presentationForRoomSlide` — this recipe is that call, named so briefs can
 * point at it instead of re-deriving (and mis-deriving) the rule.
 */
export function roomSlideAperture(slide: RoomSlideState): { width: number; height: number } {
  return presentationForRoomSlide(slide).aperture;
}

/**
 * The room-slide letterbox (pure, canvas-free): the centered one-room
 * aperture for this tick as bars + clip. Draw it when you need the geometry
 * but not the fill.
 */
export function roomSlideApertureLetterbox(
  slide: RoomSlideState,
  viewport: Readonly<CameraViewport>,
  zoom: number,
): CameraLetterbox {
  return cameraApertureLetterbox(roomSlideAperture(slide), viewport, zoom);
}

/**
 * Fill the letterbox bars and clip to the one-room aperture for this tick.
 * Call ONCE per frame, before drawing either room; the caller owns
 * `ctx.save()` / `ctx.restore()` around the world draw (the clip must
 * survive this call).
 */
export function applyRoomSlideApertureLetterbox(
  ctx: CanvasRenderingContext2D,
  slide: RoomSlideState,
  viewport: Readonly<CameraViewport>,
  zoom: number,
  options: Readonly<ApplyCameraLetterboxOptions> = {},
): CameraLetterbox {
  return applyCameraApertureLetterbox(ctx, roomSlideAperture(slide), viewport, zoom, options);
}
