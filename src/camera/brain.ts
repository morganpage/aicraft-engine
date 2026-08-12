/**
 * Camera brain — a light Cinemachine-style selector/blender.
 *
 * Virtual cameras (`VirtualCamera`) are plain config objects: selection
 * metadata, an optional placement body (follow or fixed), an optional lens
 * target, and an incoming blend duration. The brain is stateful-but-pure:
 * {@link updateCameraBrain} advances selection, an independent live body/lens,
 * and a rendered composite, returning a fresh {@link CameraBrain} each call.
 *
 * Layers (see `docs/design/camera-brain-plan.md`):
 *   - Body: `follow` deadzone-follows a target key from the caller's table;
 *     `fixed` converges to an exact world-space viewport top-left.
 *   - Lens: a strictly-positive zoom target, damped independently.
 *   - Brain: holds the rendered camera/zoom, the active selection, the
 *     incoming body/lens live state, and an optional frozen-source blend.
 *
 * The split between rendered state (`camera`/`zoom`) and live destination
 * state (`bodyCamera`/`lensZoom`) is the key invariant: during a blend the
 * live solver advances independently and the rendered output is a composite,
 * so a slow blend can never feed back into the solver and cause double easing.
 *
 * Pure throughout: no `Math.random`, no `Date.now`, no DOM; inputs are never
 * mutated and outputs are fresh objects. Deterministic given fixed `dt` and
 * inputs. The brain is deliberately outside the replay hash — it consumes
 * simulation state but produces presentation state only.
 *
 * @module
 */

import type {
  Camera,
  CameraBrain,
  CameraBrainOptions,
  CameraBounds,
  CameraTarget,
  CameraViewport,
  DampedMotionConfig,
  FollowBand,
  FollowBodyConfig,
  VirtualCamera,
} from './types';
import {
  DEFAULT_BRAIN_BLEND_DURATION,
  DEFAULT_CAMERA_MOTION,
  DEFAULT_FOLLOW_BODY,
  DEFAULT_LENS_MOTION,
} from './constants';
import { converge, clampTopLeft, followPosition, mergeMotion, resolveBand } from './motion';
import { lerp } from '../primitives/pixel';

// --- numeric guards (mirrors motion.ts; kept local for self-containment) --

function isFinitePositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}
function isFiniteNonNegative(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}
function finiteElse(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// --- resolved (normalized) vcam shape -------------------------------------

interface ResolvedFollowBody {
  readonly mode: 'follow';
  readonly targetKey: string;
  readonly followX: Readonly<FollowBand>;
  readonly followY: Readonly<FollowBand>;
  readonly motion: Required<DampedMotionConfig>;
  readonly padding: number;
}
interface ResolvedFixedBody {
  readonly mode: 'fixed';
  readonly x: number;
  readonly y: number;
  readonly motion: Required<DampedMotionConfig>;
  readonly padding: number;
}
type ResolvedBody = ResolvedFollowBody | ResolvedFixedBody;

interface ResolvedLens {
  readonly zoom: number;
  readonly motion: Required<DampedMotionConfig>;
}

interface NormalizedVcam {
  readonly id: string;
  readonly priority: number;
  readonly blend: number;
  readonly body: ResolvedBody | null;
  readonly lens: ResolvedLens | null;
}

// --- normalization --------------------------------------------------------

/** Normalize an incoming blend duration: absent/non-finite → default; finite kept (<=0 disables). */
function normalizeBlend(b: number | undefined): number {
  if (b === undefined || !Number.isFinite(b)) return DEFAULT_BRAIN_BLEND_DURATION;
  return b;
}

/** Resolve a body config into a validated {@link ResolvedBody}, or `null` when absent/unknown. */
function normalizeBody(body: unknown): ResolvedBody | null {
  if (body === null || typeof body !== 'object') return null;
  const b = body as { mode?: unknown; targetKey?: unknown; followX?: unknown; followY?: unknown; motion?: unknown; padding?: unknown; x?: unknown; y?: unknown };
  if (b.mode === 'follow') {
    const targetKey =
      typeof b.targetKey === 'string' && b.targetKey !== '' ? b.targetKey : DEFAULT_FOLLOW_BODY.targetKey;
    return {
      mode: 'follow',
      targetKey,
      followX: resolveBand(b.followX as Readonly<FollowBand> | undefined, DEFAULT_FOLLOW_BODY.followX),
      followY: resolveBand(b.followY as Readonly<FollowBand> | undefined, DEFAULT_FOLLOW_BODY.followY),
      motion: mergeMotion(b.motion as Readonly<DampedMotionConfig> | undefined, DEFAULT_CAMERA_MOTION),
      padding: isFiniteNonNegative(b.padding) ? (b.padding as number) : 0,
    };
  }
  if (b.mode === 'fixed') {
    return {
      mode: 'fixed',
      x: typeof b.x === 'number' ? b.x : NaN,
      y: typeof b.y === 'number' ? b.y : NaN,
      motion: mergeMotion(b.motion as Readonly<DampedMotionConfig> | undefined, DEFAULT_CAMERA_MOTION),
      padding: isFiniteNonNegative(b.padding) ? (b.padding as number) : 0,
    };
  }
  return null;
}

/** Resolve a lens config into a {@link ResolvedLens}, or `null` when absent/invalid. */
function normalizeLens(lens: unknown): ResolvedLens | null {
  if (lens === null || typeof lens !== 'object') return null;
  const l = lens as { zoom?: unknown; motion?: unknown };
  if (!isFinitePositive(l.zoom)) return null;
  return {
    zoom: l.zoom,
    motion: mergeMotion(l.motion as Readonly<DampedMotionConfig> | undefined, DEFAULT_LENS_MOTION),
  };
}

/**
 * Normalize the vcam collection.
 *
 * Arrays use array order; records use ECMAScript `Object.values` enumeration
 * order. Empty ids are ignored; on duplicate ids the first normalized entry
 * wins. Priority non-finite/absent → 0. Blend is normalized via
 * {@link normalizeBlend}. Bodies and lenses are resolved/validated.
 */
function normalizeVcams(
  vcams: CameraBrainOptions['vcams'],
): readonly NormalizedVcam[] {
  const list: readonly VirtualCamera[] = Array.isArray(vcams) ? vcams : Object.values(vcams);
  const out: NormalizedVcam[] = [];
  const seen = new Set<string>();
  for (const v of list) {
    if (v === null || typeof v !== 'object') continue;
    const id = typeof v.id === 'string' ? v.id : '';
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      priority: typeof v.priority === 'number' && Number.isFinite(v.priority) ? v.priority : 0,
      blend: normalizeBlend(v.blend),
      body: normalizeBody(v.body),
      lens: normalizeLens(v.lens),
    });
  }
  return out;
}

// --- selection ------------------------------------------------------------

/**
 * Select the active vcam id.
 *
 * A valid `overrideId` wins outright. Otherwise the highest normalized
 * priority wins; ties keep `stateActiveId` when it is still present at that
 * priority, else the first normalized vcam at that priority. Returns `null`
 * when there are no normalized vcams.
 */
function selectActive(
  normalized: readonly NormalizedVcam[],
  stateActiveId: string | null,
  overrideId: string | undefined,
): string | null {
  if (normalized.length === 0) return null;
  if (typeof overrideId === 'string' && overrideId !== '') {
    if (normalized.some((v) => v.id === overrideId)) return overrideId;
  }
  let maxPriority = normalized[0].priority;
  for (const v of normalized) if (v.priority > maxPriority) maxPriority = v.priority;
  if (stateActiveId !== null) {
    const active = normalized.find((v) => v.id === stateActiveId);
    if (active !== undefined && active.priority === maxPriority) return stateActiveId;
  }
  const first = normalized.find((v) => v.priority === maxPriority);
  return first !== undefined ? first.id : normalized[0].id;
}

// --- carried-state repair -------------------------------------------------

/** Repair non-finite/invalid carried state to documented defaults. */
function repairBrain(state: Readonly<CameraBrain>): CameraBrain {
  return {
    camera: { x: finiteElse(state.camera.x, 0), y: finiteElse(state.camera.y, 0) },
    zoom: isFinitePositive(state.zoom) ? state.zoom : 1,
    activeId: state.activeId,
    bodyCamera: { x: finiteElse(state.bodyCamera.x, 0), y: finiteElse(state.bodyCamera.y, 0) },
    lensZoom: isFinitePositive(state.lensZoom) ? state.lensZoom : 1,
    blend: state.blend,
  };
}

// --- small geometry helpers ----------------------------------------------

/** World-space centre of the viewport described by a top-left + physical viewport + zoom. */
function viewCentre(
  camera: Readonly<Camera>,
  viewport: Readonly<CameraViewport>,
  zoom: number,
): { x: number; y: number } {
  const vw = viewport.width / zoom;
  const vh = viewport.height / zoom;
  return { x: camera.x + vw / 2, y: camera.y + vh / 2 };
}

/** Look up a target by key without triggering TS index assumptions. */
function lookupTarget(
  targets: Readonly<Record<string, CameraTarget>>,
  key: string,
): CameraTarget | undefined {
  return Object.prototype.hasOwnProperty.call(targets, key) ? targets[key] : undefined;
}

/** Hold the current top-left (centre preserved when in range) and clamp to bounds. */
function holdAndClamp(
  camera: Readonly<Camera>,
  viewport: Readonly<CameraViewport>,
  zoom: number,
  bounds: Readonly<CameraBounds>,
  padding: number,
): Camera {
  const vw = viewport.width / zoom;
  const vh = viewport.height / zoom;
  return {
    x: clampTopLeft(camera.x, bounds.width, vw, padding),
    y: clampTopLeft(camera.y, bounds.height, vh, padding),
  };
}

/**
 * Smallest uniform padding that lets the current rendered top-left survive a
 * clamp unchanged. This is derived from the captured VIEW, not from the old
 * vcam definition: the old vcam may have been removed from `options.vcams`,
 * and during an interrupted blend its configured padding is not necessarily
 * the padding represented by the current rendered composite.
 *
 * Letterboxed axes need no padding because {@link clampTopLeft} ignores padding
 * there and a valid carried render is already centred on that axis.
 */
function requiredClampPadding(
  camera: Readonly<Camera>,
  viewport: Readonly<CameraViewport>,
  zoom: number,
  bounds: Readonly<CameraBounds>,
): number {
  const vw = viewport.width / zoom;
  const vh = viewport.height / zoom;
  let required = 0;
  if (bounds.width > vw) {
    required = Math.max(required, -camera.x, camera.x - (bounds.width - vw));
  }
  if (bounds.height > vh) {
    required = Math.max(required, -camera.y, camera.y - (bounds.height - vh));
  }
  return required;
}

/** One fixed-body axis: converge toward the clamped desired top-left (non-finite desired holds). */
function fixedAxis(
  cam: number,
  desiredInput: number,
  bound: number,
  visible: number,
  padding: number,
  dt: number,
  motion: Readonly<DampedMotionConfig>,
): number {
  const desired = Number.isFinite(desiredInput) ? desiredInput : cam;
  const clamped = clampTopLeft(desired, bound, visible, padding);
  return converge(cam, clamped, dt, motion);
}

// --- public API -----------------------------------------------------------

/**
 * Create a fresh inactive brain. Position defaults to `(0, 0)`, zoom to `1`,
 * and `bodyCamera`/`lensZoom` start equal to the rendered values. The brain
 * becomes active on its first {@link updateCameraBrain} with at least one vcam.
 */
export function createCameraBrain(
  initial: { x?: number; y?: number; zoom?: number } = {},
): CameraBrain {
  const x = finiteElse(initial.x, 0);
  const y = finiteElse(initial.y, 0);
  const zoom = isFinitePositive(initial.zoom) ? initial.zoom : 1;
  return {
    camera: { x, y },
    zoom,
    activeId: null,
    bodyCamera: { x, y },
    lensZoom: zoom,
    blend: null,
  };
}

/** Build the "inactive / hold" result from repaired state (no vcam selected). */
function inactiveHold(repaired: Readonly<CameraBrain>): CameraBrain {
  return {
    camera: { x: repaired.camera.x, y: repaired.camera.y },
    zoom: repaired.zoom,
    activeId: null,
    bodyCamera: { x: repaired.bodyCamera.x, y: repaired.bodyCamera.y },
    lensZoom: repaired.lensZoom,
    blend: null,
  };
}

/**
 * Advance the brain one step: selection, the live lens/body, and the rendered
 * blend. Pure — returns a fresh {@link CameraBrain}, never mutates any input.
 *
 * Per-step order (after selection/lifecycle handling):
 *  1. Sanitize `dt`, viewport, bounds, and carried state.
 *  2. Advance `lensZoom` toward the selected lens target (absent/invalid → hold).
 *  3. Re-anchor `bodyCamera` so its prior world-space view centre is preserved
 *     across the live zoom change.
 *  4. Advance the selected body from `bodyCamera` using the new live zoom.
 *  5. Without a blend, publish the live state as the rendered state.
 *  6. With a blend, advance `elapsed`, smoothstep-interpolate the frozen source
 *     centre/zoom toward the live centre/zoom, and derive the rendered top-left.
 *  7. Clamp the rendered top-left. During a blend, crossfade the clamp padding
 *     from the frozen source view's padding to the incoming body's (so the
 *     first frame reproduces the previous render); at `t >= 1` publish the
 *     live state exactly and clear the blend.
 */
export function updateCameraBrain(
  state: Readonly<CameraBrain>,
  options: Readonly<CameraBrainOptions>,
): CameraBrain {
  // 1. Sanitize carried state, dt, viewport, bounds.
  const repaired = repairBrain(state);
  const dt = Number.isFinite(options.dt) && options.dt > 0 ? options.dt : 0;
  const viewport: CameraViewport = {
    width: isFinitePositive(options.viewport?.width) ? options.viewport.width : 1,
    height: isFinitePositive(options.viewport?.height) ? options.viewport.height : 1,
  };
  const bounds: CameraBounds = {
    width: isFiniteNonNegative(options.bounds?.width) ? options.bounds.width : 0,
    height: isFiniteNonNegative(options.bounds?.height) ? options.bounds.height : 0,
  };

  // Selection.
  const normalized = normalizeVcams(options.vcams);
  const activeId = selectActive(normalized, repaired.activeId, options.activeId);

  if (activeId === null) return inactiveHold(repaired);
  const selectedVcam = normalized.find((v) => v.id === activeId);
  if (selectedVcam === undefined) return inactiveHold(repaired); // defensive; selectActive guarantees otherwise

  // --- lifecycle: seed incoming live state + set up blend ---
  const oldActiveId = repaired.activeId;
  const freshSeed = oldActiveId !== activeId; // covers first activation (null → id) and switches
  let bodyCamera: Camera = freshSeed
    ? { x: repaired.camera.x, y: repaired.camera.y }
    : { x: repaired.bodyCamera.x, y: repaired.bodyCamera.y };
  let lensZoom = freshSeed ? repaired.zoom : repaired.lensZoom;
  let blend = repaired.blend;

  if (oldActiveId === null) {
    // First activation: no brain blend.
    blend = null;
  } else if (freshSeed) {
    // Switch (also an interrupted blend): start a new blend from the CURRENTLY
    // RENDERED view, re-seeding the incoming live state from it (already done
    // above). Derive the source clamp padding from that captured view rather
    // than looking up the old vcam: it may have been removed, and during an
    // interrupted blend its configured padding is not the rendered composite's
    // effective padding. This guarantees visual continuity mid-transition.
    const fromPadding = requiredClampPadding(
      repaired.camera,
      viewport,
      repaired.zoom,
      bounds,
    );
    blend =
      selectedVcam.blend > 0
        ? {
            fromId: oldActiveId,
            toId: activeId,
            elapsed: 0,
            duration: selectedVcam.blend,
            fromCenter: viewCentre(repaired.camera, viewport, repaired.zoom),
            fromZoom: repaired.zoom,
            fromPadding,
          }
        : null;
  }
  // else same activeId: keep advancing the existing blend (or null).

  // --- 2. Advance lensZoom toward the selected lens target ---
  const oldLensZoom = lensZoom;
  if (selectedVcam.lens !== null) {
    lensZoom = converge(lensZoom, selectedVcam.lens.zoom, dt, selectedVcam.lens.motion);
  }

  // --- 3. Re-anchor bodyCamera so its prior world-space centre is preserved ---
  if (lensZoom !== oldLensZoom) {
    const centre = viewCentre(bodyCamera, viewport, oldLensZoom);
    const nvw = viewport.width / lensZoom;
    const nvh = viewport.height / lensZoom;
    bodyCamera = { x: centre.x - nvw / 2, y: centre.y - nvh / 2 };
  }

  // --- 4. Advance the selected body using the new live zoom ---
  const body = selectedVcam.body;
  if (body !== null && body.mode === 'follow') {
    const target = lookupTarget(options.targets ?? {}, body.targetKey);
    if (target === undefined) {
      // Missing target: hold the re-anchored centre, then clamp.
      bodyCamera = holdAndClamp(bodyCamera, viewport, lensZoom, bounds, body.padding);
    } else {
      bodyCamera = followStep(bodyCamera, target, bounds, viewport, lensZoom, dt, body);
    }
  } else if (body !== null && body.mode === 'fixed') {
    const vw = viewport.width / lensZoom;
    const vh = viewport.height / lensZoom;
    bodyCamera = {
      x: fixedAxis(bodyCamera.x, body.x, bounds.width, vw, body.padding, dt, body.motion),
      y: fixedAxis(bodyCamera.y, body.y, bounds.height, vh, body.padding, dt, body.motion),
    };
  } else {
    // No body (e.g. zoom-only vcam): hold the centre, then clamp.
    bodyCamera = holdAndClamp(bodyCamera, viewport, lensZoom, bounds, 0);
  }

  // The incoming body's padding drives the rendered clamp (step 7).
  const incomingPadding = body !== null ? body.padding : 0;

  // --- 5/6/7. Publish rendered state, with or without a blend ---
  if (blend === null) {
    const vw = viewport.width / lensZoom;
    const vh = viewport.height / lensZoom;
    return {
      camera: {
        x: clampTopLeft(bodyCamera.x, bounds.width, vw, incomingPadding),
        y: clampTopLeft(bodyCamera.y, bounds.height, vh, incomingPadding),
      },
      zoom: lensZoom,
      activeId,
      bodyCamera: { x: bodyCamera.x, y: bodyCamera.y },
      lensZoom,
      blend: null,
    };
  }

  // Blend: advance elapsed and interpolate centre + zoom.
  const elapsed = blend.elapsed + dt;
  const t = blend.duration > 0 ? elapsed / blend.duration : 1;
  if (t >= 1) {
    // Finished: publish live state exactly, clear the blend.
    const vw = viewport.width / lensZoom;
    const vh = viewport.height / lensZoom;
    return {
      camera: {
        x: clampTopLeft(bodyCamera.x, bounds.width, vw, incomingPadding),
        y: clampTopLeft(bodyCamera.y, bounds.height, vh, incomingPadding),
      },
      zoom: lensZoom,
      activeId,
      bodyCamera: { x: bodyCamera.x, y: bodyCamera.y },
      lensZoom,
      blend: null,
    };
  }

  const e = t * t * (3 - 2 * t); // smoothstep
  const liveCentre = viewCentre(bodyCamera, viewport, lensZoom);
  const cx = lerp(blend.fromCenter.x, liveCentre.x, e);
  const cy = lerp(blend.fromCenter.y, liveCentre.y, e);
  const renderedZoom = lerp(blend.fromZoom, lensZoom, e);
  const ivw = viewport.width / renderedZoom;
  const ivh = viewport.height / renderedZoom;
  // Crossfade the clamp padding from the source view's padding to the incoming
  // body's: at e=0 the clamp reproduces the previous render exactly (no jump),
  // and at e=1 it matches the live/finished clamp.
  const blendPadding = lerp(blend.fromPadding, incomingPadding, e);
  return {
    camera: {
      x: clampTopLeft(cx - ivw / 2, bounds.width, ivw, blendPadding),
      y: clampTopLeft(cy - ivh / 2, bounds.height, ivh, blendPadding),
    },
    zoom: renderedZoom,
    activeId,
    bodyCamera: { x: bodyCamera.x, y: bodyCamera.y },
    lensZoom,
    blend: {
      fromId: blend.fromId,
      toId: blend.toId,
      elapsed,
      duration: blend.duration,
      fromCenter: blend.fromCenter,
      fromZoom: blend.fromZoom,
      fromPadding: blend.fromPadding,
    },
  };
}

// --- follow step (resolved-body wrapper over motion.followPosition) --------
//
// Kept inline so `brain.ts` depends on the public `converge`/helpers plus a
// single resolved-body call site; `followPosition` itself lives in motion.ts
// for direct unit testing.

/** Apply one deadzone-follow step using a resolved follow body. */
function followStep(
  camera: Readonly<Camera>,
  target: Readonly<CameraTarget>,
  bounds: Readonly<CameraBounds>,
  viewport: Readonly<CameraViewport>,
  zoom: number,
  dt: number,
  body: ResolvedFollowBody,
): Camera {
  const config: FollowBodyConfig = {
    targetKey: body.targetKey,
    followX: body.followX,
    followY: body.followY,
    motion: body.motion,
    padding: body.padding,
  };
  return followPosition(camera, target, bounds, viewport, zoom, dt, config);
}
