/**
 * Pure ledge-mantle route helper (mantle wave — companion to
 * `docs/design/platformer-wall-mantle-directional-climb-jump-plan.md`).
 *
 * `findMantleRoute` answers ONE question: is a continuous assisted hop from
 * the actor's current position onto the top of `wall` geometrically
 * feasible, and if so, what launch impulse does it need? It computes
 * feasibility + launch metadata ONLY. It NEVER returns a replacement actor
 * position and never applies one — that is the load-bearing no-teleport
 * invariant of the mantle design:
 *
 * > Mantle code never writes `core.x` or `core.y`. Only the kernel's ordinary
 * > velocity integration and `resolveAxisX`/`resolveAxisY` collision pass may
 * > change actor position.
 *
 * The returned `landingX` is an edge-anchored FINISH MARKER for the
 * ability's short toward-ledge assist (the point at which the assist may
 * stop), never a teleport target. It is anchored to the wall's lip and
 * clamped by the actor's own body width, so a wide merged room/floor solid
 * (LDtk compiles floors into room-width rectangles) can never inflate the
 * actor's movement distance.
 *
 * The launch magnitude is derived from geometry, not copied: the hop must
 * lift the actor's ENTIRE collision body past the wall top before horizontal
 * motion can cross the lip, so the minimum impulse comes from the required
 * rise under the apex-derived jump gravity (plus a `gravity · dt` frame for
 * the semi-implicit Euler order — gravity applies before position). The
 * configured `mantleHopVy` remains a tuning floor; unusual actor heights
 * still receive enough lift to clear naturally.
 *
 * Before authorizing a launch the helper conservatively validates, in ≤1 px
 * deterministic increments against every blocking solid:
 *
 *   1. the vertical body sweep beside the wall (current X, current Y →
 *      predicted apex Y) — a ceiling above the starting side blocks the route;
 *   2. the above-ledge transition corridor (apex Y → landing Y × current X →
 *      landing X) — an overhang above the ledge blocks the route;
 *   3. the landing AABB at the finish marker — an occupied foothold blocks
 *      the route.
 *
 * Edges that merely touch remain clear (strict `aabbOverlap` semantics,
 * consistent with the collision resolvers). Passthrough, ladder, spring, and
 * dash-refill volumes are never blocking. A conservative false negative is
 * acceptable; tunnelling or a position snap is not. Live collision resolution
 * remains authoritative after launch, so changed/moving geometry still blocks
 * the actor naturally during the hop.
 *
 * Pure + deterministic: no `Math.random`, no `Date.now`, no mutation of any
 * input, never throws. Non-finite/invalid geometry returns `null`.
 *
 * Module-private surface: exported for direct unit testing but NOT re-exported
 * through the platformer barrel — consumers exercise mantling through the
 * public `stepPlatformer` / wall-grab ability API.
 *
 * @module
 */

import { aabbOverlap } from '../collision/aabb';
import type { Solid } from '../collision/types';
import type { ActorCore, PlatformerConfig } from './types';

/** Which side of the actor the grabbed wall is on. */
export type MantleSide = 'left' | 'right';

/** Feasibility + launch metadata for one mantle attempt. Never a position. */
export interface MantleRoute {
  /** The wall side the mantle starts from (mirrors the grab's latched side). */
  readonly side: MantleSide;
  /** The wall's top edge Y — the lip the actor's whole body must clear. */
  readonly wallTopY: number;
  /**
   * Edge-anchored assist finish marker. The horizontal assist may stop once
   * the actor's resolved X reaches it; it is NEVER copied into actor position.
   */
  readonly landingX: number;
  /** Derived upward launch velocity in px/s (negative — +Y is down). */
  readonly launchVy: number;
  /** The mantled wall's `Solid.id`, or `null` (provenance only). */
  readonly solidId: string | null;
}

/** Parameters for {@link findMantleRoute}. All fields required, all read-only. */
export interface FindMantleRouteParams {
  /** The actor core (immutable; never mutated, never re-returned). */
  readonly core: ActorCore;
  /** The wall solid being mantled (from the latched-side `probeWall` result). */
  readonly wall: Solid;
  /** Which side of the actor the wall is on. */
  readonly side: MantleSide;
  /** Platformer tuning (mantle + jump-apex fields). */
  readonly config: Readonly<PlatformerConfig>;
  /** Fixed timestep in seconds (the semi-implicit Euler frame guard). */
  readonly dt: number;
  /** Every collision surface (blocking-solid filter applied internally). */
  readonly solids: readonly Solid[];
}

/**
 * Whether `body` overlaps any BLOCKING solid (non-passthrough, non-ladder,
 * non-trigger-volume), via strict `aabbOverlap`. Mirrors the kernel's
 * collision-time clearance filter exactly — the same solids the live X/Y
 * resolvers treat as walls/ceilings are the solids the preflight treats as
 * blockers. Pure.
 */
function overlapsBlocking(
  body: { x: number; y: number; width: number; height: number },
  solids: readonly Solid[],
): boolean {
  for (const solid of solids) {
    if (solid.passthrough || solid.ladder) continue;
    if (solid.spring !== undefined || solid.dashRefill) continue;
    if (aabbOverlap(body, solid)) return true;
  }
  return false;
}

/**
 * Sample a 1-D vertical or horizontal span at deterministic ≤1 px increments
 * and report whether the body is clear of blocking solids at EVERY sample.
 *
 * The span is walked from `from` toward `to` in steps of at most 1 px, and the
 * exact `to` endpoint is always evaluated last regardless of float step
 * drift, so the destination itself can never be skipped. The non-swept axis
 * is held fixed at `fixed` (the body's leading extent on that axis); the
 * body's full extent is built from `core`. Pure.
 */
function spanClear(
  axis: 'x' | 'y',
  from: number,
  to: number,
  fixed: number,
  core: ActorCore,
  solids: readonly Solid[],
): boolean {
  const step = to >= from ? 1 : -1;
  for (let p = from; step > 0 ? p < to : p > to; p += step) {
    const body =
      axis === 'x'
        ? { x: p, y: fixed, width: core.width, height: core.height }
        : { x: fixed, y: p, width: core.width, height: core.height };
    if (overlapsBlocking(body, solids)) return false;
  }
  // Always evaluate the exact endpoint.
  const body =
    axis === 'x'
      ? { x: to, y: fixed, width: core.width, height: core.height }
      : { x: fixed, y: to, width: core.width, height: core.height };
  return !overlapsBlocking(body, solids);
}

/**
 * Compute the mantle route (feasibility + launch metadata) for hopping onto
 * the top of `wall` from the actor's current position, or `null` when the
 * route is blocked, the geometry is invalid, or the actor is not near the top.
 *
 * The caller (wall-grab ability) owns the input/stamina/precedence gates;
 * this helper owns the geometry: the head-at-top threshold, the finish
 * marker, the derived launch impulse, and the conservative clearance
 * preflight. Returns metadata ONLY — no coordinate it returns is ever copied
 * into actor position.
 *
 * Pure: never mutates any input; never throws; deterministic.
 */
export function findMantleRoute(params: FindMantleRouteParams): MantleRoute | null {
  const { core, wall, side, config, dt, solids } = params;

  // ----- Validate geometry. Non-finite numbers or a non-positive derived
  // gravity cannot produce a safe impulse — decline instead of launching. -----
  if (
    !Number.isFinite(core.x) ||
    !Number.isFinite(core.y) ||
    !Number.isFinite(core.width) ||
    !Number.isFinite(core.height) ||
    !Number.isFinite(wall.x) ||
    !Number.isFinite(wall.y) ||
    !Number.isFinite(wall.width) ||
    !Number.isFinite(wall.height) ||
    core.width <= 0 ||
    core.height <= 0 ||
    wall.width <= 0 ||
    wall.height <= 0 ||
    !Number.isFinite(dt) ||
    dt <= 0
  ) {
    return null;
  }

  // ----- Head-at-top threshold (the pre-emptive climb-up reach): the actor's
  // head must already be within one climb step (+ the Celeste check dist +
  // a half-pixel tolerance) of the wall top. Mid-climb on a tall wall, the
  // mantle is not eligible. -----
  const reach =
    config.wallClimbUpSpeed * dt + config.climbUpCheckDist + 0.5;
  if (core.y > wall.y + reach) return null;

  // ----- Edge-anchored finish marker. Inset is clamped to both the actor's
  // and the wall's width so it can never exceed either. This marker asks for
  // only a stable foothold — the wall's total (possibly merged room-wide)
  // width never enters the actor's movement distance. -----
  const inset = Math.min(
    Math.max(0, config.mantleLandingInset),
    core.width,
    wall.width,
  );
  const landingY = wall.y - core.height;
  const landingX =
    side === 'right'
      ? wall.x - core.width + inset
      : wall.x + wall.width - inset;

  // ----- Geometry-safe launch impulse. The hop must raise the actor's WHOLE
  // body past the wall top: the required rise is whatever the feet still hang
  // below the lip plus the configured hang-time clearance. The closed-form
  // minimum (√(2·g·rise)) gets one gravity frame (`g·dt`) because
  // semi-implicit Euler applies gravity BEFORE position each tick, so the
  // continuous minimum alone can fall short by a frame. The configured
  // `mantleHopVy` stays a tuning floor. -----
  const gravity =
    (2 * config.jump.apexHeight) /
    (config.jump.timeToApex * config.jump.timeToApex);
  if (!Number.isFinite(gravity) || gravity <= 0) return null;
  const requiredRise =
    Math.max(0, core.y + core.height - wall.y) +
    config.mantleApexClearance;
  const clearanceVy = Math.sqrt(2 * gravity * requiredRise) + gravity * dt;
  const launchVy = -Math.max(config.mantleHopVy, clearanceVy);

  // ----- Predicted apex: how far the derived impulse actually rises under
  // the same gravity (≥ requiredRise by construction). Used to bound the
  // clearance corridors. -----
  const rise = (launchVy * launchVy) / (2 * gravity);
  const apexY = core.y - rise;

  // ----- Preflight 1 — the vertical body sweep BESIDE the wall: the body at
  // its current X, rising from the current Y to the predicted apex. A ceiling
  // (or any blocking solid) over the starting column blocks the route before
  // launch. The grabbed wall itself never overlaps this column (the body is
  // flush against its face, not inside it — strict AABB). -----
  if (!spanClear('y', core.y, apexY, core.x, core, solids)) {
    return null;
  }

  // ----- Preflight 2 — the above-ledge transition corridor: the horizontal
  // path from the current X to the finish marker, swept vertically from the
  // predicted apex down to the landing Y. An overhang above the ledge blocks
  // this corridor. Walked as horizontal spans at each ≤1 px vertical step
  // (plus the exact landing-height band), which conservatively covers the
  // full rectangle the body traverses while crossing the lip. Above the
  // landing height the body's bottom edge is at/above the wall top, so the
  // wall's own lip never falsely blocks its own mantle. -----
  for (let y = apexY; y < landingY; y += 1) {
    if (!spanClear('x', core.x, landingX, y, core, solids)) {
      return null;
    }
  }
  // The exact landing-height band (the endpoint the stepped loop can skip).
  if (!spanClear('x', core.x, landingX, landingY, core, solids)) {
    return null;
  }

  // ----- Preflight 3 — the landing AABB at the finish marker: the foothold
  // itself must be free (edges that merely touch the ledge top remain clear,
  // consistent with `aabbOverlap`). -----
  if (
    overlapsBlocking(
      { x: landingX, y: landingY, width: core.width, height: core.height },
      solids,
    )
  ) {
    return null;
  }

  return {
    side,
    wallTopY: wall.y,
    landingX,
    launchVy,
    solidId: typeof wall.id === 'string' ? wall.id : null,
  };
}
