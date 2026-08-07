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
import { createJumpState } from '../animation/jump';
import {
  EMPTY_CONTACTS,
  EMPTY_EVENTS,
  DEFAULT_PLATFORMER_CONFIG,
  DEFAULT_PLAYER_WIDTH,
  DEFAULT_PLAYER_HEIGHT,
} from './constants';
import { createRidingTracker, type SolidDisplacementProvider } from './riding-tracker';
import { defaultPrecisionPipeline } from './pipelines';
import type {
  AbilityContext,
  AbilityProcessor,
  AnyAbilityState,
  ActorCore,
  ClimbAbilityState,
  Contacts,
  DashAbilityState,
  DoubleJumpAbilityState,
  JumpAbilityState,
  PlatformerConfig,
  PlatformerEvents,
  PlatformerInput,
  PlatformerState,
  WallSlideAbilityState,
  WritablePlatformerEvents,
} from './types';

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
    wallSlide: makeInitialWallSlideState(),
    dash: makeInitialDashState(config),
    doubleJump: makeInitialDoubleJumpState(config),
  };

  return {
    core,
    abilities,
    events: EMPTY_EVENTS,
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

      // Steps 3/4 — Process inputs (read inside each ability) + execute
      // abilities in pipeline order.
      for (const proc of pipeline) {
        const stateSlice = abilities[proc.kind];
        if (stateSlice === undefined) continue;

        const ctx: AbilityContext = { core, input, dt, config, solids };
        const result = proc.advance(ctx, stateSlice as never);
        core = result.core;
        abilities = { ...abilities, [proc.kind]: result.state };
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

      // Horizontal input → vx (applied AFTER abilities so abilities like dash
      // can override). Per the decision's update order, this is part of
      // "process inputs" but is applied here so dash's velocity override is
      // not immediately clobbered. Skipped during dash (dash owns velocity
      // entirely) but NOT during climb — climb owns only vertical motion, so
      // the player can still walk off a ladder.
      const dashActive = isDashActive(abilities);
      const climbActive = isClimbActive(abilities);
      if (!dashActive) {
        core = applyHorizontalInput(core, input, config);
      }

      // Step 5 — Integrate forces (gravity; skip during dash or active climb).
      if (!dashActive && !climbActive) {
        let nextVy = core.vy + config.gravity * dt;
        const terminalSpeed = Math.abs(config.maxFallSpeed);
        if (config.gravity < 0) nextVy = Math.max(nextVy, -terminalSpeed);
        else nextVy = Math.min(nextVy, terminalSpeed);
        core = { ...core, vy: nextVy };
      }

      // Climb coordination: while climbing, the ladder is authoritative for
      // vertical motion. Restore the climb-authoritative Y (the climb ability
      // already set `core.vy`; jump's internal gravity moved Y during the
      // pipeline, so the position must be restored too) and reset the jump
      // state to grounded so it neither accumulates internal falling gravity
      // nor needs a slow landing→grounded recovery on exit. This mirrors the
      // dash bypass above and is what keeps climb and jump from desyncing.
      if (climbActive) {
        core = { ...core, y: startCoreY + core.vy * dt };
        abilities = { ...abilities, jump: makeInitialJumpState(config) };
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
        !dashActive &&
        (core.onGround || climbActive)
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
      // Re-derive nextVx from the (possibly step-up-cleared) hitWall so a
      // successful step keeps the player walking instead of zeroing vx.
      const resolvedVx = hitWall ? 0 : core.vx;

      const ry = resolveAxisY(
        { x: nextX, y: core.y, width: core.width, height: core.height },
        appliedVy,
        solids,
        prevBottom,
      );

      const nextY = ry.y;
      // resolveAxisY was passed `appliedVy` (= core.vy * dt), so its returned
      // `vy` is in per-tick delta units. Preserve canonical px/s vy unless the
      // actor landed or hit a ceiling (then zero it). Same reasoning as nextVx.
      const nextVy = (ry.landed || ry.hitCeiling) ? 0 : core.vy;
      let groundId: string | null = null;
      let ceilingId: string | null = null;
      if (ry.landed) {
        groundId = findGroundSolidId(
          { x: nextX, y: nextY, width: core.width, height: core.height },
          appliedVy,
          solids,
          prevBottom,
        );
      }
      if (ry.hitCeiling) {
        ceilingId = findCeilingSolidId(
          { x: nextX, y: nextY, width: core.width, height: core.height },
          appliedVy,
          solids,
        );
      }

      const contacts: Contacts = {
        groundId,
        leftWallId,
        rightWallId,
        ceilingId,
      };

      // Step 7 — Update contacts & events.
      const nowOnGround = invertedGravity ? ry.hitCeiling : ry.landed;
      if (nowOnGround && !wasOnGround) {
        events.justLanded = true;
      }
      if (ry.hitCeiling) {
        events.hitCeiling = true;
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

      return {
        state: {
          core,
          abilities,
          events,
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
  return { kind: 'wallSlide', sliding: false, side: null, lockTimer: 0 };
}

/**
 * Build the initial `DashAbilityState`. Dashes start ready (full budget,
 * zero timers).
 */
function makeInitialDashState(config: Readonly<PlatformerConfig>): DashAbilityState {
  return {
    kind: 'dash',
    timer: 0,
    cooldown: 0,
    dashesRemaining: config.dashEnabled ? config.maxDashes : 0,
    dirX: 0,
    dirY: 0,
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
 * Apply horizontal input → core.vx. On the ground: snaps to `±moveSpeed`
 * instantly. In the air: ramps toward target by `airControl` fraction per tick
 * (weighted, not snappy). Updates `facing` only when there is active input.
 *
 * Pure: returns a shallow-copied new core.
 */
function applyHorizontalInput(
  core: ActorCore,
  input: PlatformerInput,
  config: PlatformerConfig,
): ActorCore {
  const targetVx = input.moveX * config.moveSpeed;
  if (core.onGround) {
    if (input.moveX === 0) return { ...core, vx: 0 };
    const facing: 1 | -1 = input.moveX > 0 ? 1 : -1;
    return { ...core, vx: targetVx, facing };
  }

  if (input.moveX === 0) return core;
  const rampedVx = core.vx + (targetVx - core.vx) * config.airControl;
  const facing: 1 | -1 = input.moveX > 0 ? 1 : -1;
  return { ...core, vx: rampedVx, facing };
}

/**
 * Check if the dash ability is currently active (timer > 0). When active, the
 * kernel skips horizontal-input application and gravity integration so the
 * dash's velocity override wins for its full duration.
 */
function isDashActive(abilities: Readonly<Record<string, AnyAbilityState>>): boolean {
  const dash = abilities['dash'] as DashAbilityState | undefined;
  return dash !== undefined && dash.timer > 0;
}

/**
 * Whether the climb ability is actively climbing this tick (its body overlaps
 * a ladder and it isn't jumping). The kernel uses this to coordinate: skip
 * gravity + horizontal input, restore the climb-authoritative Y, and reset the
 * jump state — mirroring the `isDashActive` bypass above. Read from the
 * post-ability `climbing` flag.
 */
function isClimbActive(abilities: Readonly<Record<string, AnyAbilityState>>): boolean {
  const climb = abilities['climb'] as ClimbAbilityState | undefined;
  return climb !== undefined && climb.climbing;
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
