/**
 * Main entry points for procedural level generation.
 *
 * Provides three entry points:
 * - {@link generateBlueprint}: seed + config → macro route + rhythm (no geometry).
 * - {@link realizeBlueprint}: seed + blueprint → complete `GeneratedLevel` with geometry.
 * - {@link generateLevel}: seed + config → complete `GeneratedLevel` (ergonomic one-shot).
 *
 * `generateLevel` is the recommended entry point. The two-stage functions
 * remain public for consumers that want to author or inspect blueprints.
 *
 * Determinism: uses `mulberry32` for all randomness. No `Math.random`,
 * no `Date.now`, no global mutable state. Same `(seed, config)` → same
 * output, forever.
 *
 * @module
 */

import type { LevelBlueprint, LevelGenConfig, GeneratedLevel, RequiredMechanic } from './types';
import { generateRoute } from './route';
import { generateRhythm } from './rhythm';
import { realizeBlueprint as doRealize } from './realize';
import { DEFAULT_LEVEL_GEN_CONFIG } from './constants';

/**
 * Infer required mechanics from the pacing beats and route graph.
 *
 * Pure: never throws.
 */
function inferMechanics(blueprint: LevelBlueprint): readonly RequiredMechanic[] {
  const mechanics: RequiredMechanic[] = [];
  const beats = blueprint.pacing;
  const hasDash = beats.includes('dash');
  const hasJump = beats.includes('jump') || beats.includes('precisionJump') || beats.includes('climax');
  const hasBranch = blueprint.route.nodes.some((n) => n.kind === 'branch' || n.kind === 'reward');

  mechanics.push({ name: 'jump', enabled: hasJump || hasBranch });
  mechanics.push({ name: 'dash', enabled: hasDash });
  mechanics.push({ name: 'doubleJump', enabled: false });
  mechanics.push({ name: 'wallJump', enabled: false });
  mechanics.push({ name: 'wallSlide', enabled: false });

  return mechanics;
}

/**
 * Generate a {@link LevelBlueprint} from a seed and config.
 *
 * A blueprint contains the macro route graph and pacing/rhythm plan
 * without any concrete geometry. It is the intermediate representation
 * between macro design and tile-level realization.
 *
 * Pure: never mutates input, never throws. Same `(seed, config)` → same
 * blueprint, forever.
 *
 * @param seed   - Deterministic seed.
 * @param config - Optional generation config. Merged with
 *                 {@link DEFAULT_LEVEL_GEN_CONFIG}.
 * @returns A level blueprint with route, rhythm, and required mechanics.
 *
 * @example
 * ```ts
 * const blueprint = generateBlueprint(42, { cols: 60, difficulty: 0.7 });
 * // blueprint.route.nodes.length >= 2 (start + exit)
 * // blueprint.pacing.length >= 4
 * ```
 */
export function generateBlueprint(
  seed: number,
  config: Readonly<LevelGenConfig> = DEFAULT_LEVEL_GEN_CONFIG,
): LevelBlueprint {
  // Merge with defaults.
  const merged: LevelGenConfig = {
    ...DEFAULT_LEVEL_GEN_CONFIG,
    ...config,
  };

  const route = generateRoute(seed, merged);
  const pacing = generateRhythm(seed, merged);

  const difficulty = (typeof merged.difficulty === 'number' && Number.isFinite(merged.difficulty))
    ? Math.max(0, Math.min(1, merged.difficulty))
    : 0.5;

  // Create a temporary blueprint to infer mechanics, then build the final one.
  const tempBlueprint: LevelBlueprint = {
    version: 1,
    route,
    pacing,
    requiredMechanics: [],
    targetDifficulty: difficulty,
  };

  const requiredMechanics = inferMechanics(tempBlueprint);

  return {
    version: 1,
    route,
    pacing,
    requiredMechanics,
    targetDifficulty: difficulty,
  };
}

/**
 * Realize a blueprint into a complete generated level.
 *
 * This is the same as {@link realizeBlueprint} from `realize.ts` but
 * re-exported from this module for import convenience. It takes a seed
 * (for deterministic variation within the blueprint) and a config
 * (for dimensions and tile parameters).
 *
 * Pure: never mutates input, never throws.
 *
 * @param seed      - Deterministic seed for geometry variation.
 * @param blueprint - The blueprint to realize.
 * @param config    - Optional generation config.
 * @returns A complete generated level with tile semantics and report.
 *
 * @example
 * ```ts
 * const blueprint = generateBlueprint(42);
 * const level = realizeBlueprint(42, blueprint);
 * // level.level passes validateLevel
 * ```
 */
export function realizeBlueprint(
  seed: number,
  blueprint: Readonly<LevelBlueprint>,
  config: Readonly<LevelGenConfig> = DEFAULT_LEVEL_GEN_CONFIG,
): GeneratedLevel {
  return doRealize(seed, blueprint, config);
}

/**
 * Generate a complete level in one call (seed + config → `GeneratedLevel`).
 *
 * This is the recommended entry point for most consumers. It internally
 * calls {@link generateBlueprint} followed by {@link realizeBlueprint}.
 *
 * Pure: never mutates input, never throws. Same `(seed, config)` → same
 * level, forever.
 *
 * @param seed   - Deterministic seed.
 * @param config - Optional generation config. Merged with
 *                 {@link DEFAULT_LEVEL_GEN_CONFIG}.
 * @returns A complete generated level with tile semantics, editor op,
 *          and generation report.
 *
 * @example
 * ```ts
 * const result = generateLevel(42);
 * // result.level — valid LevelData
 * // result.editorOp — replaceLevel operation
 * // result.tileSemantics — { solid: [1], passthrough: [2] }
 * // result.report — GenerationReport with diagnostics
 * ```
 */
export function generateLevel(
  seed: number,
  config: Readonly<LevelGenConfig> = DEFAULT_LEVEL_GEN_CONFIG,
): GeneratedLevel {
  const merged: LevelGenConfig = {
    ...DEFAULT_LEVEL_GEN_CONFIG,
    ...config,
  };

  const blueprint = generateBlueprint(seed, merged);
  return doRealize(seed, blueprint, merged);
}
