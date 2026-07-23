/**
 * Showcase-local death feedback lifecycle helpers.
 *
 * Pure deterministic helpers for the death feedback pipeline. NOT a public
 * engine export — this module lives in the showcase and is consumed only by
 * `sections/playground.ts`. The consumer composes these helpers with engine
 * primitives (hit-stop, particles, shake, flash, pop-scale) to produce the
 * full death feedback sequence.
 *
 * Locked values from `docs/design/minimalist-death-feedback-decision.md`:
 * Stack A (Temporal Freeze & Kinetic Burst).
 *
 * All exports are pure: inputs are never mutated, fresh records returned,
 * never throws on any input. Deterministic-core layer.
 *
 * @module
 */

import { volumeScale } from '../../src/animation/squash-stretch';
import type { Scale2D } from '../../src/animation/squash-stretch';

// ─── Death Reason ──────────────────────────────────────────────────────────

/**
 * How the player died. The consumer passes this to {@link beginDeath}.
 *
 * - `'enemy'` — contact with an enemy.
 * - `'projectile'` — hit by a projectile.
 * - `'fall'` — fell off the world.
 */
export type DeathReason = 'enemy' | 'projectile' | 'fall';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Total ticks of the dying phase. At tick {@link DEATH_ANIM_TICKS}, respawn fires. */
export const DEATH_ANIM_TICKS = 15;

/** Hit-stop freeze duration on death (ticks). */
export const DEATH_HIT_STOP_TICKS = 6;

/** Particle count for the death radial burst (default motion). */
export const DEATH_PARTICLE_COUNT = 16;

/** Particle count for the death radial burst (reduced motion — halved). */
export const DEATH_PARTICLE_COUNT_REDUCED = 8;

/** Screen-shake amplitude on death (default motion). */
export const DEATH_SHAKE_AMPLITUDE = 6;

/** Screen-shake duration on death (ticks, default motion). */
export const DEATH_SHAKE_DURATION = 10;

/** Flash overlay duration on death (ticks, default motion). */
export const DEATH_FLASH_DURATION_TICKS = 3;

/** Respawn pop-scale spring recovery duration (ticks). */
export const DEATH_RESPAWN_POP_TICKS = 8;

/** Initial squash on respawn (volumeScale delta — negative = squash). */
export const DEATH_POP_INITIAL_DELTA = -0.3;

/** Flash overlay color. */
export const DEATH_FLASH_COLOR = '#ffffff';

/** Particle speed for the death radial burst. */
export const DEATH_PARTICLE_SPEED = 4;

/** Particle size for the death radial burst. */
export const DEATH_PARTICLE_SIZE = 3;

/** Particle life for the death radial burst (ticks). */
export const DEATH_PARTICLE_LIFE = 20;

/** Particle drag for the death radial burst. */
export const DEATH_PARTICLE_DRAG = 0.96;

/** Seeded RNG seed for deterministic particle jitter. */
export const DEATH_RNG_SEED = 42;

/** Death particle fill color. */
export const DEATH_PARTICLE_COLOR = '#ff4444';

// ─── Death State ───────────────────────────────────────────────────────────

/**
 * Complete death lifecycle state. Immutable — every transition returns a
 * fresh record.
 *
 * The consumer stores this alongside its own game state and passes it to
 * the pure helpers each tick.
 */
export interface DeathState {
  /** How the player died. */
  readonly reason: DeathReason;
  /**
   * Current tick within the dying phase.
   * `0` = death onset (one-shot effects fire).
   * `1..14` = dying (effects advancing).
   * `15` = respawn edge ({@link shouldRespawn} returns `true`).
   * Never exceeds {@link DEATH_ANIM_TICKS}.
   */
  readonly tick: number;
  /** Player center X at the moment of death (world px). */
  readonly deathX: number;
  /** Player center Y at the moment of death (world px). */
  readonly deathY: number;
  /**
   * Impact direction X component.
   * `-1` = hit from left, `0` = neutral (fall), `1` = hit from right.
   * Used to bias particle burst direction.
   */
  readonly impactDirX: number;
  /**
   * Impact direction Y component.
   * `-1` = hit from above, `0` = neutral, `1` = hit from below.
   */
  readonly impactDirY: number;
}

// ─── Operations ────────────────────────────────────────────────────────────

/**
 * Begin a death sequence. Creates a fresh {@link DeathState} at tick 0.
 *
 * **One-shot guard:** the consumer must check {@link isDying} before calling
 * this. If the player is already dying, repeated hits must NOT retrigger —
 * the consumer skips the call and the existing death state continues.
 *
 * @example
 * ```ts
 * if (deathState === null || !isDying(deathState)) {
 *   deathState = beginDeath('enemy', player.x + w/2, player.y + h/2, -1, 0);
 * }
 * ```
 *
 * @param reason - how the player died
 * @param deathX - player center X at death (world px)
 * @param deathY - player center Y at death (world px)
 * @param impactDirX - impact direction X (-1, 0, or 1)
 * @param impactDirY - impact direction Y (-1, 0, or 1)
 * @returns a fresh {@link DeathState} at tick 0
 */
export function beginDeath(
  reason: DeathReason,
  deathX: number,
  deathY: number,
  impactDirX: number,
  impactDirY: number,
): DeathState {
  return {
    reason,
    tick: 0,
    deathX,
    deathY,
    impactDirX,
    impactDirY,
  };
}

/**
 * Advance the death state by one tick.
 *
 * Increments `tick` by 1, clamped to {@link DEATH_ANIM_TICKS}. Once at
 * {@link DEATH_ANIM_TICKS}, further calls are a no-op (returns an equal
 * record). All other fields are preserved.
 *
 * Pure: returns a fresh {@link DeathState}; never mutates input.
 *
 * @param state - current death state
 * @returns a new state with `tick` incremented (clamped)
 */
export function advanceDeath(state: DeathState): DeathState {
  const nextTick = state.tick >= DEATH_ANIM_TICKS ? DEATH_ANIM_TICKS : state.tick + 1;
  if (nextTick === state.tick) return { ...state };
  return { ...state, tick: nextTick };
}

/**
 * Whether the dying phase is complete and the player should respawn.
 *
 * Returns `true` when `tick >= DEATH_ANIM_TICKS` (i.e. tick is 15).
 *
 * @param state - current death state
 * @returns `true` if the player should respawn this tick
 */
export function shouldRespawn(state: DeathState): boolean {
  return state.tick >= DEATH_ANIM_TICKS;
}

/**
 * Linear progress through the dying phase: `tick / DEATH_ANIM_TICKS`.
 *
 * Returns `0` at tick 0, `1` at tick {@link DEATH_ANIM_TICKS}.
 *
 * @param state - current death state
 * @returns progress in `[0, 1]`
 */
export function deathProgress(state: DeathState): number {
  return state.tick / DEATH_ANIM_TICKS;
}

/**
 * Whether the player is currently in the dying phase.
 *
 * Returns `true` for `tick < DEATH_ANIM_TICKS` (ticks 0–14).
 * Returns `false` at tick {@link DEATH_ANIM_TICKS} (respawn edge).
 *
 * The consumer uses this to guard against retriggering death effects:
 * ```ts
 * if (!isDying(deathState)) { deathState = beginDeath(...); }
 * ```
 *
 * @param state - current death state
 * @returns `true` if the player is dying (not yet respawned)
 */
export function isDying(state: DeathState): boolean {
  return state.tick < DEATH_ANIM_TICKS;
}

/**
 * Whether this tick is the one-shot trigger tick (tick 0).
 *
 * The consumer fires hit-stop, particle burst, shake, and audio exactly
 * once when this returns `true`.
 *
 * @param state - current death state
 * @returns `true` if `tick === 0`
 */
export function isOneShotTick(state: DeathState): boolean {
  return state.tick === 0;
}

/**
 * Whether the screen flash should be rendered this tick.
 *
 * Returns `true` for ticks 0–2 (the first {@link DEATH_FLASH_DURATION_TICKS}
 * ticks) under default motion. Returns `false` for all ticks under reduced
 * motion.
 *
 * @param state - current death state
 * @param reducedMotion - accessibility flag
 * @returns `true` if the flash overlay should be drawn
 */
export function shouldFlash(state: DeathState, reducedMotion: boolean): boolean {
  if (reducedMotion) return false;
  return state.tick < DEATH_FLASH_DURATION_TICKS;
}

/**
 * Flash overlay alpha for the current tick.
 *
 * Linear decay from `1` (tick 0) to `0` (tick {@link DEATH_FLASH_DURATION_TICKS}
 * and beyond). This function is motion-agnostic — the consumer gates the
 * entire flash via {@link shouldFlash}.
 *
 * @param state - current death state
 * @returns alpha in `[0, 1]`
 */
export function flashAlpha(state: DeathState): number {
  if (state.tick >= DEATH_FLASH_DURATION_TICKS) return 0;
  return 1 - state.tick / DEATH_FLASH_DURATION_TICKS;
}

/**
 * Respawn pop-scale spring recovery helper.
 *
 * Returns a volume-preserving `Scale2D` that starts at
 * {@link DEATH_POP_INITIAL_DELTA} (squash) and exponentially recovers to
 * identity (1, 1) over {@link DEATH_RESPAWN_POP_TICKS} ticks.
 *
 * @param tick - ticks since respawn (0 = first respawn tick)
 * @returns volume-preserving scale pair
 */
export function respawnPopScale(tick: number): Scale2D {
  if (DEATH_RESPAWN_POP_TICKS <= 0) return volumeScale(0);
  const decay = Math.exp(-4 * tick / DEATH_RESPAWN_POP_TICKS);
  const delta = DEATH_POP_INITIAL_DELTA * decay;
  return volumeScale(delta);
}
