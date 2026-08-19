/**
 * Seam apron — make the neighbouring room's floor exist during simulation.
 *
 * **The invariant this module establishes: the floor across a linked seam is in
 * the collision set.**
 *
 * At a linked seam the geometry is continuous in the authored world — two flush
 * rooms whose floor runs meet at the shared edge — but not in the simulation.
 * The kernel takes `solids` as a per-tick argument ({@link stepPlatformer}) and
 * every consumer assembles strictly the ACTIVE room's set, so while the body is
 * still in the source room the destination's floor does not exist. A body that
 * leaves the source ledge while falling drops through the hole where that floor
 * should be; the world-exact entry rebase ({@link mapLdtkRoomEntry}) then
 * faithfully preserves the overshoot, landing the body INSIDE the destination
 * floor, and the first collision step resolves that embed by ejecting it —
 * sometimes straight out of the room.
 *
 * Every repair applied downstream of that moment is parameterised by a tuned
 * constant, and none of them can be right: the embed depth is a function of
 * fall speed (`vy × dt`), and past roughly one floor-thickness per tick "snap
 * the body up onto the floor" and "it legitimately fell into the pit below"
 * become the same input. `src/tests/room-seam-characterization.test.ts` records
 * that shape. The fix is to stop creating the situation.
 *
 * ```ts
 * const apron = createSeamApronCache((iid) => rooms.get(iid));
 * // per tick — the ONE line that closes the discontinuity:
 * const solids = [...active.solids, ...apron.apronFor(active.ldtkLevel.iid)];
 * state = stepPlatformer(state, input, solids, dt, config).state;
 * ```
 *
 * **What rides the apron:** static solids, with every flag preserved verbatim
 * (`passthrough`, `ladder`, `spring`, `dashRefill`), so a neighbour's one-way
 * platform stays one-way and a neighbour's spring still launches.
 *
 * **What does not, and why it is a decision rather than an oversight:**
 *
 * - **Hazards.** They live in a separate bucket on the compiled room, not in
 *   `solids`. So across the straddle window floors continue but spikes do not:
 *   a body can pass through a neighbour hazard sitting in the apron band
 *   without dying. This is accepted deliberately — at a seam, failing to kill
 *   is the safe direction, because the alternative kills the player on geometry
 *   they cannot see yet. Pinned by test so it reads as a rule, not a hole.
 * - **Moving platforms** stay consumer-advanced and are not part of a room's
 *   static set; a platform straddling a seam is out of scope for v1.
 * - **Per-cell ladders** are a runtime overlay, not compiled static geometry.
 *
 * **Why not bake this into `compileLdtkRoom`:** that function is pure and
 * single-room. Computing an apron inside it would require eagerly compiling
 * neighbours, whose compiles recurse back across the same links, and would
 * change the documented meaning of `CompiledLdtkRoom.solids`. The apron instead
 * composes the way moving platforms already do — the consumer owns per-tick
 * assembly, because the kernel's signature requires it, and this module makes
 * the canonical set available in one memoized call.
 *
 * Pure and never throws: a missing or non-flush neighbour simply contributes
 * nothing.
 *
 * @module
 */

import type { Solid } from '../collision';
import type { LdtkLevel } from '../ldtk/types';
import { seamSpanFor } from './room-transitions';

/**
 * How deep (px) into the neighbour, measured perpendicular from the seam line,
 * apron solids may reach.
 *
 * Generous on purpose — the apron is computed once per room and memoized, so
 * depth costs nothing per tick, while too shallow a band silently reopens the
 * hole for a fast body. 64px is ~12 ticks of travel at a typical terminal
 * velocity, far beyond any realistic straddle window.
 */
export const DEFAULT_SEAM_APRON_DEPTH = 64;

/** Prefix for apron solid ids. See {@link seamApronSourceFromSolidId}. */
const APRON_ID_PREFIX = 'apron:';

/**
 * The shape this module needs from a room: its LDtk level (for world position
 * and neighbour links) and its static solids. Structural on purpose —
 * `CompiledLdtkRoom` satisfies it, and so does a consumer's own room runtime,
 * without either taking a dependency on the other.
 */
export interface SeamApronRoom {
  readonly ldtkLevel: LdtkLevel;
  readonly solids: readonly Solid[];
}

/** Options for {@link compileRoomSeamApron} / {@link createSeamApronCache}. */
export interface SeamApronOptions {
  /**
   * Perpendicular reach into the neighbour, in px. Defaults to
   * {@link DEFAULT_SEAM_APRON_DEPTH}. Non-finite or non-positive values fall
   * back to the default.
   */
  readonly depth?: number;
}

/** The four cardinal link directions this module understands. */
type Cardinal = 'n' | 's' | 'e' | 'w';

function asCardinal(dir: string): Cardinal | null {
  return dir === 'n' || dir === 's' || dir === 'e' || dir === 'w' ? dir : null;
}

/** Strict interval overlap — the same rule the exit poll applies to bodies. */
function intervalsOverlap(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return aMin < bMax && bMin < aMax;
}

function positiveOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Recover the originating level and solid id from an apron solid's id.
 *
 * Apron ids are namespaced (`apron:<levelIid>:<originalId>`) so a neighbour's
 * solid can never collide with one of the active room's own — contact ids
 * (`contacts.groundId` and friends) stay unambiguous. Anything that parses a
 * solid id (entity lookups, spring/refill resolution) must come through here
 * first when the id may have crossed a seam.
 *
 * Returns `null` for ids that are not apron ids.
 */
export function seamApronSourceFromSolidId(
  id: string,
): { readonly levelIid: string; readonly solidId: string } | null {
  if (typeof id !== 'string' || !id.startsWith(APRON_ID_PREFIX)) return null;
  const rest = id.slice(APRON_ID_PREFIX.length);
  const split = rest.indexOf(':');
  if (split <= 0) return null;
  return { levelIid: rest.slice(0, split), solidId: rest.slice(split + 1) };
}

/**
 * Compile the seam apron for one room: every neighbouring static solid near a
 * linked seam, rebased into `active`'s local coordinates.
 *
 * Add the result to the room's own solids when stepping the kernel. Solids are
 * filtered on two independent rules:
 *
 * - **Depth** — the solid's AABB must reach into the band within `depth` px of
 *   the seam line, on the neighbour's side.
 * - **Span** — the solid must overlap the seam's shared perpendicular span,
 *   the same strict-overlap rule the exit poll uses to decide whether a
 *   crossing is real or void ({@link seamSpanFor}). A partial seam therefore
 *   gets no phantom support in its void band.
 *
 * @param active            the room being simulated
 * @param resolveNeighbour  iid → room; return `undefined` for rooms not loaded
 * @param options           see {@link SeamApronOptions}
 */
export function compileRoomSeamApron(
  active: SeamApronRoom,
  resolveNeighbour: (iid: string) => SeamApronRoom | undefined,
  options: Readonly<SeamApronOptions> = {},
): readonly Solid[] {
  const level = active?.ldtkLevel;
  if (level === undefined || level === null) return [];
  const links = level.__neighbours;
  if (!Array.isArray(links) || links.length === 0) return [];

  const depth = positiveOr(options.depth, DEFAULT_SEAM_APRON_DEPTH);
  const width = level.pxWid;
  const height = level.pxHei;
  const apron: Solid[] = [];

  for (const link of links) {
    const dir = asCardinal(link?.dir ?? '');
    if (dir === null) continue;                    // diagonal / unknown link
    const neighbour = resolveNeighbour(link.levelIid);
    if (neighbour === undefined || neighbour === null) continue;
    const seam = seamSpanFor(dir, level, neighbour.ldtkLevel);
    if (seam === null) continue;                   // not flush / no shared span

    // Neighbour-local → active-local, preserving world position.
    const dx = neighbour.ldtkLevel.worldX - level.worldX;
    const dy = neighbour.ldtkLevel.worldY - level.worldY;

    // The seam's shared span, expressed in active-local coordinates.
    const perpIsY = dir === 'e' || dir === 'w';
    const spanMin = perpIsY ? seam.min - level.worldY : seam.min - level.worldX;
    const spanMax = perpIsY ? seam.max - level.worldY : seam.max - level.worldX;

    // The band the apron may occupy, in active-local coordinates.
    const bandMin = dir === 'e' ? width : dir === 's' ? height : -depth;
    const bandMax = dir === 'e' ? width + depth : dir === 's' ? height + depth : 0;

    for (const solid of neighbour.solids) {
      const x = solid.x + dx;
      const y = solid.y + dy;

      const alongMin = perpIsY ? x : y;
      const alongMax = perpIsY ? x + solid.width : y + solid.height;
      if (!intervalsOverlap(alongMin, alongMax, bandMin, bandMax)) continue;

      const perpMin = perpIsY ? y : x;
      const perpMax = perpIsY ? y + solid.height : x + solid.width;
      if (!intervalsOverlap(perpMin, perpMax, spanMin, spanMax)) continue;

      apron.push({
        ...solid,
        id: `${APRON_ID_PREFIX}${neighbour.ldtkLevel.iid}:${solid.id ?? ''}`,
        x,
        y,
      });
    }
  }

  return apron;
}

/** A lazily-computed, memoized apron per room iid. */
export interface SeamApronCache {
  /** The apron for `iid`, compiled on first call and reused thereafter. */
  apronFor(iid: string): readonly Solid[];
  /** Drop one room's memoized apron (after an authoring edit). */
  drop(iid: string): void;
  /** Drop everything. */
  clear(): void;
}

/**
 * Memoize {@link compileRoomSeamApron} per room.
 *
 * Cycle-free by construction: an apron needs only a neighbour's SOLIDS, never
 * the neighbour's apron, so a mutual `A → B → A` link terminates immediately.
 */
export function createSeamApronCache(
  resolveRoom: (iid: string) => SeamApronRoom | undefined,
  options: Readonly<SeamApronOptions> = {},
): SeamApronCache {
  const cache = new Map<string, readonly Solid[]>();

  function apronFor(iid: string): readonly Solid[] {
    const hit = cache.get(iid);
    if (hit !== undefined) return hit;
    const room = resolveRoom(iid);
    const apron = room === undefined ? [] : compileRoomSeamApron(room, resolveRoom, options);
    cache.set(iid, apron);
    return apron;
  }

  return {
    apronFor,
    drop: (iid) => { cache.delete(iid); },
    clear: () => { cache.clear(); },
  };
}
