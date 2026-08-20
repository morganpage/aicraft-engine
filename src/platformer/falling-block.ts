/**
 * FallingBlock — the Celeste prologue-style ceiling block, as a pure state
 * machine over plain rects. The game owns the tick loop and the consequences
 * (death, shake, sound, dust); this module owns the phase machine, the
 * Celeste-derived tuning, and the per-tick solids projection.
 *
 * Source of every constant: the decompiled Celeste entities.
 *   - Arms while the player is under ANY part of the footprint — a horizontal
 *     overlap with the block rect, X only (no Y condition), so walking the
 *     corridor underneath (or standing on the back of the block) arms it.
 *     Deliberately wider than `IntroCrusher.cs`'s centre-X band.
 *   - Shake 0.2 s, then a grace window of up to 0.4 s that keeps extending
 *     while the player stays under the footprint — `FallingBlock.cs`
 *     `Sequence()` semantics: once the shake starts the fall is committed;
 *     the window only delays it.
 *   - Fall: accel 500 px/s² to a 160 px/s cap, stopping flush on the first
 *     solid below. Blocks land on statics AND on landed blocks; a block that
 *     leaves the room entirely is `gone` (no solid, not drawn).
 *
 * LDtk authoring: a `FallingBlock` entity (any casing — the trigger fallback
 * preserves the identifier as `props.action`) with an optional integer
 * `tiletype` field naming the IntGrid material its art is painted with. The
 * block is a solid in every phase except `gone` — including while falling,
 * where the per-tick solids list carries its current rect.
 *
 * Determinism: pure — `advanceFallingBlocks` never mutates its inputs and
 * returns fresh block objects for every block that changed this tick. No
 * `Math.random` / `Date.now`, never throws.
 *
 * @module
 */

import type { Solid } from '../collision/types';
import type { LevelData } from '../level/types';

/** The LDtk entity identifier (and trigger `action`) this recipe consumes. */
export const FALLING_BLOCK_TRIGGER_ACTION = 'FallingBlock';

/**
 * Celeste-derived tuning, authored at the 8 px reference tile size (Celeste's
 * grid). No magic numbers outside this object.
 */
export interface FallingBlockTuning {
  /** Shake warning duration once armed (s). */
  readonly shakeTime: number;
  /** Max grace after the shake while the player stays under the footprint (s). */
  readonly graceTime: number;
  /** Fall acceleration (px/s²). */
  readonly accel: number;
  /** Terminal fall speed (px/s). */
  readonly maxSpeed: number;
  /** A block this far below the room has left it for good (px). */
  readonly roomEscapeMargin: number;
}

/** The Celeste numbers: shake 0.2 s, grace 0.4 s, accel 500, cap 160. */
export const FALLING_BLOCK_TUNING: Readonly<FallingBlockTuning> = Object.freeze({
  shakeTime: 0.2,
  graceTime: 0.4,
  accel: 500,
  maxSpeed: 160,
  roomEscapeMargin: 32,
});

/**
 * Unit-aware tile scaling for the tuning (the same discipline as
 * `scalePlatformerConfig`): distances/velocities/accelerations scale with the
 * tile size, times do not. An 8 px room uses the reference numbers verbatim.
 */
export function scaleFallingBlockTuning(
  tuning: Readonly<FallingBlockTuning>,
  tileSize: number,
  referenceTileSize = 8,
): FallingBlockTuning {
  const scale = referenceTileSize > 0 ? tileSize / referenceTileSize : 1;
  if (scale === 1) return { ...tuning };
  return {
    shakeTime: tuning.shakeTime,
    graceTime: tuning.graceTime,
    accel: tuning.accel * scale,
    maxSpeed: tuning.maxSpeed * scale,
    roomEscapeMargin: tuning.roomEscapeMargin * scale,
  };
}

/** Block phases; `landed` and `gone` are terminal. */
export type FallingBlockPhase = 'idle' | 'shaking' | 'falling' | 'landed' | 'gone';

/**
 * One block's state. `originY` (the authored Y) is kept separately from `y`
 * because the block's art is baked at its authored row — a consumer painting
 * the falling block with the level's own tiles renders from `originY` while
 * simulating from `y`.
 */
export interface FallingBlock {
  readonly id: string;
  /** Current top-left. `y` advances while falling; everything else is fixed. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Authored Y — the render source row (the block's art is baked there). */
  readonly originY: number;
  /**
   * IntGrid value the block paints for art — the LDtk `tiletype` field.
   * Defaults to 1 (walls); any future material value autotiles its own art.
   */
  readonly material: number;
  readonly phase: FallingBlockPhase;
  /** Seconds accumulated in the current phase (shake + grace while shaking). */
  readonly timer: number;
  /** Downward speed while falling (px/s). */
  readonly speed: number;
}

/** The player body the arming check reads (any AABB). */
export interface FallingBlockPlayer {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What happened this step — the game turns these into sound/shake/death. */
export interface FallingBlockEvents {
  /** Blocks that armed (idle → shaking) this step. */
  readonly armed: readonly FallingBlock[];
  /** Blocks that committed to falling (shaking → falling) this step. */
  readonly released: readonly FallingBlock[];
  /** Blocks that landed flush on a support (→ landed) this step. */
  readonly landed: readonly FallingBlock[];
  /** Blocks whose rect overlaps the player this step — a crush each tick it holds. */
  readonly crushed: readonly FallingBlock[];
}

/** Result of one advance: the next blocks plus this step's events. */
export interface FallingBlockStep {
  readonly blocks: readonly FallingBlock[];
  readonly events: FallingBlockEvents;
}

type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Options for {@link collectFallingBlocks}. */
export interface CollectFallingBlocksOptions {
  /**
   * The trigger `action` (the LDtk entity identifier) to collect. Default
   * {@link FALLING_BLOCK_TRIGGER_ACTION}. Override to consume a differently
   * named entity (`CeilingBlock`, …) without touching the module.
   */
  readonly action?: string;
  /** Tuning to bake per-block speed/margin scale from. Default: unscaled. */
  readonly tuning?: Readonly<FallingBlockTuning>;
}

/**
 * Collect the FallingBlocks of a compiled room's translated level data.
 * Unknown LDtk identifiers translate to `trigger` entities whose `action` is
 * the identifier and whose authored field values ride `props.fields`
 * (`tiletype` and friends), so this is a kind + action filter — no raw
 * `fieldInstances` reach-through.
 */
export function collectFallingBlocks(
  levelData: LevelData,
  options: Readonly<CollectFallingBlocksOptions> = {},
): FallingBlock[] {
  const action = options.action ?? FALLING_BLOCK_TRIGGER_ACTION;
  const blocks: FallingBlock[] = [];
  for (const entity of levelData.entities) {
    if (entity.kind !== 'trigger') continue;
    if (entity.props.action !== action) continue;
    const raw = entity.props.fields.tiletype;
    blocks.push({
      id: `falling:${entity.id}`,
      x: entity.rect.x,
      y: entity.rect.y,
      width: entity.rect.width,
      height: entity.rect.height,
      originY: entity.rect.y,
      material: typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : 1,
      phase: 'idle',
      timer: 0,
      speed: 0,
    });
  }
  return blocks;
}

/** The rects to append to a room's per-tick solids (every phase but `gone`). */
export function fallingBlockSolids(blocks: readonly FallingBlock[]): Solid[] {
  return blocks
    .filter((block) => block.phase !== 'gone')
    .map((block) => ({ id: block.id, x: block.x, y: block.y, width: block.width, height: block.height }));
}

/** Armed while the player's rect overlaps the footprint on X (X only). */
export function fallingBlockArmed(block: FallingBlock, player: FallingBlockPlayer | null): boolean {
  if (!player) return false;
  return player.x + player.width > block.x && player.x < block.x + block.width;
}

/** The empty-events singleton for steps where nothing fired. */
const NO_EVENTS: FallingBlockEvents = Object.freeze({
  armed: [],
  released: [],
  landed: [],
  crushed: [],
});

/**
 * Advance every block one tick. `solids` is the room's collision set WITHOUT
 * the blocks themselves (blocks collide with statics and with each other
 * here, via their pre-step rects, so a block above another sees THIS tick's
 * support, not a half-updated one). Pure: returns fresh block objects for
 * every block that changed; unchanged blocks keep their reference.
 */
export function advanceFallingBlocks(
  blocks: readonly FallingBlock[],
  player: FallingBlockPlayer | null,
  solids: readonly Solid[],
  roomHeight: number,
  dt: number,
  tuning: Readonly<FallingBlockTuning> = FALLING_BLOCK_TUNING,
): FallingBlockStep {
  if (!Number.isFinite(dt) || dt <= 0) return { blocks, events: NO_EVENTS };

  const armed: FallingBlock[] = [];
  const released: FallingBlock[] = [];
  const landed: FallingBlock[] = [];
  const crushed: FallingBlock[] = [];
  // Snapshot the pre-step rects so block-on-block support sees THIS tick's
  // geometry, not a half-updated one.
  const before = blocks.map((block) => ({ id: block.id, x: block.x, y: block.y, width: block.width, height: block.height }));
  const next: FallingBlock[] = [];

  for (const block of blocks) {
    if (block.phase === 'landed' || block.phase === 'gone') {
      next.push(block);
      continue;
    }

    let current = block;

    if (current.phase === 'idle') {
      if (fallingBlockArmed(current, player)) {
        current = { ...current, phase: 'shaking', timer: 0 };
        armed.push(current);
      } else {
        next.push(current);
        continue;
      }
    }

    if (current.phase === 'shaking') {
      const timer = current.timer + dt;
      const graceElapsed = timer - tuning.shakeTime;
      const shaking = graceElapsed < 0;
      // Celeste: the grace window keeps extending while the player stays
      // under the footprint and closes early once they leave — the fall is
      // already committed either way.
      const stillWaiting =
        shaking || (graceElapsed < tuning.graceTime && fallingBlockArmed(current, player));
      if (stillWaiting) {
        next.push({ ...current, timer });
        continue;
      }
      current = { ...current, phase: 'falling', timer: 0, speed: 0 };
      released.push(current);
    }

    // falling (possibly just transitioned above): accelerate, move, collide.
    const speed = Math.min(current.speed + tuning.accel * dt, tuning.maxSpeed);
    const dy = speed * dt;
    const candidate = { x: current.x, y: current.y + dy, width: current.width, height: current.height };
    // First support surface at or below the current bottom: statics plus the
    // other blocks' pre-step rects (a falling block never lands on itself).
    let supportTop = Infinity;
    for (const solid of solids) {
      if (
        solid.x < candidate.x + candidate.width &&
        solid.x + solid.width > candidate.x &&
        solid.y >= current.y + current.height - 1e-6
      ) {
        supportTop = Math.min(supportTop, solid.y);
      }
    }
    for (const other of before) {
      // Only a block whose top is at/below our current bottom can support;
      // blocks beside or above us are not surfaces.
      if (other.id === current.id || other.y < current.y + current.height - 1e-6) continue;
      if (other.x < candidate.x + candidate.width && other.x + other.width > candidate.x) {
        supportTop = Math.min(supportTop, other.y);
      }
    }
    let settled: FallingBlock;
    if (candidate.y + candidate.height >= supportTop) {
      settled = { ...current, y: supportTop - current.height, speed, phase: 'landed', timer: 0 };
      landed.push(settled);
    } else {
      settled = { ...current, y: candidate.y, speed };
      if (settled.y > roomHeight + tuning.roomEscapeMargin) {
        settled = { ...settled, phase: 'gone' };
      }
    }
    if (player && overlap(settled, player)) crushed.push(settled);
    next.push(settled);
  }

  const events: FallingBlockEvents = { armed, released, landed, crushed };
  return { blocks: next, events };
}
