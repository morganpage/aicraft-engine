/**
 * Synthesized RPG audio cues over the existing `AudioAdapter`.
 *
 * Semantic cue names map to short oscillator/noise recipes; battle events
 * map to cues so presentation code never invents its own sound rules.
 * Every call is defensive: adapter failures (or a missing adapter) are
 * silent and never block state progression.
 */

import type { AudioAdapter } from '../audio/types';
import type { BattleEvent } from './battle-types';

export type RpgCue =
  | 'menuMove'
  | 'menuConfirm'
  | 'menuCancel'
  | 'encounter'
  | 'attack'
  | 'hit'
  | 'critical'
  | 'captureSuccess'
  | 'captureFail'
  | 'levelUp'
  | 'heal'
  | 'save';

interface CueRecipe {
  readonly kind: 'tone' | 'noise';
  readonly type?: OscillatorType;
  readonly f0?: number;
  readonly f1?: number;
  readonly durMs: number;
  readonly peak: number;
  readonly filter?: BiquadFilterType;
  readonly freq?: number;
}

const CUE_RECIPES: Readonly<Record<RpgCue, CueRecipe>> = Object.freeze({
  menuMove: { kind: 'tone', type: 'square', f0: 620, f1: 620, durMs: 40, peak: 0.05 },
  menuConfirm: { kind: 'tone', type: 'square', f0: 520, f1: 880, durMs: 90, peak: 0.07 },
  menuCancel: { kind: 'tone', type: 'square', f0: 420, f1: 260, durMs: 90, peak: 0.06 },
  encounter: { kind: 'tone', type: 'sawtooth', f0: 220, f1: 760, durMs: 260, peak: 0.09 },
  attack: { kind: 'tone', type: 'triangle', f0: 340, f1: 160, durMs: 110, peak: 0.08 },
  hit: { kind: 'noise', durMs: 90, peak: 0.09, filter: 'lowpass', freq: 1400 },
  critical: { kind: 'noise', durMs: 140, peak: 0.11, filter: 'bandpass', freq: 2400 },
  captureSuccess: { kind: 'tone', type: 'sine', f0: 520, f1: 1040, durMs: 300, peak: 0.08 },
  captureFail: { kind: 'tone', type: 'sine', f0: 480, f1: 180, durMs: 240, peak: 0.07 },
  levelUp: { kind: 'tone', type: 'square', f0: 440, f1: 1320, durMs: 380, peak: 0.08 },
  heal: { kind: 'tone', type: 'sine', f0: 660, f1: 990, durMs: 260, peak: 0.07 },
  save: { kind: 'tone', type: 'sine', f0: 880, f1: 880, durMs: 160, peak: 0.06 },
});

/** Play one semantic cue. Silent on any adapter failure; never throws. */
export function playRpgCue(adapter: AudioAdapter | null | undefined, cue: RpgCue): void {
  try {
    if (!adapter) return;
    const recipe = CUE_RECIPES[cue];
    if (!recipe) return;
    if (recipe.kind === 'tone') {
      adapter.playTone(recipe.type ?? 'sine', recipe.f0 ?? 440, recipe.f1 ?? 440, recipe.durMs, recipe.peak);
    } else {
      adapter.playNoise(recipe.durMs, recipe.filter ?? 'lowpass', recipe.freq ?? 1000, recipe.peak);
    }
  } catch {
    // Audio failures are silent and never block state progression.
  }
}

/** Map a battle event to its presentation cue, if it has one. */
export function rpgCueForBattleEvent(event: BattleEvent): RpgCue | null {
  switch (event.type) {
    case 'moveUsed':
      return 'attack';
    case 'damageDealt':
      return 'hit';
    case 'criticalHit':
      return 'critical';
    case 'captureAttempted':
      return null;
    case 'creatureCaptured':
      return 'captureSuccess';
    case 'creatureFainted':
      return 'captureFail';
    case 'levelGained':
      return 'levelUp';
    case 'battleEnded':
      return event.outcome === 'captured' ? 'captureSuccess' : null;
    default:
      return null;
  }
}

export { CUE_RECIPES as RPG_CUE_RECIPES };
