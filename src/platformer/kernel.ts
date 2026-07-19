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
      const wasOnGround = state.core.onGround;

      // Step 2 — Carry actors (apply solid displacement from previous tick's
      // groundId BEFORE ability processing).
      let core = tracker.applyCarry(state.core, getDisp);

      // Shallow-clone the abilities record so the input state's record is not
      // mutated; ability slices are replaced as we iterate.
      let abilities: Record<string, AnyAbilityState> = { ...state.abilities };

      // Start from empty events; abilities and collision add to this.
      const events: WritablePlatformerEvents = { ...EMPTY_EVENTS };

      // Steps 3/4 — Process inputs (read inside each ability) + execute
      // abilities in pipeline order.
      for (const proc of pipeline) {
        const stateSlice = abilities[proc.kind];
        if (stateSlice === undefined) continue;

        const ctx: AbilityContext = { core, input, dt, config };
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
      // not immediately clobbered.
      const dashActive = isDashActive(abilities);
      if (!dashActive) {
        core = applyHorizontalInput(core, input, config);
      }

      // Step 5 — Integrate forces (gravity; skip during dash).
      if (!dashActive) {
        let nextVy = core.vy + config.gravity * dt;
        if (nextVy > config.maxFallSpeed) nextVy = config.maxFallSpeed;
        core = { ...core, vy: nextVy };
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
      const nextVx = rx.hitWall ? 0 : core.vx;
      let leftWallId: string | null = null;
      let rightWallId: string | null = null;
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
      const nowOnGround = ry.landed;
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
        vx: nextVx,
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
