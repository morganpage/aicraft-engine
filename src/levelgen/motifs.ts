/**
 * Motif catalog for procedural level generation.
 *
 * Each motif is a small, curated geometry pattern that can be placed to
 * realize one or more pacing beats. Motifs declare their compatible beats,
 * required player mechanics, intensity range, and minimum safety margin.
 *
 * The motif catalog is a flat readonly array. Consumers may extend it
 * by defining additional motifs outside this module.
 *
 * Determinism: all data is static — no randomness, no mutable state.
 *
 * @module
 */

import type { PacingBeat, RequiredMechanic } from './types';

/**
 * A single geometry motif — a reusable pattern for placement.
 */
export interface Motif {
  /** Stable motif identifier (e.g. `'safe-intro-jump'`). */
  readonly id: string;
  /** Pacing beats this motif can realize. */
  readonly compatibleBeats: readonly PacingBeat[];
  /** Mechanics required by this motif (e.g. `jump` for any gap motif). */
  readonly requiredMechanics: readonly RequiredMechanic[];
  /** Intensity range `[min, max]` — both in `[0, 1]`. */
  readonly intensityRange: readonly [number, number];
  /** Minimum jump safety margin in pixels. */
  readonly minSafetyMargin: number;
}

/**
 * Convenience helper for defining a "jump enabled" mechanic reference.
 */
const JUMP_REQUIRED: readonly RequiredMechanic[] = [
  { name: 'jump', enabled: true },
];

/**
 * Convenience helper for empty mechanics array.
 */
const NO_MECHANICS: readonly RequiredMechanic[] = [];

/**
 * The initial motif catalog shipped with the engine.
 *
 * Each motif is a small curated geometry chunk. The full list (11 initial
 * motifs):
 *
 * 1. **safe-intro-jump** — Wide, low gap suitable for the first jump.
 * 2. **stair-ascent**   — Rising staircase of platforms.
 * 3. **stair-descent**  — Descending staircase of platforms.
 * 4. **short-gap-series** — Two or three small gaps in quick succession.
 * 5. **wide-landing-after-hard-jump** — Extra-wide landing after a gap.
 * 6. **drop-with-recovery** — Drop down to a lower platform with a safety net.
 * 7. **hazard-corridor** — Narrow passage with a hazard below.
 * 8. **moving-platform-transfer** — Requires a moving platform to cross.
 * 9. **optional-risky-collectible** — Collectible placed over a hazard.
 * 10. **key-detour** — A key/switch collectible off the main path.
 * 11. **pre-exit-climax** — Final challenging section before the exit.
 */
export const MOTIF_CATALOG: readonly Motif[] = [
  {
    id: 'safe-intro-jump',
    compatibleBeats: ['introduce', 'run', 'jump'],
    requiredMechanics: JUMP_REQUIRED,
    intensityRange: [0.0, 0.35],
    minSafetyMargin: 8,
  },
  {
    id: 'stair-ascent',
    compatibleBeats: ['run', 'jump'],
    requiredMechanics: JUMP_REQUIRED,
    intensityRange: [0.2, 0.6],
    minSafetyMargin: 4,
  },
  {
    id: 'stair-descent',
    compatibleBeats: ['run', 'rest', 'release'],
    requiredMechanics: JUMP_REQUIRED,
    intensityRange: [0.1, 0.4],
    minSafetyMargin: 4,
  },
  {
    id: 'short-gap-series',
    compatibleBeats: ['jump', 'precisionJump'],
    requiredMechanics: JUMP_REQUIRED,
    intensityRange: [0.3, 0.7],
    minSafetyMargin: 3,
  },
  {
    id: 'wide-landing-after-hard-jump',
    compatibleBeats: ['jump', 'precisionJump', 'climax'],
    requiredMechanics: JUMP_REQUIRED,
    intensityRange: [0.4, 0.8],
    minSafetyMargin: 6,
  },
  {
    id: 'drop-with-recovery',
    compatibleBeats: ['jump', 'run', 'rest'],
    requiredMechanics: JUMP_REQUIRED,
    intensityRange: [0.2, 0.5],
    minSafetyMargin: 4,
  },
  {
    id: 'hazard-corridor',
    compatibleBeats: ['run', 'climax'],
    requiredMechanics: NO_MECHANICS,
    intensityRange: [0.4, 0.8],
    minSafetyMargin: 0,
  },
  {
    id: 'moving-platform-transfer',
    compatibleBeats: ['jump', 'precisionJump', 'climax'],
    requiredMechanics: JUMP_REQUIRED,
    intensityRange: [0.5, 0.9],
    minSafetyMargin: 4,
  },
  {
    id: 'optional-risky-collectible',
    compatibleBeats: ['branch', 'reward', 'run'],
    requiredMechanics: JUMP_REQUIRED,
    intensityRange: [0.3, 0.7],
    minSafetyMargin: 2,
  },
  {
    id: 'key-detour',
    compatibleBeats: ['branch', 'reward'],
    requiredMechanics: JUMP_REQUIRED,
    intensityRange: [0.3, 0.7],
    minSafetyMargin: 4,
  },
  {
    id: 'pre-exit-climax',
    compatibleBeats: ['climax', 'release'],
    requiredMechanics: JUMP_REQUIRED,
    intensityRange: [0.6, 1.0],
    minSafetyMargin: 4,
  },
];

/**
 * Look up a motif by id.
 *
 * Pure: never throws; returns `undefined` for unknown ids.
 *
 * @param id - Motif identifier (e.g. `'safe-intro-jump'`).
 * @returns The matching motif, or `undefined` if not found.
 */
export function findMotif(id: string): Motif | undefined {
  return MOTIF_CATALOG.find((m) => m.id === id);
}

/**
 * Find motifs compatible with a given pacing beat and intensity.
 *
 * Filters the catalog to motifs whose `compatibleBeats` includes the
 * requested beat and whose `intensityRange` contains the given intensity.
 *
 * Pure: never throws; returns an empty array for unknown beats.
 *
 * @param beat      - The pacing beat to match.
 * @param intensity - Current intensity `[0, 1]`.
 * @returns Array of compatible motifs (may be empty).
 */
export function findCompatibleMotifs(
  beat: PacingBeat,
  intensity: number,
): readonly Motif[] {
  return MOTIF_CATALOG.filter((m) => {
    const beatMatch = m.compatibleBeats.includes(beat);
    const intensityMatch = intensity >= m.intensityRange[0] && intensity <= m.intensityRange[1];
    return beatMatch && intensityMatch;
  });
}
