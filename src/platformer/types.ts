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
import type { SquashConfig } from './squash';

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
 * Phase 8 — the kind of identifiable surface interaction the kernel reports.
 *
 * `InteractionEvent` carries an `entityId` (the `Solid.id` of the trigger
 * volume touched) so the consumer can run per-entity cooldown / respawn
 * logic — the core of Celeste's dash-crystal loop. A boolean `dashRefilled`
 * event could not say WHICH crystal was consumed.
 */
export type InteractionKind = 'spring' | 'dashRefill';

/**
 * Phase 8 — an identified surface-interaction event. Emitted by the kernel
 * each tick the actor overlaps a `spring` or `dashRefill` solid. The consumer
 * reads `state.interactions` and owns cooldowns / respawn timers / visuals.
 *
 * `entityId` is the `Solid.id` of the trigger volume (springs/dashRefills are
 * non-blocking marker solids). An absent `Solid.id` normalizes to `''` so the
 * event is always well-formed even for hand-rolled solids without ids.
 */
export interface InteractionEvent {
  /** Which kind of trigger volume was touched. */
  readonly kind: InteractionKind;
  /** The `Solid.id` of the trigger volume touched (or `''` if the solid has no id). */
  readonly entityId: string;
}

/**
 * Phase D2 — a single-tick FEEL moment surfaced on
 * {@link PlatformerState.moments}.
 *
 * The structured feel channel parallels the boolean {@link PlatformerEvents}
 * and the spring/dashRefill {@link InteractionEvent} stream. Where the booleans
 * say *that* something happened, a moment says *with what intensity* and *on
 * which surface* — data the kernel already computes internally but, before D2,
 * discarded (the load-bearing reason `squash.ts` ships a fixed landing pair:
 * Celeste keys landing squash off a 1D spring tied to impact velocity, which the
 * kernel never exposed). Every kind is presentation-only: nothing here feeds
 * velocity or position, so emitting moments cannot perturb the simulation
 * (mirrors the camera brain's presentation-only contract). The channel is
 * single-tick and replay-deterministic — same inputs ⇒ same moments.
 *
 * Kinds:
 *  - `landing`        — unsupported→supported transition. `impactSpeed` is the
 *    absolute pre-zero px/s `vy`; `normalizedImpact` is
 *    `clamp(impactSpeed / max(|maxFallSpeed|, ε), 0, 1)` so the hard-landing
 *    test is scale-invariant (the fix for the unscaled `prevVy > 520` magic
 *    number that never fired at 8 px). `hard = normalizedImpact ≥
 *    hardLandingThresholdFor(config)`; `solidId` is the gravity-facing support
 *    id (ground under positive gravity, ceiling under negative).
 *  - `dashBonk`       — a blocked-axis bonk during an active dash, emitted once
 *    per blocked axis per dash. `normalX`/`normalY` is the conventional
 *    outward surface normal (a wall on the actor's right gives `normalX = -1`;
 *    a ceiling gives `normalY = +1`). `solidId` is the resolved contact. A
 *    pinned dash does NOT retrigger: per-dash X/Y latches reset on each new dash.
 *  - `dashEnded`      — observation-only end of a dash. The dash still ends on
 *    timeout in this release, so `reason` is honestly `'timeout'`;
 *    `terminalContact` records the wall/ceiling/floor context on the ending
 *    tick WITHOUT claiming it caused the end. (Ending a dash early on contact
 *    is a behaviour-changing follow-up that may widen `reason` later.)
 *  - `grabLatch`      — `WallGrabAbilityState.grabbing: false → true`.
 *  - `staminaExhausted` — the `stamina > 0 → ≤ 0` crossing while grabbing.
 *  - `springLaunch`/`dashRefill` — supersede (and initially parallel) the
 *    `interactions` array, adding the `super` flag for super-springs and a
 *    uniform `solidId`.
 */
export type FeelMoment =
  | {
      readonly kind: 'landing';
      /** Absolute pre-zero landing px/s speed (`abs(core.vy)` before the Y resolver zeroes it). */
      readonly impactSpeed: number;
      /** `clamp(impactSpeed / max(|maxFallSpeed|, ε), 0, 1)` — scale-invariant under tile size AND gravity sign. */
      readonly normalizedImpact: number;
      /** `normalizedImpact ≥ hardLandingThresholdFor(config)`. */
      readonly hard: boolean;
      /** Gravity-facing support id (`groundId` / `ceilingId`), or `null` if none resolved. */
      readonly solidId: string | null;
    }
  | {
      readonly kind: 'dashBonk';
      /** Conventional outward surface normal X (`-1`/`0`/`+1`). A right wall gives `-1`. */
      readonly normalX: -1 | 0 | 1;
      /** Conventional outward surface normal Y (`-1`/`0`/`+1`). A ceiling gives `+1`. */
      readonly normalY: -1 | 0 | 1;
      /** Resolved contact solid id, or `null`. */
      readonly solidId: string | null;
    }
  | {
      readonly kind: 'dashEnded';
      /** Honestly `'timeout'` in this release (the dash ends on timeout). */
      readonly reason: 'timeout';
      /** Wall/ceiling/floor context on the ending tick, or `'none'`. Observation-only. */
      readonly terminalContact: 'none' | 'wall' | 'ceiling' | 'floor';
    }
  | { readonly kind: 'grabLatch'; readonly solidId: string | null }
  | { readonly kind: 'staminaExhausted' }
  | { readonly kind: 'springLaunch'; readonly solidId: string | null; readonly super: boolean }
  | { readonly kind: 'dashRefill'; readonly solidId: string | null };

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
  /**
   * `true` on the tick a dash ENTERS its startup/freeze phase — i.e. the tick
   * the dash button is consumed, BEFORE any dash motion is applied. Celeste
   * freezes the actor (~0.05s) before applying dash velocity
   * (`Player.cs:3448` `Celeste.Freeze(.05f)`); `dashStarting` marks that freeze
   * entry. The matching motion event is {@link PlatformerEvents.dashStarted},
   * which fires on the tick the freeze ends and the dash velocity actually
   * applies. The two are never `true` on the same tick.
   */
  readonly dashStarting: boolean;
  /** `true` on the tick the dash ability APPLIES dash velocity (freeze ended). */
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
  /**
   * Horizontal movement intent — a signed magnitude in the range `[-1, 1]`.
   * Positive values move right, negative left, `0` is idle. The magnitude
   * scales the target ground/air speed (e.g. `moveX = 0.5` targets half
   * `moveSpeed`), so analog controllers (gamepad sticks) can drive
   * partial-speed movement.
   *
   * NON-PARITY EXTENSION (Phase 9): Celeste's `moveX` is strictly digital
   * (`-1 | 0 | 1`, `Player.cs` `Input.MoveX`). Widening to `number` enables
   * analog input WITHOUT altering digital behavior: every edge/intent check
   * in the kernel is sign-based (`moveX < 0` / `> 0` / `Math.sign(moveX)`),
   * so `moveX ∈ {-1, 0, 1}` produces byte-identical trajectories to v8. A
   * future deadzone for jittery analog sticks could be added by the input
   * layer (out of scope here — the kernel treats any nonzero value as
   * intent).
   */
  readonly moveX: number;
  /**
   * Vertical movement intent: -1 (up), 0 (idle), +1 (down). Drives the climb
   * ability while on a ladder (climb-up = -1, climb-down = +1) AND the
   * fast-fall cap (holding down eases the max-fall cap up toward
   * `fastMaxFallSpeed`). Optional — defaults to `0` (idle) so non-climb callers
   * need not supply it, but real callers (showcase / harness) always do.
   */
  readonly moveY?: -1 | 0 | 1;
  /** Polled jump edge (from `pollEdge`). */
  readonly jump: PolledEdge;
  /** Polled dash edge, or `null` if dash is disabled for this character. */
  readonly dash: PolledEdge | null;
  /**
   * Polled grab edge (Phase 6 — wall-grab / wall-climb), or `null`/absent if
   * grab is disabled for this character. Semantics mirror `dash`: `null` or
   * omitted means the grab key is unmapped and the wall-grab ability is a
   * no-op regardless of `wallGrabEnabled` (the player has no way to ask for a
   * grab). When non-null, `held` drives wall-grab engage/continue and
   * `pressed`/`released` are available for edge-triggered variants later.
   */
  readonly grab?: PolledEdge | null;
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
  /**
   * The shared locomotion slice (Phase 5 — coyote/buffer/varJump/forceMoveX +
   * the Phase 4 mutable max-fall cap + Phase 5 ducking / last-dash-direction /
   * super-jump grace / dashing flag). Optional because most abilities do not
   * read it; the kernel ALWAYS supplies it. It is the PREVIOUS tick's resolved
   * slice (abilities see last tick's state, same as they see last tick's
   * `core`). Read-only. Phase 5's `dashTechAbility` reads `lastDashDir*`,
   * `ducking`, `superJumpGraceTimer`, and `dashing` from here to decide whether
   * a super jump / super wall jump fires this tick.
   */
  readonly locomotion?: LocomotionState;
}

/**
 * Per-ability result returned by `AbilityProcessor.advance`. Contains the
 * post-ability core (shallow-copied), the post-ability ability-state, the
 * partial set of events this ability emitted this tick, and an OPTIONAL launch
 * intent. The kernel merges the partial events into the full
 * `PlatformerEvents` for the tick and arbitrates at most one launch across all
 * abilities (see `LaunchIntent`).
 */
export interface AbilityResult<TState extends AbilityState> {
  /** Post-ability actor core (shallow-copied from the input core). */
  readonly core: ActorCore;
  /** Post-ability ability state (a brand-new record). */
  readonly state: TState;
  /** Subset of events emitted by this ability this tick. */
  readonly events: Partial<PlatformerEvents>;
  /**
   * Optional vertical (and optionally horizontal) launch impulse this ability
   * wants applied this tick. The kernel collects every ability's `launch`,
   * picks at most one by a fixed priority order, and applies the winner to
   * `core.vy`/`core.vx` AFTER the pipeline runs. This is the single chokepoint
   * through which ALL jump-class impulses flow, so an impulse can no longer be
   * silently discarded by a later ability's stale internal trajectory
   * (the Phase 0b vertical-velocity-authority fix).
   */
  readonly launch?: LaunchIntent;
  /**
   * Optional partial update to the shared {@link LocomotionState} this ability
   * wants applied (Phase 5). Abilities normally do NOT write locomotion — the
   * kernel owns it — but a few cross-ability signals must originate inside an
   * ability. Concretely: `dashAbility` returns `locomotionPatch: { ducking:
   * true }` on the tick it converts a down-diagonal ground dash into a hyper
   * slide (Celeste `Player.cs:3578-3585`), because only the dash ability knows
   * that conversion happened. The kernel collects every ability's patch (in
   * pipeline order, last-write-wins per field) and applies it to `locomotion`
   * AFTER the pipeline completes, before its own ducking/grace maintenance.
   * Fields an ability omits are left untouched.
   */
  readonly locomotionPatch?: Partial<LocomotionState>;
  /**
   * Phase D2 — optional feel moments this ability emits this tick (e.g.
   * `wallGrabAbility` latches a `grabLatch`/`staminaExhausted`). The kernel
   * appends these in pipeline order BEFORE adding its own collision/environment
   * moments (`landing`/`dashBonk`/`dashEnded`/`springLaunch`/`dashRefill`).
   * Presentation-only — they never feed velocity or position. Omitted means no
   * ability-authored moments this tick.
   */
  readonly moments?: readonly FeelMoment[];
}

/**
 * Which kind of ability produced a {@link LaunchIntent}. The kernel uses this
 * only to break ties when multiple abilities emit a launch on the same tick
 * (see {@link LAUNCH_PRIORITY}). `spring` is reserved for a later wave (Phase 8)
 * and cannot fire today.
 *
 * Phase 5 adds `'superJump'` and `'superWallJump'` (Celeste `Player.cs:3495-3524`
 * — dash-tech launches that beat a plain jump via arbitration).
 *
 * Phase 6 adds `'climbHop'` (Celeste `Player.cs:1711` `ClimbJump*` — the
 * wall-grab's jump-off-the-wall launch). It ranks alongside `wallJump` (a
 * committed wall move that must beat a plain `jump` / `doubleJump` emitted the
 * same tick) and is the only launch source that opens a `forceMoveX` lockout
 * with `climbHopForceTime` rather than `wallJumpLockTime`.
 */
export type LaunchSource =
  | 'jump'
  | 'wallJump'
  | 'doubleJump'
  | 'superJump'
  | 'superWallJump'
  | 'climbHop'
  | 'spring';

/**
 * A discrete launch impulse an ability wants the kernel to apply.
 *
 * Phase 0b contract: abilities NEVER write `core.vy` directly for a jump-class
 * impulse. They emit one of these instead. The kernel is the single authority:
 * it arbitrates at most one launch per tick (priority order documented on
 * {@link LAUNCH_PRIORITY}), applies the winner to `core.vy` (and `core.vx` when
 * present), opens the variable-jump window (`locomotion.varJumpTimer`), and
 * emits the matching event. Because the impulse lands on `core` (not on a
 * private ability-internal velocity), subsequent ticks continue from it — the
 * old "double-jump/wall-jump impulse survives one tick then reverts" defect is
 * gone.
 */
export interface LaunchIntent {
  /** Vertical launch velocity in px/s (negative — upward, +Y is down). */
  readonly vy: number;
  /**
   * Optional horizontal velocity SET (not added) by this launch, in px/s.
   * Used by wall-jump to push the actor away from the wall. When present the
   * kernel writes `core.vx = intent.vx` (replacing horizontal input this tick).
   */
  readonly vx?: number;
  /**
   * Variable-jump window this launch opens, in seconds. While
   * `locomotion.varJumpTimer > 0` the kernel applies variable-height gravity
   * (full height if the button is held, short-hop cutoff + fallMultiplier if
   * released). Derived from `JumpConfig.timeToApex` for every launch source —
   * see `jump-ability.ts` / `wall-slide-ability.ts` / `double-jump-ability.ts`.
   */
  readonly varJumpTime: number;
  /** Which ability emitted this launch (for arbitration + event emission). */
  readonly source: LaunchSource;
}

/**
 * Fixed tie-break priority for same-tick launch collisions, highest first.
 *
 * `spring > superWallJump > superJump > wallJump = climbHop > doubleJump > jump`
 *
 * Collisions are unlikely in practice (the pipeline order + each ability's
 * guards prevent most same-tick doubles), but the order is defined so the
 * outcome is deterministic if one ever occurs: environmental (`spring`) and
 * committed-directional (`wallJump`/`superWallJump`/`climbHop`) impulses beat a
 * discretionary air-jump (`doubleJump`), which beats the basic ground/coyote
 * `jump`. Phase 5 inserts the dash-tech launches ABOVE normal jump so a
 * `dashTechAbility` super-jump / super-wall-jump LaunchIntent ARBITRATES OUT a
 * plain ground jump emitted the same tick by `jumpAbility` (Celeste-faithful:
 * `SuperJump`/`SuperWallJump` are dispatched INSTEAD of `Jump`). Within the
 * tech, `superWallJump` ranks above `superJump` (it is the rarer, more
 * committed move off a wall). Phase 6's `climbHop` ranks with `wallJump`
 * (priority 3) — both are committed wall moves that must beat a plain
 * `jump`/`doubleJump` emitted the same tick; they can never collide with each
 * other (wall-jump needs `wallSlide`, climb-hop needs `wallGrab` — mutually
 * exclusive by input). Exported for tests; the kernel applies it via
 * {@link pickLaunch}.
 */
export const LAUNCH_PRIORITY: Readonly<Record<LaunchSource, number>> = {
  spring: 6,
  superWallJump: 5,
  superJump: 4,
  wallJump: 3,
  climbHop: 3,
  doubleJump: 2,
  jump: 1,
};

/**
 * Exclusive locomotion mode the kernel resolves each tick (Phase 0d).
 *
 * Exactly one mode is active per tick. The mode centralizes ALL the cross-
 * ability exclusivity logic that previously lived in ad-hoc `isDashActive` /
 * `isClimbActive` helpers — Wave 7's wall-grab just adds one more branch
 * (`'wallGrab'`) here, with no new bespoke helpers anywhere.
 *
 *   - `'normal'`  — kernel owns gravity + horizontal input (the default).
 *   - `'dash'`    — dash owns velocity for its duration, INCLUDING the startup
 *                   freeze phase; kernel SKIPS gravity and horizontal input
 *                   (dash is a sustained velocity, not an impulse, so it still
 *                   sets `core.vx`/`core.vy` directly — including pinning both
 *                   to 0 during startup).
 *   - `'ladder'`  — climb owns `vy`; kernel SKIPS gravity and restores the
 *                   climb-authoritative Y.
 *   - `'wallGrab'`— wall-grab owns `vy` (cling/climb) AND `vx` (pinned to 0);
 *                   kernel SKIPS gravity and horizontal input. Engaged by
 *                   `wallGrabAbility` while `input.grab.held` and a wall is
 *                   present on the facing side (Phase 6).
 */
export type LocomotionMode = 'normal' | 'dash' | 'wallGrab' | 'ladder';

/**
 * Shared, non-ability locomotion state (Phase 0c). A TOP-LEVEL field on
 * {@link PlatformerState} (alongside `core`/`abilities`/`events`/`tick`), NOT
 * an ability slice — it is shared across the kernel and every jump-class
 * ability, so it cannot belong to any one of them.
 *
 * Authority notes:
 *  - `varJumpTimer` / `varJumpSpeed`: AUTHORITY for the kernel's variable-
 *    height gravity. Written by the kernel when it applies a launch; read +
 *    decremented by the kernel each tick.
 *  - `forceMoveXTimer` / `forceMoveX`: AUTHORITY for the wall-jump horizontal
 *    lockout. Written by the kernel when it applies a wall-jump launch; the
 *    kernel honors `forceMoveX` (skips horizontal input) while the timer > 0.
 *  - `coyoteTimer` / `jumpBufferTimer`: kernel-maintained MIRROR of the jump
 *    slice's timers (see deviation note in `kernel.ts`). `advanceJump` remains
 *    the state-machine authority for these so the jump-animation contract
 *    (`evaluateJump`, `jump.test.ts`) is preserved byte-for-byte; the mirror
 *    exposes them on the shared top-level slice so future waves (wall-jump /
 *    double-jump consuming a shared buffer) can read/write them without
 *    reaching into the jump ability's internals.
 */
export interface LocomotionState {
  /** Ground-grace (coyote) timer, in seconds (mirror of jump slice). */
  readonly coyoteTimer: number;
  /** Shared buffered jump-press window, in seconds (mirror of jump slice). */
  readonly jumpBufferTimer: number;
  /** Variable-jump window opened by the most recent launch, in seconds. */
  readonly varJumpTimer: number;
  /** Launch speed remembered for the variable-height cutoff (negative). */
  readonly varJumpSpeed: number;
  /** Wall-jump horizontal lockout remaining, in seconds (≥ 0). */
  readonly forceMoveXTimer: number;
  /** Forced horizontal direction during a wall-jump lockout (-1, 0, +1). */
  readonly forceMoveX: number;
  /**
   * Wall-grab stamina pool (Phase 6 — Celeste `ClimbMaxStamina 110`,
   * `Player.cs:102`). A shared resource: DEPLETED by `wallGrabAbility` while
   * grabbing (up-climb at `staminaUpCostPerSec`, cling at
   * `staminaStillCostPerSec`, climb-hop flat `staminaClimbJumpCost`) and
   * REFILLED to `wallGrabMaxStamina` by the kernel whenever the actor is
   * supported (`onGround`). When it hits 0 the grab RELEASES and cannot
   * re-engage until refilled. Lives here (not on `WallGrabAbilityState`)
   * because it is read/refilled by code outside the wall-grab ability (the
   * kernel's ground refill) — the same reason `dashesRemaining` lives on the
   * dash slice but is conceptually shared. Init to `wallGrabMaxStamina` by
   * `createPlatformerState`.
   */
  readonly stamina: number;
  /**
   * Current effective max-fall cap (Phase 4 — Celeste `Player.cs:2910-2924`).
   * A per-actor magnitude that EASES between {@link PlatformerConfig.maxFallSpeed}
   * and {@link PlatformerConfig.fastMaxFallSpeed} at `fastMaxAccel`/sec, in BOTH
   * directions: while `moveY === 1` (down held) it eases UP toward
   * `fastMaxFallSpeed`; otherwise it eases DOWN toward `maxFallSpeed`. The
   * gravity integration clamps to THIS value (not the static `maxFallSpeed`),
   * so holding down lets terminal vy exceed `maxFallSpeed` (fast-fall) without
   * ever exceeding `fastMaxFallSpeed`. Kernel-authoritative: eased once per tick
   * (only when gravity is applied — not during dash/ladder) and read by
   * `integrateGravity`. Initialized to `maxFallSpeed` for a fresh state.
   */
  readonly maxFallCurrent: number;
  /**
   * Ducking state (Phase 5 — Celeste `Ducking`, `Player.cs:1711-1715` /
   * `3578-3585`). `true` while the actor is in a ducking crawl/slide. Set by
   * EITHER (a) holding down on the ground (`onGround && moveY === 1 && mode
   * 'normal'`, kernel-detected — gated by {@link PlatformerConfig.groundDuckEnabled},
   * which defaults to enabled; when `false` this input-induced latch is skipped)
   * OR (b) a hyper slide (down-diagonal ground dash at startup→active
   * transition, signaled by `dashAbility` via a `locomotionPatch` — this source
   * is NEVER gated, so hyper-induced ducking survives even with
   * `groundDuckEnabled: false`). Cleared by any launch (jump/super/wall/dash
   * that leaves the ground) and when airborne. While ducking the kernel's
   * `applyHorizontalInput` bleeds `vx` toward 0 at {@link PlatformerConfig.duckFriction}
   * (no horizontal input is honored — Celeste has no crawl-walk), and a
   * subsequent super jump becomes a DUCK super jump (fast + flat multipliers).
   *
   * Latch semantics (kernel maintains each tick): ducking carries over while
   * grounded with no launch; this lets the hyper-induced duck PERSIST after the
   * slide dash ends until the player jumps — matching Celeste, where the hyper
   * slide's duck survives into the follow-up super jump. To UN-duck without
   * jumping, the player can leave the ground or press up (`moveY === -1`).
   */
  readonly ducking: boolean;
  /**
   * The captured direction of the most recent dash (Phase 5 — Celeste
   * `DashDir`). Set when a dash STARTS (`dashAbility` captures `(dirX, dirY)`
   * at the idle→startup press tick; for a hyper slide the down-diagonal is
   * converted to horizontal at the startup→active transition, so this records
   * the POST-conversion direction). Persists across dashes (never cleared) —
   * `(0, 0)` before any dash has fired. Kernel-authoritative: synced from the
   * dash slice at the end of each tick. Drives the super-jump / super-wall-jump
   * trigger direction checks (`lastDashDirY === 0 && lastDashDirX !== 0` for
   * super jump; `lastDashDirX === 0 && lastDashDirY === -1` for super wall jump).
   */
  readonly lastDashDirX: number;
  /** See {@link LocomotionState.lastDashDirX}. */
  readonly lastDashDirY: number;
  /**
   * Super-jump ground-grace timer in seconds (Phase 5). Celeste reuses
   * `JumpGraceTime` (0.1) — the same ground-grace window that gates a coyote
   * jump — to gate the post-dash super jump (`Player.cs:3503`). Refreshed to
   * {@link PlatformerConfig.superJumpGrace} each tick the actor is grounded
   * (mode `'normal'`) AND the last dash was horizontal (`lastDashDirY === 0 &&
   * lastDashDirX !== 0`), mirroring Celeste's "jumpGraceTimer refreshed while
   * on ground" but scoped to the dash-tech context. Decays by `dt` otherwise.
   * When `> 0`, a horizontal-dash super jump may fire on `jump.pressed`.
   */
  readonly superJumpGraceTimer: number;
  /**
   * Whether a dash is currently in flight (Phase 5 — `phase !== 'idle'`).
   * Kernel-authoritative mirror of the dash slice's phase, synced at the end of
   * each tick (like the coyote/buffer mirrors). Read by `dashTechAbility` via
   * {@link AbilityContext.locomotion} so it can REFUSE to fire a super jump /
   * super wall jump mid-dash (the dash owns velocity for the tick; a launch on
   * top would prematurely end it). Reflects the previous tick's resolved phase.
   */
  readonly dashing: boolean;
  /**
   * Stashed horizontal velocity from the most recent wall contact (Phase 7 —
   * Celeste `WallSpeedRetentionTime 0.06`, `Player.cs:54`). `0` when nothing
   * is stashed. When the actor FIRST contacts a wall in a new brush while
   * moving (kernel sets `hitWall`, latch {@link wallSpeedRetaining} was false),
   * the pre-collision `vx` is stashed here and {@link wallSpeedRetentionTimer}
   * starts. If the wall clears on that side (probeWall null) before the timer
   * expires, `core.vx` is restored to this value so momentum survives a brief
   * brush; if the timer expires while still in contact, this is discarded back
   * to `0` BUT the brush latch stays set (no re-stash until the wall actually
   * clears). The retained side is derived from `Math.sign(retainedVx)`
   * (positive ⇒ wall was on the right). Kernel-authoritative; mutated only in
   * the kernel's collision step. Init `0`.
   */
  readonly retainedVx: number;
  /**
   * Wall-speed retention timer in seconds (Phase 7 — Celeste
   * `WallSpeedRetentionTime 0.06`). `0` when no retention window is active; set
   * to {@link PlatformerConfig.wallSpeedRetentionTime} on a FRESH wall contact
   * (a new brush) and decremented each subsequent tick while the wall is still
   * there. While `> 0` AND the wall has cleared on {@link retainedVx}'s side,
   * the kernel restores `core.vx = retainedVx` and clears the brush latch.
   * Kernel-authoritative; init `0`.
   */
  readonly wallSpeedRetentionTimer: number;
  /**
   * Per-brush latch (Phase 7 fix). `true` for the lifetime of ONE contiguous
   * wall-contact "brush" — set on the first stash, kept until the stashed-side
   * wall actually clears (probeWall null on that side). This is the
   * anti-re-stash guard: once a brush's retention window has expired
   * (`wallSpeedRetentionTimer` reaches 0 while still in contact), the stashed
   * `retainedVx` is discarded but THIS latch STAYS `true` so the stash guard
   * does not fire again the instant the timer hits 0. A new brush (wall
   * cleared, then contact resumes) clears the latch on the clearing tick and
   * stashes fresh on the next contact. Kernel-authoritative; init `false`.
   */
  readonly wallSpeedRetaining: boolean;
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
 * a wall, which wall, a lock timer that prevents re-entering wall-slide
 * immediately after a wall-jump (so the wall-jump's horizontal push has time
 * to carry the actor away from the wall before slide re-engages), and the
 * decaying-slide timer that eases the clamp from `wallSlideStartMax` toward
 * `maxFallSpeed` (Phase 3b).
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
  /**
   * Seconds spent in the current wall-slide engagement (Phase 3b). Accumulates
   * by `dt` while sliding; reset to `0` on engage. Drives the easing clamp:
   * `max = lerp(wallSlideStartMax, maxFallSpeed, slideTimer / wallSlideTime)`.
   */
  readonly slideTimer: number;
}

/**
 * Dash ability state. Tracks the dash's three-phase lifecycle
 * (idle → startup → active), the post-dash cooldown, and the limited dash
 * budget for the current airborne cycle. Direction is captured at dash-start
 * and held constant through the dash.
 *
 * Phase machine (Phase 2b — Celeste-style startup ordering):
 *   - `'idle'`    — no dash in flight. A press (when cooldown & budget allow)
 *                   transitions to `'startup'`.
 *   - `'startup'` — the freeze frame. The actor is pinned at zero velocity for
 *                   `startupTimer` seconds (Celeste `Freeze(.05f)`). No dash
 *                   motion is applied; `dashStarting` was emitted on entry.
 *                   When `startupTimer` reaches 0, transitions to `'active'`,
 *                   applies the dash velocity (with same-direction
 *                   preservation), and emits `dashStarted`.
 *   - `'active'`  — the dash velocity is applied each tick for `timer`
 *                   seconds. When `timer` reaches 0, returns to `'idle'`.
 *
 * The kernel's `resolveLocomotionMode` treats BOTH `'startup'` and `'active'`
 * as the exclusive `'dash'` mode (gravity + horizontal input skipped), so the
 * freeze is authoritative — the actor cannot be moved by input or gravity
 * during startup.
 */
export interface DashAbilityState extends AbilityState {
  /** Literal: `'dash'`. */
  readonly kind: 'dash';
  /**
   * Current phase of the dash lifecycle. `'idle'` when no dash is in flight;
   * `'startup'` during the freeze frame; `'active'` while the dash velocity is
   * applied. The kernel reads this (via `resolveLocomotionMode`) to decide
   * whether the dash owns velocity for the tick.
   */
  readonly phase: 'idle' | 'startup' | 'active';
  /**
   * Remaining startup/freeze time in seconds (≥ 0). `0` except during the
   * `'startup'` phase. Counts down by `dt` each startup tick; on reaching 0 the
   * dash transitions to `'active'` and applies its velocity.
   */
  readonly startupTimer: number;
  /** Remaining ACTIVE dash time in seconds; `0` when not in the `'active'` phase. */
  readonly timer: number;
  /** Remaining cooldown in seconds before another dash can begin (≥ 0). */
  readonly cooldown: number;
  /** Remaining dashes for this airborne cycle; refills to `maxDashes` on land. */
  readonly dashesRemaining: number;
  /** Captured dash direction X component (signed unit: -1, 0, or +1). */
  readonly dirX: number;
  /** Captured dash direction Y component (signed unit: -1, 0, or +1). */
  readonly dirY: number;
  /**
   * Horizontal velocity captured at the dash press tick (BEFORE the freeze).
   * Used by the same-direction preservation rule at the startup→active
   * transition: if the actor was already moving faster in the dash's horizontal
   * direction, the dash keeps that faster speed instead of slowing it
   * (`Player.cs:3557` — a dash never slows you). Stale between dashes; re-captured
   * on every press.
   */
  readonly beforeDashVx: number;
  /**
   * Whether the actor was grounded at the dash PRESS tick (Phase 5 — Celeste
   * `dashStartedOnGround`, `Player.cs:3444`). Captured because `core.onGround`
   * reads `false` THROUGHOUT the dash (the freeze pins `vy=0`, so the Y-resolver
   * detects no landing while dashing even on a ground slide). The hyper-slide
   * conversion at the startup→active transition needs "was this a ground
   * dash?", and this field answers it faithfully. Re-captured on every press.
   */
  readonly dashStartedOnGround: boolean;
  /**
   * Whether this dash is a HYPER (dodge) slide (Phase 5). Set `true` at the
   * startup→active transition when a down-diagonal ground dash is converted to
   * a flat horizontal ducking slide; persists for the dash's whole active phase
   * so every sustained-active tick re-applies the BOOSTED speed
   * (`dashSpeed × dodgeSlideSpeedMult`), not the base `dashSpeed` (otherwise the
   * boost would last exactly one tick). Reset to `false` on the next press.
   * Expiry still uses the base end-dash velocity (the boost is dash-time only,
   * matching Celeste). After the dash ends this is stale but unused.
   */
  readonly hyperSlide: boolean;
  /**
   * Phase D2 — per-dash X-axis bonk latch (observation-only). Absent/`false`
   * means no X bonk has fired for the current dash. The kernel sets this to
   * `true` after collision resolution when an active dash is pinned against a
   * wall on its horizontal axis; the `dashBonk` moment fires on the `false →
   * true` transition so a pinned dash emits hit-stop exactly once. Reset to
   * `false` on each new dash. Does not affect velocity/trajectory.
   */
  readonly bonkedX?: boolean;
  /**
   * Phase D2 — per-dash Y-axis bonk latch (observation-only). Same contract as
   * {@link bonkedX} but for the vertical axis (ceiling/floor), covering the
   * upward-dash-into-ceiling case. Reset to `false` on each new dash.
   */
  readonly bonkedY?: boolean;
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
 * Wall-grab ability state (Phase 6 — Celeste wall-climb / `Climb*`). The
 * ability claims the exclusive `'wallGrab'` locomotion mode while grabbing, so
 * it owns `core.vy` (cling/climb) and pins `core.vx` to 0 for the grab's
 * duration; the kernel skips gravity and horizontal input in that mode (the
 * same exclusivity contract dash and ladder use).
 *
 * Wall presence is read ONLY from `probeWall` (Phase 0e — a pure geometry
 * query), NEVER from `core.contacts` (which clear when `vx === 0` and would
 * release the grab on the tick after engage). This is the §0e guarantee: the
 * grab survives a pinned `vx = 0`.
 *
 * Stamina lives on the shared {@link LocomotionState.stamina} (it is
 * read/refilled outside this ability); this slice holds only the grab's own
 * phase + side. The climb-jump leniency window (Celeste `ClimbJumpBoostTime`,
 * `ClimbUpCheckDist`) is a deferred nuance — a focused, correct core grab+hop
 * is the priority; the window is documented in the roadmap and not yet wired.
 */
export interface WallGrabAbilityState extends AbilityState {
  /** Literal: `'wallGrab'`. */
  readonly kind: 'wallGrab';
  /** `true` while actively grabbing a wall this tick (owns vertical velocity). */
  readonly grabbing: boolean;
  /** Which wall is being grabbed (`'left'`/`'right'`), or `null` when not grabbing. */
  readonly side: 'left' | 'right' | null;
  /**
   * Phase D2 — the `Solid.id` of the grabbed wall on the tick grab engaged
   * (observation-only), or `null`. Captured from the `probeWall` result so the
   * `grabLatch` moment carries the surface id without overloading the boolean
   * event record. Stale while not grabbing; re-captured on each engage.
   */
  readonly solidId?: string | null;
}

/**
 * Dash-tech ability state (Phase 5 — super jump / super wall jump / duck super
 * jump). This ability is STATELESS: it holds no per-tick fields beyond the
 * discriminator. It exists in the pipeline (AFTER `jumpAbility`) to convert a
 * plain jump press into a dash-tech launch when the Celeste trigger conditions
 * hold (last dash horizontal + ground-grace → super jump; last dash straight up
 * + a wall present → super wall jump; ducking multipliers applied when
 * ducking). All inputs it needs (`lastDashDir*`, `ducking`, `superJumpGrace`,
 * `dashing`) live on the shared {@link LocomotionState}, read via
 * {@link AbilityContext.locomotion}; it emits a {@link LaunchIntent} the kernel
 * arbitrates over the plain jump's.
 */
export interface DashTechAbilityState extends AbilityState {
  /** Literal: `'dashTech'`. */
  readonly kind: 'dashTech';
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
  | ClimbAbilityState
  | DashTechAbilityState
  | WallGrabAbilityState;

/**
 * Full per-character platformer state — the unit of work the kernel clones
 * each tick. All fields are `readonly`.
 */
export interface PlatformerState {
  /** The actor core (position, velocity, contacts). */
  readonly core: ActorCore;
  /** Per-ability state slices, keyed by ability `kind`. */
  readonly abilities: Readonly<Record<string, AnyAbilityState>>;
  /**
   * Shared, non-ability locomotion state (variable-jump window, wall-jump
   * lockout, mirrored coyote/buffer). See {@link LocomotionState}.
   */
  readonly locomotion: LocomotionState;
  /** Events emitted on the most recent tick (consumer reads and clears). */
  readonly events: PlatformerEvents;
  /**
   * Phase 8 — identified surface-interaction events emitted on the most recent
   * tick (springs + dash refills). Reset to `[]` each tick (same lifecycle as
   * {@link events}). Each entry carries the `entityId` of the trigger volume
   * touched so the consumer can run per-entity cooldown / respawn logic. Empty
   * when no trigger volume was touched this tick.
   */
  readonly interactions: readonly InteractionEvent[];
  /**
   * Phase D2 — single-tick feel moments (landing/dash-bonk/dash-ended/grab/
   * stamina/spring/refill). Reset to `[]` each tick (same lifecycle as
   * {@link events}). Presentation-only — they never feed velocity or position,
   * so emitting them cannot perturb the simulation. Additive over the boolean
   * {@link events} + {@link interactions}; existing readers keep their code.
   * A consumer that manually constructs a complete {@link PlatformerState} must
   * pass `moments: []` (engine factories always populate it).
   */
  readonly moments: readonly FeelMoment[];
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
  /**
   * Fast-fall max speed in px/s — the UPPER bound the mutable max-fall cap eases
   * toward while `moveY === 1` (down held). Phase 4 — Celeste `Player.cs:2910-2924`:
   * `maxFall` is mutable state eased between `MaxFall` and `FastMaxFall` at
   * `FastMaxAccel * dt` in BOTH directions. Pegged `FastMaxFall 240 / MaxFall 160
   * = 1.5 × maxFallSpeed 600 = 900`.
   */
  readonly fastMaxFallSpeed: number;
  /**
   * Fast-fall easing rate in px/s² — the speed at which the mutable max-fall cap
   * eases toward either {@link maxFallSpeed} or {@link fastMaxFallSpeed} each
   * tick (`approach(maxFallCurrent, target, fastMaxAccel * dt)`). Pegged
   * `FastMaxAccel 300 / Celeste-gravity 900 = 0.33 × config.gravity 980 ≈ 327`.
   */
  readonly fastMaxAccel: number;
  /** Ground move speed in px/s. */
  readonly moveSpeed: number;
  /**
   * Ground/air run-acceleration rate in px/s². Replaces the old `airControl`
   * dt-free lerp (Phase 3a). Pegged to Celeste's `RunAccel 1000 / MaxRun 90 =
   * 11.1/s × moveSpeed 200 ≈ 2220`. Used by `applyHorizontalInput` via
   * `approach(vx, target, runAccel * mult * dt)` for both accel toward
   * `moveSpeed` AND decel on release (there is no separate ground decel — see
   * `Player.cs:2891-2894`: release + reverse both use `RunAccel`).
   */
  readonly runAccel: number;
  /**
   * Overspeed bleed-off rate in px/s². Applies ONLY when already above
   * `moveSpeed` AND still holding that direction (bleeding off speed gifted by
   * a dash/spring) — Celeste `RunReduce 400 = 0.4 × RunAccel`. Default `890`
   * (`0.4 × runAccel 2220`). See `Player.cs:2891-2894`.
   */
  readonly overspeedReduce: number;
  /**
   * Air-acceleration multiplier (ratio, `[0,1]`). Celeste `AirMult .65`
   * (`Player.cs:2885`): `mult = onGround ? 1 : AirMult`. This multiplies the
   * ACCEL RATE (not a lerp toward target), so air movement is rate-based just
   * like ground — the kernel's only dt-free integration is gone. NOTE: the
   * numeric coincidence with the retired `airControl 0.65` is a false friend —
   * different quantities (roadmap §3a).
   */
  readonly airAccelMultiplier: number;
  /** Jump tuning (apex parameterization, coyote, buffer, variable height). */
  readonly jump: JumpConfig;
  /** Master switch for jump. Omitted means enabled. Signed-gravity jump is deferred. */
  readonly jumpEnabled?: boolean;
  /** Master switch for the wall-slide ability. */
  readonly wallSlideEnabled: boolean;
  /**
   * Wall-slide START max fall speed in px/s — the slow clamp at slide engage.
   * The slide clamp EASES from this value up toward {@link maxFallSpeed} over
   * {@link wallSlideTime} seconds (Celeste `Player.cs:2933-2947`): you slide
   * slowly at first, then accelerate — a permanent clamp reads as sticky.
   * Pegged `WallSlideStartMax 20 / MaxFall 160 = 0.125 × maxFallSpeed 600 = 75`.
   * Replaces the old permanent `wallSlideSpeed: 60` clamp (Phase 3b).
   */
  readonly wallSlideStartMax: number;
  /**
   * Wall-slide decay window in seconds — the time it takes for the slide clamp
   * to ease from {@link wallSlideStartMax} all the way to {@link maxFallSpeed}.
   * Celeste `WallSlideTime 1.2`, verbatim seconds.
   */
  readonly wallSlideTime: number;
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
  /**
   * Dash startup (freeze) duration in seconds. On a dash press, the actor
   * FREEZES at zero velocity for this long before the dash velocity applies —
   * Celeste's `Celeste.Freeze(.05f)` (see `Player.cs:3448`), which precedes
   * setting `Speed = newSpeed` (`Player.cs:3559`). At the default `0.05` and
   * 60 Hz that is 3 ticks of freeze. `0` reproduces the legacy instant-dash
   * feel (freeze skipped, velocity on the press tick).
   */
  readonly dashStartupTime: number;
  /** Dash cooldown in seconds after a dash ends. */
  readonly dashCooldown: number;
  /**
   * End-dash speed factor (Phase 4c — Celeste `Player.cs:3625-3632`). When a
   * non-downward dash expires, velocity is set ABSOLUTELY to the (normalized)
   * dash direction × `dashSpeed × endDashSpeedFactor`. Verbatim Celeste ratio
   * `EndDashSpeed 160 / DashSpeed 240 = 0.67`. This is the carry speed that
   * bleeds toward `moveSpeed` via `overspeedReduce` afterward (Phase 5 builds on
   * this). Downward dashes skip the end-set and keep their accumulated vy.
   */
  readonly endDashSpeedFactor: number;
  /**
   * End-dash upward multiplier (Phase 4c — Celeste `EndDashUpMult .75`). When
   * an upward dash expires, the upward (`vy < 0`) component of the end-dash
   * velocity is multiplied by this factor — reducing the upward carry so an
   * upward dash does not fling the actor as high after the dash ends. Verbatim
   * Celeste ratio `0.75`.
   */
  readonly endDashUpMult: number;
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
  /**
   * Wall-presence probe distance in px used by the wall-slide ability's
   * `probeWall` geometry query (Phase 0e). Pegged to Celeste's
   * `WallJumpCheckDist = 3`. `probeWall` answers geometry ("is a wall within
   * this many px of the body's leading edge?") independently of the kernel's
   * `contacts` (which describe collisions that happened). Default `3`; both
   * probes and contacts coexist.
   */
  readonly wallProbeDistance?: number;
  // -----------------------------------------------------------------------
  // Phase 5 — super jump / super wall jump / hyper / wavedash + ducking.
  // All values are pegged to Celeste ratios (roadmap §5); magnitudes are NEVER
  // copied. Derivations in `constants.ts`.
  // -----------------------------------------------------------------------
  /**
   * Super-jump horizontal launch speed in px/s (Phase 5 — Celeste
   * `SuperJumpH 260`, `Player.cs:3495-3507`). Pegged `SuperJumpH / MaxRun =
   * 260 / 90 = 2.89 × moveSpeed 200 = 578`. Applied as `vx = superJumpVx *
   * sign(lastDashDirX)` when a super jump fires.
   */
  readonly superJumpVx: number;
  /**
   * Super-jump vertical launch speed in px/s (Phase 5 — Celeste `SuperJumpSpeed
   * = JumpSpeed`). NOT a config magnitude — derived at runtime from
   * `jumpLaunchVelocity(config.jump)` (≈ -343 for the default jump), exactly
   * the same impulse a normal ground jump uses. Kept out of `PlatformerConfig`
   * (no field here) by design: the call site calls `jumpLaunchVelocity`.
   */
  // (no config field — derived; see superWallJumpVy for the wall variant)
  /**
   * Super-wall-jump horizontal launch speed in px/s (Phase 5 — Celeste
   * `SuperWallJumpH 170`, `Player.cs:3510-3524`). Pegged `SuperWallJumpH /
   * MaxRun = 170 / 90 = 1.89 × moveSpeed 200 = 378`. Applied as `vx =
   * ±superWallJumpVx` away from the wall.
   */
  readonly superWallJumpVx: number;
  /**
   * Super-wall-jump vertical launch speed in px/s (upward, negative — Phase 5
   * — Celeste `SuperWallJumpSpeed -160`). Pegged `SuperWallJumpSpeed /
   * JumpSpeed = -160 / -105 = 1.52 × jumpLaunchVelocity 343 ≈ -523`. Unlike the
   * plain super jump, this IS a config magnitude because the wall variant's
   * ratio differs from the normal jump launch (1.52× vs 1×).
   */
  readonly superWallJumpVy: number;
  /**
   * Hyper (dodge) slide dash-speed multiplier (Phase 5 — Celeste
   * `DodgeSlideSpeedMult 1.2`, `Player.cs:3578-3585`). A down-diagonal dash
   * that starts on the ground is converted to a flat horizontal slide whose
   * speed is `dashSpeed × dodgeSlideSpeedMult`. Verbatim ratio.
   */
  readonly dodgeSlideSpeedMult: number;
  /**
   * Duck-super-jump horizontal multiplier (Phase 5 — Celeste
   * `DuckSuperJumpXMult 1.25`, `Player.cs:1711-1715`). When a super jump fires
   * while ducking, `vx` is scaled by this factor (faster). Verbatim ratio.
   */
  readonly duckSuperJumpXMult: number;
  /**
   * Duck-super-jump vertical multiplier (Phase 5 — Celeste `DuckSuperJumpYMult
   * 0.5`, `Player.cs:1711-1715`). When a super jump fires while ducking, `vy`
   * is scaled by this factor (flatter — the duck super jump is fast + flat).
   * Verbatim ratio.
   */
  readonly duckSuperJumpYMult: number;
  /**
   * Ducking horizontal friction in px/s² (Phase 5 — Celeste `DuckFriction 500`,
   * `Player.cs:2891-2894` duck branch). Pegged `DuckFriction / RunAccel = 500
   * / 1000 = 0.5 × runAccel 2220 = 1110`. While ducking on the ground,
   * `applyHorizontalInput` bleeds `vx` toward 0 at this rate (CELESTE-FaITHFUL:
   * ducking is a stationary crouch — no crawl-walk; the hyper slide's momentum
   * decays at this rate, which is SLOWER than a normal release's `runAccel`,
   * giving the slide its reach).
   */
  readonly duckFriction: number;
  /**
   * Whether a grounded Down input (`onGround && moveY === 1 && mode 'normal'`)
   * establishes a duck (Phase 5). Default-on: absent OR `true` preserves the
   * Celeste-faithful stationary-crouch latch. When `false`, grounded Down alone
   * does NOT create a new duck, so horizontal input stays responsive while Down
   * is held on ordinary ground — useful where the same `moveY` channel must be
   * kept for ladders / fast-fall / dash aiming but a stationary crouch has no
   * affordance (e.g. the LDtk showcase).
   *
   * This gates ONLY the kernel's grounded-Down latch. It does NOT disable
   * ability-owned ducking such as a hyper-slide `locomotionPatch`, and it does
   * NOT disable duck friction, the duck super jump, or any other duck tech. An
   * already-active duck (e.g. a hyper-induced one) still applies `duckFriction`
   * and clears on jump/airborne/Up regardless of this flag.
   */
  readonly groundDuckEnabled?: boolean;
  /**
   * Super-jump ground-grace window in seconds (Phase 5 — Celeste `JumpGraceTime
   * 0.1`). Refreshes `locomotion.superJumpGraceTimer` while grounded after a
   * horizontal dash; once airborne it decays over this duration, during which a
   * `jump.pressed` may still trigger a super jump. Verbatim `JumpGraceTime`.
   */
  readonly superJumpGrace: number;
  // -----------------------------------------------------------------------
  // Phase 6 — wall-grab + stamina (Celeste `Climb*`, `Player.cs:102-118`).
  // Stamina costs/rates are scale-independent (per-second rates / a pool size)
  // and transfer VERBATIM; the climb/hop SPEEDS are magnitudes and are pegged
  // via the MaxRun→moveSpeed rule from the appendix. See `constants.ts` for
  // every derivation. The ability is OFF by default (`wallGrabEnabled: false`),
  // matching `climbEnabled`.
  // -----------------------------------------------------------------------
  /** Master switch for the wall-grab ability. Default off (matches climb). */
  readonly wallGrabEnabled: boolean;
  /**
   * Wall-grab stamina pool size (Celeste `ClimbMaxStamina 110`, `Player.cs:102`).
   * A pool SIZE, not a speed — scale-independent, transferred verbatim. When
   * `stamina` hits 0 the grab releases and cannot re-engage until refilled on
   * ground.
   */
  readonly wallGrabMaxStamina: number;
  /**
   * Stamina cost per second while CLIMBING UP a wall (Celeste `ClimbUpCost
   * 100/2.2 ≈ 45.45/s`, `Player.cs:103`). A per-second RATE — scale-independent,
   * transferred verbatim.
   */
  readonly staminaUpCostPerSec: number;
  /**
   * Stamina cost per second while CLINGING (idle) on a wall (Celeste
   * `StillCost 100/10 = 10/s`, `Player.cs:104`). A per-second RATE — verbatim.
   * Descending (`moveY === 1`) is FREE in Celeste (no `DownCost`), so the
   * down-climb consumes no stamina.
   */
  readonly staminaStillCostPerSec: number;
  /**
   * Flat stamina cost of a climb-hop (Celeste `JumpCost 110/4 = 27.5`,
   * `Player.cs:105`). Deducted from the pool on the hop tick.
   */
  readonly staminaClimbJumpCost: number;
  /**
   * Wall-climb UP speed in px/s (Celeste `ClimbUpSpeed -45`, `Player.cs:110`).
   * Pegged via the appendix's MaxRun→moveSpeed rule (NOT the ladder
   * `climbSpeed` — that is a separate concern for ladder shafts):
   * `45 / MaxRun 90 × moveSpeed 200 = 100`. Magnitude; derived, never copied.
   */
  readonly wallClimbUpSpeed: number;
  /**
   * Wall-climb DOWN speed in px/s (Celeste `ClimbDownSpeed 80`,
   * `Player.cs:111`). Pegged via MaxRun→moveSpeed:
   * `80 / MaxRun 90 × moveSpeed 200 ≈ 178`. Magnitude; derived.
   */
  readonly wallClimbDownSpeed: number;
  /**
   * Climb-hop vertical launch speed magnitude in px/s (Celeste `ClimbHopY -120`,
   * `Player.cs:115`). Pegged via MaxRun→moveSpeed:
   * `120 / MaxRun 90 × moveSpeed 200 ≈ 267`. Applied as `vy = -climbHopVy`
   * (upward). Magnitude; derived.
   */
  readonly climbHopVy: number;
  /**
   * Climb-hop horizontal launch speed magnitude in px/s (Celeste `ClimbHopX
   * 100`, `Player.cs:116`). Pegged via MaxRun→moveSpeed:
   * `100 / MaxRun 90 × moveSpeed 200 ≈ 222`. Applied as `vx = ±climbHopVx`
   * away from the wall. Magnitude; derived.
   */
  readonly climbHopVx: number;
  /**
   * Climb-hop horizontal lockout duration in seconds (Celeste `ClimbHopForceTime
   * .2`, `Player.cs:117`). While > 0 the kernel forces `vx` toward the hop
   * direction (away from the wall) via `forceMoveX`, preventing an immediate
   * re-grab. Verbatim duration.
   */
  readonly climbHopForceTime: number;
  /**
   * Climb-jump leniency window in seconds (Celeste `ClimbJumpBoostTime .2`,
   * `Player.cs:118`). Reserved: the post-hop re-engage grace is a deferred
   * nuance (documented in the roadmap); the value is pegged here for parity but
   * not yet wired into the ability.
   */
  readonly climbJumpBoostTime: number;
  /**
   * Climb-jump upward probe distance in px (Celeste `ClimbUpCheckDist 2`,
   * `Player.cs:107`). Reserved: used by the deferred leniency check. A pixel
   * tolerance; Celeste copies `2` verbatim and so do we (it is sub-tile, below
   * the pegging rule's threshold of concern).
   */
  readonly climbUpCheckDist: number;
  // -----------------------------------------------------------------------
  // Phase 7 — upward corner correction + dash corner correction + wall-speed
  // retention (Celeste `UpwardCornerCorrection`/`DashCornerCorrection`/
  // `WallSpeedRetentionTime`). The two CC systems share the Celeste `4`
  // tolerance but are SEPARATE systems (roadmap §4d/§7 stress this). Both CC
  // values are PIXEL TOLERANCES, not copied magnitudes — pegged via the
  // `4/8 tile × 16px = 8px` derivation. Wall-speed retention is a duration,
  // transferred verbatim.
  // -----------------------------------------------------------------------
  /**
   * Upward corner-correction tolerance in px (Phase 7 — Celeste
   * `UpwardCornerCorrection 4`, `Player.cs:2591, 2603`). When the actor is
   * rising and bumps a ceiling/wall corner, the body is nudged horizontally by
   * up to this many px (1px steps, preferred direction first) to slip past a
   * 1-tile lip. NOT a copied magnitude — it is a pixel tolerance pegged to tile
   * size: Celeste's `4` is in 8px tiles, so `4/8 tile × 16px = 8px` at aicraft's
   * 16px tiles. Comment the pegging: a naive copy of `4` would be half the
   * intended tolerance at 16px tiles. Default `8`.
   */
  readonly upwardCornerCorrection: number;
  /**
   * Dash corner-correction tolerance in px (Phase 4d/7 — Celeste
   * `DashCornerCorrection 4`, `Player.cs:2408, 2511, 2524, 2668, 2682`).
   * During a dash, when the actor hits a wall, the body is nudged perpendicular
   * to the dash axis (vertically for a horizontal dash — up then down, 1px
   * steps) by up to this many px to slip past a corner. Pegged identically to
   * {@link upwardCornerCorrection} (`4/8 tile × 16px = 8px`) — both CC systems
   * share the Celeste `4` tolerance but are SEPARATE systems (the roadmap
   * stresses there are TWO). Default `8`.
   */
  readonly dashCornerCorrection: number;
  /**
   * Wall-speed retention window in seconds (Phase 7 — Celeste
   * `WallSpeedRetentionTime 0.06`, `Player.cs:54`). When the actor contacts a
   * wall horizontally, the pre-collision `vx` is stashed and this timer starts.
   * If the actor's path clears (the wall is no longer there on that side) before
   * the timer expires, the stashed `vx` is restored so momentum survives a brief
   * brush. If the timer expires while still in contact, the retained `vx` is
   * discarded. Verbatim duration (a timing, not a magnitude).
   */
  readonly wallSpeedRetentionTime: number;
  // -----------------------------------------------------------------------
  // Phase 8 — springs + dash refills (Celeste `BounceSpeed` / `SuperBounceSpeed`
  // / `BounceAutoJumpTime` / `BounceVarJumpTime`, `Player.cs:64,66,38,63`).
  // The two bounce magnitudes are SPEEDS and MUST be pegged (never copied) via
  // the JumpSpeed→aicraft-launch rule; the two timings are durations, verbatim.
  // Derivations in `constants.ts`.
  // -----------------------------------------------------------------------
  /**
   * Normal-spring launch velocity in px/s (Phase 8 — Celeste `BounceSpeed
   * -140`, `Player.cs:64`). Pegged `BounceSpeed / JumpSpeed = 140 / 105 = 1.33
   * × aicraft-launch 343 ≈ -460`. The pre-computed upward velocity a `spring`
   * marker solid of `power: 'normal'` carries at compile time; routed through a
   * `LaunchIntent { source: 'spring' }` so it survives the jump slice (§0b).
   * Magnitude; derived.
   */
  readonly springBounceVy: number;
  /**
   * Super-spring launch velocity in px/s (Phase 8 — Celeste `SuperBounceSpeed
   * -185`, `Player.cs:66`). Pegged `SuperBounceSpeed / JumpSpeed = 185 / 105 =
   * 1.76 × aicraft-launch 343 ≈ -605`. The pre-computed upward velocity a
   * `spring` marker solid of `power: 'super'` carries at compile time.
   * Magnitude; derived.
   */
  readonly springSuperBounceVy: number;
  /**
   * Variable-jump window a spring opens, in seconds (Phase 8 — Celeste
   * `BounceVarJumpTime 0.2`, `Player.cs:63`). While the window is open a held
   * jump keeps full gravity; releasing cuts the bounce short. Verbatim
   * duration.
   */
  readonly springVarJumpTime: number;
  /**
   * Auto-rejump grace a spring grants, in seconds (Phase 8 — Celeste
   * `BounceAutoJumpTime 0.1`, `Player.cs:38`). Celeste re-fires a jump buffer
   * for this long off a bounce so a press just before landing still jumps off
   * the spring. Reserved: added + pegged for parity; not yet wired into the
   * jump buffer plumbing (the spring LaunchIntent already opens the variable-
   * jump window, which covers the common case). TODO when full buffered-rejump
   * off a spring is wired.
   */
  readonly springAutoJumpTime: number;
  // -----------------------------------------------------------------------
  // Phase D2 — FEEL threshold (PRESENTATION-ONLY). This knob is read ONLY to
  // compute the `hard` flag on the `landing` feel moment; it never affects a
  // trajectory. Like `squash` below, it is omitted from the default config so
  // the serialized config (and thus `replayHashFor`) is unaffected by a
  // presentation default — consumers opt in by spreading an override. The
  // kernel applies `hardLandingThresholdFor(config)` (default `0.72`).
  // -----------------------------------------------------------------------
  /**
   * Phase D2 — ratio in `[0, 1]` at which a landing counts as "hard" (drives
   * the {@link FeelMoment} `landing.hard` flag). Compared against
   * `normalizedImpact` (= `impactSpeed / max(|maxFallSpeed|, ε)`), so the same
   * threshold fires identically at 8/16/32 px tiles — the fix for the unscaled
   * `prevVy > 520` magic number. Optional; defaults to `0.72` via
   * `hardLandingThresholdFor`.
   */
  readonly hardLandingThreshold?: number;
  // -----------------------------------------------------------------------
  // Phase 8c — per-event squash & stretch FX (RENDER-ONLY). This is purely a
  // presentation layer: it does NOT alter physics trajectories, does NOT live
  // on `PlatformerState`/`LocomotionState`, and does NOT bump `physicsVersion`.
  // The transient scale is held by the renderer; the kernel is unaware of it.
  // Optional — omitted means "use the renderer's own default" (callers spread
  // `DEFAULT_SQUASH_CONFIG`). See `src/platformer/squash.ts`.
  // -----------------------------------------------------------------------
  /**
   * Per-event squash tuning (Phase 8c — Celeste `Player.cs:2918-2920` +
   * `:1165`). When a renderer wants to honor consumer overrides it reads
   * `config.squash` (falling back to `DEFAULT_SQUASH_CONFIG`). The pairs are
   * verbatim Celeste literals and the `1.75` ease rate is verbatim — see
   * {@link SquashConfig}. Optional/additive: leaving it `undefined` keeps the
   * engine's physics surface unchanged (no squash is applied unless a renderer
   * opts in).
   */
  readonly squash?: SquashConfig;
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
