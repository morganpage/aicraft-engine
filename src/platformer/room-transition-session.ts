/**
 * Room-transition session — the single orchestrator for seam traversal.
 *
 * Owns `{ detector, slide }` as ONE immutable state machine so the consumer
 * cannot mis-compose the transition layer: a second transition cannot begin
 * while a slide is active (suppressed polls + refused begins), normal slide
 * completion applies the finish camera-space rebase exactly once, and every
 * abnormal exit (death/retry/teleport/reset) goes through one
 * cancel-with-rebase path. The Celerock failure modes become structurally
 * impossible rather than conventionally avoided.
 *
 * The session composes the existing detector (E2) and slide (E3) helpers —
 * no new detection or camera math. Every function is pure: it takes the
 * current session (and brain, where the camera space changes), returns fresh
 * state, never mutates its inputs, reads nothing from the environment, and
 * never throws. `detector` is plain serializable data; `slide` is
 * runtime-only (it holds an easing closure) — persist `session.detector`
 * alone and rebuild with {@link createRoomTransitionSession} on load.
 *
 * Golden consumer loop:
 *
 * ```ts
 * // per simulation tick:
 * const poll = pollRoomTransition(session, body, level, project);
 * session = poll.session; // auto-adopted detector state
 * if (poll.result.type === 'exit') {
 *   // resolve target, mapLdtkRoomEntry, transitionPlatformerToRoom …
 *   const begun = beginSessionRoomSlide(
 *     session,
 *     { source, destination, viewport, brain, destinationView, actor },
 *     { reducedMotion },
 *   );
 *   if (begun.ok) {
 *     session = begun.session; brain = begun.brain;
 *     camShift.x += begun.cameraRebaseDelta.x; camShift.y += begun.cameraRebaseDelta.y;
 *   }
 * }
 * // per presentation tick:
 * const advanced = advanceSessionRoomSlide(session, dt, brain);
 * session = advanced.session; brain = advanced.brain;
 * camShift.x += advanced.cameraRebaseDelta.x; camShift.y += advanced.cameraRebaseDelta.y;
 * // on death / retry / teleport / reset:
 * const ended = endRoomTransitionSession(session, brain, 'destination');
 * session = ended.session; brain = ended.brain;
 * camShift.x += ended.cameraRebaseDelta.x; camShift.y += ended.cameraRebaseDelta.y;
 * // anything consuming the RAW brain camera (a parallax backdrop) is fed
 * // { x: brain.camera.x - camShift.x, y: brain.camera.y - camShift.y }
 * // so it never teleports at a rebase the world render already compensated.
 * ```
 *
 * @module
 */

import type { Rect } from '../collision/types';
import type { LdtkLevel, LdtkProject } from '../ldtk/types';
import type { CameraBrain } from '../camera';
import type { CompiledLdtkRoom } from './ldtk-room';
import type {
  LdtkRoomExit,
  RoomExitDetectorOptions,
  RoomExitDetectorState,
} from './room-transitions';
import { createRoomExitDetectorState, detectLdtkRoomExit } from './room-transitions';
import type {
  RoomSlideActorMapping,
  RoomSlideOptions,
  RoomSlideState,
  RoomSlideView,
} from './room-slide';
import {
  advanceRoomSlide,
  beginRoomSlideFromBrain,
  cancelRoomSlideCameraSpace,
  enterRoomSlideCameraSpace,
  finishRoomSlideCameraSpace,
} from './room-slide';

/**
 * The camera-space rebase a call did NOT apply. Shared frozen instance — every
 * result field of this shape is treated as immutable.
 */
const NO_CAMERA_REBASE: Readonly<{ x: number; y: number }> = Object.freeze({ x: 0, y: 0 });

/**
 * One actor's room-transition state machine: the seam-exit detector plus the
 * in-flight presentation slide, owned together so their invariants hold by
 * construction.
 *
 * Immutable plain data; every operation returns a fresh session. One session
 * belongs to one traversing actor (multi-actor games keep one per actor).
 */
export interface RoomTransitionSessionState {
  /**
   * The seam-exit detector state (re-arm gate + per-axis containment
   * latches). Plain serializable data — persist this alongside save/replay
   * state; on load, reconstruct the session with it and `slide: null`.
   */
  readonly detector: RoomExitDetectorState;
  /**
   * The active room slide, or `null` when no transition is presenting.
   * Runtime tick-loop state only — a slide holds an easing closure and is not
   * save-serialized; serialize {@link RoomTransitionSessionState.detector}
   * alone.
   */
  readonly slide: RoomSlideState | null;
}

/**
 * A fresh idle session: an armed detector (no re-arm gate, no containment
 * latches) and no active slide.
 *
 * The fresh detector's unlatched axes cost nothing — the detector's latch
 * update runs before gating, so a respawn placing the body inside a room can
 * still exit on the very next poll (a body straddling a seam is gated only on
 * the axis it straddles).
 *
 * @returns A new {@link RoomTransitionSessionState} with `slide === null`.
 */
export function createRoomTransitionSession(): RoomTransitionSessionState {
  return { detector: createRoomExitDetectorState(), slide: null };
}

/**
 * The outcome of {@link pollRoomTransition}.
 *
 * - `'idle'` — no exit this tick; store the returned session and continue.
 * - `'suppressed-slide-active'` — a slide is in flight, so exits are held
 *   (the returned session is the input reference, unchanged).
 * - `'exit'` — a seam crossing fired; resolve the destination, map the entry,
 *   transition the simulation, then call {@link beginSessionRoomSlide}.
 */
export type RoomTransitionPollResult =
  | { readonly type: 'idle' }
  | { readonly type: 'suppressed-slide-active' }
  | { readonly type: 'exit'; readonly exit: LdtkRoomExit };

/**
 * Poll for a room exit through the session — the per-tick simulation entry.
 *
 * While a slide is active the poll is SUPPRESSED: the result is
 * `'suppressed-slide-active'` and the returned session is the input session
 * reference unchanged, so a second transition cannot begin mid-slide
 * (Celerock bug 2). Otherwise the poll delegates to {@link detectLdtkRoomExit}
 * and AUTO-ADOPTS the returned detector state: the returned session always
 * carries the next detector state (armed, gated, or post-exit), so the
 * consumer never hand-adopts — storing the returned session is the whole
 * obligation.
 *
 * The precise strength of auto-adoption: a consumer that DISCARDS the returned
 * session loses only the `blockedEntryEdge` deadband jitter absorption — the
 * tick-tock reverse exit stays suppressed regardless, because the detector's
 * per-axis containment latch re-derives from body geometry on every poll
 * (reset-immune).
 *
 * Pure: never mutates `session`/`body`/`level`/`project`; deterministic for
 * equal inputs; never throws.
 *
 * @param session The current session (store the returned session).
 * @param body The actor's AABB in `level`'s local coordinates.
 * @param level The active room's LDtk level.
 * @param project The whole LDtk project (neighbour resolution).
 * @param options Detector options (deadband).
 * @returns The next session and the poll result.
 */
export function pollRoomTransition(
  session: Readonly<RoomTransitionSessionState>,
  body: Rect,
  level: LdtkLevel,
  project: LdtkProject,
  options?: Readonly<RoomExitDetectorOptions>,
): {
  readonly session: RoomTransitionSessionState;
  readonly result: RoomTransitionPollResult;
} {
  if (session.slide !== null) {
    return { session, result: { type: 'suppressed-slide-active' } };
  }
  const detection = detectLdtkRoomExit(session.detector, body, level, project, options);
  return {
    session: { detector: detection.state, slide: null },
    result:
      detection.exit === undefined
        ? { type: 'idle' }
        : { type: 'exit', exit: detection.exit },
  };
}

/** Inputs for {@link beginSessionRoomSlide}. */
export interface SessionSlideBeginInput {
  /** The room being left (source slide endpoint + slide-space origin). */
  readonly source: CompiledLdtkRoom;
  /** The room being entered (destination slide endpoint + slide-space target). */
  readonly destination: CompiledLdtkRoom;
  /** Physical viewport pixels; both dimensions must be finite and positive. */
  readonly viewport: Readonly<{ width: number; height: number }>;
  /** The consumer's current camera brain (its rendered camera/zoom is captured). */
  readonly brain: Readonly<CameraBrain>;
  /** The destination endpoint view (typically from `roomEntrySlideView`). */
  readonly destinationView: Readonly<RoomSlideView>;
  /** The actor's position in both rooms' local coordinates (continuity math). */
  readonly actor: Readonly<RoomSlideActorMapping>;
}

/** Finite and strictly positive (viewport dimension validation). */
function isFinitePositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** A room-like input (non-null with a non-null `ldtkLevel`). */
function hasCompiledRoom(v: unknown): v is CompiledLdtkRoom {
  if (typeof v !== 'object' || v === null) return false;
  const level = (v as { ldtkLevel?: unknown }).ldtkLevel;
  return typeof level === 'object' && level !== null;
}

/**
 * Begin the presentation slide for an accepted exit, entering slide camera
 * space in the same call — the enter-rebase is applied exactly once, here.
 *
 * Composes {@link beginRoomSlideFromBrain} (the source endpoint is derived
 * from the brain's currently rendered camera/zoom) and
 * {@link enterRoomSlideCameraSpace}. On success the returned session holds
 * the new slide and the returned brain is the entered (slide-space) brain the
 * consumer feeds their own `updateCameraBrain` with. Owning the enter-rebase
 * here is what makes the finish-rebase at {@link advanceSessionRoomSlide}
 * completion symmetric — without it, finish would subtract an offset that was
 * never added and silently corrupt the camera.
 *
 * Refuses (`ok: false`, the input session and brain returned unchanged) while
 * a slide is already active, or when the inputs are unusable: missing
 * source/destination rooms (or other nullish fields), or a viewport dimension
 * that is not finite and positive. Refusal never throws.
 *
 * The success result also reports `cameraRebaseDelta` — the camera-SPACE jump
 * the enter-rebase applied to the returned brain (`slide.space.sourceOffset`).
 * The world render compensates for space changes by construction (each room is
 * drawn at its slide-space offset), but any consumer of the RAW `brain.camera`
 * — a parallax backdrop is the canonical one — teleports by exactly this delta
 * at the seam unless it compensates. Accumulate the deltas from this call, from
 * {@link advanceSessionRoomSlide}, and from {@link endRoomTransitionSession},
 * and feed such consumers `brain.camera − accumulated` (see the module note on
 * the golden consumer loop). Zero on refusal, when no rebase happened.
 *
 * @param session The current session.
 * @param input Rooms, viewport, brain, destination view, actor mapping.
 * @param options Slide options (duration / easing / freezeSimulation /
 *   reducedMotion — the reduced-motion decision stays an explicit input; the
 *   pure core never reads host state).
 * @returns `{ session, brain, cameraRebaseDelta, ok }`. Check `ok` before
 *   using `session.slide` or `brain`; a refusal passes the input brain through
 *   unchanged with a zero `cameraRebaseDelta`.
 */
export function beginSessionRoomSlide(
  session: Readonly<RoomTransitionSessionState>,
  input: SessionSlideBeginInput,
  options?: Readonly<RoomSlideOptions>,
): {
  readonly session: RoomTransitionSessionState;
  readonly brain: CameraBrain;
  readonly cameraRebaseDelta: Readonly<{ x: number; y: number }>;
  readonly ok: boolean;
} {
  const viewport = input.viewport;
  const refuse =
    session.slide !== null ||
    !hasCompiledRoom(input.source) ||
    !hasCompiledRoom(input.destination) ||
    input.brain === null ||
    input.brain === undefined ||
    input.destinationView === null ||
    input.destinationView === undefined ||
    input.actor === null ||
    input.actor === undefined ||
    viewport === null ||
    viewport === undefined ||
    !isFinitePositive(viewport.width) ||
    !isFinitePositive(viewport.height);
  if (refuse) {
    return { session, brain: input.brain, cameraRebaseDelta: NO_CAMERA_REBASE, ok: false };
  }

  const slide = beginRoomSlideFromBrain(
    input.source,
    input.destination,
    input.viewport,
    input.brain,
    input.destinationView,
    input.actor,
    options,
  );
  return {
    session: { detector: session.detector, slide },
    brain: enterRoomSlideCameraSpace(slide, input.brain),
    // The enter-rebase's own delta (added to camera AND bodyCamera). Exposed so
    // raw-camera consumers can subtract it — see the function note.
    cameraRebaseDelta: slide.space.sourceOffset,
    ok: true,
  };
}

/**
 * Advance the slide clock one presentation tick; apply the finish-rebase
 * exactly once when — and only when — the slide completes.
 *
 * Division of labour while the slide is ACTIVE: this function advances only
 * the slide clock and returns the brain UNCHANGED. The consumer drives the
 * per-tick slide-space camera themselves — read `session.slide`, call
 * `presentationForRoomSlide`, and feed their own `updateCameraBrain`:
 *
 * ```ts
 * const advanced = advanceSessionRoomSlide(session, dt, brain);
 * session = advanced.session;
 * brain = advanced.brain;
 * if (session.slide !== null) {
 *   const p = presentationForRoomSlide(session.slide);
 *   brain = updateCameraBrain(brain, {
 *     vcams: [p.vcam!],
 *     targets: {},
 *     bounds: p.bounds,
 *     viewport,
 *     activeId: ROOM_SLIDE_VCAM_ID,
 *     dt,
 *   });
 * }
 * ```
 *
 * (The session deliberately does not own that plumbing — the viewport,
 * targets, and vcam feed belong to the consumer's presentation layer.)
 *
 * When this advance completes the slide, the brain effect is the
 * finish-rebase only: {@link finishRoomSlideCameraSpace} is applied exactly
 * once to the returned brain and the returned session carries
 * `slide === null`. Reduced-motion immediate cuts (`reducedMotion: true` at
 * begin) complete on the FIRST advance — enter was already applied at begin,
 * so enter + finish land in one presentation frame.
 *
 * The completing call also reports `cameraRebaseDelta` — the finish-rebase's
 * camera-SPACE jump (the negated `slide.space.destinationOffset`), nonzero on
 * exactly the completing tick and zero on every active-tick and idle call.
 * Accumulate it alongside {@link beginSessionRoomSlide}'s for screen-continuous
 * raw-camera consumers (parallax backdrops); see that function's note.
 *
 * An idle session (`slide: null`) is inert: the same session reference, the
 * brain byte-identical, `done: true` — the finish-rebase can never be applied
 * twice (a double rebase would silently offset the camera by one room).
 *
 * Pure: never mutates `session` or `brain`; never throws. Non-positive or
 * non-finite `dt` advances the clock by zero (inert), matching
 * {@link advanceRoomSlide}.
 *
 * @param session The current session.
 * @param dt Presentation delta in seconds.
 * @param brain The consumer's current camera brain (slide-space while the
 *   slide is active; the consumer-driven value at completion).
 * @returns `{ session, brain, cameraRebaseDelta, done }` — `done` is true iff
 *   the returned session has `slide === null` (finished on this call, or
 *   already idle).
 */
export function advanceSessionRoomSlide(
  session: Readonly<RoomTransitionSessionState>,
  dt: number,
  brain: Readonly<CameraBrain>,
): {
  readonly session: RoomTransitionSessionState;
  readonly brain: CameraBrain;
  readonly cameraRebaseDelta: Readonly<{ x: number; y: number }>;
  readonly done: boolean;
} {
  const slide = session.slide;
  if (slide === null) {
    return { session, brain, cameraRebaseDelta: NO_CAMERA_REBASE, done: true };
  }
  const next = advanceRoomSlide(slide, dt);
  if (next.active) {
    return {
      session: { detector: session.detector, slide: next },
      brain,
      cameraRebaseDelta: NO_CAMERA_REBASE,
      done: false,
    };
  }
  const offset = next.space.destinationOffset;
  return {
    session: { detector: session.detector, slide: null },
    brain: finishRoomSlideCameraSpace(next, brain),
    cameraRebaseDelta: { x: -offset.x, y: -offset.y },
    done: true,
  };
}

/**
 * The single abnormal-exit path: death, retry, teleport, or hard reset.
 *
 * If a slide is active, the brain is FIRST rebased out of slide space via
 * {@link cancelRoomSlideCameraSpace} — `rebaseTo` names the room the
 * simulation resumes in (`'destination'` for a death mid-slide, after the
 * simulation state has already crossed the seam; `'source'` for a rapid
 * reversal while the simulation still lives in the source room). No
 * slide-space camera state can leak into ordinary room rendering (Celerock
 * bug 3). With no active slide the brain is returned unchanged. Either way
 * the returned session is a FRESH idle one — the "reset the detector on
 * respawn" discipline is owned here, not by the consumer, and the fresh
 * detector's unlatched axes cost nothing (see
 * {@link createRoomTransitionSession}).
 *
 * The result also reports `cameraRebaseDelta` — the cancel-rebase's
 * camera-SPACE jump (zero when no slide was active). A death mid-slide still
 * changes camera space, so a parallax backdrop compensates here exactly as it
 * does at {@link beginSessionRoomSlide} / {@link advanceSessionRoomSlide};
 * see that function's note for the accumulation pattern.
 *
 * Pure: never mutates `session` or `brain`; never throws.
 *
 * @param session The current session.
 * @param brain The consumer's current camera brain.
 * @param rebaseTo Which room's local space an active slide cancels into.
 * @returns `{ session, brain, cameraRebaseDelta }` — a fresh idle session and
 *   the rebased brain.
 */
export function endRoomTransitionSession(
  session: Readonly<RoomTransitionSessionState>,
  brain: Readonly<CameraBrain>,
  rebaseTo: 'source' | 'destination',
): {
  readonly session: RoomTransitionSessionState;
  readonly brain: CameraBrain;
  readonly cameraRebaseDelta: Readonly<{ x: number; y: number }>;
} {
  const slide = session.slide;
  if (slide === null) {
    return {
      session: createRoomTransitionSession(),
      brain,
      cameraRebaseDelta: NO_CAMERA_REBASE,
    };
  }
  const offset = rebaseTo === 'source' ? slide.space.sourceOffset : slide.space.destinationOffset;
  return {
    session: createRoomTransitionSession(),
    brain: cancelRoomSlideCameraSpace(slide, brain, rebaseTo),
    cameraRebaseDelta: { x: -offset.x, y: -offset.y },
  };
}
