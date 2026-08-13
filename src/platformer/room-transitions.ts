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
 * Which linked shared seam (if any) the body's AABB has crossed out of `level`.
 *
 * Considers only cardinal neighbours that exist in `project` and whose world
 * rectangles share a non-empty seam. A crossing of the nominal east/west edge
 * outside the neighbour's shared Y span (or north/south outside the shared X
 * span) is void, not a transition. When two eligible seams are crossed at a
 * corner, the greatest normalized penetration wins; stable ties use `n → e → s → w`.
 *
 * The body is in `level`'s local coordinates. Returns `undefined` when no seam is
 * crossed (the body is still inside `level`, or it left through a void/non-seam).
 */
export function findLdtkRoomExit(
  body: Rect,
  level: LdtkLevel,
  project: LdtkProject,
): LdtkRoomExit | undefined {
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

  if (candidates.length === 0) return undefined;
  // Greatest normalized penetration; stable tie → n → e → s → w.
  candidates.sort((a, b) =>
    a.normPenetration !== b.normPenetration
      ? b.normPenetration - a.normPenetration
      : a.order - b.order,
  );
  const win = candidates[0];
  return {
    dir: win.dir,
    neighbourLevelIid: win.iid,
    seamMin: win.seamMin,
    seamMax: win.seamMax,
  };
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
