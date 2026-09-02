/**
 * Battle scene rendering and the event-driven presentation queue.
 *
 * `drawRpgBattleScene` renders the current authoritative battle state
 * immediately. The presentation queue converts typed `BattleEvent[]` into
 * timed cues that the renderer consumes for text/animation pacing —
 * skipping or accelerating them can never change simulation state, because
 * the queue only ever reads events.
 */

import type { BattleEvent, BattleState } from '../battle-types';
import type { CompiledRpgContent } from '../content';
import type { CreatureInstance, SpeciesDefinition } from '../creatures';
import { drawRpgCreature } from './creature-renderer';
import { drawHpBar } from './hud-renderer';
import type { RpgVisualTheme } from './theme';
import { DEFAULT_RPG_THEME } from './theme';

export interface RpgBattleDrawOptions {
  readonly width: number;
  readonly height: number;
  readonly tick: number;
  readonly theme?: RpgVisualTheme;
  readonly reducedMotion?: boolean;
}

function activeCreature(state: BattleState): CreatureInstance | undefined {
  return state.playerParty[state.activePlayerIndex];
}

/** Draw the full battle scene from authoritative state (immediate mode). */
export function drawRpgBattleScene(
  ctx: CanvasRenderingContext2D,
  state: BattleState,
  content: CompiledRpgContent,
  options: RpgBattleDrawOptions,
): void {
  const theme = options.theme ?? DEFAULT_RPG_THEME;

  ctx.fillStyle = theme.terrain.groundAlt;
  ctx.fillRect(0, 0, options.width, options.height);
  ctx.fillStyle = theme.terrain.ground;
  ctx.fillRect(0, options.height * 0.55, options.width, options.height * 0.45);

  const player = activeCreature(state);
  const playerSpecies = player ? content.species[player.speciesId] : undefined;
  const wildSpecies = content.species[state.wild.speciesId];

  if (player && playerSpecies) {
    drawRpgCreature(ctx, playerSpecies.visual, {
      x: options.width * 0.28,
      y: options.height * 0.68,
      size: options.height * 0.34,
      tick: options.tick,
      reducedMotion: options.reducedMotion,
    });
    drawHpBar(ctx, {
      x: 12,
      y: 12,
      width: options.width * 0.4,
      label: `${playerSpecies.name} L${player.level}`,
      current: player.currentHp,
      max: maxHpOf(playerSpecies, player),
      theme,
    });
  }
  if (wildSpecies) {
    drawRpgCreature(ctx, wildSpecies.visual, {
      x: options.width * 0.72,
      y: options.height * 0.42,
      size: options.height * 0.3,
      tick: options.tick,
      reducedMotion: options.reducedMotion,
    });
    drawHpBar(ctx, {
      x: options.width * 0.56,
      y: 12,
      width: options.width * 0.4,
      label: `${wildSpecies.name} L${state.wild.level}`,
      current: state.wild.currentHp,
      max: maxHpOf(wildSpecies, state.wild),
      theme,
    });
  }

  if (state.phase === 'ended' && state.outcome) {
    ctx.fillStyle = theme.panels.background;
    ctx.fillRect(options.width / 2 - 70, options.height / 2 - 14, 140, 28);
    ctx.fillStyle = theme.panels.text;
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(state.outcome.toUpperCase(), options.width / 2, options.height / 2 + 4);
    ctx.textAlign = 'left';
  }
}

function maxHpOf(species: SpeciesDefinition, creature: CreatureInstance): number {
  return species.baseStats.hp + 3 * creature.level;
}

// ---------------------------------------------------------------------------
// Presentation queue
// ---------------------------------------------------------------------------

export interface BattleCue {
  readonly event: BattleEvent;
  readonly durationS: number;
  readonly elapsedS: number;
}

export interface BattlePresentationQueue {
  /** Enqueue events emitted by the last battle step. */
  push(events: readonly BattleEvent[]): void;
  /** Advance cue timing by `dt` seconds (already scaled by the caller). */
  advance(dt: number): void;
  /** Complete every queued cue immediately (skip/fast-forward). */
  skipAll(): void;
  /** The cue currently being presented, if any. */
  activeCue(): BattleCue | null;
  /** Cues already drained this frame (for text/animation consumers). */
  drainCompleted(): readonly BattleEvent[];
  readonly pendingCount: number;
}

function cueDuration(event: BattleEvent): number {
  switch (event.type) {
    case 'damageDealt':
      return 0.45;
    case 'moveMissed':
      return 0.3;
    case 'criticalHit':
    case 'effectiveness':
      return 0.25;
    case 'creatureFainted':
      return 0.6;
    case 'captureAttempted':
      return 0.5;
    case 'creatureCaptured':
    case 'battleEnded':
      return 0.7;
    default:
      return 0.2;
  }
}

/**
 * Create the battle presentation queue. Purely presentational: it holds
 * emitted events and pacing only, and mutating it can never affect battle
 * state (verified by determinism tests that run with skips interleaved).
 */
export function createBattlePresentationQueue(): BattlePresentationQueue {
  let cues: BattleCue[] = [];
  let completed: BattleEvent[] = [];

  return {
    push(events) {
      for (const event of events) {
        cues.push({ event, durationS: cueDuration(event), elapsedS: 0 });
      }
    },
    advance(dt) {
      const safeDt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      const stillQueued: BattleCue[] = [];
      for (const cue of cues) {
        const elapsed = cue.elapsedS + safeDt;
        if (elapsed >= cue.durationS) {
          completed.push(cue.event);
        } else {
          stillQueued.push({ ...cue, elapsedS: elapsed });
        }
      }
      cues = stillQueued;
    },
    skipAll() {
      for (const cue of cues) completed.push(cue.event);
      cues = [];
    },
    activeCue() {
      return cues[0] ?? null;
    },
    drainCompleted() {
      const drained = completed;
      completed = [];
      return drained;
    },
    get pendingCount() {
      return cues.length;
    },
  };
}
