import type { ConeConfig } from './cone';

/**
 * Tuned ONE-SHOT burst effect presets — game-feel moments, not emitters.
 *
 * {@link presets} ships continuous EMITTER recipes (lava, water — ambient
 * scenery looping forever). This module ships the other half: the discrete
 * bursts a platformer fires on a feel moment — the dash trail, the landing
 * dust, the pickup sparkle, the death shatter — where the defect history
 * lives. Two shipped consumer games each authored these by hand and each
 * shipped the SAME defect: speeds written in px/s against the px/tick solver
 * (a dash trail at `14` reading as 840 px/s, dust crossing the room in three
 * frames). Tuned constants end the authoring: spread the preset, supply the
 * position and the seeded `rng`, and the units are correct by construction.
 *
 * ## Units (the lesson, twice paid for)
 *
 * Everything here is TICK units and pairs with {@link DEFAULT_PARTICLE_AIR}
 * under `stepSeconds`/`advanceSeconds` (seconds dt in, one tick out at 60 Hz):
 * `speed`/`speedMin`/`speedMax` are **px/tick**, `life` is **ticks**, and the
 * `gravityScale`/`dragScale` multipliers compose with the AIR medium
 * (`{ gravity: 0.1, drag: 0.9 }`) — a `dragScale` above `~1.11` MULTIPLIES
 * velocity (drag × scale > 1) instead of dragging. Every value below was
 * played in a shipped build and stays under it.
 *
 * @example
 * ```ts
 * import { spawn, stepSeconds, DEFAULT_PARTICLE_AIR, DASH_TRAIL_EFFECT, mulberry32 } from 'aicraft-engine';
 *
 * const rng = mulberry32(0xce1e5);
 * let trail: Particle[] = [];
 * // per dash tick:
 * trail = [...trail, ...spawn(px, py, { ...DASH_TRAIL_EFFECT, rng })];
 * // per fixed step (seconds dt):
 * trail = stepSeconds(trail, dt, DEFAULT_PARTICLE_AIR);
 * ```
 */

/**
 * A radial burst effect: spread into {@link spawn}'s options (add only `rng`
 * when the preset jitters). `speed` is px/tick; `life` is ticks.
 */
export interface RadialBurstEffect {
  readonly count: number;
  readonly speed: number;
  readonly speedJitter: number;
  readonly life: number;
  readonly size: number;
  readonly color: string;
  readonly colorEnd?: string;
  readonly gravityScale?: number;
  readonly dragScale?: number;
}

/**
 * A directed cone burst effect (dust kicked up, sweat thrown off): sample each
 * mote's velocity with {@link sampleConeVelocity} over `cone`, then build the
 * particle with `life`/`size`/`color`/`colorEnd` and the physics scales.
 * `speedMin`/`speedMax` are px/tick.
 */
export interface ConeBurstEffect {
  readonly count: number;
  readonly cone: ConeConfig;
  readonly life: number;
  readonly size: number;
  readonly color: string;
  readonly colorEnd?: string;
  readonly gravityScale?: number;
  readonly dragScale?: number;
}

/**
 * Dash trail — a dense wake of ice-bright motes parked where the dash passed.
 * `speed 0.25` px/tick is deliberately near-still under air drag, and the wake
 * is weightless (`gravityScale: 0`): the trail MARKS the path while the body
 * moves on (a fast or falling trail chases the player and reads as exhaust).
 * 30-tick life so the wake stays readable at dash speed.
 */
export const DASH_TRAIL_EFFECT: RadialBurstEffect = {
  count: 6,
  speed: 0.25,
  speedJitter: 0.5,
  life: 30,
  size: 2,
  color: '#e6f4ff',
  gravityScale: 0,
};

/**
 * Landing dust, soft touchdown — a buoyant puff that HANGS at the feet.
 * `gravityScale: -0.15` makes motes drift up as they die (dust floats, it does
 * not arc); under air drag the ~0.35–0.7 px/tick cone spends its kick within
 * ~10 ticks and the puff dissolves in place. Color fades to `colorEnd` as each
 * mote dies (see `particleColorAt`).
 */
export const LANDING_DUST_EFFECT: ConeBurstEffect = {
  count: 8,
  cone: { baseAngle: -Math.PI / 2, spread: Math.PI * 1.1, speedMin: 0.35, speedMax: 0.7 },
  life: 34,
  size: 2,
  color: '#cfd8ea',
  colorEnd: '#8a94ad',
  gravityScale: -0.15,
};

/**
 * Landing dust, hard touchdown — more motes, one size up, a wider, harder
 * cone. Same buoyant hang as {@link LANDING_DUST_EFFECT}; fire on the engine's
 * `landing` feel moment with `hard: true` (never a hand-rolled velocity
 * threshold).
 */
export const LANDING_DUST_HARD_EFFECT: ConeBurstEffect = {
  count: 16,
  cone: { baseAngle: -Math.PI / 2, spread: Math.PI * 1.1, speedMin: 0.35, speedMax: 0.95 },
  life: 34,
  size: 3,
  color: '#cfd8ea',
  colorEnd: '#8a94ad',
  gravityScale: -0.15,
};

/**
 * Pickup sparkle — a short ring of light around the collectible. Slight
 * downward drift (`gravityScale: 0.35`) reads as confetti falling away; the
 * low speed keeps the burst INSIDE the pickup's silhouette-plus-halo instead
 * of shooting across the tile.
 */
export const PICKUP_SPARKLE_EFFECT: RadialBurstEffect = {
  count: 8,
  speed: 1.0,
  speedJitter: 0.5,
  life: 22,
  size: 2,
  color: '#ffd9e8',
  gravityScale: 0.35,
};

/**
 * Ambient collectible twinkle — ONE weightless mote on a slow period (the
 * game staggers the period by collectible id so a room's gems do not twinkle
 * in lockstep). `gravityScale: 0` and near-still speed: a twinkle hangs on the
 * gem, it never leaves it.
 */
export const GEM_AMBIENT_SPARKLE_EFFECT: RadialBurstEffect = {
  count: 1,
  speed: 0.15,
  speedJitter: 0.6,
  life: 26,
  size: 1,
  color: '#ffeef6',
  gravityScale: 0,
};

/**
 * Death shatter — a hard ring of red/white motes with a slight upward bias.
 * The fastest sanctioned effect (jitter peaks near ~2.6 px/tick): enough to
 * read as violence, not enough to cross a one-screen room.
 */
export const DEATH_BURST_EFFECT: RadialBurstEffect = {
  count: 24,
  speed: 1.6,
  speedJitter: 0.6,
  life: 40,
  size: 2,
  color: '#ff5a5a',
  gravityScale: 0.6,
};

/**
 * Respawn flash — a cyan ring that blooms out and fades. Buoyant
 * (`gravityScale: -0.2`) so the ring drifts up like vapor as the body
 * materializes.
 */
export const RESPAWN_FLASH_EFFECT: RadialBurstEffect = {
  count: 16,
  speed: 1.2,
  speedJitter: 0.35,
  life: 26,
  size: 2,
  color: '#9fe8ff',
  gravityScale: -0.2,
};

/**
 * Stamina sweat — a single drop thrown downward-off the gripping body.
 * `gravityScale: 1.2` beats the air medium's gravity so the drop FALLS (effort
 * dripping away); the narrow cone keeps it inside a body-width.
 */
export const SWEAT_DROP_EFFECT: ConeBurstEffect = {
  count: 1,
  cone: { baseAngle: Math.PI / 2, spread: 0.8, speedMin: 0.15, speedMax: 0.32 },
  life: 20,
  size: 1,
  color: '#bfe9ff',
  gravityScale: 1.2,
};
