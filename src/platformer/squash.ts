/**
 * Phase 8c — per-event squash & stretch FX (render-only).
 *
 * Celeste's squash is NOT one global pair — it is a set of literal pairs applied
 * on discrete events, with the scale easing back toward `(1, 1)` every frame
 * (`Player.cs:2918-2920` for the pairs, `Player.cs:1165` for the ease-back):
 *
 *   ```
 *   Calc.Approach(scale, 1f, 1.75f * dt)   // BOTH axes, every frame
 *   ```
 *
 * This module is a PURE, DETERMINISTIC reader of the kernel's already-emitted
 * `PlatformerEvents` + the actor's `ActorCore` velocity. It NEVER touches
 * physics state: it does not mutate `PlatformerState` / `LocomotionState`, it is
 * not part of the kernel pipeline, and it carries no `physicsVersion` impact.
 * The TRANSIENT previous-frame scale (`prev`) is held by the RENDERER across
 * frames — this helper is a pure `(prev, input, config) → new Scale2D` function.
 *
 * **Determinism contract:** same `(prev, input, config)` → byte-identical
 * returned scale, forever. No `Math.random`, no `Date.now`, no DOM reads, no
 * global mutable state. Never throws.
 *
 * **Reduced-motion:** the consumer reads `prefersReducedMotion()` (renderer
 * layer) and can spread `DEFAULT_SQUASH_CONFIG` with dampened pairs / a faster
 * `easeRate`. The deterministic core never touches the host probe.
 *
 * @module
 */

import type { Scale2D } from '../animation/squash-stretch';
import type { PlatformerEvents } from './types';
import { approach } from '../primitives/pixel';

/**
 * Per-event squash tuning. Every field is consumer-tunable; spread
 * `DEFAULT_SQUASH_CONFIG` to override individual pairs. The default pairs are
 * VERBATIM Celeste literals (`Player.cs:2918-2920`); the `easeRate` is the
 * verbatim `1.75` from `Calc.Approach(scale, 1f, 1.75f * dt)` (`Player.cs:1165`).
 *
 * Each pair is `(scaleX, scaleY)`: `<1` squashes that axis (compresses), `>1`
 * stretches it. A volume-preserving read is NOT enforced here (Celeste's pairs
 * are not exactly volume-preserving either — `(.6, 1.4)` has product `.84`); the
 * art direction intentionally favors the silhouette over an area invariant.
 */
export interface SquashConfig {
  /**
   * Ease-back rate per second applied to BOTH axes toward `1` when no event
   * fires and the actor is not fast-falling. Verbatim Celeste `1.75`
   * (`Player.cs:1165`): `approach(scale, 1, easeRate * dt)` per axis.
   */
  readonly easeRate: number;
  /**
   * Per-axis approach rate (per second) toward {@link SquashConfig.fastFall}
   * while the actor is fast-falling. Celeste lerps the scale toward the
   * fast-fall silhouette rather than snapping; `8` reaches the squat in ~1/8 s
   * from identity. Renderer-tunable.
   */
  readonly fastFallRate: number;
  /**
   * Tall vertical stretch — applied on a ground/coyote JUMP launch
   * (`justLaunched`) AND on a DASH launch (`dashStarted`). Verbatim Celeste
   * `(.6, 1.4)` (`Player.cs:2918`). Celeste reuses the tall stretch for the dash
   * pop; we do the same.
   */
  readonly launch: Scale2D;
  /**
   * Softer vertical stretch — applied on a DOUBLE jump (`doubleJumped`).
   * Verbatim Celeste `(.8, 1.2)` softer-beat pair (`Player.cs:2918`).
   */
  readonly soft: Scale2D;
  /**
   * Horizontal impact stretch — applied on a WALL-JUMP launch
   * (`wallJumpLaunched`). Verbatim Celeste `(1.4, .6)` (`Player.cs:2920`).
   */
  readonly wallJump: Scale2D;
  /**
   * Wide horizontal squash — applied on a WALL BONK (`hitWall` while NOT
   * wall-jumping). Verbatim Celeste `(1.5, .5)` (`Player.cs:2920`).
   */
  readonly wallBonk: Scale2D;
  /**
   * Landing squat — applied on `justLanded`. A wide-short pair `(1.2, .8)`: the
   * volume-preserving inverse of the {@link SquashConfig.soft} beat, reading as
   * the moment of compression on impact. Celeste drives landing squash from a
   * 1D spring keyed to impact velocity (the jump slice already owns that spring
   * — see `advanceJump`/`landingSquashMin`); this fixed pair is the event-driven
   * layer's approximation for renderers that do not consume the jump-slice
   * spring (e.g. the LDtk play host, which draws the player without the jump
   * slice's pose scale).
   */
  readonly landing: Scale2D;
  /**
   * Fast-fall silhouette — the scale lerps toward this while the actor is
   * fast-falling (holding down while descending). Verbatim Celeste `(.5, 1.5)`
   * wide squat (`Player.cs:2918`). Reached per-axis via `approach` at
   * {@link SquashConfig.fastFallRate}.
   */
  readonly fastFall: Scale2D;
}

/**
 * Default squash tuning. The pairs are VERBATIM Celeste literals and the
 * `easeRate` is the verbatim `1.75` — do not "tune" these away from Celeste
 * without a documented reason. Spread this into your own config to override
 * individual fields (`{ ...DEFAULT_SQUASH_CONFIG, easeRate: 3.5 }`).
 */
export const DEFAULT_SQUASH_CONFIG: Readonly<SquashConfig> = {
  // Player.cs:1165 — `Calc.Approach(scale, 1f, 1.75f * dt)`, applied to BOTH axes.
  easeRate: 1.75,
  // Not a Celeste literal (Celeste eases `maxFall`, not the squash, toward the
  // fast-fall shape); chosen so the squat reads in ~1/8 s. Tunable.
  fastFallRate: 8,
  // Player.cs:2918-2920 — verbatim (scaleX, scaleY) pairs.
  launch: { scaleX: 0.6, scaleY: 1.4 },
  soft: { scaleX: 0.8, scaleY: 1.2 },
  wallJump: { scaleX: 1.4, scaleY: 0.6 },
  wallBonk: { scaleX: 1.5, scaleY: 0.5 },
  landing: { scaleX: 1.2, scaleY: 0.8 },
  fastFall: { scaleX: 0.5, scaleY: 1.5 },
};

/**
 * Identity scale — the rest / settled state. Exported so the renderer can
 * initialize its transient `currentSquash` without hand-rolling a literal.
 */
export const IDENTITY_SCALE: Readonly<Scale2D> = { scaleX: 1, scaleY: 1 };

/**
 * Per-tick input for {@link advanceSquash}. The caller (renderer) builds this
 * from the returned {@link PlatformerState} of the tick — it does NOT derive
 * anything the kernel has not already computed.
 */
export interface SquashInput {
  /** This tick's events (read verbatim from the kernel's `state.events`). */
  readonly events: PlatformerEvents;
  /** Actor horizontal velocity in px/s (from `core.vx`). Currently unused by the default pairs; reserved for future direction-aware FX. */
  readonly coreVx: number;
  /** Actor vertical velocity in px/s, +Y down (from `core.vy`). Read by callers to derive {@link SquashInput.fastFalling}; kept here for future heuristics. */
  readonly coreVy: number;
  /**
   * Caller-computed fast-fall flag. The canonical derivation is
   * `moveY === 1 && coreVy > 0` (holding down while descending). The renderer
   * computes this from its input snapshot + `core.vy` and passes it in so this
   * helper stays free of input-layer concerns.
   */
  readonly fastFalling: boolean;
  /** Fixed timestep in seconds (caller MUST keep constant for deterministic easing). */
  readonly dt: number;
}

/**
 * Advance the transient squash scale by one fixed timestep. PURE: returns a
 * fresh `Scale2D`; never mutates `prev`; never throws.
 *
 * Resolution order (DOCUMENTED — when multiple events fire on the same tick the
 * FIRST matching branch wins, so the outcome is deterministic):
 *
 *   1. **Launch** (`justLaunched` OR `dashStarted`) → {@link SquashConfig.launch}
 *      — the strongest visual beat; a dash/jump overrides everything.
 *   2. **Wall-jump** (`wallJumpLaunched`) → {@link SquashConfig.wallJump} — a
 *      committed horizontal launch off a wall.
 *   3. **Double jump** (`doubleJumped`) → {@link SquashConfig.soft} — a softer
 *      mid-air beat.
 *   4. **Wall bonk** (`hitWall`) → {@link SquashConfig.wallBonk} — a horizontal
 *      impact squash. (Ranked below the launches because a wall-jump or air-hop
 *      on the same tick is the more expressive read; `hitWall` and
 *      `wallJumpLaunched` are also mutually exclusive in practice.)
 *   5. **Land** (`justLanded`) → {@link SquashConfig.landing} — the lowest-
 *      priority event; if nothing else fired, the landing squat plays.
 *
 * If NO event fired:
 *   - **Fast-falling** (`input.fastFalling`): lerp BOTH axes toward
 *     {@link SquashConfig.fastFall} via `approach` at `fastFallRate * dt` per
 *     axis. The scale eases into the wide squat, never snaps.
 *   - **Otherwise**: ease BOTH axes back toward `1` via
 *     `approach(scale, 1, easeRate * dt)` — verbatim Celeste
 *     `Calc.Approach(scale, 1f, 1.75f * dt)` (`Player.cs:1165`).
 *
 * An event SETS the scale (it overrides `prev`); the ease-back / fast-fall
 * branches ADVANCE `prev`. This mirrors Celeste: the event pair is the impulse,
 * the per-frame approach is the recovery.
 *
 * @param prev - the previous frame's scale (held by the renderer; pass
 *   {@link IDENTITY_SCALE} on the first frame)
 * @param input - this tick's events + velocity + fast-fall flag + dt
 * @param config - squash tuning (spread {@link DEFAULT_SQUASH_CONFIG})
 * @returns a fresh `Scale2D` for this frame
 */
export function advanceSquash(
  prev: Scale2D,
  input: SquashInput,
  config: SquashConfig,
): Scale2D {
  const { events } = input;

  // 1. Launch — jump or dash pop (tall stretch).
  if (events.justLaunched || events.dashStarted) {
    return { scaleX: config.launch.scaleX, scaleY: config.launch.scaleY };
  }
  // 2. Wall-jump — committed horizontal launch.
  if (events.wallJumpLaunched) {
    return { scaleX: config.wallJump.scaleX, scaleY: config.wallJump.scaleY };
  }
  // 3. Double jump — softer mid-air beat.
  if (events.doubleJumped) {
    return { scaleX: config.soft.scaleX, scaleY: config.soft.scaleY };
  }
  // 4. Wall bonk — horizontal impact squash.
  if (events.hitWall) {
    return { scaleX: config.wallBonk.scaleX, scaleY: config.wallBonk.scaleY };
  }
  // 5. Land — landing squat.
  if (events.justLanded) {
    return { scaleX: config.landing.scaleX, scaleY: config.landing.scaleY };
  }

  // No event this tick — recover / drift.
  if (input.fastFalling) {
    // Ease toward the wide fast-fall squat, per axis.
    const rate = config.fastFallRate * input.dt;
    return {
      scaleX: approach(prev.scaleX, config.fastFall.scaleX, rate),
      scaleY: approach(prev.scaleY, config.fastFall.scaleY, rate),
    };
  }

  // Ease BOTH axes back toward 1 — verbatim Calc.Approach(scale, 1, 1.75 * dt).
  const ease = config.easeRate * input.dt;
  return {
    scaleX: approach(prev.scaleX, 1, ease),
    scaleY: approach(prev.scaleY, 1, ease),
  };
}
