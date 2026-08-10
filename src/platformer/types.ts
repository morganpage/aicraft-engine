/**
 * Type definitions for the platformer kernel module.
 *
 * The kernel is the orchestration layer that connects the library's existing
 * primitives — `advanceJump`, `resolveAxisX`/`resolveAxisY`, edge accumulators
 * — into one authoritative deterministic step function. It does NOT duplicate
 * any underlying logic; it sequences it in the correct update order and owns
 * the persistent per-character state that abilities need between ticks.
 *
 * Architecture: Approach B from `docs/design/platformer-kernel-decision.md` —
 * a thin `PlatformerState` core (position, velocity, contacts) plus separate
 * ability modules (`JumpAbility`, `WallSlideAbility`, `DashAbility`,
 * `DoubleJumpAbility`). Each ability owns its own state slice and exposes an
 * `advance` function. The kernel runs the pipeline in a fixed, deterministic
 * order per tick. Adding a new ability (grapple, swim, climb) means writing
 * one new module and adding it to the pipeline — zero changes to existing
 * ability code or the kernel.
 *
 * **Purity contract (decision §Resolution 1):** `ActorCore` and every
 * `AbilityState` are deeply readonly. Each ability receives an immutable core
 * and returns a shallow-copied new core via spread. The kernel orchestrates
 * without any in-place mutation. Pure-progression-ops discipline honored.
 *
 * **Determinism contract:** same `(state, input, solids, dt)` → byte-identical
 * returned state, forever. No `Math.random`, no `Date.now`, no DOM reads, no
 * global mutable state.
 *
 * @module
 */

import type { JumpState, JumpConfig } from '../animation/jump';
import type { PolledEdge } from '../input/types';
import type { Solid } from '../collision/types';

/**
 * Contact identity — which solid the actor is touching, updated each tick by
 * the kernel from collision-resolution results.
 *
 * Every field is `string | null`: the string is the `Solid.id` of the solid
 * that caused the contact this tick, or `null` if no contact on that side or
 * the solid has no id assigned.
 */
export interface Contacts {
  /** The id of a physical floor contact, or `null` (independent of gravity). */
  readonly groundId: string | null;
  /** The id of the solid the actor is touching on its left side, or `null`. */
  readonly leftWallId: string | null;
  /** The id of the solid the actor is touching on its right side, or `null`. */
  readonly rightWallId: string | null;
  /** The id of a physical ceiling contact, or `null` (independent of gravity). */
  readonly ceilingId: string | null;
}

/**
 * Per-tick events emitted by the kernel. All fields are `boolean` — `true`
 * only on the single tick the event fires, `false` otherwise. The consumer
 * reads these from the returned state and they reset on the next tick.
 */
export interface PlatformerEvents {
  /** `true` on transition from unsupported to supported in gravity's direction. */
  readonly justLanded: boolean;
  /** `true` on the tick the jump ability launched the actor upward. */
  readonly justLaunched: boolean;
  /**
   * Physical upward collision for this tick. Under negative gravity, gravity
   * presses a supported actor upward every tick, so this remains `true` while
   * ceiling-supported; only `justLanded` is the support-entry pulse.
   */
  readonly hitCeiling: boolean;
  /** `true` on the tick the actor's side bumped a wall while moving. */
  readonly hitWall: boolean;
  /** `true` on the tick the wall-slide ability began sliding. */
  readonly startedWallSlide: boolean;
  /** `true` on the tick a wall-jump launched the actor off the wall. */
  readonly wallJumpLaunched: boolean;
  /** `true` on the tick the dash ability started a dash. */
  readonly dashStarted: boolean;
  /** `true` on the tick the double-jump ability fired a second jump in air. */
  readonly doubleJumped: boolean;
}

/**
 * Per-tick input snapshot consumed by the kernel. The consumer builds this
 * each tick from polled edge accumulators (`pollEdge`) and a horizontal move
 * scalar derived from left/right held state.
 */
export interface PlatformerInput {
  /** Horizontal movement intent: -1 (left), 0 (idle), +1 (right). */
  readonly moveX: -1 | 0 | 1;
  /** Polled jump edge (from `pollEdge`). */
  readonly jump: PolledEdge;
  /** Polled dash edge, or `null` if dash is disabled for this character. */
  readonly dash: PolledEdge | null;
  /**
   * Vertical climb intent: -1 (up), 0 (idle), +1 (down). Drives the climb
   * ability while on a ladder; ignored elsewhere. Optional — defaults to
   * `null` (climb disabled) so non-climb callers need not supply it.
   */
  readonly climb?: -1 | 0 | 1 | null;
}

/**
 * Core physics state — position, velocity, contacts. Abilities read through
 * this and produce a new copy via spread. Strictly immutable per decision
 * §Resolution 1 — every field is `readonly`.
 */
export interface ActorCore {
  /** World-space X of the body's top-left corner. */
  readonly x: number;
  /** World-space Y of the body's top-left corner (+Y is down). */
  readonly y: number;
  /** Body width in world units. */
  readonly width: number;
  /** Body height in world units. */
  readonly height: number;
  /** Horizontal velocity in px/s. */
  readonly vx: number;
  /** Vertical velocity in px/s (+Y is down, so upward motion is negative). */
  readonly vy: number;
  /** Facing direction: +1 right, -1 left. */
  readonly facing: 1 | -1;
  /** `true` when supported opposite the current gravity direction. */
  readonly onGround: boolean;
  /** Contact identity from last tick's collision resolution. */
  readonly contacts: Contacts;
}

/**
 * Base shape for every ability's persistent state slice. Each concrete
 * ability state (e.g. `JumpAbilityState`) extends this and adds a
 * string-literal `kind` discriminator for serialization and pipeline lookup.
 */
export interface AbilityState {
  /** Discriminator for debugging, serialization, and pipeline lookup. */
  readonly kind: string;
}

/**
 * Read-only context passed to every ability's `advance` function each tick.
 * Abilities must treat the `core` and `input` as immutable — they return a
 * new shallow-copied core rather than mutating the input.
 */
export interface AbilityContext {
  /** Current actor core (immutable). */
  readonly core: ActorCore;
  /** Per-tick input snapshot. */
  readonly input: PlatformerInput;
  /** Fixed timestep in seconds. */
  readonly dt: number;
  /** Platformer tuning config. */
  readonly config: PlatformerConfig;
  /**
   * Collision surfaces for this tick (including any `ladder`-flagged solids),
   * so an ability can detect geometry — e.g. a climb ability asks
   * `overlapsLadder(core, solids)`. Optional because most abilities need no
   * geometry; the kernel always supplies it. Read-only.
   */
  readonly solids?: readonly Solid[];
}

/**
 * Per-ability result returned by `AbilityProcessor.advance`. Contains the
 * post-ability core (shallow-copied), the post-ability ability-state, and the
 * partial set of events this ability emitted this tick. The kernel merges the
 * partial events into the full `PlatformerEvents` for the tick.
 */
export interface AbilityResult<TState extends AbilityState> {
  /** Post-ability actor core (shallow-copied from the input core). */
  readonly core: ActorCore;
  /** Post-ability ability state (a brand-new record). */
  readonly state: TState;
  /** Subset of events emitted by this ability this tick. */
  readonly events: Partial<PlatformerEvents>;
}

/**
 * Writable view of `PlatformerEvents`. Used internally by the kernel and
 * ability implementations to accumulate events field-by-field before
 * returning the frozen `readonly` record. Not for external use.
 */
export type WritablePlatformerEvents = {
  -readonly [K in keyof PlatformerEvents]: PlatformerEvents[K];
};

/**
 * One ability's per-tick processor. The controller runs these in a fixed
 * pipeline order each tick (see `defaultPrecisionPipeline`).
 *
 * Implementations MUST be pure: same `(ctx, state)` → byte-identical result,
 * forever. Never mutate `ctx.core` — produce a new shallow-copied core via
 * spread. Never throw.
 *
 * @typeparam TState - the concrete ability-state type this processor handles
 */
export interface AbilityProcessor<TState extends AbilityState> {
  /** State-kind discriminator (matches `TState['kind']`). */
  readonly kind: TState['kind'];
  /**
   * Run this ability for one tick. Receives an immutable context and the
   * ability's prior state; returns the post-ability core, the post-ability
   * state, and any events emitted.
   *
   * Pure: never mutates `ctx.core` or `state`; returns fresh records.
   * Never throws.
   */
  advance(ctx: AbilityContext, state: TState): AbilityResult<TState>;
}

/**
 * Jump ability state. Wraps the existing `JumpState` from `src/animation/jump`.
 * The jump trajectory, coyote time, buffering, and variable-height cutoff all
 * live inside `JumpState`; the ability is a thin adapter that feeds
 * `JumpInputs` derived from the kernel context and applies the resulting `vy`
 * back onto the core.
 */
export interface JumpAbilityState extends AbilityState {
  /** Literal: `'jump'`. */
  readonly kind: 'jump';
  /** The wrapped jump state. */
  readonly jump: JumpState;
}

/**
 * Wall-slide ability state. Tracks whether the actor is currently sliding down
 * a wall, which wall, and a lock timer that prevents re-entering wall-slide
 * immediately after a wall-jump (so the wall-jump's horizontal push has time
 * to carry the actor away from the wall before slide re-engages).
 */
export interface WallSlideAbilityState extends AbilityState {
  /** Literal: `'wallSlide'`. */
  readonly kind: 'wallSlide';
  /** `true` while the actor is sliding down a wall. */
  readonly sliding: boolean;
  /** Which wall is being slid (`'left'`, `'right'`, or `null` when not sliding). */
  readonly side: 'left' | 'right' | null;
  /** Remaining wall-jump lock time in seconds (≥ 0). */
  readonly lockTimer: number;
}

/**
 * Dash ability state. Tracks the active dash timer, the post-dash cooldown,
 * and the limited dash budget for the current airborne cycle. Direction is
 * captured at dash-start and held constant through the dash.
 */
export interface DashAbilityState extends AbilityState {
  /** Literal: `'dash'`. */
  readonly kind: 'dash';
  /** Remaining dash time in seconds; `0` when not dashing. */
  readonly timer: number;
  /** Remaining cooldown in seconds before another dash can begin (≥ 0). */
  readonly cooldown: number;
  /** Remaining dashes for this airborne cycle; refills to `maxDashes` on land. */
  readonly dashesRemaining: number;
  /** Captured dash direction X component (signed unit: -1, 0, or +1). */
  readonly dirX: number;
  /** Captured dash direction Y component (signed unit: -1, 0, or +1). */
  readonly dirY: number;
}

/**
 * Double-jump ability state. Tracks the remaining second-jump budget for the
 * current airborne cycle; refills to `maxDoubleJumps` whenever the actor lands.
 */
export interface DoubleJumpAbilityState extends AbilityState {
  /** Literal: `'doubleJump'`. */
  readonly kind: 'doubleJump';
  /** Remaining double-jumps for this airborne cycle (≥ 0). */
  readonly jumpsRemaining: number;
}

/**
 * Climb (ladder) ability state. `climbing` is `true` on the tick the body
 * overlaps a ladder and isn't jumping — the kernel reads it (via
 * `isClimbActive`) to skip gravity, restore the climb-authoritative Y, and
 * reset the jump state so climb and jump coexist without desync.
 */
export interface ClimbAbilityState extends AbilityState {
  /** Literal: `'climb'`. */
  readonly kind: 'climb';
  /** `true` while the body overlaps a ladder this tick and isn't jumping. */
  readonly climbing: boolean;
}

/**
 * Discriminated union of every ability state the kernel ships. Used for
 * serialization (replay round-trip) and for the controller's
 * `Record<string, AnyAbilityState>` store.
 */
export type AnyAbilityState =
  | JumpAbilityState
  | WallSlideAbilityState
  | DashAbilityState
  | DoubleJumpAbilityState
  | ClimbAbilityState;

/**
 * Full per-character platformer state — the unit of work the kernel clones
 * each tick. All fields are `readonly`.
 */
export interface PlatformerState {
  /** The actor core (position, velocity, contacts). */
  readonly core: ActorCore;
  /** Per-ability state slices, keyed by ability `kind`. */
  readonly abilities: Readonly<Record<string, AnyAbilityState>>;
  /** Events emitted on the most recent tick (consumer reads and clears). */
  readonly events: PlatformerEvents;
  /** Monotonic integer tick counter — strictly increases by 1 each step. */
  readonly tick: number;
}

/**
 * All tunable knobs for the kernel. Spread `DEFAULT_PLATFORMER_CONFIG` into
 * your own object to override individual fields.
 *
 * Math note: gravity and jump apex parameterization are independent. The
 * kernel's `gravity` (applied during the integrate step) controls fall speed
 * after the apex; `jump`'s derived `physics.gravity` controls rise trajectory
 * inside `advanceJump`. This split keeps rise and fall independently tunable.
 */
export interface PlatformerConfig {
  /** Signed gravity in px/s². Positive pulls down; negative pulls up. */
  readonly gravity: number;
  /** Maximum speed in the current gravity direction, expressed as a magnitude. */
  readonly maxFallSpeed: number;
  /** Ground move speed in px/s. */
  readonly moveSpeed: number;
  /** Air control multiplier in `[0, 1]` (1 = full ground control in air). */
  readonly airControl: number;
  /** Jump tuning (apex parameterization, coyote, buffer, variable height). */
  readonly jump: JumpConfig;
  /** Master switch for jump. Omitted means enabled. Signed-gravity jump is deferred. */
  readonly jumpEnabled?: boolean;
  /** Master switch for the wall-slide ability. */
  readonly wallSlideEnabled: boolean;
  /** Wall-slide terminal velocity in px/s (slow slide). */
  readonly wallSlideSpeed: number;
  /** Wall-jump launch velocity X component in px/s (pushes away from wall). */
  readonly wallJumpVx: number;
  /** Wall-jump launch velocity Y component in px/s (upward; negative). */
  readonly wallJumpVy: number;
  /** Wall-jump lock time in seconds (prevents re-wall-slide briefly). */
  readonly wallJumpLockTime: number;
  /** Master switch for the dash ability. */
  readonly dashEnabled: boolean;
  /** Dash speed in px/s. */
  readonly dashSpeed: number;
  /** Dash duration in seconds. */
  readonly dashDuration: number;
  /** Dash cooldown in seconds after a dash ends. */
  readonly dashCooldown: number;
  /** Max dashes per airborne cycle (refills on land). */
  readonly maxDashes: number;
  /** Master switch for the double-jump ability. */
  readonly doubleJumpEnabled: boolean;
  /** Max double-jumps per airborne cycle (refills on land; typically 0 or 1). */
  readonly maxDoubleJumps: number;
  /** Master switch for the climb (ladder) ability. Default off. */
  readonly climbEnabled: boolean;
  /** Climb speed in px/s while ascending/descending a ladder. */
  readonly climbSpeed: number;
  /**
   * Maximum vertical step-up height in px the player auto-snaps over while
   * moving horizontally into a small step. When the player walks into a solid
   * whose top is within this height above the player's feet, the player is
   * lifted onto it instead of being blocked — so stairs, small ledges, and the
   * last few px of a ladder-top exit (where the player is one climb step below a
   * flush platform) are traversed smoothly. `0` (or omitted) disables step-up,
   * preserving strict wall blocking. Only applies while moving horizontally and
   * supported (on ground or climbing) — never in free fall.
   */
  readonly stepHeight?: number;
}

/**
 * Convenience helper for callers that build `PlatformerInput.moveX` from a
 * pair of polled edges (left + right). When both are held, `moveX` is `0`.
 */
export interface MoveInput {
  /** Polled left-direction edge. */
  readonly left: PolledEdge;
  /** Polled right-direction edge. */
  readonly right: PolledEdge;
}
