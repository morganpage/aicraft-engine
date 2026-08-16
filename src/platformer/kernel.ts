/**
 * Platformer kernel — the orchestration layer that connects the library's
 * existing primitives into a single authoritative deterministic step function.
 *
 * Per `docs/design/platformer-kernel-decision.md`:
 *   - Approach B: Composable Ability Processors.
 *   - Strict purity: immutable `ActorCore`, shallow-copied each ability.
 *   - Calls existing primitives (`advanceJump` via `jumpAbility`;
 *     `resolveAxisX`/`resolveAxisY` here in the kernel step 6).
 *
 * **Update order locked (decision §"Update order locked"):**
 *   1. Move solids (consumer-driven — kernel reads displacements via callback)
 *   2. Carry actors (apply solid displacement to riding actors)
 *   3. Process inputs (read input snapshot — passed in)
 *   4. Execute abilities (pipeline in fixed order)
 *   5. Integrate forces (gravity, clamped; skip during dash)
 *   6. Resolve actor collision (resolveAxisX then resolveAxisY)
 *   7. Update contacts & events
 *
 * The kernel is single-actor in v1. Multi-actor (enemies, NPCs) is deferred.
 *
 * Pure: returns a brand-new `PlatformerState` each tick; input never mutated.
 * Never throws. No `Math.random`, no `Date.now`, no DOM reads.
 *
 * @module
 */

import type { Solid, Rect } from '../collision/types';
import { resolveAxisX, resolveAxisY } from '../collision/resolve';
import { aabbOverlap, probeWall } from '../collision/aabb';
import { createJumpState } from '../animation/jump';
import { approach } from '../primitives/pixel';
import {
  EMPTY_CONTACTS,
  EMPTY_EVENTS,
  EMPTY_INTERACTIONS,
  EMPTY_LOCOMOTION,
  EMPTY_MOMENTS,
  DEFAULT_PLATFORMER_CONFIG,
  DEFAULT_PLAYER_WIDTH,
  DEFAULT_PLAYER_HEIGHT,
} from './constants';
import { createRidingTracker, type SolidDisplacementProvider } from './riding-tracker';
import { defaultPrecisionPipeline } from './pipelines';
import { landingMomentFor } from './feel-moments';
import type {
  AbilityContext,
  AbilityProcessor,
  AnyAbilityState,
  ActorCore,
  ClimbAbilityState,
  Contacts,
  DashAbilityState,
  DashTechAbilityState,
  DoubleJumpAbilityState,
  FeelMoment,
  InteractionEvent,
  JumpAbilityState,
  LaunchIntent,
  LocomotionMode,
  LocomotionState,
  PlatformerConfig,
  PlatformerEvents,
  PlatformerInput,
  PlatformerState,
  WallGrabAbilityState,
  WallSlideAbilityState,
  WritablePlatformerEvents,
} from './types';
import { LAUNCH_PRIORITY } from './types';

/**
 * Options for {@link createPlatformerController}.
 */
export interface PlatformerControllerOptions {
  /**
   * Callback that returns the per-tick displacement of a moving solid by id,
   * or `null` if the solid is not moving. Called once per tick per riding
   * actor during step 2 (carry). Omit entirely when no platforms move.
   */
  readonly getSolidDisplacement?: SolidDisplacementProvider;
}

/**
 * Return value of {@link createPlatformerController} — a stateless step
 * function bound to a fixed pipeline + config.
 */
export interface PlatformerController {
  /**
   * Advance the platformer state by one fixed timestep.
   *
   * @param state - current platformer state (immutable; not mutated)
   * @param input - per-tick input snapshot
   * @param solids - collision surfaces for this tick
   * @param dt - fixed timestep in seconds
   * @returns the next `PlatformerState` (a brand-new record)
   */
  step(
    state: PlatformerState,
    input: PlatformerInput,
    solids: readonly Solid[],
    dt: number,
  ): { state: PlatformerState };
}

/**
 * Create the initial platformer state for a character.
 *
 * Returns a grounded, at-rest state with empty contacts, empty events, tick
 * `0`, and each ability's initial state slice. Pass to `controller.step` (or
 * `stepPlatformer`) once per tick.
 *
 * Pure: returns a fresh record; never throws.
 *
 * @param x - initial world X of the body's top-left corner
 * @param y - initial world Y of the body's top-left corner
 * @param config - platformer tuning config (default `DEFAULT_PLATFORMER_CONFIG`)
 * @param width - body width (default `DEFAULT_PLAYER_WIDTH`)
 * @param height - body height (default `DEFAULT_PLAYER_HEIGHT`)
 * @returns a fresh, grounded, at-rest `PlatformerState`
 *
 * @example
 * ```ts
 * let state = createPlatformerState(100, 200);
 * state = stepPlatformer(state, input, solids, 1 / 60).state;
 * ```
 */
export function createPlatformerState(
  x: number,
  y: number,
  config: Readonly<PlatformerConfig> = DEFAULT_PLATFORMER_CONFIG,
  width: number = DEFAULT_PLAYER_WIDTH,
  height: number = DEFAULT_PLAYER_HEIGHT,
): PlatformerState {
  const core: ActorCore = {
    x,
    y,
    width,
    height,
    vx: 0,
    vy: 0,
    facing: 1,
    onGround: false,
    contacts: EMPTY_CONTACTS,
  };

  const abilities: Record<string, AnyAbilityState> = {
    climb: makeInitialClimbState(),
    jump: makeInitialJumpState(config),
    // Phase 5 — dash-tech processor (stateless; lives after jump in the
    // pipeline so it can override a plain jump launch with a super jump).
    dashTech: makeInitialDashTechState(),
    wallSlide: makeInitialWallSlideState(),
    dash: makeInitialDashState(config),
    doubleJump: makeInitialDoubleJumpState(config),
    // Phase 6 — wall-grab processor. Lives after wallSlide in the pipeline;
    // mutually exclusive with wall-slide by input (grab.held vs moveX-into-wall).
    wallGrab: makeInitialWallGrabState(),
  };

  return {
    core,
    abilities,
    // Phase 4 — initialize the mutable max-fall cap to this config's
    // `maxFallSpeed` (overriding EMPTY_LOCOMOTION's default-600 value) so a
    // custom config starts falling at the right terminal speed before any
    // fast-fall easing.
    // Phase 6 — initialize the shared stamina pool to `wallGrabMaxStamina` so
    // a fresh actor can grab immediately (the pool depletes only while
    // grabbing and refills on ground).
    locomotion: {
      ...EMPTY_LOCOMOTION,
      maxFallCurrent: config.maxFallSpeed,
      stamina: config.wallGrabMaxStamina,
    },
    events: EMPTY_EVENTS,
    // Phase 8 — no surface interactions on a fresh state.
    interactions: EMPTY_INTERACTIONS,
    // Phase D2 — no feel moments on a fresh state.
    moments: EMPTY_MOMENTS,
    tick: 0,
  };
}

/**
 * Create a platformer controller bound to a fixed ability pipeline and config.
 *
 * The controller is stateless — all per-character state lives in the
 * `PlatformerState` you pass to `step`. Multiple characters can share a
 * controller if they share a pipeline + config.
 *
 * Pure factory: no host access, no global state. Never throws.
 *
 * @param pipeline - ordered ability processors (see `defaultPrecisionPipeline`)
 * @param config - platformer tuning config
 * @param options - optional solid-displacement provider for moving-platform carry
 * @returns a stateless controller with a `step(state, input, solids, dt)` method
 *
 * @example
 * ```ts
 * const controller = createPlatformerController(
 *   defaultPrecisionPipeline(),
 *   { ...DEFAULT_PLATFORMER_CONFIG, dashEnabled: true },
 * );
 * let state = createPlatformerState(100, 200);
 * state = controller.step(state, input, solids, 1 / 60).state;
 * ```
 */
export function createPlatformerController(
  pipeline: readonly AbilityProcessor<AnyAbilityState>[],
  config: Readonly<PlatformerConfig>,
  options: PlatformerControllerOptions = {},
): PlatformerController {
  const tracker = createRidingTracker();
  const getDisp = options.getSolidDisplacement ?? null;

  return {
    step(state, input, solids, dt) {
      // Step 2 — Carry actors (apply solid displacement from previous tick's
      // groundId BEFORE ability processing).
      const invertedGravity = config.gravity < 0;
      const supportId = invertedGravity
        ? state.core.contacts.ceilingId
        : state.core.contacts.groundId;
      const wasOnGround =
        supportId !== null ||
        hasPhysicalSupport(state.core, solids, invertedGravity);
      // The END-of-previous-tick grounded flag, read from the pristine input
      // state (the force just below overwrites the local `core` copy only).
      // `wasOnGround` answers "is the body supported RIGHT NOW, given current
      // solids"; `enteredOnGround` answers "was it supported when the previous
      // tick ended". Step 7's landing edge needs BOTH — only a body supported
      // across the boundary AND at the tick start is "continuously supported"
      // (never landed). The flags diverge exactly on the flush arrival: a
      // body whose gravity-facing edge lands EXACTLY on a support edge (a
      // full-height held jump's symmetric arc does, deterministically) is not
      // a strict AABB overlap, so the arrival tick reports no landing — and
      // this tick's flush probe then sees the resting body as already
      // supported, which alone used to mask the airborne→grounded transition.
      const enteredOnGround = state.core.onGround;
      let core = tracker.applyCarry(state.core, getDisp, supportId);
      if (core.onGround !== wasOnGround) {
        core = { ...core, onGround: wasOnGround };
      }

      // Shallow-clone the abilities record so the input state's record is not
      // mutated; ability slices are replaced as we iterate.
      let abilities: Record<string, AnyAbilityState> = { ...state.abilities };

      // Capture the pre-pipeline Y so the climb coordination below can restore
      // the climb-authoritative Y (jump's internal gravity moves Y during the
      // pipeline; setting only vy would leave the player drifting on a ladder).
      const startCoreY = core.y;

      // Start from empty events; abilities and collision add to this.
      const events: WritablePlatformerEvents = { ...EMPTY_EVENTS };

      // Phase 8 — identified surface-interaction events (springs + dash
      // refills). Reset to empty each tick (same lifecycle as `events`).
      // Accumulated in ONE place: the kernel's spring/dashRefill detection
      // after the pipeline (see below). The consumer reads
      // `state.interactions` and owns per-entity cooldown/respawn by
      // including/excluding the trigger solid from the `solids[]` it passes.
      const interactions: InteractionEvent[] = [];

      // Phase D2 — single-tick feel moments (landing/dash-bonk/dash-ended/grab/
      // stamina/spring/refill). Reset to empty each tick (same lifecycle as
      // `events`/`interactions`). Ability-authored moments are appended below in
      // pipeline order; the kernel adds collision/environment moments after.
      const moments: FeelMoment[] = [];

      // Phase D2 — capture the pre-pipeline dash phase so the kernel can detect
      // the `active → idle` transition (dash timeout) AFTER the pipeline + collide
      // and emit an observation-only `dashEnded` moment with the ending-tick
      // terminal-contact context. No velocity/trajectory use.
      const prevDashSlice = state.abilities['dash'] as DashAbilityState | undefined;
      const prevDashActive =
        prevDashSlice !== undefined &&
        prevDashSlice.kind === 'dash' &&
        prevDashSlice.phase === 'active';

      // Launch intents collected from the pipeline — at most one is applied
      // (Phase 0b vertical-velocity authority). Abilities push here via the
      // optional `launch` field on `AbilityResult`; the kernel arbitrates after
      // the pipeline completes so every ability sees the same pre-launch core.
      const launches: LaunchIntent[] = [];
      // Phase 5 — locomotion patches collected from the pipeline (e.g.
      // `dashAbility` signals `ducking: true` on a hyper slide). Applied to
      // `locomotion` after the pipeline, before the kernel's own ducking/grace
      // maintenance. Last-write-wins per field, in pipeline order.
      const locomotionPatches: Partial<LocomotionState>[] = [];

      // Steps 3/4 — Process inputs (read inside each ability) + execute
      // abilities in pipeline order.
      for (const proc of pipeline) {
        const stateSlice = abilities[proc.kind];
        // NOTE: this silent `continue` is the extensibility path for custom
        // pipelines — a proc whose slice is absent in `abilities` is simply
        // skipped (no crash, no slice synthesized). Replay safety is NOT
        // guaranteed here; it is guaranteed UPSTREAM by replay physicsVersion
        // rejection (see `assertPhysicsVersion` in `src/replay/player.ts`): a
        // replay that loads has a current-version `initial` state, which
        // `createPlatformerState` populated with every current slice, so no
        // current slice can be silently absent during a version-matched replay.
        // We deliberately do NOT add runtime slice validation — version
        // rejection is the guard.
        if (stateSlice === undefined) continue;

        const ctx: AbilityContext = {
          core,
          input,
          dt,
          config,
          solids,
          // Phase 5 — supply the previous tick's resolved locomotion slice so
          // `dashTechAbility` can read lastDashDir / ducking / grace / dashing.
          locomotion: state.locomotion,
        };
        const result = proc.advance(ctx, stateSlice as never);
        core = result.core;
        abilities = { ...abilities, [proc.kind]: result.state };
        if (result.launch !== undefined) {
          launches.push(result.launch);
        }
        if (result.locomotionPatch !== undefined) {
          locomotionPatches.push(result.locomotionPatch);
        }
        // Phase D2 — ability-authored feel moments (e.g. wall-grab's
        // grabLatch/staminaExhausted) are appended in pipeline order, BEFORE the
        // kernel's own collision/environment moments.
        if (result.moments !== undefined && result.moments.length > 0) {
          for (const m of result.moments) moments.push(m);
        }
        // OR-merge events: every ability returns a full PlatformerEvents
        // record (all fields, defaulted to false). A plain Object.assign would
        // let later abilities clobber an earlier ability's `true` (e.g. jump
        // emits justLaunched=true, then wallSlide emits justLaunched=false).
        // Events are boolean single-tick pulses — once any ability sets one to
        // true, the kernel treats it as fired for this tick.
        if (result.events) {
          const ev = result.events;
          (Object.keys(ev) as (keyof PlatformerEvents)[]).forEach((k) => {
            if (ev[k]) {
              events[k] = true;
            }
          });
        }
      }

      // -------------------------------------------------------------------
      // Phase 0d — resolve the exclusive LocomotionMode for this tick.
      //
      // Centralizes ALL cross-ability exclusivity in ONE place (replaces the
      // old ad-hoc `isDashActive` / `isClimbActive` helpers). Wave 7's
      // wall-grab just adds a `'wallGrab'` branch here — no new bespoke
      // helpers anywhere else. Dash is a sustained velocity (owns vx/vy
      // directly); ladder owns vy; otherwise the kernel owns gravity + input.
      // -------------------------------------------------------------------
      const mode = resolveLocomotionMode(abilities);

      // -------------------------------------------------------------------
      // Phase 5 — apply collected locomotion patches (e.g. `dashAbility`'s
      // hyper-slide `ducking: true`) BEFORE launch arbitration + the kernel's
      // own ducking maintenance, so the patch's effect is visible to both.
      // Last-write-wins per field, in pipeline order.
      // -------------------------------------------------------------------
      let locomotion: LocomotionState = state.locomotion;
      for (const patch of locomotionPatches) {
        locomotion = { ...locomotion, ...patch };
      }

      // -------------------------------------------------------------------
      // Phase 8 — Springs + dash refills (Celeste `BounceSpeed` /
      // `SuperBounceSpeed` / dash crystals). Detected in ONE place (the kernel,
      // post-pipeline + post-locomotion-patch, PRE launch arbitration) so both
      // route through the §0b launch contract and report identified
      // `InteractionEvent`s for the consumer's per-entity cooldown/respawn.
      //
      // WHY the kernel (not a `springAbility` processor): the dash-refill
      // mutates the dash slice's `dashesRemaining` — a cross-ability write that
      // the pipeline ownership model forbids an ability from doing to another
      // ability's slice. The kernel already does cross-ability coordination
      // (launch arbitration resets the jump slice; the stamina refill tops up
      // the shared pool), so this is the natural home. Keeping spring detection
      // here too gives a single accumulation point for `interactions` and
      // avoids a new stateless ability slice + pipeline entry for pure
      // environment detection. The spring's `LaunchIntent` joins the same pool
      // the abilities filled, so `pickLaunch` arbitrates it fairly (spring has
      // the highest priority, 6 — it beats every ability-emitted launch).
      //
      // Spring gate: fire only when the actor is DESCENDING onto the volume
      // (`core.vy > 0`, strictly falling). This matches Celeste's "land on
      // spring from above" feel AND prevents two failure modes: (a) refiring
      // every tick while ASCENDING after the bounce (core.vy < 0 → no fire,
      // even if still inside the volume), and (b) jitter-bouncing when a spring
      // volume overlaps a floor the actor rests on (core.vy === 0 → no fire).
      // The actor must be actively falling into the spring to trigger it; a
      // repeat bounce requires leaving the volume and re-entering while falling.
      // The `core` position here is post-pipeline (start of this tick's
      // resolved position = end of last tick's collision), so "overlap" means
      // "the actor's resolved position intersects the spring volume" — the same
      // pre-collision detection model the climb ability uses for ladders.
      // -------------------------------------------------------------------
      const bodyRect = {
        x: core.x,
        y: core.y,
        width: core.width,
        height: core.height,
      };
      for (const solid of solids) {
        if (solid.spring !== undefined) {
          if (core.vy > 0 && aabbOverlap(bodyRect, solid)) {
            // Spring launches via the §0b launch contract — the kernel's
            // arbitration applies it (source 'spring' has priority 6). The
            // impulse lands on `core.vy`, so next tick continues from it
            // (the deferred Wave-0 "spring into jump slice" proof — the
            // launch PERSISTS across ticks, not discarded).
            launches.push({
              vy: solid.spring.launch,
              varJumpTime: config.springVarJumpTime,
              source: 'spring',
            });
            interactions.push({
              kind: 'spring',
              entityId: typeof solid.id === 'string' ? solid.id : '',
            });
            // Phase D2 — structured spring moment (supersedes the interaction
            // entry, adding the `super` flag preserved at compile time).
            moments.push({
              kind: 'springLaunch',
              solidId: typeof solid.id === 'string' ? solid.id : null,
              super: solid.spring.super === true,
            });
          }
          continue;
        }
        if (solid.dashRefill) {
          if (aabbOverlap(bodyRect, solid)) {
            // Refill the dash budget to max (consumer-owned respawn cycle:
            // the consumer REMOVES the crystal from `solids[]` on seeing this
            // interaction, so it cannot refill again until re-added).
            const dashSlice = abilities['dash'] as DashAbilityState | undefined;
            if (
              dashSlice !== undefined &&
              dashSlice.kind === 'dash' &&
              dashSlice.dashesRemaining < config.maxDashes
            ) {
              abilities = {
                ...abilities,
                dash: { ...dashSlice, dashesRemaining: config.maxDashes },
              };
            }
            interactions.push({
              kind: 'dashRefill',
              entityId: typeof solid.id === 'string' ? solid.id : '',
            });
            // Phase D2 — structured dash-refill moment (supersedes the
            // interaction entry with a uniform solidId).
            moments.push({
              kind: 'dashRefill',
              solidId: typeof solid.id === 'string' ? solid.id : null,
            });
          }
        }
      }

      // -------------------------------------------------------------------
      // Phase 0b — arbitrate at most one launch and apply it to core.
      //
      // `pickLaunch` chooses the winner by LAUNCH_PRIORITY
      // (spring > superWallJump > superJump > wallJump > doubleJump > jump).
      // Applying the winner writes `core.vy` (and `core.vx` for a wall-jump /
      // super-jump) and opens the variable-jump window on `locomotion`. Because
      // the impulse lands on `core`, the next tick continues from it — the old
      // discard bug is gone. Phase 5: ANY launch clears `ducking` (Celeste:
      // jumping out of a duck clears `Ducking`), and a super-source launch
      // RESETS the jump slice to `'rising'` so the plain ground jump's
      // anticipation→rising launch cannot re-fire 3 ticks later (the super jump
      // fires immediately on the press, no crouch).
      // -------------------------------------------------------------------
      const launch = pickLaunch(launches);
      const launchFired = launch !== null;
      if (launch !== null) {
        core = applyLaunch(core, launch);
        const isWallFamily =
          launch.source === 'wallJump' || launch.source === 'superWallJump';
        // Phase 6 — a climb-hop is also a wall-family launch (it pushes the
        // actor away from the wall) but opens its OWN lockout duration
        // (`climbHopForceTime`), distinct from a wall-jump's `wallJumpLockTime`.
        const isClimbHop = launch.source === 'climbHop';
        // Mantle wave — the straight-up climb-jump and the mantle open NO
        // horizontal force window: `needsForceMove` stays false for both, so
        // `forceMoveXTimer`/`forceMoveX` resolve to 0 (the climb-jump rises
        // vertically beside the wall; the mantle's toward-ledge push is owned
        // by the wall-grab ability's short assist, not the forced-move
        // subsystem). Toward-input therefore cannot create sideways velocity
        // through the forced-move subsystem.
        const needsForceMove = isWallFamily || isClimbHop;
        locomotion = {
          ...locomotion,
          varJumpTimer: launch.varJumpTime,
          varJumpSpeed: launch.vy,
          // A wall-jump (normal OR super) OR a climb-hop opens a horizontal
          // lockout so the push is not immediately cancelled by opposing
          // horizontal input or by an immediate re-grab (Celeste-style
          // `forceMoveX`). Direction follows the launch's vx sign; duration is
          // the configured lock time for the source family. The climb-jump and
          // mantle sources fall through to 0/0 — their separation is the
          // ability-owned re-grab lock + mantle assist instead.
          forceMoveXTimer: isClimbHop
            ? config.climbHopForceTime
            : isWallFamily
              ? config.wallJumpLockTime
              : 0,
          forceMoveX:
            needsForceMove && launch.vx !== undefined
              ? (Math.sign(launch.vx) as -1 | 0 | 1)
              : 0,
          // The buffered press is consumed by whichever launch won — EXCEPT a
          // spring: a spring launch must not swallow a buffered press (Celeste
          // `BounceAutoJumpTime`, `Player.cs:38`). Keep the buffer alive for
          // `springAutoJumpTime` so a press just before the bounce still fires
          // as a jump off the spring via the buffered-rejump machinery; the
          // jump slice's own buffer is re-armed in the launch re-sync below.
          jumpBufferTimer:
            launch.source === 'spring'
              ? Math.max(locomotion.jumpBufferTimer, config.springAutoJumpTime)
              : 0,
          // Phase 5 — any launch clears ducking (jumping out of a duck ends it).
          ducking: false,
        };
        // Emit the matching event for the winning source (abilities set their
        // own event too, but only the winner's should survive — clear and set
        // so a losing ability's event does not leak). Super launches are
        // jump-class → `justLaunched`; super-wall-jump is ALSO wall-jump-family.
        events.justLaunched = false;
        events.wallJumpLaunched = false;
        events.doubleJumped = false;
        events.climbJumpLaunched = false;
        events.mantled = false;
        if (
          launch.source === 'jump' ||
          launch.source === 'superJump' ||
          launch.source === 'superWallJump'
        ) {
          events.justLaunched = true;
        }
        // Mantle wave — DELIBERATE WIDENING of `wallJumpLaunched` (canonical
        // plan §3.3): the away climb-hop now reports as a wall jump alongside
        // `wallJump`/`superWallJump`. Consumers already reading this pulse
        // will start seeing climb-hops; that is the documented contract change
        // ("away grab+jump reports as a wall jump"), not an accidental leak.
        if (
          launch.source === 'wallJump' ||
          launch.source === 'superWallJump' ||
          launch.source === 'climbHop'
        ) {
          events.wallJumpLaunched = true;
        }
        if (launch.source === 'doubleJump') events.doubleJumped = true;
        // Mantle wave — the two new wall-grab launch pulses. Both last exactly
        // one tick (reset above each launch tick and recomputed from the
        // winning source only).
        if (launch.source === 'climbJump') events.climbJumpLaunched = true;
        if (launch.source === 'mantle') events.mantled = true;

        // -----------------------------------------------------------------
        // Phase 5 — super-source launch: RESET the jump slice to `'rising'`
        // tracking the launch. WHY: `dashTechAbility` fires the super jump on
        // the PRESS tick, but `jumpAbility` already transitioned the jump slice
        // to `'anticipating'` on that same press — without resetting, the
        // anticipation→rising launch would fire AGAIN ~3 ticks later (a
        // double launch). Forcing `phase: 'rising'`, `vy: launch.vy`, and
        // `justLaunched: true` cancels the anticipation, prevents the re-launch,
        // and makes the pose track the super jump (airborne blend / launch
        // stretch). For non-super sources the existing vy-only re-sync below
        // still runs (and is a no-op here since `vy` is already set).
        //
        // Phase 6 — `'climbHop'` is reset the same way for the same reason: the
        // wall-grab ability fires the hop on the PRESS tick, but `jumpAbility`
        // already transitioned to `'anticipating'`; without this reset the jump
        // would launch AGAIN ~3 ticks later (a phantom jump after the hop).
        // Resetting to `'rising'` with the hop's vy cancels the anticipation.
        // (`climbHop` does NOT emit `justLaunched` above — it is a wall-hop, not
        // a jump-ability launch — but the slice reset still applies for pose +
        // anti-relaunch.)
        //
        // Mantle wave — `'climbJump'` and `'mantle'` join the reset family for
        // the same anti-relaunch + pose reason (both fire on the PRESS/eligible
        // tick and must cancel the plain jump's anticipation without reporting
        // a normal jump).
        // -----------------------------------------------------------------
        const jumpSlice0 = abilities['jump'] as JumpAbilityState | undefined;
        if (
          (launch.source === 'superJump' ||
            launch.source === 'superWallJump' ||
            launch.source === 'climbHop' ||
            launch.source === 'climbJump' ||
            launch.source === 'mantle') &&
          jumpSlice0 !== undefined &&
          jumpSlice0.kind === 'jump'
        ) {
          abilities = {
            ...abilities,
            jump: {
              ...jumpSlice0,
              jump: {
                ...jumpSlice0.jump,
                phase: 'rising',
                vy: launch.vy,
                y: 0,
                coyoteTimer: 0,
                jumpBufferTimer: 0,
                anticipationTimer: 0,
                justLaunched: true,
              },
            },
          };
        } else if (jumpSlice0 !== undefined && jumpSlice0.kind === 'jump') {
          // -----------------------------------------------------------------
          // Re-sync the jump slice's pose-only `vy` to the winning launch
          // velocity (Phase 0b hardening). WHY: `advanceJump` ran inside the
          // pipeline and integrated `JumpState.vy`/`JumpState.y` from the STALE
          // pre-launch arc — it has no idea a different launch won. Without
          // this, a non-jump launch (`doubleJump`/`wallJump`/`spring`) would
          // leave the jump slice's `vy`/`y` diverging from the kernel-
          // authoritative `core.vy`/`core.y`, a latent footgun for future
            // kernel-path pose/FX consumers of `evaluateJump()`. Setting the
            // slice's `vy` to `intent.vy` (the same value just applied to
            // `core.vy`) puts its integration back on the authoritative
            // trajectory. For a `'jump'`-source launch this is a no-op:
            // `advanceJump` already set its own `vy` to the same launch
            // velocity on the anticipating → rising transition. (`y` is
            // intentionally left alone — it is a relative pose offset, not an
            // absolute position.) Graceful no-op if the jump slice is absent.
            // -----------------------------------------------------------------
          abilities = {
            ...abilities,
            jump: {
              ...jumpSlice0,
              jump: {
                ...jumpSlice0.jump,
                vy: launch.vy,
                // Spring wiring (physics v14): preserve the buffered press on
                // the SLICE too — the locomotion mirror alone would be
                // re-synced from this value next tick. Max'd with
                // springAutoJumpTime per the kernel comment above.
                jumpBufferTimer:
                  launch.source === 'spring'
                    ? Math.max(jumpSlice0.jump.jumpBufferTimer, config.springAutoJumpTime)
                    : jumpSlice0.jump.jumpBufferTimer,
              },
            },
          };
        }
      }

      // -------------------------------------------------------------------
      // Phase 5 — ducking maintenance (only when NO launch fired this tick —
      // a launch already cleared `ducking` above). Latch model:
      //   - During a dash / on a ladder / wall-grab → CARRY ducking (those modes
      //     own their tick; `core.onGround` reads false throughout a dash even
      //     on a ground slide, so the airborne rule must NOT fire here —
      //     otherwise the hyper-slide's duck latch, set via patch, would be
      //     cleared mid-dash).
      //   - airborne (normal mode) → ducking = false (cleared when genuinely
      //     airborne).
      //   - grounded, holding down (`moveY === 1`), normal mode, AND
      //     `config.groundDuckEnabled !== false` → ducking = true. This is the
      //     INPUT-INDUCED latch only; the hyper-slide's ability-owned duck patch
      //     (applied earlier, above) is NOT gated by this flag and an
      //     already-active duck still carries through the fall-through below.
      //   - grounded, holding up (`moveY === -1`) → ducking = false (stand).
      //   - otherwise → carry (hyper-induced duck persists until jump/airborne;
      //     see the `ducking` field doc on `LocomotionState`).
      // -------------------------------------------------------------------
      if (!launchFired && mode === 'normal') {
        if (!core.onGround) {
          if (locomotion.ducking) locomotion = { ...locomotion, ducking: false };
        } else if (
          (input.moveY ?? 0) === 1 &&
          config.groundDuckEnabled !== false
        ) {
          if (!locomotion.ducking) locomotion = { ...locomotion, ducking: true };
        } else if ((input.moveY ?? 0) === -1) {
          if (locomotion.ducking) locomotion = { ...locomotion, ducking: false };
        }
      }

      // -------------------------------------------------------------------
      // Horizontal input → vx. Skipped while dashing (dash owns velocity) AND
      // while wall-grabbing (the wall-grab ability owns vx — it pins it to 0 so
      // the actor clings; honoring horizontal input would push the body off the
      // wall). On a climb-hop tick `grabbing` is already false (the grab ended),
      // so mode resolves to `'normal'` and the forced-horizontal lockout
      // (just opened by the launch) correctly drives the hop's away-push.
      // During a wall-jump / climb-hop lockout the kernel FORCES vx toward the
      // launch direction (ignoring input) so the push persists. Otherwise normal.
      //
      // Mantle wave — `'mantle'` mode ALSO skips ordinary horizontal input:
      // the wall-grab ability's assist owns the toward-ledge vx for the hop's
      // short lifetime (a forced-move window is deliberately NOT opened for
      // the `'mantle'` source). Gravity and X/Y collision still apply in this
      // mode — only horizontal INPUT is skipped.
      // -------------------------------------------------------------------
      if (mode !== 'dash' && mode !== 'wallGrab' && mode !== 'mantle') {
        if (locomotion.forceMoveXTimer > 0) {
          core = applyForcedHorizontal(core, locomotion.forceMoveX, config, dt);
        } else {
          core = applyHorizontalInput(core, input, config, dt, locomotion.ducking);
        }
      }

      // -------------------------------------------------------------------
      // Step 5 — Integrate gravity EXACTLY ONCE (Phase 0b core fix).
      //
      // The authoritative gravity is the apex-derived jump gravity g_jump
      // (= 2·apexHeight/timeToApex², cached on the jump slice's physics),
      // because that is the gravity that actually drove today's trajectory —
      // the old `config.gravity` only ever contributed a per-tick perturbation
      // that was overwritten next tick. If jump is disabled, fall back to
      // `config.gravity`. Skipped entirely in `'dash'`, `'ladder'`, and
      // `'wallGrab'` modes (those abilities own velocity for the tick —
      // wall-grab sets `vy` from the climb intent and pins `vx` to 0).
      //
      // Variable height (preserved): while `varJumpTimer > 0` AND still rising
      // (`vy < 0` under positive gravity), held ⇒ full g_jump; released ⇒
      // cutoff to `varJumpSpeed·jumpCutoffFactor` then `g_jump·fallMultiplier`.
      // Once falling (or past the window), plain `g_jump` with NO multiplier
      // (today's advanceJump falling branch used `physics.gravity` with no
      // fallMultiplier — preserved here intentionally).
      // -------------------------------------------------------------------
      if (mode !== 'dash' && mode !== 'ladder' && mode !== 'wallGrab') {
        // -----------------------------------------------------------------
        // Phase 4 — ease the mutable max-fall cap (Celeste `Player.cs:2910-2924`).
        // While `moveY === 1` (down held) the cap eases UP toward
        // `fastMaxFallSpeed` (fast-fall); otherwise it eases DOWN toward
        // `maxFallSpeed`. Eased in BOTH directions at `fastMaxAccel`/sec via
        // `approach`, only on ticks where gravity is applied (not during a dash
        // or on a ladder — those modes own velocity and skip gravity). The
        // eased magnitude is then the cap `integrateGravity` clamps to below.
        // -----------------------------------------------------------------
        const fastFallTarget =
          (input.moveY ?? 0) === 1
            ? config.fastMaxFallSpeed
            : config.maxFallSpeed;
        const maxFallCurrent = approach(
          locomotion.maxFallCurrent,
          fastFallTarget,
          config.fastMaxAccel * dt,
        );
        locomotion = { ...locomotion, maxFallCurrent };

        core = integrateGravity(
          core,
          locomotion,
          input,
          config,
          readJumpGravity(abilities, config),
          dt,
        );
      }

      // Climb coordination: while on a ladder, climb is authoritative for
      // vertical motion. Restore the climb-authoritative Y (climb already set
      // `core.vy`; we restore the position from the pre-pipeline Y so the
      // player does not drift) and reset the jump slice to grounded so climb
      // and jump never desync. Mirrors the dash-mode bypass above.
      if (mode === 'ladder') {
        core = { ...core, y: startCoreY + core.vy * dt };
        abilities = { ...abilities, jump: makeInitialJumpState(config) };
      }

      // Maintain the shared locomotion timers (independent of mode): decay the
      // variable-jump window and the wall-jump lockout. The coyote/buffer
      // mirrors are (re)synced from the jump slice just before returning.
      locomotion = decayLocomotionTimers(locomotion, dt);

      // -------------------------------------------------------------------
      // Phase 7 — Wall-speed retention (Celeste `WallSpeedRetentionTime 0.06`,
      // `Player.cs:54`). Stash-on-contact / restore-when-path-clears: when the
      // actor brushes a wall, the pre-brush `vx` is stashed and a short timer
      // starts. If the wall clears on that side BEFORE the timer expires, the
      // stashed `vx` is restored so a brief brush does not kill momentum. If the
      // brush outlasts the timer, the retained `vx` is discarded (the actor
      // really did stop). Local copies here are merged into `locomotion` at the
      // end of Step 6.
      //
      // Per-brush latch (`wallSpeedRetaining`): stash happens EXACTLY ONCE per
      // contiguous wall-contact brush. The latch is set on the first stash and
      // stays set until the stashed-side wall actually clears (probeWall null)
      // — even after the retention timer expires mid-brush. This is the fix for
      // the re-stash-at-expiry defect: a SUSTAINED brush (input held toward the
      // wall, continuous contact) used to re-stash the instant the timer
      // counted to 0 (the old `wallSpeedRetentionTimer === 0` guard fired
      // again), so the retained vx was never truly discarded. Now expiry
      // discards `retainedVx` but keeps the latch set, blocking re-stash until
      // a NEW brush (wall cleared, then contact resumes).
      // -------------------------------------------------------------------
      let retainedVx = locomotion.retainedVx;
      let wallSpeedRetentionTimer = locomotion.wallSpeedRetentionTimer;
      let wallSpeedRetaining = locomotion.wallSpeedRetaining;

      // Resolve check — runs each tick while a brush is active, BEFORE appliedVx
      // is computed so a restored vx actually moves the body past the corner
      // THIS tick. Reads wall presence from `probeWall` (pure geometry — §0e:
      // never from `contacts`, which clear when vx=0 and would defeat the
      // mechanic). A brush is "active" when the per-brush latch is set
      // (`wallSpeedRetaining`) OR there is stashed momentum (`retainedVx !== 0`
      // — the legacy trigger, which also covers a state pre-stashed without the
      // latch). The retained side is derived from `Math.sign(retainedVx)` while
      // it is nonzero; after the window expires (`retainedVx` discarded to 0 but
      // latch still set) the side is re-derived from `core.vx` — the
      // sustained-push direction (the actor held into the wall keeps a nonzero
      // vx at this point because resolveAxisX has not run yet). When that motion
      // goes to zero we cannot pick a side and simply hold the latch one more
      // tick.
      if (wallSpeedRetaining || retainedVx !== 0) {
        // Cancel if the actor is now moving AWAY from the retained side (the
        // brush is over — a wall-jump pushed it off, or input reversed). The
        // mechanic preserves momentum only while the actor is still moving
        // (or coasting) in the retained direction; restoring momentum after a
        // wall-jump would clobber the launch's away-push. `core.vx` here is the
        // post-pipeline, post-horizontal-input velocity, so a wall-jump lockout
        // (forcing vx away from the wall) reads as opposite-sign and cancels.
        // (Only meaningful while there is still a retained vx to compare; once
        // it has been discarded on expiry there is nothing to cancel.)
        if (retainedVx !== 0 && core.vx !== 0 && core.vx * retainedVx < 0) {
          retainedVx = 0;
          wallSpeedRetentionTimer = 0;
          wallSpeedRetaining = false;
        } else {
          // Derive the stashed side: prefer the retained sign (authoritative
          // while the window is live); after expiry fall back to the current
          // motion direction so we can still detect the wall clearing and
          // release the latch for a fresh brush.
          const sideSource = retainedVx !== 0 ? retainedVx : core.vx;
          if (sideSource !== 0) {
            const side: -1 | 1 = sideSource > 0 ? 1 : -1;
            const wallStillThere = probeWall(
              { x: core.x, y: core.y, width: core.width, height: core.height },
              side,
              1, // flush-or-near probe: a wall within 1px on the stashed side
              solids,
            );
            if (wallStillThere === null) {
              // Path cleared on the stashed side. Restore the pre-brush vx ONLY
              // when clearing happened within the window (timer > 0 AND there
              // is still a retained value); clearing after expiry just ends the
              // brush with no restore.
              if (wallSpeedRetentionTimer > 0 && retainedVx !== 0) {
                core = { ...core, vx: retainedVx };
              }
              retainedVx = 0;
              wallSpeedRetentionTimer = 0;
              wallSpeedRetaining = false;
            } else {
              // Still brushing — keep counting down; discard the retained vx
              // when the brush outlasts the window (a sustained wall contact
              // must NOT keep momentum alive forever, or the actor would ghost
              // through after the timer). The latch STAYS set so the stash
              // guard below does not re-fire the instant the timer hits 0; it
              // is released only when the wall actually clears (above).
              wallSpeedRetentionTimer = Math.max(
                0,
                wallSpeedRetentionTimer - dt,
              );
              if (wallSpeedRetentionTimer === 0) retainedVx = 0;
            }
          }
          // else: sideSource === 0 — cannot derive a side this tick (no
          // retained momentum and no current motion). Hold the latch unchanged
          // and retry next tick; nothing to probe or restore.
        }
      }

      // Step 6 — Resolve actor collision: resolveAxisX then resolveAxisY.
      const prevBottom = core.y + core.height;
      const appliedVx = core.vx * dt;
      const appliedVy = core.vy * dt;

      const rx = resolveAxisX(
        { x: core.x, y: core.y, width: core.width, height: core.height },
        appliedVx,
        solids,
      );

      let nextX = rx.x;
      // resolveAxisX was passed `appliedVx` (= core.vx * dt), so its returned
      // `vx` is in per-tick delta units, not canonical px/s. We preserve the
      // pre-resolution canonical vx unless a wall was hit (then zero it).
      // Storing the per-tick delta here would corrupt core.vx into px/tick
      // units, breaking any consumer that reads core.vx as px/s (e.g. the
      // showcase's locomotion drive: `vx / 60` to convert to px/tick).
      let leftWallId: string | null = null;
      let rightWallId: string | null = null;
      let hitWall = rx.hitWall;
      if (rx.hitWall) {
        const contact = findWallSolidId(
          { x: nextX, y: core.y, width: core.width, height: core.height },
          appliedVx,
          solids,
        );
        if (contact !== null) {
          if (contact.side === 'left') leftWallId = contact.id;
          else rightWallId = contact.id;
        }
        events.hitWall = true;
      }

      // Step 6b — Horizontal step-up. If the player walked into a wall but the
      // wall's top is a small step (within `config.stepHeight` above the feet),
      // lift the player onto it instead of blocking. This smooths stair-climbs,
      // small ledges, and the last few px of a ladder-top exit (where the climb
      // guard leaves the player one step below a flush platform). Only when
      // moving horizontally, supported (on ground or climbing), step-up enabled,
      // and not dashing. The subsequent Y resolve confirms the landing on the
      // stepped surface.
      const stepHeight = config.stepHeight ?? 0;
      if (
        hitWall &&
        stepHeight > 0 &&
        appliedVx !== 0 &&
        mode !== 'dash' &&
        (core.onGround || mode === 'ladder')
      ) {
        const stepped = tryStepUp(
          { x: nextX, y: core.y, width: core.width, height: core.height },
          appliedVx,
          prevBottom,
          stepHeight,
          solids,
        );
        if (stepped !== null) {
          // Snap onto the step: feet to the step top, X advanced just past the
          // leading edge so the body rests on the surface. Keep the horizontal
          // velocity (the player is walking, not stopped) and clear the wall
          // contact — this was a step, not a wall.
          core = { ...core, y: stepped.top - core.height };
          nextX = stepped.advanceTo;
          hitWall = false;
          leftWallId = null;
          rightWallId = null;
          events.hitWall = false;
        }
      }

      // -----------------------------------------------------------------
      // Step 6c — Dash corner correction (Phase 4d/7 — Celeste
      // `DashCornerCorrection = 4`, `Player.cs:2408, 2511, 2524, 2668, 2682`).
      // During a dash, if the dashing actor hit a wall, nudge the body
      // PERPENDICULAR to the dash's primary axis (vertically for a horizontal
      // dash — the common case) by up to `dashCornerCorrection` px to find a
      // position where the dash can continue past the corner. This is a
      // SEPARATE system from upward CC (Step 6d below): both share the Celeste
      // `4` tolerance (pegged to `8px` here) but operate on different modes +
      // axes. Only fires in dash mode; the dash owns velocity, so clearing the
      // wall-block preserves the dash velocity (resolvedVx below) and lets the
      // dash slide around the corner. Scoped to `hitWall` (horizontal blocking);
      // vertical dashes do not set hitWall (vx=0 → resolveAxisX no-op), so the
      // vertical-dash X-nudge branch of `tryDashCornerCorrection` is structurally
      // present for the general perpendicular nudge but not currently reached —
      // wiring it needs a ceiling/floor-hit path, deliberately deferred.
      // -----------------------------------------------------------------
      if (mode === 'dash' && hitWall) {
        const dashSlice = abilities['dash'] as DashAbilityState | undefined;
        const dashDirX =
          dashSlice !== undefined && dashSlice.kind === 'dash' ? dashSlice.dirX : 0;
        const slipped = tryDashCornerCorrection(
          core.x,
          core.y,
          appliedVx,
          appliedVy,
          core.width,
          core.height,
          core.facing,
          dashDirX,
          config.dashCornerCorrection,
          solids,
        );
        if (slipped !== null) {
          // Snap the body past the wall at the nudged perpendicular position.
          // Setting core.y here makes the Y resolve below continue from the
          // nudged y (a no-op for a horizontal dash, where appliedVy === 0).
          // Clearing hitWall preserves the dash velocity via resolvedVx below.
          core = { ...core, y: slipped.y };
          nextX = slipped.x;
          hitWall = false;
          leftWallId = null;
          rightWallId = null;
          events.hitWall = false;
        }
      }

      // -----------------------------------------------------------------
      // Phase 7 — Wall-speed retention stash. On a FRESH wall contact in
      // NORMAL mode, capture the pre-collision vx, arm the per-brush latch,
      // and start the retention window. `mode === 'normal'` excludes dash /
      // ladder / wallGrab (those modes own velocity — retention is for
      // preserved run/wall-jump momentum across a brief brush). The
      // anti-re-stash guard is the per-brush latch `!wallSpeedRetaining`: a
      // SUSTAINED brush (input held toward the wall, continuous contact) must
      // stash EXACTLY ONCE so the resolve check above can count the window down
      // to expiry and discard the retained vx — otherwise the actor would ghost
      // through after the timer (the old `wallSpeedRetentionTimer === 0` guard
      // re-fired the instant the timer hit 0 while still in contact). The
      // latch is cleared only when the stashed-side wall actually clears (see
      // the resolve check), so a NEW brush (wall cleared, then contact resumes)
      // stashes fresh. `core.vx !== 0` guards against stashing a zero (no
      // momentum to retain). core.vx here is still the pre-resolve value —
      // resolveAxisX changed only nextX.
      // -----------------------------------------------------------------
      if (
        hitWall &&
        mode === 'normal' &&
        core.vx !== 0 &&
        !wallSpeedRetaining
      ) {
        retainedVx = core.vx;
        wallSpeedRetentionTimer = config.wallSpeedRetentionTime;
        wallSpeedRetaining = true;
      }

      // Re-derive nextVx from the (possibly step-up-/dash-CC-cleared) hitWall
      // so a successful step or dash-corner-slip keeps the body moving instead
      // of zeroing vx.
      const resolvedVx = hitWall ? 0 : core.vx;

      const ry = resolveAxisY(
        { x: nextX, y: core.y, width: core.width, height: core.height },
        appliedVy,
        solids,
        prevBottom,
      );

      // `nextY`/`nextVy` are mutable below so upward CC (Step 6d) can snap the
      // body to the would-be upward position and preserve the rising vy when it
      // slips past a ceiling corner.
      let nextY = ry.y;
      const landed = ry.landed;
      let hitCeiling = ry.hitCeiling;
      // resolveAxisY was passed `appliedVy` (= core.vy * dt), so its returned
      // `vy` is in per-tick delta units. Preserve canonical px/s vy unless the
      // actor landed or hit a ceiling (then zero it). Same reasoning as nextVx.
      // `let` (not `const`) so upward CC (Step 6d) can preserve the rising
      // velocity when it slips the body past a ceiling corner.
      let nextVy = (landed || hitCeiling) ? 0 : core.vy;
      // Phase D2 — capture the pre-zero impact speed (absolute canonical px/s)
      // for the `landing` feel moment. `core.vy` is still the original fall/rise
      // speed here; the ternary above is what zeroes it. Magnitude-only so it is
      // correct under both gravity signs. Presentation use only.
      const impactSpeed = landed || hitCeiling ? Math.abs(core.vy) : 0;
      let groundId: string | null = null;
      let ceilingId: string | null = null;
      if (landed) {
        groundId = findGroundSolidId(
          { x: nextX, y: nextY, width: core.width, height: core.height },
          appliedVy,
          solids,
          prevBottom,
        );
      }
      if (hitCeiling) {
        ceilingId = findCeilingSolidId(
          { x: nextX, y: nextY, width: core.width, height: core.height },
          appliedVy,
          solids,
        );
      }

      // -----------------------------------------------------------------
      // Step 6d — Upward corner correction (Phase 7 — Celeste
      // `UpwardCornerCorrection = 4`, `Player.cs:2591, 2603`). When the actor
      // is RISING and bumps a ceiling/wall corner, nudge the body horizontally
      // by up to `upwardCornerCorrection` px (1px steps, input/facing direction
      // first) to a position where the upward move no longer collides — so
      // jumps squeak past 1-tile lips instead of bonking. If a clear position
      // is found, snap there and continue rising (preserve vy, clear the
      // ceiling contact + event).
      //
      // DECISION (roadmap §7 open question — "extend stepHeight or separate?"):
      // → SEPARATE. `tryStepUp` (Step 6b) handles horizontal-into-wall stepping
      // UP ONTO a ledge: the body advances along X and is lifted along Y to
      // stand on the surface. Upward CC handles vertical-into-ceiling stepping
      // SIDEWAYS around a corner: the body advances along Y (rising) and is
      // shifted along X to slip past the lip. These are PERPENDICULAR axes and
      // distinct geometries — forcing upward CC into `tryStepUp` would conflate
      // a ledge-climb with a ceiling-slip and muddle both. Implemented as its
      // own pass here (Step 6d, after the Y resolve that detected the ceiling).
      //
      // Scope: upward motion only (appliedVy < 0, i.e. rising). NOT applied
      // while dashing (dash CC, Step 6c, handles dash corners), climbing a
      // ladder, or wall-grabbing (those modes own velocity). Preferred nudge
      // direction is `Math.sign(input.moveX)` if held, else `facing` — Celeste
      // tries the intended side first. Phase 9: sign-based so a partial analog
      // deflection still picks the intended side; for digital `moveX ∈ {-1, 0,
      // 1}`, `Math.sign(moveX)` === `moveX`, so byte-identical to v8.
      // -----------------------------------------------------------------
      if (hitCeiling && appliedVy < 0 && mode === 'normal') {
        const preferredDir = input.moveX !== 0 ? Math.sign(input.moveX) : core.facing;
        const targetY = core.y + appliedVy;
        const clearX = tryUpwardCornerCorrection(
          nextX,
          targetY,
          core.width,
          core.height,
          preferredDir,
          config.upwardCornerCorrection,
          solids,
        );
        if (clearX !== null) {
          // Slip past the corner: advance X to the cleared position and Y to
          // the would-be upward position. Preserve vy (keep rising), clear the
          // ceiling contact + event so the actor is not treated as bonked.
          nextX = clearX;
          nextY = targetY;
          nextVy = core.vy;
          hitCeiling = false;
          ceilingId = null;
          events.hitCeiling = false;
        }
      }

      const contacts: Contacts = {
        groundId,
        leftWallId,
        rightWallId,
        ceilingId,
      };

      // Step 7 — Update contacts & events.
      const nowOnGround = invertedGravity ? hitCeiling : landed;
      // The landing edge: supported NOW, and NOT supported both when the
      // previous tick ENDED (`enteredOnGround`) and at the START of this tick
      // (`wasOnGround`, the probe above). The old `!wasOnGround` form dropped
      // the exact-flush arrival — a body whose gravity-facing edge lands
      // EXACTLY on a support edge (a full-height held jump's symmetric arc
      // does, deterministically) is not a strict AABB overlap, so the arrival
      // tick reports no landing, and this tick's flush probe then sees the
      // resting body as already supported: `landedThisTick` stayed false two
      // ticks running, silently dropping the `landing` moment + `justLanded`
      // pulse for the whole landing. Requiring BOTH flags keeps every other
      // configuration byte-identical to the old edge (a same-tick support
      // swap under a gravity flip — airborne per the probe, grounded at the
      // boundary — still reports; a body grounded across the boundary never
      // does). A flush landing reports one tick after the contact; its
      // `impactSpeed` is the fall speed captured above (within a couple of
      // gravity steps of the true arrival speed).
      const landedThisTick = nowOnGround && !(enteredOnGround && wasOnGround);
      if (landedThisTick) {
        events.justLanded = true;
        // Phase D2 — structured landing feel moment on the unsupported→supported
        // transition. The support id is gravity-facing (ceiling under inverted
        // gravity, ground otherwise); the impact speed was captured above before
        // the Y resolver zeroed it. `normalizedImpact`/`hard` are derived in the
        // pure helper so they are scale-invariant across tile sizes.
        moments.push(
          landingMomentFor(
            impactSpeed,
            invertedGravity ? ceilingId : groundId,
            config,
          ),
        );
      }
      if (hitCeiling) {
        events.hitCeiling = true;
      }

      // -----------------------------------------------------------------
      // Phase D2 — dash feel moments. The dash ability never reads contacts
      // (it ends only on timeout), so the kernel owns (a) the per-dash X/Y
      // bonk latches that emit a one-shot `dashBonk` per blocked axis, and
      // (b) the observation-only `dashEnded` on the active→idle transition.
      // Neither feeds velocity/position; both are derived from contacts the
      // kernel already resolved this tick.
      // -----------------------------------------------------------------
      const dashSliceNow = abilities['dash'] as DashAbilityState | undefined;
      // Active→idle this tick = the dash timed out (the only end path in this
      // release). Computed once here so the `dashEnded` moment and the
      // super-jump grace seed (finalizeLocomotion) share one definition.
      const dashEndedThisTick =
        prevDashActive &&
        dashSliceNow !== undefined &&
        dashSliceNow.kind === 'dash' &&
        dashSliceNow.phase === 'idle';
      if (
        dashSliceNow !== undefined &&
        dashSliceNow.kind === 'dash'
      ) {
        if (dashSliceNow.phase === 'active') {
          // One-shot bonk per blocked axis. The latch resets on each new dash
          // (the dash ability clears `bonkedX`/`bonkedY` at dash start).
          let dashUpdated = dashSliceNow;
          const ddx = dashSliceNow.dirX;
          const ddy = dashSliceNow.dirY;
          if (ddx !== 0 && !dashSliceNow.bonkedX) {
            const wallId = ddx > 0 ? rightWallId : leftWallId;
            if (wallId !== null) {
              moments.push({
                kind: 'dashBonk',
                // Conventional outward surface normal: a wall the actor dashed
                // INTO points back against the dash direction.
                normalX: ddx > 0 ? -1 : 1,
                normalY: 0,
                solidId: wallId,
              });
              dashUpdated = { ...dashUpdated, bonkedX: true };
            }
          }
          if (ddy !== 0 && !dashSliceNow.bonkedY) {
            // A ceiling (up dash, ddy < 0) gives outward normal +1; a floor
            // (down dash, ddy > 0) gives -1.
            const yId = ddy < 0 ? ceilingId : groundId;
            if (yId !== null) {
              moments.push({
                kind: 'dashBonk',
                normalX: 0,
                normalY: ddy < 0 ? 1 : -1,
                solidId: yId,
              });
              dashUpdated = { ...dashUpdated, bonkedY: true };
            }
          }
          if (dashUpdated !== dashSliceNow) {
            abilities = { ...abilities, dash: dashUpdated };
          }
        } else if (dashEndedThisTick) {
          // The dash timed out this tick. Report the ending-tick resolved contact
          // context WITHOUT claiming it caused the end. Precedence: wall > ceiling
          // > floor.
          let terminal: 'none' | 'wall' | 'ceiling' | 'floor' = 'none';
          if (leftWallId !== null || rightWallId !== null) terminal = 'wall';
          else if (ceilingId !== null) terminal = 'ceiling';
          else if (groundId !== null) terminal = 'floor';
          moments.push({
            kind: 'dashEnded',
            reason: 'timeout',
            terminalContact: terminal,
          });
        }
      }

      core = {
        ...core,
        x: nextX,
        y: nextY,
        vx: resolvedVx,
        vy: nextVy,
        onGround: nowOnGround,
        contacts,
      };

      // Phase 7 — merge the wall-speed-retention locals (possibly mutated by
      // the resolve check + stash above) into the locomotion slice before the
      // finalizer. `finalizeLocomotion` does not touch these fields, so a plain
      // spread carry is correct (the finalizer syncs dash/jump mirrors only).
      const locomotionFinal: LocomotionState = {
        ...locomotion,
        retainedVx,
        wallSpeedRetentionTimer,
        wallSpeedRetaining,
      };

      return {
        state: {
          core,
          abilities,
          // Phase 5 — end-of-tick locomotion finalizer. Syncs the coyote/buffer
          // mirrors from the jump slice (existing), the last-dash-direction +
          // dashing flag from the dash slice, and maintains the super-jump
          // ground-grace timer (seeded once when a horizontal dash ENDS or when
          // the actor LANDS after one, then decaying). These mirrors expose the
          // current windows to cross-ability consumers (dashTech) without them
          // reaching into another ability's slice.
          locomotion: finalizeLocomotion(
            locomotionFinal,
            abilities,
            nowOnGround,
            landedThisTick,
            dashEndedThisTick,
            config,
            dt,
          ),
          events,
          // Phase 8 — identified surface-interaction events (springs + dash
          // refills). Frozen empty when no trigger fired this tick (reference-
          // stable with EMPTY_INTERACTIONS) so consumers can cheap-compare.
          interactions: interactions.length > 0 ? interactions : EMPTY_INTERACTIONS,
          // Phase D2 — feel moments. Frozen empty when none fired this tick
          // (reference-stable with EMPTY_MOMENTS) so consumers can cheap-compare.
          moments: moments.length > 0 ? moments : EMPTY_MOMENTS,
          tick: state.tick + 1,
        },
      };
    },
  };
}

/**
 * Convenience wrapper: step the platformer state by one tick using the default
 * precision pipeline + a per-call config. Avoids the need to assemble a
 * controller for one-off / simple usage. For tight loops, build a controller
 * once with `createPlatformerController` and reuse it (the controller allocates
 * one less closure per tick).
 *
 * Pure: returns a brand-new state; input never mutated.
 *
 * @param state - current platformer state
 * @param input - per-tick input snapshot
 * @param solids - collision surfaces for this tick
 * @param dt - fixed timestep in seconds
 * @param config - platformer tuning config (default `DEFAULT_PLATFORMER_CONFIG`)
 * @param getSolidDisplacement - optional moving-platform carry provider
 * @returns the next `PlatformerState`
 */
export function stepPlatformer(
  state: PlatformerState,
  input: PlatformerInput,
  solids: readonly Solid[],
  dt: number,
  config: Readonly<PlatformerConfig> = DEFAULT_PLATFORMER_CONFIG,
  getSolidDisplacement?: SolidDisplacementProvider,
): { state: PlatformerState } {
  const controller = createPlatformerController(defaultPrecisionPipeline(), config, {
    getSolidDisplacement,
  });
  return controller.step(state, input, solids, dt);
}

// ---------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------

/**
 * Build the initial `JumpAbilityState` for a freshly created character.
 */
function makeInitialJumpState(config: Readonly<PlatformerConfig>): JumpAbilityState {
  return { kind: 'jump', jump: createJumpState(config.jump) };
}

function hasPhysicalSupport(
  core: ActorCore,
  solids: readonly Solid[],
  invertedGravity: boolean,
): boolean {
  const edge = invertedGravity ? core.y : core.y + core.height;
  const tolerance = 1e-7;
  for (const solid of solids) {
    if (invertedGravity && solid.passthrough) continue;
    // Phase 8 — spring/dashRefill solids are non-blocking trigger volumes; they
    // do not support the actor (a spring is not a floor).
    if (solid.spring !== undefined || solid.dashRefill) continue;
    const supportEdge = invertedGravity ? solid.y + solid.height : solid.y;
    if (Math.abs(edge - supportEdge) > tolerance) continue;
    if (core.x < solid.x + solid.width && core.x + core.width > solid.x) return true;
  }
  return false;
}

/**
 * Build the initial `WallSlideAbilityState`.
 */
function makeInitialWallSlideState(): WallSlideAbilityState {
  return {
    kind: 'wallSlide',
    sliding: false,
    side: null,
    lockTimer: 0,
    slideTimer: 0,
    graceTimer: 0,
  };
}

/**
 * Build the initial `DashAbilityState`. Dashes start ready (full budget,
 * zero timers) and in the `'idle'` phase.
 */
function makeInitialDashState(config: Readonly<PlatformerConfig>): DashAbilityState {
  return {
    kind: 'dash',
    phase: 'idle',
    startupTimer: 0,
    timer: 0,
    cooldown: 0,
    dashesRemaining: config.dashEnabled ? config.maxDashes : 0,
    dirX: 0,
    dirY: 0,
    beforeDashVx: 0,
    dashStartedOnGround: false,
    hyperSlide: false,
  };
}

/**
 * Build the initial `DoubleJumpAbilityState`.
 */
function makeInitialDoubleJumpState(config: Readonly<PlatformerConfig>): DoubleJumpAbilityState {
  return {
    kind: 'doubleJump',
    jumpsRemaining: config.doubleJumpEnabled ? config.maxDoubleJumps : 0,
  };
}

/**
 * Build the initial `ClimbAbilityState`. The actor starts off-ladder; the
 * ability sets `climbing` true on the first tick it detects a ladder overlap.
 */
function makeInitialClimbState(): ClimbAbilityState {
  return { kind: 'climb', climbing: false };
}

/**
 * Build the initial `DashTechAbilityState` (Phase 5). The dash-tech processor is
 * stateless — only the `kind` discriminator is needed.
 */
function makeInitialDashTechState(): DashTechAbilityState {
  return { kind: 'dashTech' };
}

/**
 * Build the initial `WallGrabAbilityState` (Phase 6). A fresh actor is not
 * grabbing; the ability engages on the first tick the conditions hold. The
 * mantle wave inits the re-grab lock to 0 (unlocked) and the mantle assist to
 * `null` (none in flight).
 */
function makeInitialWallGrabState(): WallGrabAbilityState {
  return {
    kind: 'wallGrab',
    grabbing: false,
    side: null,
    regrabTimer: 0,
    mantle: null,
  };
}

/**
 * Apply horizontal input → core.vx via Celeste-style rate-based acceleration
 * (Phase 3a — replaces the old ground-snap + dt-free `airControl` lerp).
 *
 * Implements `Player.cs:2891-2894` via the existing `approach()` primitive
 * (already the `Calc.Approach` contract):
 *
 *   - `target = moveX * moveSpeed` (0 when released).
 *   - `mult = onGround ? 1 : airAccelMultiplier` (Celeste `AirMult`, a RATE
 *     multiplier — not the old per-tick lerp fraction).
 *   - When already above `moveSpeed` AND still holding that direction
 *     (`overspeed`), bleed off at the gentler `overspeedReduce` rate
 *     (`RunReduce`) instead of `runAccel` — a dash/spring's gifted speed fades
 *     out rather than snapping back. Releasing input AND reversing both use the
 *     full `runAccel` — there is NO separate ground decel.
 *
 * Phase 5 — DUCKING (Celeste duck branch): while ducking on the ground, `vx`
 * bleeds toward 0 at `config.duckFriction` and NO horizontal input is honored
 * (Celeste has no crawl-walk — ducking is a stationary crouch; the hyper
 * slide's momentum simply decays). `duckFriction` (1110) is SLOWER than a
 * normal release's `runAccel` (2220), so the slide retains its reach — this is
 * the point of the hyper. Facing is preserved while ducking.
 *
 * Pure: returns a shallow-copied new core. Signature gained `dt` in Phase 3 and
 * `ducking` in Phase 5 (internal helper; no external callers).
 */
function applyHorizontalInput(
  core: ActorCore,
  input: PlatformerInput,
  config: PlatformerConfig,
  dt: number,
  ducking: boolean,
): ActorCore {
  if (ducking && core.onGround) {
    // Phase 5 — duck friction: bleed toward 0 at duckFriction, no input honored.
    const nextVx = approach(core.vx, 0, config.duckFriction * dt);
    return { ...core, vx: nextVx };
  }
  const target = input.moveX * config.moveSpeed; // analog: scales with magnitude
  const mult = core.onGround ? 1 : config.airAccelMultiplier;
  // Phase 9 — overspeed "still holding that direction" is sign-based so a
  // partial analog deflection still bleeds gifted speed when moving that way.
  // For digital `moveX ∈ {-1, 0, 1}`, `Math.sign(moveX)` === `moveX`, so this
  // is byte-identical to v8.
  const overspeed =
    input.moveX !== 0 &&
    Math.abs(core.vx) > config.moveSpeed &&
    Math.sign(core.vx) === Math.sign(input.moveX);
  const rate = (overspeed ? config.overspeedReduce : config.runAccel) * mult;
  const nextVx = approach(core.vx, target, rate * dt);
  const facing: 1 | -1 =
    input.moveX !== 0 ? (input.moveX > 0 ? 1 : -1) : core.facing;
  return { ...core, vx: nextVx, facing };
}

/**
 * Resolve the exclusive {@link LocomotionMode} for this tick from the
 * post-pipeline ability slices (Phase 0d).
 *
 * Centralizes ALL cross-ability exclusivity in one place (the old kernel used
 * two ad-hoc helpers, `isDashActive` + `isClimbActive`; this replaces both).
 * Order is dash → ladder → wallGrab → normal:
 *   - Dash wins over everything (a committed velocity override).
 *   - Ladder wins over wall-grab: a ladder shaft's climb space takes priority
 *     when both are somehow active (the wall-grab ability also self-disables
 *     while overlapping a ladder, so this branch is a backstop).
 *   - Wall-grab (Phase 6) owns velocity while `grabbing`: the kernel skips
 *     gravity and horizontal input for that tick.
 *
 * Phase 2b: the dash is treated as active during BOTH its `'startup'` (freeze)
 * and `'active'` phases — i.e. while `phase !== 'idle'` (equivalently, while
 * `startupTimer > 0 || timer > 0`). This ensures gravity and horizontal input
 * are skipped for the freeze frame too, so the dash's pinned zero velocity is
 * authoritative during startup. (Previously this checked only `timer > 0`.)
 *
 * Pure: a pure function of the ability slices.
 */
function resolveLocomotionMode(
  abilities: Readonly<Record<string, AnyAbilityState>>,
): LocomotionMode {
  const dash = abilities['dash'] as DashAbilityState | undefined;
  if (dash !== undefined && dash.phase !== 'idle') return 'dash';
  const climb = abilities['climb'] as ClimbAbilityState | undefined;
  if (climb !== undefined && climb.climbing) return 'ladder';
  const wallGrab = abilities['wallGrab'] as WallGrabAbilityState | undefined;
  if (wallGrab !== undefined && wallGrab.grabbing) return 'wallGrab';
  // Mantle wave — the wall-grab ability's assisted ledge hop. While the assist
  // record is active the ability owns ONLY the toward-ledge `vx`; the kernel
  // skips ordinary horizontal input in this mode but NOT gravity, and the
  // normal X/Y collision resolvers stay authoritative (the actor rises beside
  // the wall, crosses the lip once its feet clear, and lands through the
  // resolver — mantle code never assigns position).
  if (wallGrab !== undefined && wallGrab.mantle != null) return 'mantle';
  return 'normal';
}

/**
 * Pick the single winning {@link LaunchIntent} from the pool collected during
 * the pipeline, using {@link LAUNCH_PRIORITY} (spring > wallJump > doubleJump >
 * jump). Ties break to the first-emitted launch (stable). Returns `null` when
 * no ability emitted a launch this tick.
 *
 * Pure: deterministic; never throws.
 */
function pickLaunch(launches: readonly LaunchIntent[]): LaunchIntent | null {
  let best: LaunchIntent | null = null;
  let bestPri = -1;
  for (const l of launches) {
    const pri = LAUNCH_PRIORITY[l.source];
    if (pri > bestPri) {
      best = l;
      bestPri = pri;
    }
  }
  return best;
}

/**
 * Apply a winning launch to the core: set `vy` (always) and `vx` (when the
 * launch carries one, e.g. wall-jump's away-from-wall push). Returns a new
 * shallow-copied core. Does NOT touch events or locomotion (the caller does).
 *
 * Pure: returns a fresh core; input never mutated.
 */
function applyLaunch(core: ActorCore, launch: LaunchIntent): ActorCore {
  if (launch.vx !== undefined) {
    return { ...core, vy: launch.vy, vx: launch.vx };
  }
  return { ...core, vy: launch.vy };
}

/**
 * Force horizontal velocity toward a wall-jump lockout direction, ignoring
 * player input. Used while `locomotion.forceMoveXTimer > 0` so the wall-jump's
 * push is not immediately cancelled. `forceMoveX` is -1/0/+1; `0` simply
 * preserves `vx` (no forced direction, but input is still suppressed by the
 * caller's gate).
 *
 * Phase 3a: now ramps toward the forced target at the air-accel RATE
 * (`runAccel * airAccelMultiplier`) via `approach`, matching
 * {@link applyHorizontalInput}'s air branch (the wall-jump lockout is airborne
 * by definition). The retired `airControl` lerp is gone.
 *
 * Pure: returns a fresh core.
 */
function applyForcedHorizontal(
  core: ActorCore,
  forceMoveX: number,
  config: PlatformerConfig,
  dt: number,
): ActorCore {
  if (forceMoveX === 0) return core;
  const targetVx = forceMoveX * config.moveSpeed;
  const rate = config.runAccel * config.airAccelMultiplier;
  const rampedVx = approach(core.vx, targetVx, rate * dt);
  const facing: 1 | -1 = forceMoveX > 0 ? 1 : -1;
  return { ...core, vx: rampedVx, facing };
}

/**
 * Read the authoritative gravity magnitude for this tick. When jump is
 * enabled, that is the apex-derived jump gravity `g_jump` cached on the jump
 * slice's `physics.gravity` (the gravity that actually drove today's
 * trajectory). When jump is disabled, fall back to `|config.gravity|`. Always
 * returns a positive magnitude; the caller applies it in `config.gravity`'s
 * direction.
 *
 * Pure: a pure function of the jump slice + config.
 */
function readJumpGravity(
  abilities: Readonly<Record<string, AnyAbilityState>>,
  config: PlatformerConfig,
): number {
  if (config.jumpEnabled !== false) {
    const jump = abilities['jump'] as JumpAbilityState | undefined;
    if (jump !== undefined && jump.kind === 'jump') {
      return jump.jump.physics.gravity;
    }
  }
  return Math.abs(config.gravity);
}

/**
 * Integrate gravity ONCE for this tick (Phase 0b core fix — the old kernel
 * added a second `config.gravity` term on top of the jump slice's own vy,
 * double-applying gravity).
 *
 * Uses `gravityMag` (from {@link readJumpGravity}) applied in `config.gravity`'s
 * direction. Variable-height window: while `locomotion.varJumpTimer > 0` and
 * the actor is still rising against gravity, held ⇒ full gravity; released ⇒
 * cutoff to `varJumpSpeed·jumpCutoffFactor` then `gravityMag·fallMultiplier`.
 * Once falling (or past the window), plain `gravityMag` with NO multiplier —
 * today's `advanceJump` falling branch used `physics.gravity` with no
 * `fallMultiplier`, and that feel is preserved here intentionally. The result
 * is clamped to the MUTABLE `locomotion.maxFallCurrent` cap in the gravity
 * direction (Phase 4 — eased between `maxFallSpeed` and `fastMaxFallSpeed` by
 * the kernel each tick; see the easing block in the step function).
 *
 * Pure: returns a fresh core; never throws.
 */
function integrateGravity(
  core: ActorCore,
  locomotion: LocomotionState,
  input: PlatformerInput,
  config: PlatformerConfig,
  gravityMag: number,
  dt: number,
): ActorCore {
  const inverted = config.gravity < 0;
  // Gravity magnitude applied in config.gravity's direction (negative gravity
  // pulls up). The magnitude is g_jump (jump enabled) or |config.gravity|.
  const gravitySigned = (inverted ? -1 : 1) * gravityMag;
  // "Rising against gravity" = moving opposite the gravity direction (vy < 0
  // for normal gravity, vy > 0 for inverted).
  const rising = inverted ? core.vy > 0 : core.vy < 0;
  const inVarWindow = locomotion.varJumpTimer > 0 && rising;

  let nextVy = core.vy;
  if (inVarWindow && !input.jump.held) {
    // Released early inside the variable-jump window: clamp toward 0 (short
    // hop) then apply the heavier fall-off gravity. The cutoff clamps toward
    // zero from the launch speed; for inverted gravity the signs flip via
    // `min`/`max` so the clamp still pulls toward zero, not away.
    const cutoff = locomotion.varJumpSpeed * config.jump.jumpCutoffFactor;
    nextVy = inverted ? Math.min(nextVy, cutoff) : Math.max(nextVy, cutoff);
    nextVy += gravitySigned * config.jump.fallMultiplier * dt;
  } else {
    // Full-height rise (held), normal fall, or past the window: plain gravity.
    nextVy += gravitySigned * dt;
  }

  // Clamp to terminal speed in the gravity direction (respects inverted
  // gravity exactly as the pre-refactor kernel did). Phase 4: the cap is the
  // MUTABLE `locomotion.maxFallCurrent` (eased between `maxFallSpeed` and
  // `fastMaxFallSpeed` by the kernel each tick before this call), NOT the
  // static `config.maxFallSpeed` — so holding `moveY === 1` (fast-fall) lets
  // terminal vy exceed `maxFallSpeed` without ever exceeding `fastMaxFallSpeed`.
  const terminalSpeed = Math.abs(locomotion.maxFallCurrent);
  if (inverted) nextVy = Math.max(nextVy, -terminalSpeed);
  else nextVy = Math.min(nextVy, terminalSpeed);

  return { ...core, vy: nextVy };
}

/**
 * Decay the kernel-owned locomotion timers by `dt` (variable-jump window and
 * wall-jump horizontal lockout), flooring at 0. Does NOT touch the coyote/
 * buffer mirrors — those are (re)synced from the jump slice by
 * {@link syncLocomotionFromJump} at the end of the tick.
 *
 * Pure: returns a fresh locomotion record.
 */
function decayLocomotionTimers(
  locomotion: LocomotionState,
  dt: number,
): LocomotionState {
  return {
    ...locomotion,
    varJumpTimer: Math.max(0, locomotion.varJumpTimer - dt),
    forceMoveXTimer: Math.max(0, locomotion.forceMoveXTimer - dt),
  };
}

/**
 * Copy the jump slice's coyote/buffer timers onto the shared locomotion slice
 * (read-only mirror — see the deviation note on {@link LocomotionState}). The
 * jump slice remains the state-machine authority (so `advanceJump`'s contract
 * and `jump.test.ts` are preserved); this mirror exposes the current windows
 * to future cross-ability consumers without them reaching into the jump slice.
 *
 * Pure: returns a fresh locomotion record. If the jump slice is absent, the
 * existing mirrors are preserved unchanged.
 */
function syncLocomotionFromJump(
  locomotion: LocomotionState,
  abilities: Readonly<Record<string, AnyAbilityState>>,
): LocomotionState {
  const jump = abilities['jump'] as JumpAbilityState | undefined;
  if (jump === undefined || jump.kind !== 'jump') return locomotion;
  return {
    ...locomotion,
    coyoteTimer: jump.jump.coyoteTimer,
    jumpBufferTimer: jump.jump.jumpBufferTimer,
  };
}

/**
 * End-of-tick locomotion finalizer (Phase 5). Composes:
 *
 *   1. Sync `coyoteTimer` / `jumpBufferTimer` from the jump slice (existing
 *      mirror — the jump slice stays the state-machine authority).
 *   2. Sync `lastDashDirX` / `lastDashDirY` from the dash slice (the captured
 *      direction of the most recent dash; persists after the dash ends). For a
 *      hyper slide the down-diagonal was converted to horizontal at the
 *      startup→active transition, so this records the POST-conversion dir.
 *   3. Sync `dashing` from the dash phase (`true` while `phase !== 'idle'`) —
 *      read by `dashTechAbility` next tick to refuse a super jump mid-dash.
 *   4. Maintain `superJumpGraceTimer`: SEED to `config.superJumpGrace` when a
 *      horizontal dash ENDS (`dashEndedThisTick`) OR when the actor LANDS after
 *      one (`landedThisTick`), provided the last dash was horizontal
 *      (`lastDashDirY === 0 && lastDashDirX !== 0`). Otherwise decay by `dt`
 *      (floored at 0). Both seeds are needed: a ground dash / hyper slide never
 *      produces a landing event (the actor stays physically supported while the
 *      collision resolver is bypassed, so `landedThisTick` is false at dash
 *      end), so the dash-end transition seeds it for those cases; the landing
 *      seed covers an air dash that touches down later. Seeding once instead of
 *      refreshing every grounded tick is essential — because `lastDashDirX/Y`
 *      persist after a horizontal dash, a per-tick refresh would hold the window
 *      open forever and turn every later plain grounded jump into a Super Jump.
 *   5. Phase 6 — REFILL `stamina` to `config.wallGrabMaxStamina` while the
 *      actor is supported (`onGround`). This is the SINGLE refill site (the
 *      wall-grab ability only DEPLETES via `locomotionPatch`); keeping refill
 *      here means deplete and refill each have exactly one owner. While airborne
 *      the pool carries unchanged (Celeste: stamina does not regen in the air).
 *
 * Pure: returns a fresh locomotion record. Absent slices leave their mirrors
 * unchanged.
 */
function finalizeLocomotion(
  locomotion: LocomotionState,
  abilities: Readonly<Record<string, AnyAbilityState>>,
  onGround: boolean,
  landedThisTick: boolean,
  dashEndedThisTick: boolean,
  config: PlatformerConfig,
  dt: number,
): LocomotionState {
  let next = syncLocomotionFromJump(locomotion, abilities);

  // Sync dash-direction + dashing flag from the dash slice.
  const dash = abilities['dash'] as DashAbilityState | undefined;
  let dirX = next.lastDashDirX;
  let dirY = next.lastDashDirY;
  let dashing = false;
  if (dash !== undefined && dash.kind === 'dash') {
    // Direction persists once captured (0/0 before any dash). Only overwrite
    // when a direction has actually been captured, so we never clobber a real
    // prior dash with the pre-dash 0/0.
    if (dash.dirX !== 0 || dash.dirY !== 0) {
      dirX = dash.dirX;
      dirY = dash.dirY;
    }
    dashing = dash.phase !== 'idle';
  }
  next = { ...next, lastDashDirX: dirX, lastDashDirY: dirY, dashing };

  // Maintain the super-jump ground-grace timer. SEED it once when a horizontal
  // dash ENDS or when the actor LANDS after one, then let it only decay. We
  // must NOT refresh it every grounded tick: because lastDashDirX/Y persist
  // after a horizontal dash, a per-tick refresh would hold the window open
  // forever and turn every later plain grounded jump into a Super Jump
  // ("dash → land → stand still → jump → you go flying"). The `!dashing` guard
  // on the landing seed avoids re-seeding on the same tick a dash is starting.
  const horizontalLastDash = dirY === 0 && dirX !== 0;
  const seedGrace =
    horizontalLastDash &&
    !dashing &&
    (dashEndedThisTick || landedThisTick);
  const superJumpGraceTimer = seedGrace
    ? config.superJumpGrace
    : Math.max(0, next.superJumpGraceTimer - dt);
  next = { ...next, superJumpGraceTimer };

  // Phase 6 — refill the wall-grab stamina pool to max while supported. This is
  // the ONLY refill site (deplete lives in `wallGrabAbility` via patch). The
  // `?? max` fallback covers hand-rolled states that omitted `stamina` (e.g. the
  // replay test's fixture); `createPlatformerState` always inits it.
  const carriedStamina = next.stamina ?? config.wallGrabMaxStamina;
  const stamina = onGround ? config.wallGrabMaxStamina : carriedStamina;
  next = { ...next, stamina };

  return next;
}

/**
 * Find the id of the wall solid that blocked horizontal motion. Returns
 * `null` if no solid caused the contact. The `id` field of the returned
 * object is `null` if the solid has no id assigned.
 *
 * The resolved body is flush against the wall; we look for the solid whose
 * trailing edge matches the body's leading edge with Y-range overlap.
 */
function findWallSolidId(
  resolvedBody: Rect,
  appliedVx: number,
  solids: readonly Solid[],
): { id: string | null; side: 'left' | 'right' } | null {
  if (appliedVx === 0) return null;
  const dir = Math.sign(appliedVx);
  for (const solid of solids) {
    if (solid.passthrough) continue;
    if (solid.spring !== undefined || solid.dashRefill) continue;
    const yOverlap =
      resolvedBody.y < solid.y + solid.height &&
      resolvedBody.y + resolvedBody.height > solid.y;
    if (!yOverlap) continue;
    if (dir > 0) {
      const touchingRight = Math.abs(resolvedBody.x + resolvedBody.width - solid.x) < 0.5;
      if (touchingRight) {
        return {
          id: typeof solid.id === 'string' ? solid.id : null,
          side: 'right',
        };
      }
    } else {
      const touchingLeft = Math.abs(resolvedBody.x - (solid.x + solid.width)) < 0.5;
      if (touchingLeft) {
        return {
          id: typeof solid.id === 'string' ? solid.id : null,
          side: 'left',
        };
      }
    }
  }
  return null;
}

/**
 * Attempt a horizontal step-up: when the body is flush against a wall (from
 * {@link resolveAxisX}), find the blocking solid and, if its top is a small step
 * (within `stepHeight` above the body's pre-move feet `prevBottom`), return the
 * target surface height and the X to advance to so the body rests on top.
 *
 * Conditions for a successful step (all must hold):
 *  - The blocking solid is fully solid (not passthrough, not ladder).
 *  - Its top is strictly above the feet (a real step up, not level ground) and
 *    within `stepHeight` of them.
 *  - There is headroom: lifting the body by the step height does not drive it
 *    into a ceiling solid.
 *  - The space above the step is clear horizontally (no solid blocks the body
 *    at its lifted height at the destination X), so the body can actually stand
 *    there.
 *
 * Returns `null` when the wall is too tall to step, the body is unsupported, or
 * the destination is obstructed — in which case the caller treats it as a real
 * wall. Pure: never mutates inputs.
 *
 * @param resolvedBody - Body rect flush against the wall (post-X-resolve).
 * @param appliedVx    - Horizontal delta this tick (sign = direction). `0` → no step.
 * @param prevBottom   - Body's feet Y before this tick's movement.
 * @param stepHeight   - Max step-up height; the caller gates on `> 0`.
 * @param solids       - Collision surfaces.
 */
function tryStepUp(
  resolvedBody: Rect,
  appliedVx: number,
  prevBottom: number,
  stepHeight: number,
  solids: readonly Solid[],
): { top: number; advanceTo: number } | null {
  if (appliedVx === 0) return null;
  const dir = Math.sign(appliedVx);

  // 1. Find the blocking solid: flush against the body's leading edge with
  //    Y-range overlap. (Same contact test as findWallSolidId.)
  let blocking: Solid | null = null;
  for (const solid of solids) {
    if (solid.passthrough || solid.ladder) continue;
    if (solid.spring !== undefined || solid.dashRefill) continue;
    const yOverlap =
      resolvedBody.y < solid.y + solid.height &&
      resolvedBody.y + resolvedBody.height > solid.y;
    if (!yOverlap) continue;
    const touching = dir > 0
      ? Math.abs(resolvedBody.x + resolvedBody.width - solid.x) < 0.5
      : Math.abs(resolvedBody.x - (solid.x + solid.width)) < 0.5;
    if (touching) {
      blocking = solid;
      break;
    }
  }
  if (blocking === null) return null;

  // 2. The step top must be above the feet (a real step up) and within
  //    stepHeight. +Y is down, so "above" means stepTop < prevBottom; the rise
  //    height is prevBottom - stepTop (positive when stepping up). A wall whose
  //    top is at/below the feet isn't a step (level ground or lower).
  const stepTop = blocking.y;
  const rise = prevBottom - stepTop;
  if (rise <= 0 || rise > stepHeight) return null;

  // 3. Advance X just past the step's leading edge so the body rests on top.
  //    A full body-width past the edge guarantees the body is wholly on the
  //    surface (no longer straddling the lip), which the Y resolve then lands.
  const advanceTo = dir > 0 ? blocking.x + resolvedBody.width : blocking.x + blocking.width - resolvedBody.width;

  // 4. Headroom + destination clearance: the body lifted onto the step must not
  //    overlap any solid at its new position. Check the lifted rect.
  const lifted = {
    x: advanceTo,
    y: stepTop - resolvedBody.height,
    width: resolvedBody.width,
    height: resolvedBody.height,
  };
  for (const solid of solids) {
    if (solid.passthrough || solid.ladder) continue;
    if (solid.spring !== undefined || solid.dashRefill) continue;
    if (
      lifted.x < solid.x + solid.width &&
      lifted.x + lifted.width > solid.x &&
      lifted.y < solid.y + solid.height &&
      lifted.y + lifted.height > solid.y
    ) {
      return null;
    }
  }

  return { top: stepTop, advanceTo };
}

/**
 * Find the id of the floor solid that the body landed on. Returns `null` if
 * no solid caused the contact or the solid has no id assigned. Honors the
 * passthrough rule: the body must have been above the platform last tick.
 */
function findGroundSolidId(
  resolvedBody: Rect,
  appliedVy: number,
  solids: readonly Solid[],
  prevBottom: number,
): string | null {
  if (appliedVy <= 0) return null;
  for (const solid of solids) {
    if (solid.passthrough) {
      if (prevBottom > solid.y) continue;
    }
    if (solid.spring !== undefined || solid.dashRefill) continue;
    const bodyBottomTouching = Math.abs(resolvedBody.y + resolvedBody.height - solid.y) < 0.5;
    if (!bodyBottomTouching) continue;
    const xOverlap =
      resolvedBody.x < solid.x + solid.width &&
      resolvedBody.x + resolvedBody.width > solid.x;
    if (!xOverlap) continue;
    return typeof solid.id === 'string' ? solid.id : null;
  }
  return null;
}

/**
 * Find the id of the ceiling solid the body bumped from below. Returns `null`
 * if no solid caused the contact or the solid has no id assigned.
 */
function findCeilingSolidId(
  resolvedBody: Rect,
  appliedVy: number,
  solids: readonly Solid[],
): string | null {
  if (appliedVy >= 0) return null;
  for (const solid of solids) {
    if (solid.passthrough) continue;
    if (solid.spring !== undefined || solid.dashRefill) continue;
    const bodyTopTouching = Math.abs(resolvedBody.y - (solid.y + solid.height)) < 0.5;
    if (!bodyTopTouching) continue;
    const xOverlap =
      resolvedBody.x < solid.x + solid.width &&
      resolvedBody.x + resolvedBody.width > solid.x;
    if (!xOverlap) continue;
    return typeof solid.id === 'string' ? solid.id : null;
  }
  return null;
}

// ---------------------------------------------------------------------
// Phase 7 — corner-correction + wall-speed-retention helpers.
//
// All three mechanisms (upward CC, dash CC, wall-speed retention) are
// COLLISION-TIME adjustments inside Step 6. They use pure geometry
// (probeWall / aabbOverlap) for clearance tests — NEVER last-tick contacts
// (which clear when vx=0 and would defeat the whole point, the same §0e
// lesson wall-grab learned). Pure + deterministic.
// ---------------------------------------------------------------------

/**
 * Whether `body` overlaps any BLOCKING solid (non-passthrough, non-ladder) in
 * `solids`, via strict {@link aabbOverlap}. Used by both CC systems' clearance
 * tests: a nudged position is only accepted if it is free of ALL blocking
 * solids (not just the one that caused the corner), so CC never teleports the
 * body into another wall. Pure: never mutates inputs.
 */
function overlapsAnyBlocking(body: Rect, solids: readonly Solid[]): boolean {
  for (const solid of solids) {
    if (solid.passthrough || solid.ladder) continue;
    if (solid.spring !== undefined || solid.dashRefill) continue;
    if (aabbOverlap(body, solid)) return true;
  }
  return false;
}

/**
 * Sweep the body along one axis in 1px steps, trying each direction in `order`
 * up to `tolerance` px, and return the first signed offset at which the body
 * does NOT overlap any blocking solid. Used by both CC systems (upward CC
 * sweeps X; dash CC sweeps Y) — the shared 1px-step clearance sweep the
 * roadmap specifies. Returns `null` if no clear position is found within
 * tolerance.
 *
 * Axis choice: `'x'` offsets the body horizontally (upward CC slipping
 * sideways around a ceiling corner); `'y'` offsets vertically (dash CC
 * slipping a horizontal dash past a wall lip). The `order` parameter controls
 * which direction is tried first (upward CC prefers the input/facing side;
 * dash CC prefers up-then-down, Celeste `Player.cs:2511,2524`).
 *
 * Pure: never mutates inputs; a pure function of geometry.
 */
function findClearanceOffset(
  base: Rect,
  axis: 'x' | 'y',
  tolerance: number,
  order: readonly number[],
  solids: readonly Solid[],
): number | null {
  if (tolerance <= 0) return null;
  for (const dir of order) {
    for (let step = 1; step <= tolerance; step++) {
      const offset = dir * step;
      const candidate: Rect =
        axis === 'x'
          ? { x: base.x + offset, y: base.y, width: base.width, height: base.height }
          : { x: base.x, y: base.y + offset, width: base.width, height: base.height };
      if (!overlapsAnyBlocking(candidate, solids)) return offset;
    }
  }
  return null;
}

/**
 * Upward corner correction (Phase 7 — Celeste `UpwardCornerCorrection = 4`,
 * `Player.cs:2591, 2603`). When the actor is rising and a horizontal nudge
 * would let it slip past a ceiling/wall corner, sweep the body horizontally by
 * up to `tolerance` px (in 1px steps) to a position where the upward move no
 * longer collides. Returns the cleared X position, or `null` if no clear
 * position exists within tolerance.
 *
 * The body is tested at the FULL would-be upward position `targetY` (NOT the
 * ceiling-snapped position) so the clearance reflects where the body would
 * actually land if it continued rising. The sweep tries the preferred direction
 * first (input.moveX, else facing), then the opposite — Celeste tries the
 * input/facing side first so a deliberate corner-aim feels responsive.
 *
 * Pure: a pure geometry query; never mutates inputs.
 *
 * @param nextX        - Body's resolved X (post-resolveAxisX, flush against any wall).
 * @param targetY      - The would-be upward Y (core.y + appliedVy) the body wants.
 * @param width        - Body width.
 * @param height       - Body height.
 * @param preferredDir - Direction to try first (`+1` or `-1`).
 * @param tolerance    - Max nudge in px (upwardCornerCorrection).
 * @param solids       - Collision surfaces.
 */
function tryUpwardCornerCorrection(
  nextX: number,
  targetY: number,
  width: number,
  height: number,
  preferredDir: number,
  tolerance: number,
  solids: readonly Solid[],
): number | null {
  const base: Rect = { x: nextX, y: targetY, width, height };
  const offset = findClearanceOffset(base, 'x', tolerance, [preferredDir, -preferredDir], solids);
  return offset === null ? null : nextX + offset;
}

/**
 * Dash corner correction (Phase 4d/7 — Celeste `DashCornerCorrection = 4`,
 * `Player.cs:2408, 2511, 2524, 2668, 2682`). During a dash, when the dashing
 * actor hits a wall, sweep the body PERPENDICULAR to the dash's primary axis by
 * up to `tolerance` px to find a position where the dash can continue past the
 * corner. Returns the cleared position `{ x, y }`, or `null`.
 *
 * Axis choice (documented per the roadmap's "keep it simple" note): for a
 * horizontal dash (`dashDirX !== 0`, the common case) the dash moves primarily
 * along X, so the perpendicular nudge is along Y — slipping the body vertically
 * past a horizontal lip in the wall. Celeste tries UP first, then DOWN
 * (`Player.cs:2511,2524`), and so do we. For a vertical dash (`dashDirX === 0`,
 * `dashDirY !== 0`) the perpendicular nudge is along X; we try the facing side
 * first then its opposite (the spec allows any documented choice — the vertical-
 * dash case is rare and not exercised by the test suite).
 *
 * The body is tested at the FULL would-be horizontal target `core.x + appliedVx`
 * (past the wall) so the clearance reflects whether the dash could actually
 * continue. If a clear perpendicular position is found, the caller snaps the
 * body there and clears the wall-block so the dash velocity is preserved.
 *
 * Pure: a pure geometry query; never mutates inputs.
 *
 * @param coreX        - Body's pre-resolve X (core.x, before resolveAxisX).
 * @param coreY        - Body's pre-resolve Y (core.y).
 * @param appliedVx    - Horizontal delta this tick (the dash's intended X move).
 * @param appliedVy    - Vertical delta this tick (the dash's intended Y move).
 * @param width        - Body width.
 * @param height       - Body height.
 * @param facing       - Body facing (`+1` or `-1`); drives vertical-dash X-nudge order.
 * @param dashDirX     - Captured dash direction X (`-1`/`0`/`+1`); selects the nudge axis.
 * @param tolerance    - Max nudge in px (dashCornerCorrection).
 * @param solids       - Collision surfaces.
 */
function tryDashCornerCorrection(
  coreX: number,
  coreY: number,
  appliedVx: number,
  appliedVy: number,
  width: number,
  height: number,
  facing: 1 | -1,
  dashDirX: number,
  tolerance: number,
  solids: readonly Solid[],
): { x: number; y: number } | null {
  if (tolerance <= 0) return null;
  // Horizontal dash → nudge Y (the dash slips vertically past a wall lip).
  // Vertical dash → nudge X (slips horizontally past a ceiling/floor lip).
  // For a diagonal dash (both axes non-zero) we treat it as horizontal
  // (dashDirX !== 0) and nudge Y — the dominant-case behavior.
  if (dashDirX !== 0) {
    // Horizontal dash: body would be at (coreX + appliedVx, coreY). Sweep Y.
    const targetX = coreX + appliedVx;
    const base: Rect = { x: targetX, y: coreY, width, height };
    // Celeste order: up (negative) first, then down (positive).
    const offsetY = findClearanceOffset(base, 'y', tolerance, [-1, 1], solids);
    if (offsetY === null) return null;
    return { x: targetX, y: coreY + offsetY };
  }
  // Vertical dash: body would be at (coreX, coreY + appliedVy). Sweep X.
  const targetY = coreY + appliedVy;
  const base: Rect = { x: coreX, y: targetY, width, height };
  // Try facing side first, then opposite (documented choice for the rare
  // vertical-dash case).
  const order: readonly number[] = [facing, -facing];
  const offsetX = findClearanceOffset(base, 'x', tolerance, order, solids);
  if (offsetX === null) return null;
  return { x: coreX + offsetX, y: targetY };
}
