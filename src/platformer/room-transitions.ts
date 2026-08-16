/**
 * Phase E2 — pure, canvas-free room-transition helpers.
 *
 * These compose `createLdtkRoomCache`/`CompiledLdtkRoom` (0.7.0) and the LDtk
 * `__neighbours` graph to give a future Celerock builder a supported traversal
 * path: `findLdtkRoomExit → mapLdtkRoomEntry → transitionPlatformerToRoom`, plus
 * `rebasePointBetweenLdtkRooms` for particle/dust continuity. Every function is
 * pure (no canvas, no host state) and fully unit-testable.
 *
 * Coordinate convention: the body (`Rect`, typically the player's `core`) is in
 * the SOURCE room's local coordinates (origin `(0,0)`). Level geometry comes from
 * `LdtkLevel.worldX/worldY/pxWid/pxHei`. A level's room-local bounds are
 * `[0, pxWid] × [0, pxHei]`; its world rect is
 * `[worldX, worldX+pxWid] × [worldY, worldY+pxHei]`.
 *
 * The simulation transition (this module) is deliberately separated from the
 * presentation transition (the slide, E3): this module owns detecting an
 * eligible cardinal seam crossing, resolving the `__neighbour`, converting the
 * actor through world space into destination-local coordinates, preserving
 * momentum/facing/abilities/locomotion, clearing per-tick channels, and returning
 * seam-entry spawn provenance. It NEVER settles a seam-entry state (settling
 * would destroy valid mid-air momentum — matches C3).
 *
 * @module
 */

import type { Rect, Solid } from '../collision/types';
import { probeGround, probeCeiling } from '../collision/aabb';
import type { LdtkLevel, LdtkProject } from '../ldtk/types';
import type {
  Contacts,
  PlatformerConfig,
  PlatformerState,
} from './types';
import {
  DEFAULT_PLATFORMER_CONFIG,
  EMPTY_CONTACTS,
  EMPTY_EVENTS,
  EMPTY_INTERACTIONS,
  EMPTY_MOMENTS,
} from './constants';
import type { ResolvedPlatformerSpawn } from './level-runtime';

/** A cardinal direction (`__neighbours` dir narrowed to the four edges). */
export type Cardinal = 'n' | 's' | 'e' | 'w';

/**
 * A detected room exit on a cardinal seam.
 *
 * `seamMin`/`seamMax` are the INCLUSIVE world-space span of the shared seam on
 * its perpendicular axis (Y for `e`/`w`, X for `n`/`s`). A crossing whose body
 * lies outside this span on the perpendicular axis is void, not a transition.
 */
export interface LdtkRoomExit {
  readonly dir: Cardinal;
  readonly neighbourLevelIid: string;
  /** Inclusive world-space span of the shared seam on its perpendicular axis. */
  readonly seamMin: number;
  readonly seamMax: number;
}

/** Where the actor enters the destination room (destination-local). */
export interface LdtkRoomEntry {
  readonly x: number;
  readonly y: number;
  readonly dir: Cardinal;
  readonly toLevelIid: string;
}

/** Options for {@link transitionPlatformerToRoom}. */
export interface TransitionPlatformerToRoomOptions {
  /**
   * Optional destination collision set used ONLY to revalidate exact
   * gravity-facing support at the mapped position. Never used to settle or
   * reposition the actor.
   */
  readonly destinationSolids?: readonly Solid[];
  readonly config?: Readonly<PlatformerConfig>;
}

/** The post-transition state + seam-entry spawn provenance. */
export interface PlatformerRoomTransition {
  readonly state: PlatformerState;
  readonly spawn: ResolvedPlatformerSpawn;
}

// Stable tie-break order for corner exits: n → e → s → w (lower wins on ties).
const CARDINAL_ORDER: Record<Cardinal, number> = { n: 0, e: 1, s: 2, w: 3 };

/** Narrow a raw `__neighbours` dir string to a cardinal, or `null`. */
function asCardinal(dir: string): Cardinal | null {
  if (dir === 'n' || dir === 's' || dir === 'e' || dir === 'w') return dir;
  return null;
}

/** A level's world-space rectangle. */
interface WorldRect {
  readonly x: number;
  readonly y: number;
  readonly right: number;
  readonly bottom: number;
}

function worldRectOf(level: LdtkLevel): WorldRect {
  return {
    x: level.worldX,
    y: level.worldY,
    right: level.worldX + level.pxWid,
    bottom: level.worldY + level.pxHei,
  };
}

/** Collect every level in a project (top-level + multi-world), keyed by iid. */
function collectLevelsByIid(project: LdtkProject): Map<string, LdtkLevel> {
  const map = new Map<string, LdtkLevel>();
  for (const lvl of project.levels) map.set(lvl.iid, lvl);
  for (const world of project.worlds) {
    for (const lvl of world.levels) map.set(lvl.iid, lvl);
  }
  return map;
}

/** Strict interior overlap of two `[min, max)` intervals (inclusive endpoints). */
function intervalsOverlap(
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
): boolean {
  return aMin < bMax && bMin < aMax;
}

/**
 * For a cardinal neighbour of `level`, compute the shared seam span (perpendicular
 * axis, world space) and the flush status. Returns `null` when the rooms do not
 * share a non-empty seam on that side.
 */
function seamSpanFor(
  dir: Cardinal,
  level: LdtkLevel,
  nb: LdtkLevel,
): { min: number; max: number } | null {
  const L = worldRectOf(level);
  const N = worldRectOf(nb);
  switch (dir) {
    case 'e': {
      // Neighbour east: flush when N.x === L.right. Seam axis = Y.
      if (N.x !== L.right) return null;
      const min = Math.max(L.y, N.y);
      const max = Math.min(L.bottom, N.bottom);
      return max > min ? { min, max } : null;
    }
    case 'w': {
      // Neighbour west: flush when N.right === L.x. Seam axis = Y.
      if (N.right !== L.x) return null;
      const min = Math.max(L.y, N.y);
      const max = Math.min(L.bottom, N.bottom);
      return max > min ? { min, max } : null;
    }
    case 's': {
      // Neighbour south (below, larger Y): flush when N.y === L.bottom. Seam = X.
      if (N.y !== L.bottom) return null;
      const min = Math.max(L.x, N.x);
      const max = Math.min(L.right, N.right);
      return max > min ? { min, max } : null;
    }
    case 'n': {
      // Neighbour north (above, smaller Y): flush when N.bottom === L.y. Seam = X.
      if (N.bottom !== L.y) return null;
      const min = Math.max(L.x, N.x);
      const max = Math.min(L.right, N.right);
      return max > min ? { min, max } : null;
    }
  }
}

/**
 * Rank every cardinal seam the body's AABB has currently crossed out of
 * `level`, greatest normalized penetration first; stable ties use
 * `n → e → s → w`.
 *
 * Considers only cardinal neighbours that exist in `project` and whose world
 * rectangles share a non-empty seam. A crossing of the nominal east/west edge
 * outside the neighbour's shared Y span (or north/south outside the shared X
 * span) is void, not a transition, and yields no candidate. The body is in
 * `level`'s local coordinates.
 *
 * Module-private ranking shared by {@link findLdtkRoomExit} (which returns
 * the top candidate with NO gating) and {@link detectLdtkRoomExit} (which
 * walks the list in rank order and skips candidates gated by the per-axis
 * containment latch).
 */
function rankLdtkRoomExits(
  body: Rect,
  level: LdtkLevel,
  project: LdtkProject,
): readonly LdtkRoomExit[] {
  const byIid = collectLevelsByIid(project);
  const W = level.pxWid;
  const H = level.pxHei;

  type Candidate = {
    dir: Cardinal;
    iid: string;
    seamMin: number;
    seamMax: number;
    // Penetration past the boundary, normalized by the body's extent on the
    // crossing axis (fraction of the body that is across). Greater wins.
    normPenetration: number;
    order: number;
  };
  const candidates: Candidate[] = [];

  for (const link of level.__neighbours) {
    const dir = asCardinal(link.dir);
    if (dir === null) continue; // diagonal / unknown — not a cardinal seam.
    const nb = byIid.get(link.levelIid);
    if (nb === undefined) continue; // neighbour missing from project.
    const seam = seamSpanFor(dir, level, nb);
    if (seam === null) continue; // no shared non-empty seam on this side.

    // Convert the perpendicular seam span into level-local coordinates for the
    // body-overlap test (body is local; seam was computed in world).
    let crossed = false;
    let penetration = 0;
    let perpMinLocal = 0;
    let perpMaxLocal = 0;
    let bodyExtent = 0;

    switch (dir) {
      case 'e': {
        crossed = body.x + body.width > W;
        penetration = body.x + body.width - W;
        perpMinLocal = seam.min - level.worldY;
        perpMaxLocal = seam.max - level.worldY;
        bodyExtent = body.width;
        break;
      }
      case 'w': {
        crossed = body.x < 0;
        penetration = -body.x;
        perpMinLocal = seam.min - level.worldY;
        perpMaxLocal = seam.max - level.worldY;
        bodyExtent = body.width;
        break;
      }
      case 's': {
        crossed = body.y + body.height > H;
        penetration = body.y + body.height - H;
        perpMinLocal = seam.min - level.worldX;
        perpMaxLocal = seam.max - level.worldX;
        bodyExtent = body.height;
        break;
      }
      case 'n': {
        crossed = body.y < 0;
        penetration = -body.y;
        perpMinLocal = seam.min - level.worldX;
        perpMaxLocal = seam.max - level.worldX;
        bodyExtent = body.height;
        break;
      }
    }

    if (!crossed) continue;
    // The body's perpendicular span must overlap the seam span (strict interior).
    const perpIsY = dir === 'e' || dir === 'w';
    const bodyPerpMin = perpIsY ? body.y : body.x;
    const bodyPerpMax = perpIsY ? body.y + body.height : body.x + body.width;
    if (!intervalsOverlap(bodyPerpMin, bodyPerpMax, perpMinLocal, perpMaxLocal)) {
      continue; // crossed the edge but OUTSIDE the shared span → void.
    }

    const normPenetration = bodyExtent > 0 ? penetration / bodyExtent : penetration;
    candidates.push({
      dir,
      iid: link.levelIid,
      seamMin: seam.min,
      seamMax: seam.max,
      normPenetration,
      order: CARDINAL_ORDER[dir],
    });
  }

  // Greatest normalized penetration; stable tie → n → e → s → w.
  candidates.sort((a, b) =>
    a.normPenetration !== b.normPenetration
      ? b.normPenetration - a.normPenetration
      : a.order - b.order,
  );
  return candidates.map((candidate) => ({
    dir: candidate.dir,
    neighbourLevelIid: candidate.iid,
    seamMin: candidate.seamMin,
    seamMax: candidate.seamMax,
  }));
}

/**
 * Which linked shared seam (if any) the body's AABB has crossed out of `level`.
 *
 * Returns the top-ranked crossing from {@link rankLdtkRoomExits} with NO
 * gating applied, or `undefined` when no seam is crossed (the body is still
 * inside `level`, or it left through a void/non-seam). When two eligible
 * seams are crossed at a corner, the greatest normalized penetration wins;
 * stable ties use `n → e → s → w`. The body is in `level`'s local
 * coordinates.
 *
 * Low-level stateless primitive. A per-tick game loop polling this directly
 * inherits seam tick-tock: after an east crossing, `mapLdtkRoomEntry`
 * preserves the actor's exact world position, which leaves part of its AABB
 * at a negative destination-local X — so the very next `findLdtkRoomExit`
 * call in the destination detects the reverse west exit before the actor
 * clears the seam. Per-tick consumers should use {@link detectLdtkRoomExit}
 * (which adds re-arm hysteresis via {@link RoomExitDetectorState}). This
 * function remains valid for callers that manage their own hysteresis or
 * query exits outside a tick loop.
 */
export function findLdtkRoomExit(
  body: Rect,
  level: LdtkLevel,
  project: LdtkProject,
): LdtkRoomExit | undefined {
  return rankLdtkRoomExits(body, level, project)[0];
}

/**
 * Where the actor enters the destination room, in destination-local coordinates
 * (momentum-preserving seam point). Does NOT clamp. Preserves the actor top-left
 * exactly through world space:
 *
 * ```
 * to.worldX + entry.x === from.worldX + body.x
 * to.worldY + entry.y === from.worldY + body.y
 * ```
 */
export function mapLdtkRoomEntry(
  body: Rect,
  from: LdtkLevel,
  to: LdtkLevel,
  exit: LdtkRoomExit,
): LdtkRoomEntry {
  return {
    x: from.worldX + body.x - to.worldX,
    y: from.worldY + body.y - to.worldY,
    dir: exit.dir,
    toLevelIid: exit.neighbourLevelIid,
  };
}

/**
 * Produce the post-transition state + seam-entry spawn provenance. Pure; never
 * settles or repositions beyond `entry`.
 *
 * Preserves `vx`/`vy`/`facing` and the full ability/locomotion slices; clears the
 * per-tick output channels (`events`/`interactions`/`moments`). Support:
 *  - With `destinationSolids`, revalidate exact gravity-facing support at the
 *    mapped position WITHOUT moving the actor; populate `onGround` + the
 *    destination contact id from that probe.
 *  - Without `destinationSolids`, conservatively set `onGround: false` and clear
 *    all contacts (the next destination tick re-establishes support).
 *
 * Never calls `settlePlatformerState` — settling would destroy valid mid-air
 * momentum. The state uses its existing `core.width`/`core.height`.
 */
export function transitionPlatformerToRoom(
  state: PlatformerState,
  entry: LdtkRoomEntry,
  options?: TransitionPlatformerToRoomOptions,
): PlatformerRoomTransition {
  const config = options?.config ?? DEFAULT_PLATFORMER_CONFIG;
  const inverted = config.gravity < 0;
  const { width, height } = state.core;

  // Revalidate exact gravity-facing support at the mapped position (no move).
  let onGround = false;
  let contacts: Contacts = EMPTY_CONTACTS;
  const solids = options?.destinationSolids;
  if (solids !== undefined) {
    const bodyRect: Rect = { x: entry.x, y: entry.y, width, height };
    // Small tolerance so a flush rest (body.bottom === solid.y) is detected.
    const tolerance = 1;
    const support = inverted
      ? probeCeiling(bodyRect, tolerance, solids)
      : probeGround(bodyRect, tolerance, solids);
    if (support !== null) {
      onGround = true;
      const id = typeof support.id === 'string' ? support.id : null;
      contacts = inverted
        ? { ...EMPTY_CONTACTS, ceilingId: id }
        : { ...EMPTY_CONTACTS, groundId: id };
    }
  }

  const nextState: PlatformerState = {
    core: {
      ...state.core,
      x: entry.x,
      y: entry.y,
      // Momentum + facing preserved across the seam.
      onGround,
      contacts,
    },
    // Ability/locomotion slices are carried verbatim (a dash in flight stays in
    // flight; stamina/coyote/buffer survive the seam).
    abilities: state.abilities,
    locomotion: state.locomotion,
    events: EMPTY_EVENTS,
    interactions: EMPTY_INTERACTIONS,
    moments: EMPTY_MOMENTS,
    tick: state.tick,
  };

  const spawn: ResolvedPlatformerSpawn = {
    x: entry.x,
    y: entry.y,
    source: 'seam-entry',
  };

  return { state: nextState, spawn };
}

/**
 * Rebase a point from `from`-room-local into `to`-room-local coordinates across
 * the seam (for particle/dust continuity). Equivalent to preserving the point's
 * world position: `result = { from.worldX + point.x - to.worldX, … }`.
 */
export function rebasePointBetweenLdtkRooms(
  point: { readonly x: number; readonly y: number },
  from: LdtkLevel,
  to: LdtkLevel,
): { x: number; y: number } {
  return {
    x: from.worldX + point.x - to.worldX,
    y: from.worldY + point.y - to.worldY,
  };
}

// --- re-arm detector (tick-tock prevention) --------------------------------

/**
 * Default positive re-arm margin in room/world pixels. One pixel absorbs
 * sub-pixel solver jitter at the seam yet stays small relative to both 8px and
 * 16px tiles, so it never reads as input lag.
 */
export const DEFAULT_EXIT_DEADBAND = 1;

/** Options for {@link detectLdtkRoomExit}. */
export interface RoomExitDetectorOptions {
  /**
   * Re-arm margin in room/world pixels. Only finite values `> 0` are honored;
   * `NaN`/`Infinity`/zero/negative fall back to {@link DEFAULT_EXIT_DEADBAND}
   * (so a bad margin can never permanently block the detector or defeat the
   * default protection).
   */
  readonly deadband?: number;
}

/**
 * Immutable, serializable re-arm state for {@link detectLdtkRoomExit}.
 *
 * Persist one instance per traversing actor alongside game/save/replay state.
 * The state is plain data (no closures), so a `JSON.parse(JSON.stringify(x))`
 * clone behaves identically — deterministic across save/load and replay.
 */
export interface RoomExitDetectorState {
  /**
   * Destination edge that must be cleared before another exit can fire, or
   * `null` when the detector is armed (no pending re-arm gate). The gate also
   * releases once the body no longer overlaps the room at all (a full
   * back-out), so a genuine reverse crossing is never suppressed indefinitely.
   */
  readonly blockedEntryEdge: Cardinal | null;
  /**
   * IID of the room in whose local coordinates `blockedEntryEdge` is
   * meaningful, or `null` when armed. A call whose `level.iid` differs from
   * this is treated as a teleport/retry/stale state: the detector resets to
   * armed and polls the supplied room during the same call.
   */
  readonly expectedLevelIid: string | null;
  /**
   * IID of the room in which the body has been fully contained ON THE X AXIS
   * since the last exit (latched), or null. A body not yet X-contained in the
   * current room is straddling an east/west seam, so east/west exits are
   * suppressed until it genuinely enters on that axis (or fully departs the
   * room). North/south exits are unaffected.
   */
  readonly fullyInsideXIid: string | null;
  /** As {@link fullyInsideXIid}, for the Y axis (gates north/south exits). */
  readonly fullyInsideYIid: string | null;
}

/** The result of {@link detectLdtkRoomExit}: the next state, and any exit fired. */
export interface RoomExitDetection {
  readonly state: RoomExitDetectorState;
  readonly exit?: LdtkRoomExit;
}

/**
 * The armed state: no pending re-arm gate and no containment latches
 * recorded — exits enabled.
 */
export function createRoomExitDetectorState(): RoomExitDetectorState {
  return {
    blockedEntryEdge: null,
    expectedLevelIid: null,
    fullyInsideXIid: null,
    fullyInsideYIid: null,
  };
}

/** Opposite cardinal: the destination entry edge for a given exit direction. */
const OPPOSITE_CARDINAL: Record<Cardinal, Cardinal> = { n: 's', s: 'n', e: 'w', w: 'e' };

/**
 * Has the actor moved at least `margin` pixels back inside `level` off the
 * `entryEdge` it entered through? Direction-specific: only the one entry edge
 * is gated, so an actor legitimately flush with an unrelated edge (e.g. a
 * grounded actor sitting on the floor) can still clear a west/east re-arm.
 */
function hasClearedEntryEdge(
  body: Rect,
  level: LdtkLevel,
  entryEdge: Cardinal,
  margin: number,
): boolean {
  switch (entryEdge) {
    case 'w': return body.x >= margin;
    case 'e': return body.x + body.width <= level.pxWid - margin;
    case 'n': return body.y >= margin;
    case 's': return body.y + body.height <= level.pxHei - margin;
  }
}

/**
 * Does the body still overlap `level`'s rect at all (strict — zero-width
 * contact counts as departed)? The re-arm gate exists to absorb seam jitter
 * while the body STRADDLES the arrival seam; a body that no longer overlaps
 * the room has unambiguously departed, so any crossing the bare helper reports
 * is genuine, not jitter. An arrival always overlaps (entry mapping preserves
 * world position, so a post-transition body straddles), which keeps the
 * tick-tock protection intact.
 */
function bodyOverlapsRoom(body: Rect, level: LdtkLevel): boolean {
  return (
    body.x < level.pxWid &&
    body.x + body.width > 0 &&
    body.y < level.pxHei &&
    body.y + body.height > 0
  );
}

/**
 * Normalize a caller-supplied deadband to a finite positive value, falling back
 * to {@link DEFAULT_EXIT_DEADBAND} for anything invalid. A bad margin must never
 * permanently block the detector (e.g. `NaN`) or defeat the protection (zero).
 */
function normalizeDeadband(deadband: number | undefined): number {
  return Number.isFinite(deadband) && (deadband as number) > 0
    ? (deadband as number)
    : DEFAULT_EXIT_DEADBAND;
}

/**
 * Poll for a room exit with direction-specific re-arm hysteresis plus a
 * per-axis containment latch.
 *
 * Wraps {@link findLdtkRoomExit} with a {@link RoomExitDetectorState} that
 * prevents the seam tick-tock oscillation the bare helper produces when a body
 * lingers on a seam, in two layers:
 *
 * - **Re-arm gate (`blockedEntryEdge` + `deadband`):** after an exit fires,
 *   the detector returns no further exits until the actor has moved at least
 *   `deadband` pixels back inside the destination room on the entry edge it
 *   arrived through — or has backed fully OUT of the destination room, in
 *   which case the gate releases and the bare helper reports the genuine
 *   crossing (the reverse transition, or void if the departure is outside
 *   the shared seam span).
 * - **Per-axis containment latch (`fullyInsideXIid`/`fullyInsideYIid`):**
 *   every exit additionally requires the body to have been fully contained
 *   ON THE EXIT'S CROSSING AXIS (`e`/`w` → X, `n`/`s` → Y) in the current
 *   room at least once since the last exit. This makes straddle suppression
 *   intrinsic and reset-immune: the latch re-derives from body geometry on
 *   every poll, so even a discarded or freshly created detector state cannot
 *   fire the reverse exit for a body that straddles the arrival seam. The
 *   latch is sticky (historical containment), and the orthogonal axis is
 *   never gated by an arrival — so diagonal seam exits and corner arrivals
 *   behave as in 0.14.1. A body that can never be contained on an axis (it
 *   is larger than the room on that axis) has that axis's exits suppressed
 *   only until it fully departs the room. A body that no longer overlaps the
 *   room at all skips the axis gate entirely (full back-out release), so
 *   genuine reverse crossings and void departures always stay reportable.
 *
 * Pure: takes the current state and returns the next state plus any exit; it
 * never mutates the input state (adopt the returned {@link RoomExitDetection.state}
 * transactionally — only when the transition is actually accepted). One
 * detector state belongs to one actor; multi-actor games keep one state per
 * actor. See {@link findLdtkRoomExit} for the coordinate convention (body is in
 * `level`'s local coordinates).
 */
export function detectLdtkRoomExit(
  state: Readonly<RoomExitDetectorState>,
  body: Rect,
  level: LdtkLevel,
  project: LdtkProject,
  options?: Readonly<RoomExitDetectorOptions>,
): RoomExitDetection {
  const margin = normalizeDeadband(options?.deadband);

  // Resolve stale/teleport state for THIS room: a blocked edge or a latch
  // keyed to a DIFFERENT room than `level.iid` is not applicable here (the
  // body was teleported / retried, or the snapshot is stale). The blocked
  // edge resets to armed; a foreign latch counts as unlatched. Polling
  // continues in the supplied room during the same call.
  const blockedEdge =
    state.blockedEntryEdge !== null && state.expectedLevelIid === level.iid
      ? state.blockedEntryEdge
      : null;
  const latchedXIid = state.fullyInsideXIid === level.iid ? state.fullyInsideXIid : null;
  const latchedYIid = state.fullyInsideYIid === level.iid ? state.fullyInsideYIid : null;

  // Latch update BEFORE any gating, so an interior body never loses a tick.
  // The latches are sticky — they record historical containment — and every
  // later step tests these UPDATED values.
  const insideX = body.x >= 0 && body.x + body.width <= level.pxWid;
  const insideY = body.y >= 0 && body.y + body.height <= level.pxHei;
  const fullyInsideXIid = insideX ? level.iid : latchedXIid;
  const fullyInsideYIid = insideY ? level.iid : latchedYIid;

  // While the body still straddles the arrival seam (overlaps the room but
  // has not cleared the entry edge by the deadband), hold the gate and emit no
  // exit. A body that has backed fully out of the room no longer straddles:
  // the gate releases and the ranking below reports the genuine crossing (or
  // void, if out-of-span) instead of suppressing the reverse exit forever.
  if (
    blockedEdge !== null &&
    bodyOverlapsRoom(body, level) &&
    !hasClearedEntryEdge(body, level, blockedEdge, margin)
  ) {
    return {
      state: {
        blockedEntryEdge: blockedEdge,
        expectedLevelIid: level.iid,
        fullyInsideXIid,
        fullyInsideYIid,
      },
    };
  }

  const ranked = rankLdtkRoomExits(body, level, project);

  let exit: LdtkRoomExit | undefined;
  if (!bodyOverlapsRoom(body, level)) {
    // Full back-out release: the body has unambiguously departed, so the axis
    // gate is skipped entirely and the bare top-ranked candidate (or void) is
    // reported.
    exit = ranked[0];
  } else {
    // Per-axis candidate filter (the new gate): walk the ranked list in rank
    // order and take the first candidate whose crossing axis (e/w → X, n/s →
    // Y) is latched to this room. A candidate on an unlatched axis is a
    // straddled seam (arrival or reset artifact) and is skipped, not fatal to
    // the poll.
    exit = ranked.find((candidate) =>
      candidate.dir === 'e' || candidate.dir === 'w'
        ? fullyInsideXIid === level.iid
        : fullyInsideYIid === level.iid,
    );
  }

  if (exit === undefined) {
    // Armed, carrying the updated latches — the axis gate is expressed by the
    // latches, not by `blockedEntryEdge`.
    return {
      state: {
        blockedEntryEdge: null,
        expectedLevelIid: null,
        fullyInsideXIid,
        fullyInsideYIid,
      },
    };
  }

  // An exit fired: gate reverse transitions until the actor clears the entry
  // edge in the DESTINATION room (recorded as the opposite of the exit dir),
  // and clear both latches — they are keyed to the room just left, so neither
  // is meaningful in the destination.
  return {
    state: {
      blockedEntryEdge: OPPOSITE_CARDINAL[exit.dir],
      expectedLevelIid: exit.neighbourLevelIid,
      fullyInsideXIid: null,
      fullyInsideYIid: null,
    },
    exit,
  };
}
